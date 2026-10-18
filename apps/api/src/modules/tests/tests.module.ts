import {
  Body,
  Controller,
  Delete,
  Get,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Actor, CurrentUser, PageDto, Roles } from "../../common/http";
import { CoursesModule } from "../courses/courses.module";
import { EnrollmentsModule } from "../enrollments/enrollments.module";
import { TestsRepository } from "./tests.repository";
import { TestsService } from "./tests.service";
import { AnswersDto, TestDto, UpdateTestDto } from "./tests.dto";
@ApiTags("tests")
@Controller()
export class TestsController {
  constructor(private s: TestsService) {}
  @Get("courses/:id/tests") list(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() a: Actor,
    @Query() q: PageDto,
  ) {
    return this.s.list(id, a, q);
  }
  @Roles("tutor") @Post("courses/:id/tests") create(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() a: Actor,
    @Body() dto: TestDto,
  ) {
    return this.s.create(id, a, dto);
  }
  @Get("tests/:id") get(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() a: Actor,
  ) {
    return this.s.get(id, a);
  }
  @Roles("tutor") @Patch("tests/:id") update(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() a: Actor,
    @Body() dto: UpdateTestDto,
  ) {
    return this.s.update(id, a, dto);
  }
  @Roles("tutor") @Delete("tests/:id") remove(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() a: Actor,
  ) {
    return this.s.remove(id, a);
  }
  @Roles("tutor") @Post("tests/:id/publish") publish(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() a: Actor,
  ) {
    return this.s.publish(id, a);
  }
  @Roles("tutor") @Post("tests/:id/copy") copy(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() a: Actor,
  ) {
    return this.s.copy(id, a);
  }
  @Roles("student") @Post("tests/:id/attempts") start(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() a: Actor,
  ) {
    return this.s.start(id, a);
  }
  @Roles("tutor") @Get("tests/:id/attempts") attempts(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() a: Actor,
    @Query() q: PageDto,
  ) {
    return this.s.attempts(a, q, id);
  }
  @Roles("student") @Get("test-attempts/me") mine(
    @CurrentUser() a: Actor,
    @Query() q: PageDto,
  ) {
    return this.s.attempts(a, q);
  }
  @Get("test-attempts/:id") attempt(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() a: Actor,
  ) {
    return this.s.attempt(id, a);
  }
  @Roles("student") @Put("test-attempts/:id/answers") save(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() a: Actor,
    @Body() dto: AnswersDto,
  ) {
    return this.s.save(id, a, dto);
  }
  @Roles("student") @Post("test-attempts/:id/submit") submit(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() a: Actor,
  ) {
    return this.s.submit(id, a);
  }
}
@Module({
  imports: [CoursesModule, EnrollmentsModule],
  controllers: [TestsController],
  providers: [TestsRepository, TestsService],
})
export class TestsModule {}
