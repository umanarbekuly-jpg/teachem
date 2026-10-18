import {
  Body,
  Controller,
  Get,
  Inject,
  Module,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import { randomBytes } from "crypto";
import { Actor, CurrentUser, Public } from "../../common/http";
import { ENV, Environment } from "../../config/env";
import { UsersModule, UsersService } from "../users/users.module";
import { AuthService } from "./auth.service";
import { AuthRepository } from "./auth.repository";
import { LoginDto, RegisterDto, UserView } from "./auth.dto";
@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(
    private service: AuthService,
    private users: UsersService,
    @Inject(ENV) private env: Environment,
  ) {}
  private cookies(res: Response, tokens: { access: string; refresh: string }) {
    const options = {
      httpOnly: true,
      secure: this.env.COOKIE_SECURE,
      sameSite: "lax" as const,
    };
    res.cookie("access", tokens.access, {
      ...options,
      path: "/",
      maxAge: 900000,
    });
    res.cookie("refresh", tokens.refresh, {
      ...options,
      path: "/",
      maxAge: 30 * 86400000,
    });
  }
  @Public() @Get("csrf") csrf(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const previous = req.cookies?.csrf;
    const token = typeof previous === "string" && /^[a-f0-9]{64}$/.test(previous) ? previous : randomBytes(32).toString("hex");
    res.cookie("csrf", token, {
      httpOnly: true,
      secure: this.env.COOKIE_SECURE,
      sameSite: "lax",
      path: "/",
    });
    return { token };
  }
  @Public()
  @Throttle({ default: { limit: 8, ttl: 60000 } })
  @Post("register")
  @ApiCreatedResponse({ type: UserView })
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tokens = await this.service.register(dto);
    this.cookies(res, tokens);
    return tokens.user;
  }
  @Public()
  @Throttle({ default: { limit: 8, ttl: 60000 } })
  @Post("login")
  @ApiCreatedResponse({ type: UserView })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tokens = await this.service.login(dto);
    this.cookies(res, tokens);
    return tokens.user;
  }
  @Public()
  @Post("refresh")
  @ApiCreatedResponse({ type: UserView })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!req.cookies?.refresh)
      throw new UnauthorizedException("Войдите в аккаунт");
    const tokens = await this.service.refresh(req.cookies.refresh);
    this.cookies(res, tokens);
    return tokens.user;
  }
  @Post("logout") async logout(
    @CurrentUser() actor: Actor,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.service.logout(actor.sessionId);
    res.clearCookie("access", { path: "/" });
    res.clearCookie("refresh", { path: "/" });
    return { ok: true };
  }
  @Get("me") @ApiOkResponse({ type: UserView }) me(
    @CurrentUser() actor: Actor,
  ) {
    return this.users.byId(actor.id);
  }
}
@Module({
  imports: [UsersModule],
  controllers: [AuthController],
  providers: [AuthService, AuthRepository],
  exports: [AuthService],
})
export class AuthModule {}
