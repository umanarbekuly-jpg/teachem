import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { compare, hash } from "bcryptjs";
import { createHash, randomUUID } from "crypto";
import { sign, verify, JwtPayload } from "jsonwebtoken";
import { ENV, Environment } from "../../config/env";
import { UsersService } from "../users/users.module";
import { AuthRepository } from "./auth.repository";
import { LoginDto, RegisterDto } from "./auth.dto";
import { Actor } from "../../common/http";
import { Transaction } from "../../infrastructure/database/database.module";
const digest = (token: string) =>
  createHash("sha256").update(token).digest("hex");
@Injectable()
export class AuthService {
  constructor(
    private users: UsersService,
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
    return this.issue(user.id);
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
    return this.issue(user.id);
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
    return { id: user.id, role: user.role, sessionId: session.id };
  }
  private async issue(userId: string) {
    const id = randomUUID();
    const expiresAt = new Date(Date.now() + 30 * 86400000);
    const refresh = this.token(userId, id, true, expiresAt);
    await this.repo.create(id, userId, digest(refresh), expiresAt);
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
  logout(sid: string) {
    return this.repo.revoke(sid);
  }
  revokeUser(userId: string, tx: Transaction) {
    return this.repo.revokeUser(userId, tx);
  }
}
