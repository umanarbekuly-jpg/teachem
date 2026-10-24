import "dotenv/config";
import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import { ThrottlerStorage } from "@nestjs/throttler";
import request from "supertest";
import { randomUUID } from "crypto";
import { hash } from "bcryptjs";
import { AppModule } from "../src/app.module";
import { configure } from "../src/bootstrap";
import { Database } from "../src/infrastructure/database/database.module";
import { StorageProvider } from "../src/infrastructure/storage/storage.module";

describe("Own profile", () => {
  let app: INestApplication, db: Database;
  type Agent = ReturnType<typeof request.agent>;
  const tokens = new Map<Agent, string>(),
    run = randomUUID();
  const password = "profile-test-password",
    nextPassword = "profile-replacement-password";
  const origin = "http://localhost:8080";
  const accounts: { agent: Agent; id: string; email: string; role: string }[] =
    [];
  async function agent() {
    const a = request.agent(app.getHttpServer());
    tokens.set(a, (await a.get("/api/v1/auth/csrf")).body.token);
    return a;
  }
  function post(a: Agent, path: string, body: object) {
    return a
      .post("/api/v1/" + path)
      .set("Origin", origin)
      .set("X-CSRF-Token", tokens.get(a)!)
      .send(body);
  }
  function patch(a: Agent, body: object, path = "users/me") {
    return a
      .patch("/api/v1/" + path)
      .set("Origin", origin)
      .set("X-CSRF-Token", tokens.get(a)!)
      .send(body);
  }
  beforeAll(async () => {
    if (!process.env.DATABASE_URL?.includes("test"))
      throw new Error("Isolated test database required");
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(StorageProvider)
      .useValue({ healthy: async () => {} })
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
    const old = await db.user.findFirst({ where: { role: "SUPERADMIN" } });
    await db.user.upsert({
      where: { id: old?.id ?? randomUUID() },
      create: {
        email: "supadmin@teachem",
        name: "Owner",
        role: "SUPERADMIN",
        passwordHash: await hash(password, 12),
      },
      update: {
        email: "supadmin@teachem",
        passwordHash: await hash(password, 12),
        mustChangePassword: false,
        authVersion: { increment: 1 },
      },
    });
    for (const role of ["student", "tutor", "SUPERADMIN"]) {
      const a = await agent(),
        email =
          role === "SUPERADMIN"
            ? "supadmin@teachem"
            : `${role}-${run}@example.test`;
      await post(a, role === "SUPERADMIN" ? "auth/login" : "auth/register", {
        email,
        password,
        ...(role === "SUPERADMIN" ? {} : { name: "Original full name", role }),
      }).expect(201);
      const me = (await a.get("/api/v1/users/me").expect(200)).body;
      accounts.push({ agent: a, id: me.id, email, role });
    }
  });
  afterAll(async () => {
    await app?.close();
  });

  it("allows all three roles to read and save names, without changing tutor data", async () => {
    const tutor = accounts[1]!;
    const before = await db.tutorProfile.findUnique({
      where: { userId: tutor.id },
    });
    for (const a of accounts) {
      const response = await patch(a.agent, {
        name: "  Новое имя  ",
        surname: " Фамилия ",
        email: a.email,
      }).expect(200);
      expect(response.body).toMatchObject({
        id: a.id,
        name: "Новое имя",
        surname: "Фамилия",
        role: a.role,
      });
      expect(response.body.passwordHash).toBeUndefined();
      expect(response.body.currentPassword).toBeUndefined();
      expect((await a.agent.get("/api/v1/auth/me")).body.surname).toBe(
        "Фамилия",
      );
      expect(
        (await db.user.findUniqueOrThrow({ where: { id: a.id } })).name,
      ).toBe("Новое имя");
    }
    expect(
      await db.tutorProfile.findUnique({ where: { userId: tutor.id } }),
    ).toEqual(before);
  });
  it("rejects protected fields, other users and anonymous requests", async () => {
    for (const key of [
      "role",
      "id",
      "userId",
      "status",
      "blockedAt",
      "passwordHash",
    ]) {
      await patch(accounts[0]!.agent, {
        name: "Attempt",
        [key]: accounts[1]!.id,
      }).expect(400);
    }
    await patch(
      accounts[0]!.agent,
      { name: "Attempt" },
      "users/" + accounts[1]!.id,
    ).expect(404);
    const anonymous = await agent();
    await patch(anonymous, { name: "Attempt" }).expect(401);
    await accounts[0]!.agent.get("/api/v1/admin/users").expect(403);
  });
  it("validates names, email, reserved login, uniqueness and current password", async () => {
    const a = accounts[0]!;
    await patch(a.agent, { name: " " }).expect(400);
    await patch(a.agent, { name: "Valid", surname: "x".repeat(101) }).expect(
      400,
    );
    for (const email of ["bad", "", "supadmin@teachem"])
      await patch(a.agent, {
        name: "Valid",
        email,
        currentPassword: password,
      }).expect(400);
    for (const currentPassword of [undefined, "wrong-password"]) {
      const r = await patch(a.agent, {
        name: "Valid",
        email: `new-${run}@example.test`,
        currentPassword,
      }).expect(400);
      expect(r.body.fields.currentPassword).toBeDefined();
    }
    const duplicate = await patch(a.agent, {
      name: "Valid",
      email: accounts[1]!.email.toUpperCase(),
      currentPassword: password,
    }).expect(409);
    expect(duplicate.body.fields.email).toBeDefined();
    expect((await a.agent.get("/api/v1/users/me")).body.email).toBe(a.email);
  });
  it("changes login, clears email verification and preserves ID and role", async () => {
    const a = accounts[0]!;
    await db.user.update({
      where: { id: a.id },
      data: { emailVerifiedAt: new Date() },
    });
    const email = `changed-${run}@example.test`;
    const updated = await patch(a.agent, {
      name: "Changed",
      surname: "",
      email: ` ${email.toUpperCase()} `,
      currentPassword: password,
    }).expect(200);
    expect(updated.body).toMatchObject({
      id: a.id,
      email,
      role: "student",
      surname: "",
    });
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: a.id } }))
        .emailVerifiedAt,
    ).toBeNull();
    const fresh = await agent();
    await post(fresh, "auth/login", { email: a.email, password }).expect(401);
    await post(fresh, "auth/login", { email, password }).expect(201);
    a.email = email;
  });
  it("revokes all sessions after password change and requires the new password", async () => {
    const a = accounts[0]!,
      second = await agent();
    await post(second, "auth/login", { email: a.email, password }).expect(201);
    await post(a.agent, "auth/change-password", {
      currentPassword: "wrong-password",
      newPassword: nextPassword,
      confirmPassword: nextPassword,
    }).expect(400);
    await post(a.agent, "auth/change-password", {
      currentPassword: password,
      newPassword: nextPassword,
      confirmPassword: "different-password",
    }).expect(400);
    await post(a.agent, "auth/change-password", {
      currentPassword: password,
      newPassword: nextPassword,
      confirmPassword: nextPassword,
    }).expect(201);
    await second.get("/api/v1/users/me").expect(401);
    await post(second, "auth/refresh", {}).expect(401);
    expect(
      await db.authSession.count({ where: { userId: a.id, revokedAt: null } }),
    ).toBe(0);
    const fresh = await agent();
    await post(fresh, "auth/login", { email: a.email, password }).expect(401);
    await post(fresh, "auth/login", {
      email: a.email,
      password: nextPassword,
    }).expect(201);
  });
  it("keeps forced password change ahead of profile editing", async () => {
    const a = accounts[1]!;
    await db.user.update({
      where: { id: a.id },
      data: { mustChangePassword: true },
    });
    await patch(a.agent, { name: "Bypass" }).expect(403);
    await post(a.agent, "auth/change-password", {
      currentPassword: password,
      newPassword: nextPassword,
      confirmPassword: nextPassword,
    }).expect(201);
    const fresh = await agent();
    await post(fresh, "auth/login", {
      email: a.email,
      password: nextPassword,
    }).expect(201);
    await fresh.get("/api/v1/users/me").expect(200);
  });
});
