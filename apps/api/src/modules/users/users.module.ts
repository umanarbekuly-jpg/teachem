import {
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  Patch,
  BadRequestException,
  ConflictException,
} from "@nestjs/common";
import { ApiProperty, ApiPropertyOptional, ApiTags } from "@nestjs/swagger";
import {
  IsString,
  IsOptional,
  Length,
  MaxLength,
  isEmail,
} from "class-validator";
import { Transform } from "class-transformer";
import { compare } from "bcryptjs";
import { Prisma } from "@prisma/client";
import {
  Database,
  Transaction,
} from "../../infrastructure/database/database.module";
import {
  Actor,
  CurrentUser,
  PageDto,
  pageArgs,
  paged,
} from "../../common/http";
export const userSelect = {
  id: true,
  name: true,
  surname: true,
  email: true,
  role: true,
  blockedAt: true,
  createdAt: true,
  mustChangePassword: true,
  authVersion: true,
} as const;
export const publicUserSelect = { id: true, name: true } as const;
export class UpdateUserDto {
  @ApiProperty()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @Length(2, 100)
  name!: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MaxLength(100)
  surname?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === "string" ? value.trim().toLowerCase() : value,
  )
  @IsString()
  @MaxLength(254)
  email?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 72)
  currentPassword?: string;
}
@Injectable()
export class UsersRepository {
  constructor(private db: Database) {}
  async list(q: PageDto) {
    const [items, total] = await Promise.all([
      this.db.user.findMany({
        where: { deletedAt: null },
        select: userSelect,
        ...pageArgs(q),
        orderBy: { createdAt: "desc" },
      }),
      this.db.user.count({ where: { deletedAt: null } }),
    ]);
    return paged(items, total, q);
  }
  byEmail(email: string) {
    return this.db.user.findUnique({ where: { email } });
  }
  byId(id: string) {
    return this.db.user.findFirstOrThrow({
      where: { id, deletedAt: null },
      select: userSelect,
    });
  }
  create(data: {
    email: string;
    passwordHash: string;
    name: string;
    role: "student" | "tutor";
  }) {
    return this.db.user.create({ data, select: userSelect });
  }
  async update(actor: Actor, dto: UpdateUserDto) {
    const user = await this.db.user.findUniqueOrThrow({
      where: { id: actor.id },
    });
    const email = dto.email ?? user.email;
    if (
      !isEmail(email) &&
      !(user.role === "SUPERADMIN" && email === "supadmin@teachem")
    )
      throw new BadRequestException({
        message: "Проверьте email",
        fields: { email: "Укажите корректный email" },
      });
    const emailChanged = email !== user.email;
    if (
      emailChanged &&
      (!dto.currentPassword ||
        !(await compare(dto.currentPassword, user.passwordHash)))
    )
      throw new BadRequestException({
        message: "Не удалось изменить email",
        fields: { currentPassword: "Введите верный текущий пароль" },
      });
    try {
      return await this.db.atomic(async (tx) => {
        // A password reset or role change during verification must invalidate this write.
        const changed = await tx.user.updateMany({
          where: {
            id: actor.id,
            authVersion: user.authVersion,
            email: user.email,
            blockedAt: null,
            deletedAt: null,
            mustChangePassword: false,
          },
          data: {
            name: dto.name,
            ...(dto.surname !== undefined ? { surname: dto.surname } : {}),
            email,
            ...(emailChanged ? { emailVerifiedAt: null } : {}),
          },
        });
        if (changed.count !== 1)
          throw new ConflictException(
            "Аккаунт изменился. Обновите страницу и повторите действие",
          );
        return tx.user.findUniqueOrThrow({
          where: { id: actor.id },
          select: userSelect,
        });
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        throw new ConflictException({
          message: "Этот email уже используется",
          fields: { email: "Этот email уже используется" },
        });
      throw error;
    }
  }
  block(id: string, blocked: boolean, tx: Transaction) {
    return tx.user.update({
      where: { id },
      data: {
        blockedAt: blocked ? new Date() : null,
        authVersion: { increment: 1 },
      },
      select: userSelect,
    });
  }
}
@Injectable()
export class UsersService {
  constructor(private repo: UsersRepository) {}
  list(q: PageDto) {
    return this.repo.list(q);
  }
  byEmail(email: string) {
    return this.repo.byEmail(email.trim().toLowerCase());
  }
  byId(id: string) {
    return this.repo.byId(id);
  }
  create(data: {
    email: string;
    passwordHash: string;
    name: string;
    role: "student" | "tutor";
  }) {
    return this.repo.create({
      ...data,
      email: data.email.trim().toLowerCase(),
    });
  }
  update(actor: Actor, dto: UpdateUserDto) {
    return this.repo.update(actor, dto);
  }
  block(id: string, blocked: boolean, tx: Transaction) {
    return this.repo.block(id, blocked, tx);
  }
}
@ApiTags("users")
@Controller("users")
export class UsersController {
  constructor(private service: UsersService) {}
  @Get("me") me(@CurrentUser() actor: Actor) {
    return this.service.byId(actor.id);
  }
  @Patch("me") update(@CurrentUser() actor: Actor, @Body() dto: UpdateUserDto) {
    return this.service.update(actor, dto);
  }
}
@Module({
  controllers: [UsersController],
  providers: [UsersService, UsersRepository],
  exports: [UsersService],
})
export class UsersModule {}
