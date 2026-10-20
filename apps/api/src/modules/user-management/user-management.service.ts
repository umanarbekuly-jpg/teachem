import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { hash } from "bcryptjs";
import { Actor, pageArgs, paged } from "../../common/http";
import {
  Database,
  Transaction,
} from "../../infrastructure/database/database.module";
import { FilesService } from "../materials/files.module";
import {
  ProfileEditDto,
  UserCreateDto,
  UserQuery,
  PasswordResetDto,
} from "./user-management.dto";
const select = {
  id: true,
  name: true,
  surname: true,
  email: true,
  phone: true,
  bio: true,
  photoAssetId: true,
  role: true,
  blockedAt: true,
  createdAt: true,
  emailVerifiedAt: true,
  mustChangePassword: true,
  profile: {
    select: {
      bio: true,
      photoAssetId: true,
      experienceYears: true,
      education: true,
      subjects: true,
      languages: true,
    },
  },
} satisfies Prisma.UserSelect;
function field(key: string, message: string): never {
  throw new BadRequestException({ message, fields: { [key]: message } });
}
@Injectable()
export class UserManagementService {
  constructor(
    private db: Database,
    private files: FilesService,
  ) {}
  private async authority(tx: Transaction, a: Actor) {
    const session = await tx.authSession.findUnique({
      where: { id: a.sessionId },
      include: { user: true },
    });
    if (
      !session ||
      session.userId !== a.id ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      session.authVersion !== session.user.authVersion ||
      session.user.role !== "SUPERADMIN" ||
      session.user.blockedAt ||
      session.user.deletedAt
    )
      throw new ForbiddenException("Сессия суперадминистратора завершена");
  }
  private async ordinary(tx: Transaction, id: string) {
    const user = await tx.user.findUnique({ where: { id } });
    if (!user || user.deletedAt)
      throw new NotFoundException("Пользователь не найден");
    if (user.role === "SUPERADMIN")
      throw new ForbiddenException(
        "Суперадминистратор защищён. Свой пароль меняйте в разделе «Сменить пароль»",
      );
    return user;
  }
  async list(q: UserQuery) {
    const term = q.search?.trim();
    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      role: q.role,
      ...(q.status
        ? { blockedAt: q.status === "blocked" ? { not: null } : null }
        : {}),
      ...(term
        ? {
            OR: [
              { name: { contains: term, mode: "insensitive" } },
              { surname: { contains: term, mode: "insensitive" } },
              { email: { contains: term, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.db.$transaction([
      this.db.user.findMany({
        where,
        select,
        ...pageArgs(q),
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      }),
      this.db.user.count({ where }),
    ]);
    return paged(items, total, q);
  }
  async get(id: string) {
    const user = await this.db.user.findFirst({
      where: { id, deletedAt: null },
      select,
    });
    if (!user) throw new NotFoundException("Пользователь не найден");
    const photo = user.profile?.photoAssetId ?? user.photoAssetId;
    return { ...user, photoUrl: photo ? await this.files.avatar(photo) : null };
  }
  private async profile(
    tx: Transaction,
    id: string,
    a: Actor,
    d: ProfileEditDto,
    hasTutor: boolean,
  ) {
    // Reject nulls for non-nullable fields (IsOptional also accepts null).
    for (const [key, value] of Object.entries(d))
      if (value === null && key !== "photoAssetId")
        field(key, "Поле не может быть пустым");
    if (d.name !== undefined && d.name.trim().length < 2)
      field("name", "Не менее 2 символов");
    if (d.photoAssetId) {
      const f = await tx.fileAsset.findFirst({
        where: {
          id: d.photoAssetId,
          status: "ready",
          purpose: "avatar",
          ownerId: { in: [id, a.id] },
        },
      });
      if (!f)
        field(
          "photoAssetId",
          "Выберите проверенное фото этого пользователя или загрузите новое",
        );
      const binding = await tx.tutorProfile.findFirst({
        where: { photoAssetId: d.photoAssetId, userId: { not: id } },
      });
      if (binding)
        field("photoAssetId", "Фото уже используется другим профилем");
    }
    const email = d.email?.trim().toLowerCase();
    const current = await tx.user.findUniqueOrThrow({ where: { id } });
    if (email && email !== current.email) {
      if (
        await tx.user.findFirst({
          where: {
            email: { equals: email, mode: "insensitive" },
            id: { not: id },
          },
        })
      )
        field("email", "Этот email уже занят");
    }
    const emailChanged = !!email && email !== current.email;
    await tx.user.update({
      where: { id },
      data: {
        name: d.name?.trim(),
        surname: d.surname?.trim(),
        email,
        phone: d.phone?.trim(),
        bio: d.bio,
        photoAssetId: d.photoAssetId,
        ...(emailChanged
          ? { emailVerifiedAt: null, authVersion: { increment: 1 } }
          : {}),
      },
    });
    if (emailChanged)
      await tx.authSession.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    const tutorFields =
      d.experienceYears !== undefined ||
      d.education !== undefined ||
      d.subjects !== undefined ||
      d.languages !== undefined;
    if (hasTutor || tutorFields) {
      const data = {
        bio: d.bio,
        photoAssetId: d.photoAssetId,
        experienceYears: d.experienceYears,
        education: d.education,
        subjects: d.subjects,
        languages: d.languages,
      };
      await tx.tutorProfile.upsert({
        where: { userId: id },
        create: {
          userId: id,
          ...data,
          subjects: d.subjects ?? [],
          languages: d.languages ?? [],
        },
        update: data,
      });
    }
  }
  private audit(
    tx: Transaction,
    a: Actor,
    id: string,
    action: string,
    requestId: string,
    metadata: Prisma.InputJsonObject = {},
  ) {
    return tx.auditLog.create({
      data: {
        actorId: a.id,
        entityType: "User",
        entityId: id,
        action,
        requestId,
        metadata,
      },
    });
  }
  private async mutate<T>(work: (tx: Transaction) => Promise<T>) {
    try {
      return await this.db.atomic(work);
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002"
      )
        field("email", "Email или фото уже используются. Обновите страницу");
      throw e;
    }
  }
  async create(a: Actor, d: UserCreateDto, requestId: string) {
    if (!d.name || !d.email)
      throw new BadRequestException({
        message: "Заполните обязательные поля",
        fields: { name: "Укажите имя", email: "Укажите email" },
      });
    const passwordHash = await hash(d.password, 12);
    return this.mutate(async (tx) => {
      await this.authority(tx, a);
      const user = await tx.user.create({
        data: {
          name: d.name.trim(),
          email: d.email.trim().toLowerCase(),
          role: d.role,
          passwordHash,
          mustChangePassword: true,
        },
      });
      const { password: _password, role: _role, ...profile } = d;
      await this.profile(tx, user.id, a, profile, d.role === "tutor");
      await this.audit(tx, a, user.id, "user.create", requestId, {
        role: d.role,
      });
      return tx.user.findUniqueOrThrow({ where: { id: user.id }, select });
    });
  }
  async update(id: string, a: Actor, d: ProfileEditDto, requestId: string) {
    return this.mutate(async (tx) => {
      await this.authority(tx, a);
      const user = await this.ordinary(tx, id);
      const profile = await tx.tutorProfile.findUnique({
        where: { userId: id },
      });
      await this.profile(tx, id, a, d, user.role === "tutor" || !!profile);
      await this.audit(tx, a, id, "user.profile.update", requestId, {
        fields: Object.keys(d),
      });
      return tx.user.findUniqueOrThrow({ where: { id }, select });
    });
  }
  async role(
    id: string,
    a: Actor,
    role: "student" | "tutor",
    requestId: string,
  ) {
    return this.mutate(async (tx) => {
      await this.authority(tx, a);
      const user = await this.ordinary(tx, id);
      if (user.role === role) return { ok: true };
      if (user.role === "tutor") {
        const active = await tx.course.count({
          where: {
            tutorId: id,
            OR: [
              { status: "published", deletedAt: null },
              {
                sessions: {
                  some: {
                    status: "scheduled",
                    deletedAt: null,
                    startsAt: { gte: new Date() },
                  },
                },
              },
              {
                enrollments: { some: { accessExpiresAt: { gt: new Date() } } },
              },
            ],
          },
        });
        if (active)
          throw new ConflictException(
            "У тьютора есть опубликованные курсы, будущие занятия или действующий доступ учеников. Сначала завершите обязательства, отмените будущие занятия и архивируйте курсы. Историю удалять не нужно.",
          );
      } else if (
        await tx.enrollment.count({
          where: { studentId: id, accessExpiresAt: { gt: new Date() } },
        })
      ) {
        throw new ConflictException(
          "У студента есть оплаченный действующий доступ. Дождитесь его завершения перед сменой роли; история сохранится.",
        );
      }
      await tx.user.update({
        where: { id },
        data: { role, authVersion: { increment: 1 } },
      });
      if (role === "tutor")
        await tx.tutorProfile.upsert({
          where: { userId: id },
          create: {
            userId: id,
            bio: user.bio,
            photoAssetId: user.photoAssetId,
            subjects: [],
            languages: [],
          },
          update: {},
        });
      await tx.authSession.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit(tx, a, id, "user.role.change", requestId, {
        from: user.role,
        to: role,
      });
      return { ok: true };
    });
  }
  async reset(id: string, a: Actor, d: PasswordResetDto, requestId: string) {
    if (d.newPassword !== d.confirmPassword)
      field("confirmPassword", "Пароли не совпадают");
    const passwordHash = await hash(d.newPassword, 12);
    return this.mutate(async (tx) => {
      await this.authority(tx, a);
      await this.ordinary(tx, id);
      await tx.user.update({
        where: { id },
        data: {
          passwordHash,
          mustChangePassword: true,
          authVersion: { increment: 1 },
        },
      });
      await tx.authSession.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit(tx, a, id, "user.password.reset", requestId);
      return { ok: true };
    });
  }
}
