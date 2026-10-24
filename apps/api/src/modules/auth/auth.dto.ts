import { ApiProperty } from "@nestjs/swagger";
import {
  IsEmail,
  isEmail,
  IsIn,
  IsString,
  Length,
  MaxLength,
  ValidateBy,
} from "class-validator";
export class LoginDto {
  @ApiProperty({ example: "student@example.com" })
  @ValidateBy({
    name: "loginEmail",
    validator: {
      validate: (v: unknown) =>
        typeof v === "string" &&
        (isEmail(v) || v.trim().toLowerCase() === "supadmin@teachem"),
      defaultMessage: () => "Укажите корректный email",
    },
  })
  @MaxLength(254)
  email!: string;
  @ApiProperty({ minLength: 12, maxLength: 72 })
  @IsString()
  @Length(12, 72)
  @ValidateBy({
    name: "passwordBytes",
    validator: {
      validate: (v: unknown) =>
        typeof v === "string" && Buffer.byteLength(v) <= 72,
      defaultMessage: () => "Пароль должен занимать не более 72 байт",
    },
  })
  password!: string;
}
export class RegisterDto extends LoginDto {
  @IsEmail() declare email: string;
  @ApiProperty() @IsString() @Length(2, 100) name!: string;
  @ApiProperty({ enum: ["student", "tutor"] })
  @IsIn(["student", "tutor"])
  role!: "student" | "tutor";
}
export class UserView {
  @ApiProperty() surname!: string;
  @ApiProperty() mustChangePassword!: boolean;
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() email!: string;
  @ApiProperty({ enum: ["student", "tutor", "SUPERADMIN"] }) role!: string;
}
