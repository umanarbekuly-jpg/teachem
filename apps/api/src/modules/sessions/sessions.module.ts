import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { ApiProperty, ApiTags, PartialType } from "@nestjs/swagger";
import {
  IsDateString,
  IsInt,
  IsString,
  IsUrl,
  Length,
  Max,
  Min,
} from "class-validator";
import { Database } from "../../infrastructure/database/database.module";
import {
  Actor,
  CurrentUser,
  PageDto,
  pageArgs,
  paged,
  Roles,
} from "../../common/http";
import { CoursesModule, CoursesService } from "../courses/courses.module";
import {
  EnrollmentsModule,
  EnrollmentsService,
} from "../enrollments/enrollments.module";
export class SessionDto {
  @ApiProperty() @IsString() @Length(2, 160) topic!: string;
  @ApiProperty() @IsDateString() startsAt!: string;
  @ApiProperty() @IsInt() @Min(5) @Max(480) durationMinutes!: number;
  @ApiProperty()
  @IsUrl({ protocols: ["https"], require_protocol: true })
  joinUrl!: string;
}
export class UpdateSessionDto extends PartialType(SessionDto) {}
export abstract class VideoProvider {
  abstract createSession(
    url: string,
  ): Promise<{ joinUrl: string; provider: string }>;
  abstract cancelSession(id: string): Promise<void>;
}
@Injectable()
export class ManualMeetLink extends VideoProvider {
  async createSession(url: string) {
    const parsed = new URL(url);
    if (
      parsed.protocol !== "https:" ||
      parsed.hostname !== "meet.google.com" ||
      parsed.username ||
      parsed.password
    )
      throw new BadRequestException("Нужна ссылка https://meet.google.com/...");
    return { joinUrl: parsed.toString(), provider: "manual" };
  }
  async cancelSession(_id: string) {}
}
const sessionSelect = {
  id: true,
  courseId: true,
  topic: true,
  startsAt: true,
  durationMinutes: true,
  status: true,
  createdAt: true,
  course: { select: { title: true } },
} as const;
@Injectable()
export class SessionsRepository {
  constructor(private db: Database) {}
  get(id: string) {
    return this.db.liveSession.findFirstOrThrow({
      where: { id, deletedAt: null },
    });
  }
  create(courseId: string, dto: SessionDto) {
    return this.db.liveSession.create({
      data: { ...dto, courseId, startsAt: new Date(dto.startsAt) },
      select: sessionSelect,
    });
  }
  update(id: string, dto: UpdateSessionDto) {
    return this.db.liveSession.update({
      where: { id },
      data: {
        ...dto,
        ...(dto.startsAt ? { startsAt: new Date(dto.startsAt) } : {}),
      },
      select: sessionSelect,
    });
  }
  cancel(id: string) {
    return this.db.liveSession.update({
      where: { id },
      data: { status: "cancelled" },
      select: sessionSelect,
    });
  }
  async list(ids: string[], q: PageDto) {
    const where = { courseId: { in: ids }, deletedAt: null };
    const [items, total] = await Promise.all([
      this.db.liveSession.findMany({
        where,
        ...pageArgs(q),
        select: sessionSelect,
        orderBy: { startsAt: "asc" },
      }),
      this.db.liveSession.count({ where }),
    ]);
    return paged(items, total, q);
  }
}
@Injectable()
export class SessionsService {
  constructor(
    private repo: SessionsRepository,
    private courses: CoursesService,
    private enrollments: EnrollmentsService,
    private provider: VideoProvider,
  ) {}
  async list(a: Actor, q: PageDto, courseId?: string) {
    if (courseId) {
      await this.enrollments.assertAccess(a, courseId);
      return this.repo.list([courseId], q);
    }
    return this.repo.list(
      a.role === "tutor"
        ? await this.courses.ownedIds(a.id)
        : await this.enrollments.activeCourseIds(a.id),
      q,
    );
  }
  async create(courseId: string, a: Actor, dto: SessionDto) {
    await this.courses.owned(courseId, a);
    await this.provider.createSession(dto.joinUrl);
    return this.repo.create(courseId, dto);
  }
  async update(id: string, a: Actor, dto: UpdateSessionDto) {
    const s = await this.repo.get(id);
    await this.courses.owned(s.courseId, a);
    if (dto.joinUrl) await this.provider.createSession(dto.joinUrl);
    return this.repo.update(id, dto);
  }
  async cancel(id: string, a: Actor) {
    const s = await this.repo.get(id);
    await this.courses.owned(s.courseId, a);
    await this.provider.cancelSession(id);
    return this.repo.cancel(id);
  }
  async join(id: string, a: Actor) {
    const s = await this.repo.get(id);
    await this.enrollments.assertAccess(a, s.courseId);
    if (s.status === "cancelled")
      throw new BadRequestException("Занятие отменено");
    return { url: s.joinUrl };
  }
}
@ApiTags("sessions")
@Controller()
export class SessionsController {
  constructor(private s: SessionsService) {}
  @Get("sessions/me") mine(@CurrentUser() a: Actor, @Query() q: PageDto) {
    return this.s.list(a, q);
  }
  @Get("courses/:id/sessions") list(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() a: Actor,
    @Query() q: PageDto,
  ) {
    return this.s.list(a, q, id);
  }
  @Roles("tutor") @Post("courses/:id/sessions") create(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() a: Actor,
    @Body() dto: SessionDto,
  ) {
    return this.s.create(id, a, dto);
  }
  @Roles("tutor") @Patch("sessions/:id") update(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() a: Actor,
    @Body() dto: UpdateSessionDto,
  ) {
    return this.s.update(id, a, dto);
  }
  @Roles("tutor") @Post("sessions/:id/cancel") cancel(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() a: Actor,
  ) {
    return this.s.cancel(id, a);
  }
  @Get("sessions/:id/join") join(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() a: Actor,
  ) {
    return this.s.join(id, a);
  }
}
@Module({
  imports: [CoursesModule, EnrollmentsModule],
  controllers: [SessionsController],
  providers: [
    SessionsRepository,
    SessionsService,
    { provide: VideoProvider, useClass: ManualMeetLink },
  ],
})
export class SessionsModule {}
