import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { Database } from "../../infrastructure/database/database.module";
import { pageArgs, PageDto, paged } from "../../common/http";
import { publicUserSelect } from "../users/users.module";
import { CourseQuery, CreateCourseDto, UpdateCourseDto } from "./courses.dto";
import { StorageProvider } from "../../infrastructure/storage/storage.module";
import { SUBJECTS, normalizeSubject, normalizeTag } from "@tutor/shared";
@Injectable()
export class CoursesRepository {
  constructor(
    private db: Database,
    private storage: StorageProvider,
  ) {}
  async view<T extends { coverAssetId: string | null }>(course: T) {
    const f = course.coverAssetId
      ? await this.db.fileAsset.findUnique({
          where: { id: course.coverAssetId },
        })
      : null;
    return {
      ...course,
      coverUrl:
        f?.status === "ready" && f.purpose === "course_cover"
          ? await this.storage.download(f.objectKey, f.originalName)
          : null,
    };
  }
  async assertCover(id: string, ownerId: string) {
    const f = await this.db.fileAsset.findUnique({ where: { id } });
    if (
      !f ||
      f.ownerId !== ownerId ||
      f.status !== "ready" ||
      f.purpose !== "course_cover"
    )
      throw new BadRequestException("Обложка недоступна или не проверена");
  }
  async subjects() {
    const rows = await this.db.course.findMany({
      where: {
        deletedAt: null,
        status: "published",
        tutor: { blockedAt: null, deletedAt: null },
      },
      select: { subject: true },
      distinct: ["subject"],
    });
    const unique = new Map<string, string>();
    for (const s of [...SUBJECTS, ...rows.map((r) => r.subject)]) {
      const name = normalizeSubject(s);
      if (name && !unique.has(name.toLowerCase()))
        unique.set(name.toLowerCase(), name);
    }
    return { items: [...unique.values()] };
  }
  async canonicalSubject(subject: string, tx: Prisma.TransactionClient) {
    const name = normalizeSubject(subject);
    // Serializable read + write reuses one spelling, including concurrent submissions.
    const existing = await tx.course.findFirst({
      where: { subject: { equals: name, mode: "insensitive" } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { subject: true },
    });
    return (
      SUBJECTS.find((s) => s.toLowerCase() === name.toLowerCase()) ??
      existing?.subject ??
      name
    );
  }
  async list(q: CourseQuery, tutorId?: string, all = false) {
    const where: Prisma.CourseWhereInput = {
      deletedAt: null,
      ...(all
        ? {}
        : tutorId
          ? { tutorId }
          : {
              status: "published",
              tutor: { blockedAt: null, deletedAt: null },
            }),
      ...(q.search
        ? {
            OR: [
              { title: { contains: q.search, mode: "insensitive" } },
              { subject: { contains: q.search, mode: "insensitive" } },
              { tags: { has: normalizeTag(q.search) } },
            ],
          }
        : {}),
      ...(q.subject
        ? {
            subject: {
              equals: normalizeSubject(q.subject),
              mode: "insensitive" as const,
            },
          }
        : {}),
      ...(q.tag ? { tags: { has: normalizeTag(q.tag) } } : {}),
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
    return paged(await Promise.all(items.map((c) => this.view(c))), total, q);
  }
  async get(id: string) {
    const course = await this.db.course.findFirstOrThrow({
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
    return this.view(course);
  }
  async create(tutorId: string, data: CreateCourseDto) {
    return this.view(
      await this.db.atomic(async (tx) =>
        tx.course.create({
          data: {
            ...data,
            subject: await this.canonicalSubject(data.subject, tx),
            tutorId,
          },
          include: { tutor: { select: publicUserSelect } },
        }),
      ),
    );
  }
  async update(
    id: string,
    data: UpdateCourseDto & {
      status?: "published" | "archived";
      deletedAt?: Date;
    },
  ) {
    return this.view(
      await this.db.atomic(async (tx) =>
        tx.course.update({
          where: { id },
          data: {
            ...data,
            ...(data.subject
              ? { subject: await this.canonicalSubject(data.subject, tx) }
              : {}),
          },
          include: { tutor: { select: publicUserSelect } },
        }),
      ),
    );
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
