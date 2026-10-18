import { ForbiddenException } from "@nestjs/common";
import { AuthService } from "../src/modules/auth/auth.service";
import { TestsService } from "../src/modules/tests/tests.service";
import { EnrollmentsService } from "../src/modules/enrollments/enrollments.module";
import { PaymentsService } from "../src/modules/payments/payments.service";
import { sign } from "jsonwebtoken";
import { createHash } from "crypto";
const student = {
  id: "student",
  role: "student" as const,
  sessionId: "session",
};
describe("Authorization boundaries", () => {
  it("does not disclose correct answers in student test DTO", async () => {
    const repo = {
      get: jest
        .fn()
        .mockResolvedValue({
          courseId: "course",
          status: "published",
          questions: [
            {
              id: "question",
              options: [
                { id: "a", text: "Answer", position: 0, isCorrect: true },
              ],
            },
          ],
        }),
    };
    const service = new TestsService(
      repo as any,
      {} as any,
      {} as any,
      {
        assertAccess: jest.fn().mockResolvedValue({ tutorId: "tutor" }),
      } as any,
    );
    const output = await service.get("test", student);
    expect(JSON.stringify(output)).not.toContain("isCorrect");
  });
  it("does not expose a draft test to an enrolled student", async () => {
    const service = new TestsService(
      {
        get: jest
          .fn()
          .mockResolvedValue({ courseId: "course", status: "draft" }),
      } as any,
      {} as any,
      {} as any,
      {
        assertAccess: jest.fn().mockResolvedValue({ tutorId: "tutor" }),
      } as any,
    );
    await expect(service.get("test", student)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
  it("denies expired course access", async () => {
    const repo = {
      access: jest.fn().mockResolvedValue({ accessExpiresAt: new Date(0) }),
    };
    const courses = {
      get: jest
        .fn()
        .mockResolvedValue({ tutorId: "tutor", tutor: { blockedAt: null } }),
    };
    await expect(
      new EnrollmentsService(repo as any, courses as any).assertAccess(
        student,
        "course",
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
  it("revokes the session when a refresh token is replayed", async () => {
    const secret = "test-refresh-secret-with-at-least-32-chars";
    const token = sign({ sid: "session", type: "refresh" }, secret, {
      subject: "student",
      issuer: "tutor-api",
      audience: "tutor-web",
      expiresIn: 1000,
    });
    const repo = {
      find: jest
        .fn()
        .mockResolvedValue({
          id: "session",
          userId: "student",
          refreshTokenHash: createHash("sha256")
            .update("different")
            .digest("hex"),
          expiresAt: new Date(Date.now() + 10000),
        }),
      revoke: jest.fn(),
    };
    const auth = new AuthService(
      {} as any,
      repo as any,
      { JWT_REFRESH_SECRET: secret } as any,
    );
    await expect(auth.refresh(token)).rejects.toThrow("Сессия отозвана");
    expect(repo.revoke).toHaveBeenCalledWith("session");
  });
  it("does not create a second payout on repeated approval", async () => {
    const repo = {
      find: jest.fn().mockResolvedValue({ id: "payment", status: "approved" }),
      transition: jest.fn(),
    };
    const payout = { create: jest.fn() };
    const enrollment = { extend: jest.fn() };
    const db = { atomic: (fn: any) => fn({}) };
    const service = new PaymentsService(
      db as any,
      repo as any,
      enrollment as any,
      {} as any,
      {} as any,
      {} as any,
      payout as any,
      {} as any,
      {} as any,
    );
    await service.review(
      "payment",
      { id: "admin", role: "admin", sessionId: "s" },
      true,
      undefined,
      "request",
    );
    expect(payout.create).not.toHaveBeenCalled();
    expect(enrollment.extend).not.toHaveBeenCalled();
    expect(repo.transition).not.toHaveBeenCalled();
  });
});
