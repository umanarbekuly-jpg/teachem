import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { Database } from "../../infrastructure/database/database.module";
import { pageArgs, PageDto, paged } from "../../common/http";
import { publicUserSelect } from "../users/users.module";
import { CourseQuery, CreateCourseDto, UpdateCourseDto } from "./courses.dto";
@Injectable()
export class CoursesRepository {
  constructor(private db: Database) {}
  async list(q: CourseQuery, tutorId?: string) {
    const where: Prisma.CourseWhereInput = {
      deletedAt: null,
      ...(tutorId
        ? { tutorId }
        : { status: "published", tutor: { blockedAt: null, deletedAt: null } }),
      ...(q.search
        ? {
            OR: [
              { title: { contains: q.search, mode: "insensitive" } },
              { subject: { contains: q.search, mode: "insensitive" } },
            ],
          }
        : {}),
      ...(q.subject ? { subject: q.subject } : {}),
      monthlyPriceMinor: { gte: q.priceFromMinor, lte: q.priceToMinor },
    };
    const [items, total] = await Promise.all([
      this.db.course.findMany({
        where,
        ...pageArgs(q),
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        include: { tutor: { select: publicUserSelect } },
      }),
      this.db.course.count({ where }),
    ]);
    return paged(items, total, q);
  }
  get(id: string) {
    return this.db.course.findFirstOrThrow({
      where: { id, deletedAt: null },
      include: {
        tutor: {
          select: {
            ...publicUserSelect,
            blockedAt: true,
            deletedAt: true,
            profile: true,
          },
        },
      },
    });
  }
  create(tutorId: string, data: CreateCourseDto) {
    return this.db.course.create({
      data: { ...data, tutorId },
      include: { tutor: { select: publicUserSelect } },
    });
  }
  update(
    id: string,
    data: UpdateCourseDto & {
      status?: "published" | "archived";
      deletedAt?: Date;
    },
  ) {
    return this.db.course.update({
      where: { id },
      data,
      include: { tutor: { select: publicUserSelect } },
    });
  }
  async tutorIds(q: CourseQuery) {
    return this.db.course.findMany({
      where: {
        status: "published",
        deletedAt: null,
        ...(q.subject ? { subject: q.subject } : {}),
        monthlyPriceMinor: { gte: q.priceFromMinor, lte: q.priceToMinor },
      },
      select: { tutorId: true },
      distinct: ["tutorId"],
    });
  }
  async ownedIds(tutorId: string) {
    return (
      await this.db.course.findMany({
        where: { tutorId, deletedAt: null },
        select: { id: true },
      })
    ).map((c) => c.id);
  }
  async titles(ids: string[], _q?: PageDto) {
    return this.db.course.findMany({
      where: { id: { in: ids } },
      select: { id: true, title: true },
    });
  }
}
