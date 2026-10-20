import {
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  Patch,
} from "@nestjs/common";
import { ApiProperty, ApiTags } from "@nestjs/swagger";
import { IsString, Length } from "class-validator";
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
  email: true,
  role: true,
  blockedAt: true,
  createdAt: true,
  mustChangePassword: true,
  authVersion: true,
} as const;
export const publicUserSelect = { id: true, name: true } as const;
export class UpdateUserDto {
  @ApiProperty() @IsString() @Length(2, 100) name!: string;
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
  update(id: string, name: string) {
    return this.db.user.update({
      where: { id },
      data: { name },
      select: userSelect,
    });
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
  update(id: string, name: string) {
    return this.repo.update(id, name);
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
    return this.service.update(actor.id, dto.name);
  }
}
@Module({
  controllers: [UsersController],
  providers: [UsersService, UsersRepository],
  exports: [UsersService],
})
export class UsersModule {}
