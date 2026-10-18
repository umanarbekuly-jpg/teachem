import "dotenv/config";
import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { randomUUID } from "crypto";
import { hash } from "bcryptjs";
import { AppModule } from "../src/app.module";
import { configure } from "../src/bootstrap";
import { Database } from "../src/infrastructure/database/database.module";
import { StorageProvider } from "../src/infrastructure/storage/storage.module";
const origin = "http://localhost:8080";
// Real PostgreSQL; storage adapter is replaced here so these tests focus on domain and HTTP boundaries.
describe("Platform HTTP integration", () => {
  let app: INestApplication;
  let db: Database;
  let tutor: ReturnType<typeof request.agent>;
  let student: ReturnType<typeof request.agent>;
  let stranger: ReturnType<typeof request.agent>;
  let admin: ReturnType<typeof request.agent>;
  let tutorCsrf: string,
    studentCsrf: string,
    strangerCsrf: string,
    adminCsrf: string;
  let courseId: string,
    enrollmentId: string,
    paymentId: string,
    testId: string,
    attemptId: string;
  const tag = randomUUID();
  async function csrf(agent: ReturnType<typeof request.agent>) {
    return (await agent.get("/api/v1/auth/csrf").expect(200)).body
      .token as string;
  }
  beforeAll(async () => {
    if (!process.env.DATABASE_URL?.includes("test"))
      throw new Error("Use an isolated DATABASE_URL containing test");
    process.env.PUBLIC_ORIGIN = origin;
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(StorageProvider)
      .useValue({ healthy: async () => {} })
      .compile();
    app = mod.createNestApplication();
    configure(app);
    await app.init();
    db = app.get(Database);
    tutor = request.agent(app.getHttpServer());
    student = request.agent(app.getHttpServer());
    stranger = request.agent(app.getHttpServer());
    admin = request.agent(app.getHttpServer());
    [tutorCsrf, studentCsrf, strangerCsrf, adminCsrf] = await Promise.all([
      csrf(tutor),
      csrf(student),
      csrf(stranger),
      csrf(admin),
    ]);
    for (const [agent, token, role, suffix] of [
      [tutor, tutorCsrf, "tutor", "tutor"],
      [student, studentCsrf, "student", "student"],
      [stranger, strangerCsrf, "student", "stranger"],
    ] as const)
      await agent
        .post("/api/v1/auth/register")
        .set("Origin", origin)
        .set("X-CSRF-Token", token)
        .send({
          email: `${suffix}-${tag}@example.test`,
          password: "test-password-long",
          name: `Test ${suffix}`,
          role,
        })
        .expect(201);
    await db.user.create({
      data: {
        email: `admin-${tag}@example.test`,
        passwordHash: await hash("test-password-long", 12),
        name: "Test Admin",
        role: "admin",
      },
    });
    await admin
      .post("/api/v1/auth/login")
      .set("Origin", origin)
      .set("X-CSRF-Token", adminCsrf)
      .send({
        email: `admin-${tag}@example.test`,
        password: "test-password-long",
      })
      .expect(201);
    await admin
      .patch("/api/v1/admin/settings")
      .set("Origin", origin)
      .set("X-CSRF-Token", adminCsrf)
      .send({
        commissionBps: 1250,
        paymentDetails: "TEST ONLY account 1234567890",
      })
      .expect(200);
  });
  afterAll(async () => {
    await app?.close();
  });
  it("rejects cross-site mutation and registration as admin", async () => {
    await student.post("/api/v1/auth/logout").send({}).expect(403);
    await stranger
      .post("/api/v1/auth/register")
      .set("Origin", origin)
      .set("X-CSRF-Token", strangerCsrf)
      .send({
        email: `bad-${tag}@example.test`,
        password: "test-password-long",
        name: "Bad Actor",
        role: "admin",
      })
      .expect(400);
  });
  it("keeps drafts private, then publishes a course", async () => {
    const r = await tutor
      .post("/api/v1/courses")
      .set("Origin", origin)
      .set("X-CSRF-Token", tutorCsrf)
      .send({
        title: "Test mathematics",
        description:
          "A sufficiently detailed description for this test course.",
        subject: "Математика",
        level: "Начальный",
        monthlyPriceMinor: 10001,
      })
      .expect(201);
    courseId = r.body.id;
    await student.get(`/api/v1/courses/${courseId}`).expect(404);
    await student
      .patch(`/api/v1/courses/${courseId}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", studentCsrf)
      .send({ title: "Hijacked" })
      .expect(403);
    await tutor
      .post(`/api/v1/courses/${courseId}/publish`)
      .set("Origin", origin)
      .set("X-CSRF-Token", tutorCsrf)
      .expect(201);
    await student.get(`/api/v1/courses/${courseId}`).expect(200);
  });
  it("denies materials before approval, preserves payment ownership", async () => {
    enrollmentId = (
      await student
        .post(`/api/v1/courses/${courseId}/enrollments`)
        .set("Origin", origin)
        .set("X-CSRF-Token", studentCsrf)
        .expect(201)
    ).body.id;
    await student.get(`/api/v1/courses/${courseId}/materials`).expect(403);
    paymentId = (
      await student
        .post(`/api/v1/enrollments/${enrollmentId}/payments`)
        .set("Origin", origin)
        .set("X-CSRF-Token", studentCsrf)
        .send({ idempotencyKey: randomUUID() })
        .expect(201)
    ).body.id;
    await stranger.get(`/api/v1/payments/${paymentId}`).expect(403);
    await student
      .post(`/api/v1/payments/${paymentId}/submit`)
      .set("Origin", origin)
      .set("X-CSRF-Token", studentCsrf)
      .send({})
      .expect(201);
  });
  it("approves once even with parallel requests", async () => {
    const responses = await Promise.all(
      [1, 2].map(() =>
        admin
          .post(`/api/v1/admin/payments/${paymentId}/approve`)
          .set("Origin", origin)
          .set("X-CSRF-Token", adminCsrf),
      ),
    );
    expect(responses.map((r) => r.status)).toEqual([201, 201]);
    expect(await db.payout.count({ where: { paymentId } })).toBe(1);
    const e = await db.enrollment.findUniqueOrThrow({
      where: { id: enrollmentId },
    });
    expect(e.accessExpiresAt!.getTime() - Date.now()).toBeGreaterThan(
      29 * 86400000,
    );
    expect(e.accessExpiresAt!.getTime() - Date.now()).toBeLessThanOrEqual(
      30 * 86400000,
    );
    expect(
      (await db.payout.findUniqueOrThrow({ where: { paymentId } })).netMinor,
    ).toBe(8751);
    await student.get(`/api/v1/courses/${courseId}/materials`).expect(200);
    await stranger.get(`/api/v1/courses/${courseId}/materials`).expect(403);
  });
  it("grades on the server and never sends answer keys to students", async () => {
    testId = (
      await tutor
        .post(`/api/v1/courses/${courseId}/tests`)
        .set("Origin", origin)
        .set("X-CSRF-Token", tutorCsrf)
        .send({
          title: "Test addition",
          questions: [
            {
              text: "2 + 2?",
              type: "single",
              points: 3,
              options: [
                { text: "4", isCorrect: true },
                { text: "5", isCorrect: false },
              ],
            },
          ],
        })
        .expect(201)
    ).body.id;
    await tutor
      .post(`/api/v1/tests/${testId}/publish`)
      .set("Origin", origin)
      .set("X-CSRF-Token", tutorCsrf)
      .expect(201);
    const response = await student.get(`/api/v1/tests/${testId}`).expect(200);
    expect(JSON.stringify(response.body)).not.toContain("isCorrect");
    const question = response.body.questions[0];
    attemptId = (
      await student
        .post(`/api/v1/tests/${testId}/attempts`)
        .set("Origin", origin)
        .set("X-CSRF-Token", studentCsrf)
        .expect(201)
    ).body.id;
    await student
      .put(`/api/v1/test-attempts/${attemptId}/answers`)
      .set("Origin", origin)
      .set("X-CSRF-Token", studentCsrf)
      .send({
        answers: [{ questionId: question.id, optionIds: [randomUUID()] }],
      })
      .expect(400);
    await student
      .put(`/api/v1/test-attempts/${attemptId}/answers`)
      .set("Origin", origin)
      .set("X-CSRF-Token", studentCsrf)
      .send({
        answers: [
          { questionId: question.id, optionIds: [question.options[0].id] },
        ],
      })
      .expect(200);
    expect(
      (
        await student
          .post(`/api/v1/test-attempts/${attemptId}/submit`)
          .set("Origin", origin)
          .set("X-CSRF-Token", studentCsrf)
          .expect(201)
      ).body.score,
    ).toBe(3);
    await stranger.get(`/api/v1/test-attempts/${attemptId}`).expect(403);
    await tutor
      .patch(`/api/v1/tests/${testId}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", tutorCsrf)
      .send({ title: "Changed" })
      .expect(400);
  });
  it("hides session links and stops access immediately at expiration", async () => {
    const id = (
      await tutor
        .post(`/api/v1/courses/${courseId}/sessions`)
        .set("Origin", origin)
        .set("X-CSRF-Token", tutorCsrf)
        .send({
          topic: "Lesson",
          startsAt: new Date(Date.now() + 3600000).toISOString(),
          durationMinutes: 60,
          joinUrl: "https://meet.google.com/abc-defg-hij",
        })
        .expect(201)
    ).body.id;
    expect(
      JSON.stringify(
        (await student.get(`/api/v1/courses/${courseId}/sessions`).expect(200))
          .body,
      ),
    ).not.toContain("meet.google.com");
    await student.get(`/api/v1/sessions/${id}/join`).expect(200);
    await db.enrollment.update({
      where: { id: enrollmentId },
      data: { accessExpiresAt: new Date(0) },
    });
    await student.get(`/api/v1/sessions/${id}/join`).expect(403);
  });
});
