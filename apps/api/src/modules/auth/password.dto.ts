import { ApiProperty } from "@nestjs/swagger";
import { IsString, Length, ValidateBy } from "class-validator";
export class ChangePasswordDto {
  @ApiProperty() @IsString() @Length(1, 72) currentPassword!: string;
  @ApiProperty({ minLength: 12, maxLength: 72 })
  @IsString()
  @Length(12, 72)
  @ValidateBy({
    name: "passwordBytes",
    validator: {
      validate: (v: unknown) =>
        typeof v === "string" && Buffer.byteLength(v) <= 72,
    },
  })
  newPassword!: string;
  @ApiProperty() @IsString() confirmPassword!: string;
}
