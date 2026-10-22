import "dotenv/config";
import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import { ThrottlerStorage } from "@nestjs/throttler";
import request from "supertest";
import { randomUUID } from "crypto";
import { hash } from "bcryptjs";
import sharp from "sharp";
import { AppModule } from "../src/app.module";
import { configure } from "../src/bootstrap";
import { Database } from "../src/infrastructure/database/database.module";
import { StorageProvider } from "../src/infrastructure/storage/storage.module";
import { COVER_MAX_BYTES, daysLabel } from "@tutor/shared";

describe("Course options HTTP and persistence", () => {
  let app: INestApplication, db: Database;
  type Agent = ReturnType<typeof request.agent>;
  let tutor: Agent, other: Agent, student: Agent, admin: Agent;
  const tokens = new Map<Agent, string>(),
    files = new Map<string, { body: Buffer; mime: string }>();
  const run = randomUUID();
  let courseId: string, coverId: string;
  const origin = "http://localhost:8080";
  function post(a: Agent, url: string, body: object = {}) {
    return a
      .post("/api/v1" + url)
      .set("Origin", origin)
      .set("X-CSRF-Token", tokens.get(a)!)
      .send(body);
  }
  function patch(a: Agent, url: string, body: object) {
    return a
      .patch("/api/v1" + url)
      .set("Origin", origin)
      .set("X-CSRF-Token", tokens.get(a)!)
      .send(body);
  }
  const base = {
    title: "Курс для проверки " + run,
    description: "Подробное описание курса, его целей и результатов обучения.",
    subject: "  Вайбкодинг   для всех  ",
    monthlyPriceMinor: 2000000,
    durationDays: 45,
    tags: ["#Код", "Практика", "AI_2026"],
  };
  async function upload(
    a: Agent,
    body: Buffer,
    mime = "image/png",
    name = "cover.png",
  ) {
    const r = await post(a, "/files/uploads", {
      purpose: "course_cover",
      originalName: name,
      mimeType: mime,
      sizeBytes: body.length,
    }).expect(201);
    const file = await db.fileAsset.findUniqueOrThrow({
      where: { id: r.body.id },
    });
    files.set(file.objectKey, { body, mime });
    return r.body.id as string;
  }
  beforeAll(async () => {
    if (!process.env.DATABASE_URL?.includes("test"))
      throw new Error("Isolated test database required");
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(StorageProvider)
      .useValue({
        healthy: async () => {},
        upload: async (key: string) => ({
          url: "https://storage.example.test/upload",
          fields: { key },
        }),
        inspect: async (key: string) => ({
          size: files.get(key)!.body.length,
          mime: files.get(key)!.mime,
        }),
        read: async (key: string) => files.get(key)!.body,
        put: async (key: string, body: Buffer, mime: string) => {
          files.set(key, { body, mime });
        },
        delete: async (key: string) => {
          files.delete(key);
        },
        download: async (key: string) => "https://storage.example.test/" + key,
      })
      .overrideProvider(ThrottlerStorage)
      .useValue({
        increment: async () => ({
          totalHits: 1,
          timeToExpire: 60,
          isBlocked: false,
          timeToBlockExpire: 0,
        }),
      })
      .compile();
    app = mod.createNestApplication();
    configure(app);
    await app.init();
    db = app.get(Database);
    const owner = await db.user.findFirst({ where: { role: "SUPERADMIN" } });
    await db.user.upsert({
      where: { id: owner?.id ?? randomUUID() },
      update: {
        email: `owner-${run}@example.test`,
        passwordHash: await hash("test-only-password", 12),
        mustChangePassword: false,
      },
      create: {
        email: `owner-${run}@example.test`,
        passwordHash: await hash("test-only-password", 12),
        name: "Owner",
        role: "SUPERADMIN",
      },
    });
    tutor = request.agent(app.getHttpServer());
    other = request.agent(app.getHttpServer());
    student = request.agent(app.getHttpServer());
    admin = request.agent(app.getHttpServer());
    for (const a of [tutor, other, student, admin])
      tokens.set(a, (await a.get("/api/v1/auth/csrf").expect(200)).body.token);
    for (const [a, role, label] of [
      [tutor, "tutor", "one"],
      [other, "tutor", "two"],
      [student, "student", "student"],
    ] as const)
      await post(a, "/auth/register", {
        email: `${label}-${run}@example.test`,
        password: "test-only-password",
        name: "Test " + label,
        role,
      }).expect(201);
    await post(admin, "/auth/login", {
      email: `owner-${run}@example.test`,
      password: "test-only-password",
    }).expect(201);
    await patch(admin, "/admin/settings", {
      commissionBps: 1000,
      paymentDetails: "TEST transfer details",
    }).expect(200);
  });
  afterAll(async () => {
    await app?.close();
  });
  it("creates and reloads a 45-day custom course with verified cover, three tags and no level", async () => {
    const image = await sharp({
      create: { width: 64, height: 40, channels: 3, background: "#F97316" },
    })
      .png()
      .toBuffer();
    coverId = await upload(tutor, image);
    await post(tutor, `/files/${coverId}/complete`).expect(201);
    const c = (
      await post(tutor, "/courses", { ...base, coverAssetId: coverId }).expect(
        201,
      )
    ).body;
    courseId = c.id;
    expect(c).toMatchObject({
      durationDays: 45,
      tags: ["код", "практика", "ai_2026"],
      coverAssetId: coverId,
      level: "",
    });
    expect(c.coverUrl).toContain("/ready/");
    const edit = (
      await tutor.get(`/api/v1/courses/${courseId}/edit`).expect(200)
    ).body;
    expect(edit.subject).toBe("Вайбкодинг для всех");
    expect(edit.tags).toEqual(c.tags);
    expect(
      (await db.course.findUniqueOrThrow({ where: { id: courseId } }))
        .durationDays,
    ).toBe(45);
  });
  it("publishes, searches tags with either case/hash, combines tag, subject and price filters", async () => {
    await post(tutor, `/courses/${courseId}/publish`).expect(201);
    for (const search of ["#КОД", "код", "Вайбкодинг"]) {
      const r = await request(app.getHttpServer())
        .get("/api/v1/courses")
        .query({ search })
        .expect(200);
      expect(r.body.items.map((c: { id: string }) => c.id)).toContain(courseId);
    }
    const r = await request(app.getHttpServer())
      .get("/api/v1/courses")
      .query({
        tag: "#КоД",
        subject: "ВАЙБКОДИНГ ДЛЯ ВСЕХ",
        priceFromMinor: 1999999,
      })
      .expect(200);
    expect(r.body.items.map((c: { id: string }) => c.id)).toContain(courseId);
    const none = await request(app.getHttpServer())
      .get("/api/v1/courses")
      .query({ tag: "код", priceToMinor: 1 })
      .expect(200);
    expect(none.body.total).toBe(0);
    const subjects = (
      await request(app.getHttpServer())
        .get("/api/v1/courses/subjects")
        .expect(200)
    ).body.items;
    expect(subjects).toContain("Математика");
    expect(subjects).toContain("Вайбкодинг для всех");
  });
  it("rejects fourth/duplicate/invalid tags and invalid duration/subject through API", async () => {
    for (const changes of [
      { tags: ["a", "b", "c", "d"] },
      { tags: ["Код", "#кОД"] },
      { tags: ["два слова"] },
      { tags: ["#"] },
      { tags: ["a".repeat(31)] },
      { tags: ["❤️"] },
      { durationDays: null },
      { tags: null },
      { durationDays: 0 },
      { durationDays: -1 },
      { durationDays: 1.5 },
      { subject: "  " },
      { subject: "a".repeat(81) },
    ])
      await patch(tutor, `/courses/${courseId}`, changes).expect(400);
    expect(
      (await db.course.findUniqueOrThrow({ where: { id: courseId } })).tags,
    ).toHaveLength(3);
  });
  it("protects ownership and permits superadmin to replace/remove covers", async () => {
    await patch(other, `/courses/${courseId}`, { coverAssetId: null }).expect(
      403,
    );
    await patch(student, `/courses/${courseId}`, {
      title: "Hacked course",
    }).expect(403);
    await request(app.getHttpServer())
      .patch(`/api/v1/courses/${courseId}`)
      .send({ title: "Hacked course" })
      .expect(403);
    await request(app.getHttpServer())
      .get(`/api/v1/courses/${courseId}/edit`)
      .expect(401);
    await student.get("/api/v1/admin/courses").expect(403);
    expect(
      (await admin.get("/api/v1/admin/courses").expect(200)).body.items.map(
        (c: { id: string }) => c.id,
      ),
    ).toContain(courseId);
    await other.get(`/api/v1/courses/${courseId}/edit`).expect(403);
    const image = await sharp({
      create: { width: 40, height: 40, channels: 3, background: "blue" },
    })
      .webp()
      .toBuffer();
    const adminCover = await upload(admin, image, "image/webp", "cover.webp");
    await post(admin, `/files/${adminCover}/complete`).expect(201);
    await patch(tutor, `/courses/${courseId}`, {
      coverAssetId: adminCover,
    }).expect(400);
    const updated = (
      await patch(admin, `/courses/${courseId}`, {
        coverAssetId: adminCover,
      }).expect(200)
    ).body;
    expect(updated.coverAssetId).toBe(adminCover);
    // Owner can edit the rest of a course whose current cover was uploaded by admin.
    await patch(tutor, `/courses/${courseId}`, {
      coverAssetId: adminCover,
      title: base.title,
    }).expect(200);
    expect(
      (
        await patch(admin, `/courses/${courseId}`, {
          coverAssetId: null,
        }).expect(200)
      ).body.coverUrl,
    ).toBeNull();
    await patch(tutor, `/courses/${courseId}`, {
      coverAssetId: coverId,
    }).expect(200);
  });
  it("validates size and decodes real images, rejecting forged MIME and truncated headers", async () => {
    await post(tutor, "/files/uploads", {
      purpose: "course_cover",
      originalName: "huge.png",
      mimeType: "image/png",
      sizeBytes: COVER_MAX_BYTES + 1,
    }).expect(400);
    await post(tutor, "/files/uploads", {
      purpose: "course_cover",
      originalName: "file.pdf",
      mimeType: "application/pdf",
      sizeBytes: 10,
    }).expect(400);
    await post(student, "/files/uploads", {
      purpose: "course_cover",
      originalName: "a.png",
      mimeType: "image/png",
      sizeBytes: 10,
    }).expect(403);
    for (const bytes of [
      Buffer.from("not an image"),
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    ]) {
      const id = await upload(tutor, bytes);
      await post(tutor, `/files/${id}/complete`).expect(400);
      await patch(tutor, `/courses/${courseId}`, { coverAssetId: id }).expect(
        400,
      );
    }
    const jpeg = await sharp({
      create: { width: 32, height: 32, channels: 3, background: "red" },
    })
      .jpeg()
      .toBuffer();
    const id = await upload(tutor, jpeg, "image/jpeg", "a.jpg");
    await post(tutor, `/files/${id}/complete`).expect(201);
    const wrong = await upload(tutor, jpeg);
    await post(tutor, `/files/${wrong}/complete`).expect(400);
  });
  it("keeps old pending purchase amount and 30 days, applies 45 days only to new purchases", async () => {
    const old = (
      await post(tutor, "/courses", {
        title: "Legacy purchase " + run,
        description: base.description,
        subject: "Математика",
        monthlyPriceMinor: 500000,
      }).expect(201)
    ).body;
    expect(old).toMatchObject({ durationDays: 30, tags: [], coverUrl: null });
    await post(tutor, `/courses/${old.id}/publish`).expect(201);
    const enrollment = (
      await post(student, `/courses/${old.id}/enrollments`).expect(201)
    ).body;
    const payment = (
      await post(student, `/enrollments/${enrollment.id}/payments`, {
        idempotencyKey: randomUUID(),
      }).expect(201)
    ).body;
    await patch(tutor, `/courses/${old.id}`, {
      durationDays: 45,
      monthlyPriceMinor: 2000000,
    }).expect(200);
    expect(
      (
        await post(student, `/enrollments/${enrollment.id}/payments`, {
          idempotencyKey: randomUUID(),
        }).expect(201)
      ).body,
    ).toMatchObject({ id: payment.id, amountMinor: 500000, durationDays: 30 });
    await post(student, `/payments/${payment.id}/submit`).expect(201);
    await post(admin, `/admin/payments/${payment.id}/approve`).expect(201);
    const first = await db.enrollment.findUniqueOrThrow({
      where: { id: enrollment.id },
    });
    expect(
      first.accessExpiresAt!.getTime() - first.accessStartsAt!.getTime(),
    ).toBe(30 * 86400000);
    const next = (
      await post(student, `/enrollments/${enrollment.id}/payments`, {
        idempotencyKey: randomUUID(),
      }).expect(201)
    ).body;
    expect(next).toMatchObject({ amountMinor: 2000000, durationDays: 45 });
    await patch(tutor, `/courses/${old.id}`, {
      durationDays: 7,
      monthlyPriceMinor: 100000,
    }).expect(200);
    expect(
      (await db.enrollment.findUniqueOrThrow({ where: { id: enrollment.id } }))
        .accessExpiresAt,
    ).toEqual(first.accessExpiresAt);
    await post(student, `/payments/${next.id}/submit`).expect(201);
    await post(admin, `/admin/payments/${next.id}/approve`).expect(201);
    expect(
      (
        await db.enrollment.findUniqueOrThrow({ where: { id: enrollment.id } })
      ).accessExpiresAt!.getTime() - first.accessExpiresAt!.getTime(),
    ).toBe(45 * 86400000);
  });
  it("supports preset durations, canonical concurrent subjects and Russian day forms", async () => {
    for (const durationDays of [7, 30, 180, 45])
      expect(
        (
          await patch(tutor, `/courses/${courseId}`, { durationDays }).expect(
            200,
          )
        ).body.durationDays,
      ).toBe(durationDays);
    const courses = await Promise.all(
      [" ШаХмАтЫ   онлайн ", "шахматы онлайн"].map((subject) =>
        post(tutor, "/courses", { ...base, subject }).expect(201),
      ),
    );
    expect(courses[0]!.body.subject).toBe(courses[1]!.body.subject);
    expect([1, 2, 5, 11, 21, 22, 45, 180].map(daysLabel)).toEqual([
      "1 день",
      "2 дня",
      "5 дней",
      "11 дней",
      "21 день",
      "22 дня",
      "45 дней",
      "180 дней",
    ]);
  });
});
