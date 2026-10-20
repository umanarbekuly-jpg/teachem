import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { ApiProperty, ApiPropertyOptional, ApiTags } from "@nestjs/swagger";
import { IsInt, IsOptional, IsString, Length, Max, Min } from "class-validator";
import {
  Actor,
  AuthRequest,
  CurrentUser,
  PageDto,
  pageArgs,
  paged,
  Roles,
} from "../../common/http";
import { Database } from "../../infrastructure/database/database.module";
import { UsersModule, UsersService } from "../users/users.module";
import { AuthModule } from "../auth/auth.module";
import { AuthService } from "../auth/auth.service";
import { PaymentsModule } from "../payments/payments.module";
import { PaymentsService } from "../payments/payments.service";
import { PaymentQuery } from "../payments/payments.dto";
import { PayoutsModule, PayoutsService } from "../payouts/payouts.module";
import { AuditService, SettingsService } from "./settings.module";
export class RejectDto {
  @ApiProperty() @IsString() @Length(3, 1000) reason!: string;
}
export class PaidDto {
  @ApiProperty() @IsString() @Length(3, 200) reference!: string;
}
export class SettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  commissionBps?: number;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(10, 5000)
  paymentDetails?: string;
}
@Injectable()
export class AdminService {
  constructor(
    private db: Database,
    private users: UsersService,
    private auth: AuthService,
    private audit: AuditService,
    private settings: SettingsService,
    private payouts: PayoutsService,
  ) {}
  async listUsers(q: PageDto) {
    return this.users.list(q);
  }
  async block(id: string, a: Actor, blocked: boolean, requestId: string) {
    if (id === a.id) throw new BadRequestException("Нельзя заблокировать себя");
    const user = await this.users.byId(id);
    if (user.role === "SUPERADMIN")
      throw new BadRequestException("Блокировка администратора недоступна");
    return this.db.atomic(async (tx) => {
      const result = await this.users.block(id, blocked, tx);
      if (blocked) await this.auth.revokeUser(id, tx);
      await this.audit.write(
        tx,
        a.id,
        blocked ? "user.block" : "user.unblock",
        "User",
        id,
        requestId,
      );
      return result;
    });
  }
  async logs(q: PageDto) {
    const [items, total] = await Promise.all([
      this.db.auditLog.findMany({
        ...pageArgs(q),
        orderBy: { createdAt: "desc" },
      }),
      this.db.auditLog.count(),
    ]);
    return paged(items, total, q);
  }
  async updateSettings(a: Actor, dto: SettingsDto, requestId: string) {
    return this.db.atomic(async (tx) => {
      const r = await this.settings.update(a.id, dto, tx);
      await this.audit.write(
        tx,
        a.id,
        "settings.update",
        "PlatformSetting",
        "platform",
        requestId,
        { keys: Object.keys(dto) },
      );
      return r;
    });
  }
  async paid(id: string, a: Actor, reference: string, requestId: string) {
    return this.db.atomic(async (tx) => {
      const r = await this.payouts.markPaid(tx, id, a.id, reference);
      await this.audit.write(tx, a.id, "payout.paid", "Payout", id, requestId, {
        reference,
      });
      return r;
    });
  }
}
@ApiTags("admin")
@Roles("SUPERADMIN")
@Controller("admin")
export class AdminController {
  constructor(
    private service: AdminService,
    private payments: PaymentsService,
    private payouts: PayoutsService,
    private settings: SettingsService,
  ) {}
  @Post("users/:id/block") block(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() a: Actor,
    @Req() req: AuthRequest,
  ) {
    return this.service.block(id, a, true, req.requestId);
  }
  @Post("users/:id/unblock") unblock(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() a: Actor,
    @Req() req: AuthRequest,
  ) {
    return this.service.block(id, a, false, req.requestId);
  }
  @Get("payments") listPayments(@Query() q: PaymentQuery) {
    return this.payments.list(q);
  }
  @Post("payments/:id/approve") approve(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() a: Actor,
    @Req() req: AuthRequest,
  ) {
    return this.payments.review(id, a, true, undefined, req.requestId);
  }
  @Post("payments/:id/reject") reject(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() a: Actor,
    @Body() dto: RejectDto,
    @Req() req: AuthRequest,
  ) {
    return this.payments.review(id, a, false, dto.reason, req.requestId);
  }
  @Get("payouts") listPayouts(@Query() q: PageDto) {
    return this.payouts.list(q);
  }
  @Post("payouts/:id/mark-paid") paid(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() a: Actor,
    @Body() dto: PaidDto,
    @Req() req: AuthRequest,
  ) {
    return this.service.paid(id, a, dto.reference, req.requestId);
  }
  @Get("settings") getSettings() {
    return this.settings.get();
  }
  @Patch("settings") updateSettings(
    @CurrentUser() a: Actor,
    @Body() dto: SettingsDto,
    @Req() req: AuthRequest,
  ) {
    return this.service.updateSettings(a, dto, req.requestId);
  }
  @Get("audit-logs") logs(@Query() q: PageDto) {
    return this.service.logs(q);
  }
}
@Module({
  imports: [UsersModule, AuthModule, PaymentsModule, PayoutsModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
