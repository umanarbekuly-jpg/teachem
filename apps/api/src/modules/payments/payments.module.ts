import {
  Body,
  Controller,
  Get,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Actor, CurrentUser, Roles } from "../../common/http";
import { EnrollmentsModule } from "../enrollments/enrollments.module";
import { CoursesModule } from "../courses/courses.module";
import { FilesModule } from "../materials/files.module";
import { PayoutsModule } from "../payouts/payouts.module";
import { PaymentsRepository } from "./payments.repository";
import { PaymentsService } from "./payments.service";
import { ManualPaymentProvider, PaymentProvider } from "./payments.provider";
import {
  CreatePaymentDto,
  PaymentQuery,
  SubmitPaymentDto,
} from "./payments.dto";
@ApiTags("payments")
@Controller()
export class PaymentsController {
  constructor(private service: PaymentsService) {}
  @Roles("student") @Post("enrollments/:id/payments") create(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() a: Actor,
    @Body() dto: CreatePaymentDto,
  ) {
    return this.service.create(id, a, dto.idempotencyKey);
  }
  @Roles("student") @Get("payments/me") mine(
    @CurrentUser() a: Actor,
    @Query() q: PaymentQuery,
  ) {
    return this.service.list(q, a.id);
  }
  @Get("payments/:id") get(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() a: Actor,
  ) {
    return this.service.get(id, a);
  }
  @Get("payments/:id/instructions") instructions(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() a: Actor,
  ) {
    return this.service.instructions(id, a);
  }
  @Roles("student") @Post("payments/:id/submit") submit(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() a: Actor,
    @Body() dto: SubmitPaymentDto,
  ) {
    return this.service.submit(id, a, dto);
  }
}
@Module({
  imports: [EnrollmentsModule, CoursesModule, FilesModule, PayoutsModule],
  controllers: [PaymentsController],
  providers: [
    PaymentsRepository,
    PaymentsService,
    { provide: PaymentProvider, useClass: ManualPaymentProvider },
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}
