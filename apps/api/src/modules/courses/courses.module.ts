import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Actor, CurrentUser, Public, Roles } from "../../common/http";
import { CoursesRepository } from "./courses.repository";
import { CourseQuery, CreateCourseDto, UpdateCourseDto } from "./courses.dto";
@Injectable()
export class CoursesService {
  constructor(private repo: CoursesRepository) {}
  subjects() {
    return this.repo.subjects();
  }
  list(q: CourseQuery, tutorId?: string, all = false) {
    return this.repo.list(q, tutorId, all);
  }
  async publicGet(id: string) {
    const c = await this.repo.get(id);
    if (c.status !== "published" || c.tutor.blockedAt || c.tutor.deletedAt)
      throw new NotFoundException("Курс не найден");
    return c;
  }
  async get(id: string) {
    return this.repo.get(id);
  }
  async owned(id: string, actor: Actor) {
    const c = await this.repo.get(id);
    if (c.tutorId !== actor.id && actor.role !== "SUPERADMIN")
      throw new ForbiddenException("Это не ваш курс");
    return c;
  }
  async create(actor: Actor, dto: CreateCourseDto) {
    if (dto.coverAssetId)
      await this.repo.assertCover(dto.coverAssetId, actor.id);
    return this.repo.create(actor.id, dto);
  }
  async update(id: string, actor: Actor, dto: UpdateCourseDto) {
    const current = await this.owned(id, actor);
    if (dto.coverAssetId && dto.coverAssetId !== current.coverAssetId)
      await this.repo.assertCover(dto.coverAssetId, actor.id);
    return this.repo.update(id, dto);
  }
  async status(id: string, actor: Actor, status: "published" | "archived") {
    await this.owned(id, actor);
    return this.repo.update(id, { status });
  }
  async remove(id: string, actor: Actor) {
    const c = await this.owned(id, actor);
    if (c.status !== "draft")
      return this.repo.update(id, { status: "archived" });
    return this.repo.update(id, { deletedAt: new Date() });
  }
  tutorIds(q: CourseQuery) {
    return this.repo.tutorIds(q);
  }
  ownedIds(tutorId: string) {
    return this.repo.ownedIds(tutorId);
  }
}
@ApiTags("courses")
@Controller()
export class CoursesController {
  constructor(private service: CoursesService) {}
  @Roles("SUPERADMIN") @Get("admin/courses") all(@Query() q: CourseQuery) {
    return this.service.list(q, undefined, true);
  }
  @Public() @Get("courses") list(@Query() q: CourseQuery) {
    return this.service.list(q);
  }
  @Roles("tutor") @Get("tutors/me/courses") mine(
    @CurrentUser() a: Actor,
    @Query() q: CourseQuery,
  ) {
    return this.service.list(q, a.id);
  }
  @Public() @Get("courses/subjects") subjects() {
    return this.service.subjects();
  }
  @Roles("tutor", "SUPERADMIN") @Get("courses/:id/edit") edit(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() a: Actor,
  ) {
    return this.service.owned(id, a);
  }
  @Public() @Get("courses/:id") get(@Param("id", ParseUUIDPipe) id: string) {
    return this.service.publicGet(id);
  }
  @Roles("tutor") @Post("courses") create(
    @CurrentUser() a: Actor,
    @Body() dto: CreateCourseDto,
  ) {
    return this.service.create(a, dto);
  }
  @Roles("tutor", "SUPERADMIN") @Patch("courses/:id") update(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() a: Actor,
    @Body() dto: UpdateCourseDto,
  ) {
    return this.service.update(id, a, dto);
  }
  @Roles("tutor") @Post("courses/:id/publish") publish(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() a: Actor,
  ) {
    return this.service.status(id, a, "published");
  }
  @Roles("tutor") @Post("courses/:id/archive") archive(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() a: Actor,
  ) {
    return this.service.status(id, a, "archived");
  }
  @Roles("tutor") @Delete("courses/:id") remove(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() a: Actor,
  ) {
    return this.service.remove(id, a);
  }
}
@Module({
  controllers: [CoursesController],
  providers: [CoursesService, CoursesRepository],
  exports: [CoursesService],
})
export class CoursesModule {}
