import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional, IsUUID } from "class-validator";
import { PageDto } from "../../common/http";
export class CreatePaymentDto {
  @ApiProperty() @IsUUID() idempotencyKey!: string;
}
export class SubmitPaymentDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() receiptAssetId?: string;
}
export class PaymentQuery extends PageDto {
  @ApiPropertyOptional({
    enum: ["pending", "awaiting_review", "approved", "rejected"],
  })
  @IsOptional()
  @IsIn(["pending", "awaiting_review", "approved", "rejected"])
  status?: "pending" | "awaiting_review" | "approved" | "rejected";
}
