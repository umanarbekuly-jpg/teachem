import {
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import {
  Database,
  Transaction,
} from "../../infrastructure/database/database.module";
import {
  Actor,
  CurrentUser,
  PageDto,
  pageArgs,
  paged,
  Roles,
} from "../../common/http";
import { CoursesModule, CoursesService } from "../courses/courses.module";
export function extendAccess(current: Date | null, now: Date) {
  return new Date(
    Math.max(current?.getTime() ?? 0, now.getTime()) + 30 * 86400000,
  );
}
export function accessStatus(expiresAt: Date | null, now = new Date()) {
  return !expiresAt ? "inactive" : expiresAt > now ? "active" : "expired";
}
@Injectable()
export class EnrollmentsRepository {
  constructor(private db: Database) {}
  enroll(studentId: string, courseId: string) {
    return this.db.enrollment.upsert({
      where: { studentId_courseId: { studentId, courseId } },
      update: {},
      create: { studentId, courseId },
    });
  }
  find(id: string, tx: Transaction = this.db) {
    return tx.enrollment.findUniqueOrThrow({ where: { id } });
  }
  access(studentId: string, courseId: string) {
    return this.db.enrollment.findUnique({
      where: { studentId_courseId: { studentId, courseId } },
    });
  }
  async list(
    q: PageDto,
    where: { studentId?: string; courseId?: string | { in: string[] } },
  ) {
    const [items, total] = await Promise.all([
      this.db.enrollment.findMany({
        where,
        ...pageArgs(q),
        orderBy: { createdAt: "desc" },
        include: {
          course: {
            select: {
              id: true,
              title: true,
              subject: true,
              monthlyPriceMinor: true,
              status: true,
            },
          },
          student: { select: { id: true, name: true } },
        },
      }),
      this.db.enrollment.count({ where }),
    ]);
    return paged(
      items.map((e) => ({
        ...e,
        accessStatus: accessStatus(e.accessExpiresAt),
      })),
      total,
      q,
    );
  }
  async activeCourseIds(studentId: string) {
    return (
      await this.db.enrollment.findMany({
        where: { studentId, accessExpiresAt: { gt: new Date() } },
        select: { courseId: true },
      })
    ).map((e) => e.courseId);
  }
  async extend(id: string, tx: Transaction) {
    const enrollment = await this.find(id, tx);
    const now = new Date();
    return tx.enrollment.update({
      where: { id },
      data: {
        accessStartsAt: enrollment.accessStartsAt ?? now,
        accessExpiresAt: extendAccess(enrollment.accessExpiresAt, now),
      },
    });
  }
}
@Injectable()
export class EnrollmentsService {
  constructor(
    private repo: EnrollmentsRepository,
    private courses: CoursesService,
  ) {}
  async enroll(a: Actor, courseId: string) {
    await this.courses.publicGet(courseId);
    return this.repo.enroll(a.id, courseId);
  }
  async assertAccess(a: Actor, courseId: string) {
    const course = await this.courses.get(courseId);
    if (a.role === "SUPERADMIN" || course.tutorId === a.id) return course;
    const e = await this.repo.access(a.id, courseId);
    if (
      course.tutor.blockedAt ||
      !e ||
      accessStatus(e.accessExpiresAt) !== "active"
    )
      throw new ForbiddenException("Нужна активная оплаченная запись на курс");
    return course;
  }
  async own(id: string, a: Actor) {
    const e = await this.repo.find(id);
    if (e.studentId !== a.id)
      throw new ForbiddenException("Это не ваша запись");
    return e;
  }
  find(id: string, tx?: Transaction) {
    return this.repo.find(id, tx);
  }
  mine(a: Actor, q: PageDto) {
    return this.repo.list(q, { studentId: a.id });
  }
  async students(a: Actor, q: PageDto, courseId?: string) {
    if (courseId) await this.courses.owned(courseId, a);
    return this.repo.list(q, {
      courseId: courseId ?? { in: await this.courses.ownedIds(a.id) },
    });
  }
  activeCourseIds(studentId: string) {
    return this.repo.activeCourseIds(studentId);
  }
  extend(id: string, tx: Transaction) {
    return this.repo.extend(id, tx);
  }
}
@ApiTags("enrollments")
@Controller()
export class EnrollmentsController {
  constructor(private service: EnrollmentsService) {}
  @Get("learning/courses/:id") learning(
    @CurrentUser() a: Actor,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.service.assertAccess(a, id);
  }
  @Roles("student") @Post("courses/:id/enrollments") enroll(
    @CurrentUser() a: Actor,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.service.enroll(a, id);
  }
  @Roles("student") @Get("enrollments/me") mine(
    @CurrentUser() a: Actor,
    @Query() q: PageDto,
  ) {
    return this.service.mine(a, q);
  }
  @Roles("tutor") @Get("courses/:id/enrollments") students(
    @CurrentUser() a: Actor,
    @Param("id", ParseUUIDPipe) id: string,
    @Query() q: PageDto,
  ) {
    return this.service.students(a, q, id);
  }
  @Roles("tutor") @Get("tutors/me/students") allStudents(
    @CurrentUser() a: Actor,
    @Query() q: PageDto,
  ) {
    return this.service.students(a, q);
  }
}
@Module({
  imports: [CoursesModule],
  controllers: [EnrollmentsController],
  providers: [EnrollmentsRepository, EnrollmentsService],
  exports: [EnrollmentsService],
})
export class EnrollmentsModule {}
