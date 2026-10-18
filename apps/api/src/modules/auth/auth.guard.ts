import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Role } from "@prisma/client";
import { AuthRequest } from "../../common/http";
import { AuthService } from "./auth.service";
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private auth: AuthService,
  ) {}
  async canActivate(context: ExecutionContext) {
    if (
      this.reflector.getAllAndOverride<boolean>("public", [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true;
    const req = context.switchToHttp().getRequest<AuthRequest>();
    const token = req.cookies?.access;
    if (!token) throw new UnauthorizedException("Войдите в аккаунт");
    req.actor = await this.auth.authenticate(token);
    const roles = this.reflector.getAllAndOverride<Role[]>("roles", [
      context.getHandler(),
      context.getClass(),
    ]);
    if (roles && !roles.includes(req.actor.role))
      throw new ForbiddenException("Недостаточно прав");
    return true;
  }
}
