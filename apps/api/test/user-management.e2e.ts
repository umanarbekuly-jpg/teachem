import "dotenv/config";
import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import { ThrottlerStorage } from "@nestjs/throttler";
import request from "supertest";
import { randomUUID } from "crypto";
import { hash, compare } from "bcryptjs";
import { AppModule } from "../src/app.module";
import { configure } from "../src/bootstrap";
import { Database } from "../src/infrastructure/database/database.module";
import { StorageProvider } from "../src/infrastructure/storage/storage.module";
const origin = "http://localhost:8080",
  initial = "test-initial-password",
  personal = "test-personal-password",
  assigned = "test-assigned-password";
type Agent = ReturnType<typeof request.agent>;
describe("Superadmin and account management", () => {
  let app: INestApplication,
    db: Database,
    admin: Agent,
    token: string,
    ownerId: string,
    studentId: string,
    tutorId: string,
    student: Agent,
    studentToken: string;
  const tag = randomUUID();
  const email = (s: string) => s + "-" + tag + "@example.test";
  async function session(login: string, password: string) {
    const agent = request.agent(app.getHttpServer());
    const csrf = (await agent.get("/api/v1/auth/csrf")).body.token;
    await agent
      .post("/api/v1/auth/login")
      .set("Origin", origin)
      .set("X-CSRF-Token", csrf)
      .send({ email: login, password })
      .expect(201);
    return { agent, csrf };
  }
  function post(agent: Agent, csrf: string, url: string, body: object = {}) {
    return agent
      .post("/api/v1/" + url)
      .set("Origin", origin)
      .set("X-CSRF-Token", csrf)
      .send(body);
  }
  function patch(id: string, body: object) {
    return admin
      .patch("/api/v1/admin/users/" + id)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send(body);
  }
  beforeAll(async () => {
    if (!process.env.DATABASE_URL?.includes("test"))
      throw new Error("Use an isolated test database");
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(StorageProvider)
      .useValue({
        healthy: async () => {},
        download: async () => origin + "/test-avatar",
      })
      .overrideProvider(ThrottlerStorage)
      .useValue({
        increment: async () => ({
          totalHits: 1,
          timeToExpire: 0,
          isBlocked: false,
          timeToBlockExpire: 0,
        }),
      })
      .compile();
    app = mod.createNestApplication();
    configure(app);
    await app.init();
    db = app.get(Database);
    const previous = await db.user.findFirst({ where: { role: "SUPERADMIN" } });
    const owner = await db.user.upsert({
      where: { id: previous?.id ?? randomUUID() },
      create: {
        email: "supadmin@teachem",
        name: "Test Superadmin",
        role: "SUPERADMIN",
        passwordHash: await hash(initial, 12),
      },
      update: {
        email: "supadmin@teachem",
        passwordHash: await hash(initial, 12),
        authVersion: { increment: 1 },
      },
    });
    ownerId = owner.id;
    const s = await session("supadmin@teachem", initial);
    admin = s.agent;
    token = s.csrf;
  });
  afterAll(async () => {
    await app?.close();
  });
  it("logs in using the reserved address and exposes no password hash", async () => {
    const me = await admin.get("/api/v1/auth/me").expect(200);
    expect(me.body.role).toBe("SUPERADMIN");
    expect(me.body.passwordHash).toBeUndefined();
    await admin.get("/api/v1/admin/users").expect(200);
    await request(app.getHttpServer()).get("/api/v1/admin/users").expect(401);
  });
  it("creates student/tutor, validates required fields and email, rejects administrative roles", async () => {
    for (const role of ["student", "tutor"]) {
      const r = await post(admin, token, "admin/users", {
        name: "Managed " + role,
        email: email(role),
        password: initial,
        role,
        surname: "Surname",
        phone: "+77000000000",
        bio: "Biography",
        ...(role === "tutor"
          ? {
              education: "University",
              experienceYears: 4,
              subjects: ["Math"],
              languages: ["Russian"],
            }
          : {}),
      }).expect(201);
      if (role === "student") studentId = r.body.id;
      else tutorId = r.body.id;
      expect(r.body.mustChangePassword).toBe(true);
      expect(r.body.passwordHash).toBeUndefined();
      expect(
        await compare(
          initial,
          (await db.user.findUniqueOrThrow({ where: { id: r.body.id } }))
            .passwordHash,
        ),
      ).toBe(true);
    }
    await post(admin, token, "admin/users", {
      email: email("missing"),
      role: "student",
      password: initial,
    }).expect(400);
    for (const role of ["admin", "SUPERADMIN"])
      await post(admin, token, "admin/users", {
        name: "Invalid",
        email: email("invalid"),
        role,
        password: initial,
      }).expect(400);
    await post(admin, token, "admin/users", {
      name: "Duplicate",
      email: email("student").toUpperCase(),
      role: "student",
      password: initial,
    }).expect(400);
    await post(admin, token, "admin/users", {
      name: "Short",
      email: email("short"),
      role: "student",
      password: "short",
    }).expect(400);
    for (const login of ["supadmin@teachem", "other@teachem"])
      await post(admin, token, "auth/register", {
        name: "Bad",
        email: login,
        role: "student",
        password: initial,
      }).expect(400);
    await post(admin, token, "auth/register", {
      name: "Bad",
      email: email("bad"),
      role: "SUPERADMIN",
      password: initial,
    }).expect(400);
  });
  it("requires first password change for both roles, blocks other protected actions", async () => {
    for (const role of ["student", "tutor"]) {
      const s = await session(email(role), initial);
      await s.agent.get("/api/v1/users/me").expect(403);
      await s.agent.get("/api/v1/tutors/me/courses").expect(403);
      await post(s.agent, s.csrf, "auth/refresh").expect(401);
      await post(s.agent, s.csrf, "auth/change-password", {
        currentPassword: "wrong",
        newPassword: personal,
        confirmPassword: personal,
      }).expect(400);
      await post(s.agent, s.csrf, "auth/change-password", {
        currentPassword: initial,
        newPassword: personal,
        confirmPassword: personal,
      }).expect(201);
      await s.agent.get("/api/v1/auth/me").expect(401);
      const fresh = await session(email(role), personal);
      expect(
        (await fresh.agent.get("/api/v1/auth/me").expect(200)).body
          .mustChangePassword,
      ).toBe(false);
      if (role === "student") {
        student = fresh.agent;
        studentToken = fresh.csrf;
      }
    }
  });
  it("denies ordinary users every management API and mass assignment", async () => {
    for (const url of ["admin/users", "admin/users/" + tutorId])
      await student.get("/api/v1/" + url).expect(403);
    await post(student, studentToken, "admin/users", { name: "X" }).expect(403);
    await post(student, studentToken, "admin/users/" + tutorId + "/role", {
      role: "student",
    }).expect(403);
    await post(student, studentToken, "admin/users/" + tutorId + "/password", {
      newPassword: assigned,
      confirmPassword: assigned,
    }).expect(403);
    await student
      .patch("/api/v1/admin/users/" + tutorId)
      .set("Origin", origin)
      .set("X-CSRF-Token", studentToken)
      .send({ name: "Hacked" })
      .expect(403);
    await student
      .patch("/api/v1/users/me")
      .set("Origin", origin)
      .set("X-CSRF-Token", studentToken)
      .send({ name: "Hacked", role: "SUPERADMIN" })
      .expect(400);
    await patch(studentId, { passwordHash: "bad", role: "SUPERADMIN" }).expect(
      400,
    );
  });
  it("persists profile, validates fields, searches, filters and paginates", async () => {
    await db.user.update({
      where: { id: studentId },
      data: { emailVerifiedAt: new Date() },
    });
    await patch(studentId, {
      name: "Updated Student",
      surname: "Persisted",
      email: email("updated"),
      phone: "+77123456789",
      bio: "New description",
    }).expect(200);
    await student.get("/api/v1/auth/me").expect(401);
    const detail = (
      await admin.get("/api/v1/admin/users/" + studentId).expect(200)
    ).body;
    expect(detail.surname).toBe("Persisted");
    expect(detail.emailVerifiedAt).toBeNull();
    expect(detail.phone).toBe("+77123456789");
    await patch(studentId, { email: email("tutor") }).expect(400);
    await patch(studentId, { name: null }).expect(400);
    const result = (
      await admin
        .get("/api/v1/admin/users")
        .query({
          search: email("updated"),
          role: "student",
          status: "active",
          page: 1,
          pageSize: 1,
        })
        .expect(200)
    ).body;
    expect(result.total).toBe(1);
    expect(result.items[0].id).toBe(studentId);
    const avatar = await db.fileAsset.create({
      data: {
        ownerId,
        originalName: "test.png",
        objectKey: tag,
        mimeType: "image/png",
        sizeBytes: 8,
        purpose: "avatar",
        status: "ready",
      },
    });
    await patch(tutorId, {
      bio: "Tutor changed",
      experienceYears: 8,
      education: "Masters",
      subjects: ["Physics"],
      languages: ["English"],
      photoAssetId: avatar.id,
    }).expect(200);
    const tutor = (await admin.get("/api/v1/admin/users/" + tutorId)).body;
    expect(tutor.profile.subjects).toEqual(["Physics"]);
    expect(tutor.photoUrl).toContain("test-avatar");
  });
  it("changes roles, revokes existing access/refresh, preserves profiles and courses", async () => {
    const s = await session(email("tutor"), personal);
    const course = await db.course.create({
      data: {
        tutorId,
        title: "History",
        description: "Preserved",
        subject: "Math",
        level: "All",
        monthlyPriceMinor: 10000,
        status: "published",
      },
    });
    await post(admin, token, "admin/users/" + tutorId + "/role", {
      role: "student",
    }).expect(409);
    await db.course.update({
      where: { id: course.id },
      data: { status: "archived" },
    });
    await post(admin, token, "admin/users/" + tutorId + "/role", {
      role: "student",
    }).expect(201);
    await s.agent.get("/api/v1/auth/me").expect(401);
    await post(s.agent, s.csrf, "auth/refresh").expect(401);
    const changed = await session(email("tutor"), personal);
    await changed.agent.get("/api/v1/tutors/me/profile").expect(403);
    expect(await db.course.count({ where: { id: course.id } })).toBe(1);
    expect(
      (await db.tutorProfile.findUniqueOrThrow({ where: { userId: tutorId } }))
        .education,
    ).toBe("Masters");
    await post(admin, token, "admin/users/" + tutorId + "/role", {
      role: "tutor",
    }).expect(201);
  });
  it("resets password, revokes all sessions and forces replacement", async () => {
    const first = await session(email("updated"), personal),
      second = await session(email("updated"), personal);
    await post(admin, token, "admin/users/" + studentId + "/password", {
      newPassword: assigned,
      confirmPassword: "different",
    }).expect(400);
    await post(admin, token, "admin/users/" + studentId + "/password", {
      newPassword: assigned,
      confirmPassword: assigned,
    }).expect(201);
    for (const s of [first, second]) {
      await s.agent.get("/api/v1/auth/me").expect(401);
      await post(s.agent, s.csrf, "auth/refresh").expect(401);
    }
    await post(first.agent, first.csrf, "auth/login", {
      email: email("updated"),
      password: personal,
    }).expect(401);
    const fresh = await session(email("updated"), assigned);
    await fresh.agent.get("/api/v1/users/me").expect(403);
    await post(fresh.agent, fresh.csrf, "auth/change-password", {
      currentPassword: assigned,
      newPassword: personal,
      confirmPassword: personal,
    }).expect(201);
    await session(email("updated"), personal);
  });
  it("protects sole superadmin through HTTP and database including concurrent inserts", async () => {
    await post(admin, token, "admin/users/" + ownerId + "/role", {
      role: "student",
    }).expect(403);
    await post(admin, token, "admin/users/" + ownerId + "/password", {
      newPassword: assigned,
      confirmPassword: assigned,
    }).expect(403);
    await post(admin, token, "admin/users/" + ownerId + "/block").expect(400);
    await patch(ownerId, { name: "Changed" }).expect(403);
    await expect(
      db.user.update({ where: { id: ownerId }, data: { role: "student" } }),
    ).rejects.toThrow();
    await expect(
      db.user.update({
        where: { id: ownerId },
        data: { blockedAt: new Date() },
      }),
    ).rejects.toThrow();
    await expect(
      db.user.update({
        where: { id: ownerId },
        data: { deletedAt: new Date() },
      }),
    ).rejects.toThrow();
    await expect(db.user.delete({ where: { id: ownerId } })).rejects.toThrow();
    const results = await Promise.allSettled(
      [1, 2].map((n) =>
        db.user.create({
          data: {
            name: "Invalid",
            email: email("duplicate" + n),
            role: "SUPERADMIN",
            passwordHash: "not-a-secret",
          },
        }),
      ),
    );
    expect(results.every((r) => r.status === "rejected")).toBe(true);
    expect(await db.user.count({ where: { role: "SUPERADMIN" } })).toBe(1);
  });
  it("audits actions without passwords or tokens and changes owner password only with current password", async () => {
    const logs = await db.auditLog.findMany({
      where: { entityId: { in: [studentId, tutorId] } },
    });
    for (const action of [
      "user.create",
      "user.profile.update",
      "user.role.change",
      "user.password.reset",
    ])
      expect(
        logs.some((l) => l.action === action && l.actorId === ownerId),
      ).toBe(true);
    const serialized = JSON.stringify(logs);
    for (const secret of [
      initial,
      personal,
      assigned,
      "passwordHash",
      "refreshToken",
    ])
      expect(serialized).not.toContain(secret);
    await post(admin, token, "auth/change-password", {
      currentPassword: "wrong",
      newPassword: personal,
      confirmPassword: personal,
    }).expect(400);
    await post(admin, token, "auth/change-password", {
      currentPassword: initial,
      newPassword: personal,
      confirmPassword: personal,
    }).expect(201);
    await admin.get("/api/v1/admin/users").expect(401);
    const s = await session("supadmin@teachem", personal);
    await s.agent.get("/api/v1/admin/users").expect(200);
  });
});
