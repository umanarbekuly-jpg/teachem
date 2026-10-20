import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  IsArray,
  ArrayMaxSize,
  ValidateBy,
} from "class-validator";
import { PageDto } from "../../common/http";
export class UserQuery extends PageDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 100)
  search?: string;
  @ApiPropertyOptional({ enum: ["student", "tutor", "SUPERADMIN"] })
  @IsOptional()
  @IsIn(["student", "tutor", "SUPERADMIN"])
  role?: "student" | "tutor" | "SUPERADMIN";
  @ApiPropertyOptional({ enum: ["active", "blocked"] })
  @IsOptional()
  @IsIn(["active", "blocked"])
  status?: "active" | "blocked";
}
export class ProfileEditDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(2, 100)
  name?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 100)
  surname?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  @Length(3, 254)
  email?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 40)
  phone?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 5000)
  bio?: string;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  photoAssetId?: string | null;
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(80)
  experienceYears?: number;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 2000)
  education?: string;
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @Length(1, 100, { each: true })
  subjects?: string[];
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @Length(1, 100, { each: true })
  languages?: string[];
}
export class UserCreateDto extends ProfileEditDto {
  @ApiProperty() @IsString() @Length(2, 100) declare name: string;
  @ApiProperty() @IsEmail() @Length(3, 254) declare email: string;
  @ApiProperty({ enum: ["student", "tutor"] })
  @IsIn(["student", "tutor"])
  role!: "student" | "tutor";
  @ApiProperty()
  @IsString()
  @Length(12, 72)
  @ValidateBy({
    name: "passwordBytes",
    validator: {
      validate: (v: unknown) =>
        typeof v === "string" && Buffer.byteLength(v) <= 72,
    },
  })
  password!: string;
}
export class RoleChangeDto {
  @ApiProperty({ enum: ["student", "tutor"] })
  @IsIn(["student", "tutor"])
  role!: "student" | "tutor";
}
export class PasswordResetDto {
  @ApiProperty()
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
