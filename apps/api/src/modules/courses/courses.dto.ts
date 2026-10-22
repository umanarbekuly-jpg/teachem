import { ApiProperty, ApiPropertyOptional, PartialType } from "@nestjs/swagger";
import {
  IsArray,
  ValidateIf,
  ArrayMaxSize,
  ArrayUnique,
  Matches,
  IsUUID,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from "class-validator";
import { Type, Transform } from "class-transformer";
import { PageDto } from "../../common/http";
import { normalizeSubject, normalizeTag, TAG_PATTERN } from "@tutor/shared";
export class CourseQuery extends PageDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 100)
  search?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 31) tag?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 100)
  subject?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  priceFromMinor?: number;
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  priceToMinor?: number;
}
export class CreateCourseDto {
  @ApiProperty() @IsString() @Length(3, 160) title!: string;
  @ApiProperty() @IsString() @Length(20, 10000) description!: string;
  @ApiProperty()
  @IsString()
  @Transform(({ value }) =>
    typeof value === "string" ? normalizeSubject(value) : value,
  )
  @Length(1, 80)
  subject!: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 100)
  level?: string;
  @ApiPropertyOptional({ default: 30, minimum: 1 })
  @ValidateIf((_, value) => value !== undefined)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  durationDays?: number;
  @ApiPropertyOptional({ type: [String], maxItems: 3 })
  @ValidateIf((_, value) => value !== undefined)
  @Transform(({ value }) =>
    Array.isArray(value)
      ? value.map((v) => (typeof v === "string" ? normalizeTag(v) : v))
      : value,
  )
  @IsArray()
  @ArrayMaxSize(3, { message: "Разрешено не более 3 хештегов" })
  @ArrayUnique()
  @Matches(TAG_PATTERN, {
    each: true,
    message: "Тег: 1–30 букв, цифр или _, без пробелов",
  })
  tags?: string[];
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsUUID()
  coverAssetId?: string | null;
  @ApiProperty({ description: "Цена в тиынах", minimum: 100 })
  @IsInt()
  @Min(100)
  @Max(1000000000)
  monthlyPriceMinor!: number;
}
export class UpdateCourseDto extends PartialType(CreateCourseDto, {
  skipNullProperties: false,
}) {}
