import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  Database,
  Transaction,
} from "../../infrastructure/database/database.module";
import { PageDto, pageArgs, paged } from "../../common/http";
import { TestDto, UpdateTestDto } from "./tests.dto";
const questionInclude = {
  orderBy: { position: "asc" as const },
  include: { options: { orderBy: { position: "asc" as const } } },
};
function questions(data: TestDto["questions"]) {
  return data.map((q, position) => ({
    ...q,
    position,
    options: { create: q.options.map((o, i) => ({ ...o, position: i })) },
  }));
}
@Injectable()
export class TestsRepository {
  constructor(private db: Database) {}
  get(id: string, tx: Transaction = this.db) {
    return tx.test.findFirstOrThrow({
      where: { id, deletedAt: null },
      include: { questions: questionInclude },
    });
  }
  create(courseId: string, dto: TestDto) {
    return this.db.test.create({
      data: {
        courseId,
        title: dto.title,
        questions: { create: questions(dto.questions) },
      },
      include: { questions: questionInclude },
    });
  }
  async update(id: string, dto: UpdateTestDto, tx: Transaction) {
    if (dto.questions) {
      await tx.answerOption.deleteMany({ where: { question: { testId: id } } });
      await tx.question.deleteMany({ where: { testId: id } });
    }
    return tx.test.update({
      where: { id },
      data: {
        title: dto.title,
        ...(dto.questions
          ? { questions: { create: questions(dto.questions) } }
          : {}),
      },
      include: { questions: questionInclude },
    });
  }
  publish(id: string, tx: Transaction) {
    return tx.test.update({ where: { id }, data: { status: "published" } });
  }
  remove(id: string, tx: Transaction) {
    return tx.test.update({
      where: { id },
      data: { status: "archived", deletedAt: new Date() },
    });
  }
  async list(courseId: string, q: PageDto, owner: boolean) {
    const where: Prisma.TestWhereInput = {
      courseId,
      deletedAt: null,
      ...(owner ? {} : { status: "published" }),
    };
    const [items, total] = await Promise.all([
      this.db.test.findMany({
        where,
        ...pageArgs(q),
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          title: true,
          courseId: true,
          status: true,
          createdAt: true,
          _count: { select: { questions: true } },
        },
      }),
      this.db.test.count({ where }),
    ]);
    return paged(items, total, q);
  }
  start(testId: string, studentId: string, maxScore: number) {
    return this.db.testAttempt.create({
      data: { testId, studentId, maxScore },
    });
  }
  attempt(id: string, tx: Transaction = this.db) {
    return tx.testAttempt.findUniqueOrThrow({
      where: { id },
      include: {
        test: { include: { questions: questionInclude } },
        answers: { include: { selected: true } },
      },
    });
  }
  async listAttempts(q: PageDto, where: Prisma.TestAttemptWhereInput) {
    const [items, total] = await Promise.all([
      this.db.testAttempt.findMany({
        where,
        ...pageArgs(q),
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          testId: true,
          studentId: true,
          status: true,
          score: true,
          maxScore: true,
          submittedAt: true,
          test: { select: { title: true, courseId: true } },
          student: { select: { name: true } },
        },
      }),
      this.db.testAttempt.count({ where }),
    ]);
    return paged(items, total, q);
  }
  async saveAnswers(
    id: string,
    answers: { questionId: string; optionIds: string[] }[],
    tx: Transaction,
  ) {
    await tx.attemptAnswer.deleteMany({ where: { attemptId: id } });
    for (const a of answers)
      await tx.attemptAnswer.create({
        data: {
          attemptId: id,
          questionId: a.questionId,
          selected: {
            create: a.optionIds.map((answerOptionId) => ({ answerOptionId })),
          },
        },
      });
  }
  finish(id: string, score: number, tx: Transaction) {
    return tx.testAttempt.update({
      where: { id },
      data: { status: "submitted", score, submittedAt: new Date() },
    });
  }
  award(id: string, points: number, tx: Transaction) {
    return tx.attemptAnswer.update({
      where: { id },
      data: { awardedPoints: points },
    });
  }
}
