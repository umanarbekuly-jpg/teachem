import { ApiProperty, ApiPropertyOptional, PartialType } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateNested,
} from "class-validator";
export class OptionDto {
  @ApiProperty() @IsString() @Length(1, 1000) text!: string;
  @ApiProperty() @IsBoolean() isCorrect!: boolean;
}
export class QuestionDto {
  @ApiProperty() @IsString() @Length(1, 3000) text!: string;
  @ApiProperty({ enum: ["single", "multiple"] })
  @IsIn(["single", "multiple"])
  type!: "single" | "multiple";
  @ApiProperty() @IsInt() @Min(1) @Max(1000) points!: number;
  @ApiProperty({ type: [OptionDto] })
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => OptionDto)
  options!: OptionDto[];
}
export class TestDto {
  @ApiProperty() @IsString() @Length(2, 160) title!: string;
  @ApiProperty({ type: [QuestionDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => QuestionDto)
  questions!: QuestionDto[];
}
export class UpdateTestDto extends PartialType(TestDto) {}
export class AnswerDto {
  @ApiProperty() @IsUUID() questionId!: string;
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(10)
  @ArrayUnique()
  @IsUUID("all", { each: true })
  optionIds!: string[];
}
export class AnswersDto {
  @ApiProperty({ type: [AnswerDto] })
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => AnswerDto)
  answers!: AnswerDto[];
}
export class AttemptQuery {
  @ApiPropertyOptional() @IsOptional() @IsUUID() testId?: string;
}
