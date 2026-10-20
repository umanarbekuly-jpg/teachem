import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Injectable,
  Logger,
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from "@nestjs/common";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsInt, IsOptional, Max, Min } from "class-validator";
import { Type } from "class-transformer";
import { Prisma, Role } from "@prisma/client";
import type { Request, Response } from "express";
export interface Actor {
  id: string;
  role: Role;
  sessionId: string;
  mustChangePassword?: boolean;
}
export type AuthRequest = Request & { actor: Actor; requestId: string };
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) =>
    ctx.switchToHttp().getRequest<AuthRequest>().actor,
);
export const PasswordAllowed = () => SetMetadata("passwordAllowed", true);
export const Public = () => SetMetadata("public", true);
export const Roles = (...roles: Role[]) => SetMetadata("roles", roles);
export class PageDto {
  @ApiPropertyOptional({ type: Number, default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;
  @ApiPropertyOptional({ type: Number, default: 20, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 20;
}
export function pageArgs(q: PageDto) {
  return { skip: (q.page - 1) * q.pageSize, take: q.pageSize };
}
export function paged<T>(items: T[], total: number, q: PageDto) {
  return { items, total, page: q.page, pageSize: q.pageSize };
}
export class ErrorDto {
  @ApiProperty() code!: string;
  @ApiProperty() message!: string;
  @ApiPropertyOptional() @IsOptional() details?: string[];
  @ApiProperty() requestId!: string;
}
@Catch()
@Injectable()
export class ApiErrors implements ExceptionFilter {
  private logger = new Logger("HTTP");
  catch(error: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<AuthRequest>();
    const res = ctx.getResponse<Response>();
    let status = 500;
    let message = "Внутренняя ошибка сервера";
    let details: unknown;
    let fields: unknown;
    if (error instanceof HttpException) {
      status = error.getStatus();
      const body = error.getResponse();
      if (typeof body === "object")
        fields = (body as { fields?: unknown }).fields;
      const value =
        typeof body === "string"
          ? body
          : (body as { message: unknown }).message;
      if (Array.isArray(value)) {
        message = "Проверьте заполненные поля";
        details = value;
      } else message = String(value);
    } else if (error instanceof Prisma.PrismaClientValidationError) {
      status = 400;
      message = "Некорректные данные запроса";
    } else if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      ["P2002", "P2025", "P2003", "P2034"].includes(error.code)
    ) {
      status = error.code === "P2025" ? 404 : 409;
      message =
        status === 404
          ? "Запись не найдена"
          : "Конфликт данных. Обновите страницу и повторите действие";
    } else
      this.logger.error(
        JSON.stringify({
          requestId: req.requestId,
          error: error instanceof Error ? error.name : "UnknownError",
        }),
      );
    res.status(status).json({
      code: `HTTP_${status}`,
      message,
      ...(details ? { details } : {}),
      ...(fields ? { fields } : {}),
      requestId: req.requestId,
    });
  }
}
