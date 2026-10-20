import {
  BadRequestException,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { compare, hash } from "bcryptjs";
import { createHash, randomUUID } from "crypto";
import { sign, verify, JwtPayload } from "jsonwebtoken";
import { ENV, Environment } from "../../config/env";
import { UsersService } from "../users/users.module";
import { AuthRepository } from "./auth.repository";
import { LoginDto, RegisterDto } from "./auth.dto";
import { Actor } from "../../common/http";
import { ChangePasswordDto } from "./password.dto";
import {
  Database,
  Transaction,
} from "../../infrastructure/database/database.module";
const digest = (token: string) =>
  createHash("sha256").update(token).digest("hex");
@Injectable()
export class AuthService {
  constructor(
    private users: UsersService,
    private db: Database,
    private repo: AuthRepository,
    @Inject(ENV) private env: Environment,
  ) {}
  async register(dto: RegisterDto) {
    const user = await this.users.create({
      email: dto.email,
      name: dto.name,
      role: dto.role,
      passwordHash: await hash(dto.password, 12),
    });
    return this.issue(user.id, user.authVersion);
  }
  async login(dto: LoginDto) {
    const user = await this.users.byEmail(dto.email);
    if (
      !user ||
      user.blockedAt ||
      user.deletedAt ||
      !(await compare(dto.password, user.passwordHash))
    )
      throw new UnauthorizedException("Неверный email или пароль");
    return this.issue(user.id, user.authVersion);
  }
  private token(
    userId: string,
    sid: string,
    refresh = false,
    expiresAt?: Date,
  ) {
    const ttl = refresh
      ? Math.max(
          1,
          Math.floor(
            ((expiresAt?.getTime() ?? Date.now() + 30 * 86400000) -
              Date.now()) /
              1000,
          ),
        )
      : 900;
    return sign(
      { sid, type: refresh ? "refresh" : "access" },
      refresh ? this.env.JWT_REFRESH_SECRET : this.env.JWT_ACCESS_SECRET,
      {
        subject: userId,
        issuer: "tutor-api",
        audience: "tutor-web",
        algorithm: "HS256",
        jwtid: randomUUID(),
        expiresIn: ttl,
      },
    );
  }
  private decode(token: string, refresh = false): JwtPayload {
    try {
      const payload = verify(
        token,
        refresh ? this.env.JWT_REFRESH_SECRET : this.env.JWT_ACCESS_SECRET,
        { algorithms: ["HS256"], issuer: "tutor-api", audience: "tutor-web" },
      );
      if (
        typeof payload === "string" ||
        payload.type !== (refresh ? "refresh" : "access") ||
        typeof payload.sub !== "string" ||
        typeof payload.sid !== "string"
      )
        throw new Error();
      return payload;
    } catch {
      throw new UnauthorizedException("Войдите в аккаунт");
    }
  }
  async authenticate(token: string): Promise<Actor> {
    const payload = this.decode(token);
    const session = await this.repo.find(payload.sid);
    if (
      !session ||
      session.userId !== payload.sub ||
      session.revokedAt ||
      session.expiresAt <= new Date()
    )
      throw new UnauthorizedException("Сессия завершена");
    const user = await this.users.byId(session.userId);
    if (user.blockedAt) throw new UnauthorizedException("Аккаунт заблокирован");
    if (session.authVersion !== user.authVersion)
      throw new UnauthorizedException("Сессия завершена");
    return {
      id: user.id,
      role: user.role,
      sessionId: session.id,
      mustChangePassword: user.mustChangePassword,
    };
  }
  private async issue(userId: string, authVersion: number) {
    const id = randomUUID();
    const expiresAt = new Date(Date.now() + 30 * 86400000);
    const refresh = this.token(userId, id, true, expiresAt);
    await this.repo.create(id, userId, digest(refresh), expiresAt, authVersion);
    return {
      user: await this.users.byId(userId),
      access: this.token(userId, id),
      refresh,
    };
  }
  async refresh(token: string) {
    const payload = this.decode(token, true);
    const session = await this.repo.find(payload.sid);
    if (
      !session ||
      session.userId !== payload.sub ||
      session.revokedAt ||
      session.expiresAt <= new Date()
    )
      throw new UnauthorizedException("Сессия завершена");
    if (session.refreshTokenHash !== digest(token)) {
      await this.repo.revoke(session.id);
      throw new UnauthorizedException("Сессия отозвана");
    }
    const user = await this.users.byId(session.userId);
    if (user.blockedAt) throw new UnauthorizedException("Аккаунт заблокирован");
    if (session.authVersion !== user.authVersion || user.mustChangePassword)
      throw new UnauthorizedException("Смените пароль или войдите заново");
    const refresh = this.token(user.id, session.id, true, session.expiresAt);
    const rotated = await this.repo.rotate(
      session.id,
      digest(token),
      digest(refresh),
    );
    if (rotated.count !== 1)
      throw new UnauthorizedException("Токен уже обновлён");
    return { user, access: this.token(user.id, session.id), refresh };
  }
  async changePassword(
    actor: Actor,
    dto: ChangePasswordDto,
    requestId: string,
  ) {
    if (dto.newPassword !== dto.confirmPassword)
      throw new BadRequestException("Пароли не совпадают");
    const user = await this.db.user.findUniqueOrThrow({
      where: { id: actor.id },
    });
    if (!(await compare(dto.currentPassword, user.passwordHash)))
      throw new BadRequestException("Текущий пароль неверен");
    if (await compare(dto.newPassword, user.passwordHash))
      throw new BadRequestException(
        "Новый пароль должен отличаться от текущего",
      );
    const passwordHash = await hash(dto.newPassword, 12);
    await this.db.atomic(async (tx) => {
      const changed = await tx.user.updateMany({
        where: { id: actor.id, authVersion: user.authVersion },
        data: {
          passwordHash,
          mustChangePassword: false,
          authVersion: { increment: 1 },
        },
      });
      if (changed.count !== 1)
        throw new BadRequestException("Аккаунт изменился. Войдите заново");
      await this.repo.revokeUser(actor.id, tx);
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "user.password.change",
          entityType: "User",
          entityId: actor.id,
          requestId,
          metadata: {},
        },
      });
    });
    return { ok: true };
  }
  logout(sid: string) {
    return this.repo.revoke(sid);
  }
  revokeUser(userId: string, tx: Transaction) {
    return this.repo.revokeUser(userId, tx);
  }
}
