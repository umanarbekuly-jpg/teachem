import { ApiProperty, ApiPropertyOptional, PartialType } from "@nestjs/swagger";
import { IsInt, IsOptional, IsString, Length, Max, Min } from "class-validator";
import { Type } from "class-transformer";
import { PageDto } from "../../common/http";
export class CourseQuery extends PageDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 100)
  search?: string;
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
  @ApiProperty() @IsString() @Length(2, 100) subject!: string;
  @ApiProperty() @IsString() @Length(2, 100) level!: string;
  @ApiProperty({ description: "Цена в тиынах", minimum: 100 })
  @IsInt()
  @Min(100)
  @Max(1000000000)
  monthlyPriceMinor!: number;
}
export class UpdateCourseDto extends PartialType(CreateCourseDto) {}
