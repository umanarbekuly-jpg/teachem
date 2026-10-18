import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Actor, PageDto } from "../../common/http";
import { Database } from "../../infrastructure/database/database.module";
import { CoursesService } from "../courses/courses.module";
import { EnrollmentsService } from "../enrollments/enrollments.module";
import { AnswersDto, TestDto, UpdateTestDto } from "./tests.dto";
import { TestsRepository } from "./tests.repository";
export function scoreQuestion(
  correct: string[],
  selected: string[],
  points: number,
) {
  return correct.length === selected.length &&
    new Set(selected).size === selected.length &&
    correct.every((id) => selected.includes(id))
    ? points
    : 0;
}
function validQuestions(dto: UpdateTestDto) {
  for (const q of dto.questions ?? []) {
    const count = q.options.filter((o) => o.isCorrect).length;
    if (count === 0 || (q.type === "single" && count !== 1))
      throw new BadRequestException(
        "Укажите правильные ответы для каждого вопроса",
      );
  }
}
@Injectable()
export class TestsService {
  constructor(
    private repo: TestsRepository,
    private db: Database,
    private courses: CoursesService,
    private enrollments: EnrollmentsService,
  ) {}
  async create(courseId: string, a: Actor, dto: TestDto) {
    await this.courses.owned(courseId, a);
    validQuestions(dto);
    return this.repo.create(courseId, dto);
  }
  async get(id: string, a: Actor) {
    const t = await this.repo.get(id);
    const c = await this.enrollments.assertAccess(a, t.courseId);
    if (c.tutorId === a.id || a.role === "admin") return t;
    if (t.status !== "published") throw new ForbiddenException();
    return {
      ...t,
      questions: t.questions.map((q) => ({
        ...q,
        options: q.options.map((o) => ({
          id: o.id,
          text: o.text,
          position: o.position,
        })),
      })),
    };
  }
  async list(courseId: string, a: Actor, q: PageDto) {
    const c = await this.enrollments.assertAccess(a, courseId);
    return this.repo.list(
      courseId,
      q,
      c.tutorId === a.id || a.role === "admin",
    );
  }
  async update(id: string, a: Actor, dto: UpdateTestDto) {
    const t = await this.repo.get(id);
    await this.courses.owned(t.courseId, a);
    validQuestions(dto);
    return this.db.atomic(async (tx) => {
      const current = await this.repo.get(id, tx);
      if (current.status !== "draft")
        throw new BadRequestException(
          "Опубликованный тест нельзя менять. Создайте копию",
        );
      return this.repo.update(id, dto, tx);
    });
  }
  async publish(id: string, a: Actor) {
    const t = await this.repo.get(id);
    await this.courses.owned(t.courseId, a);
    return this.db.atomic(async (tx) => {
      const current = await this.repo.get(id, tx);
      if (current.status !== "draft")
        throw new BadRequestException("Тест уже опубликован");
      validQuestions(current);
      return this.repo.publish(id, tx);
    });
  }
  async copy(id: string, a: Actor) {
    const t = await this.repo.get(id);
    await this.courses.owned(t.courseId, a);
    return this.repo.create(t.courseId, {
      title: `${t.title} — копия`.slice(0, 160),
      questions: t.questions.map((q) => ({
        text: q.text,
        type: q.type,
        points: q.points,
        options: q.options.map((o) => ({
          text: o.text,
          isCorrect: o.isCorrect,
        })),
      })),
    });
  }
  async remove(id: string, a: Actor) {
    const t = await this.repo.get(id);
    await this.courses.owned(t.courseId, a);
    return this.db.atomic((tx) => this.repo.remove(id, tx));
  }
  async start(id: string, a: Actor) {
    const t = await this.repo.get(id);
    await this.enrollments.assertAccess(a, t.courseId);
    if (t.status !== "published")
      throw new BadRequestException("Тест не опубликован");
    return this.repo.start(
      id,
      a.id,
      t.questions.reduce((sum, q) => sum + q.points, 0),
    );
  }
  async attempt(id: string, a: Actor) {
    const attempt = await this.repo.attempt(id);
    if (attempt.studentId !== a.id)
      await this.courses.owned(attempt.test.courseId, a);
    return {
      id: attempt.id,
      testId: attempt.testId,
      studentId: attempt.studentId,
      status: attempt.status,
      score: attempt.score,
      maxScore: attempt.maxScore,
      submittedAt: attempt.submittedAt,
      answers: attempt.answers.map((answer) => ({
        questionId: answer.questionId,
        optionIds: answer.selected.map((s) => s.answerOptionId),
        awardedPoints: answer.awardedPoints,
      })),
    };
  }
  async save(id: string, a: Actor, dto: AnswersDto) {
    const attempt = await this.repo.attempt(id);
    if (attempt.studentId !== a.id) throw new ForbiddenException();
    await this.enrollments.assertAccess(a, attempt.test.courseId);
    return this.db.atomic(async (tx) => {
      const current = await this.repo.attempt(id, tx);
      if (current.status !== "in_progress")
        throw new BadRequestException("Попытка завершена");
      if (
        new Set(dto.answers.map((x) => x.questionId)).size !==
        dto.answers.length
      )
        throw new BadRequestException("Повтор вопроса");
      for (const answer of dto.answers) {
        const q = current.test.questions.find(
          (q) => q.id === answer.questionId,
        );
        if (
          !q ||
          answer.optionIds.some((id) => !q.options.some((o) => o.id === id)) ||
          (q.type === "single" && answer.optionIds.length > 1)
        )
          throw new BadRequestException("Некорректный ответ");
      }
      await this.repo.saveAnswers(id, dto.answers, tx);
      return { ok: true };
    });
  }
  async submit(id: string, a: Actor) {
    const attempt = await this.repo.attempt(id);
    if (attempt.studentId !== a.id) throw new ForbiddenException();
    await this.enrollments.assertAccess(a, attempt.test.courseId);
    return this.db.atomic(async (tx) => {
      const current = await this.repo.attempt(id, tx);
      if (current.status === "submitted")
        return {
          id: current.id,
          score: current.score,
          maxScore: current.maxScore,
          status: current.status,
        };
      let score = 0;
      for (const answer of current.answers) {
        const q = current.test.questions.find(
          (q) => q.id === answer.questionId,
        )!;
        const points = scoreQuestion(
          q.options.filter((o) => o.isCorrect).map((o) => o.id),
          answer.selected.map((o) => o.answerOptionId),
          q.points,
        );
        score += points;
        await this.repo.award(answer.id, points, tx);
      }
      return this.repo.finish(id, score, tx);
    });
  }
  async attempts(a: Actor, q: PageDto, testId?: string) {
    if (testId) {
      const t = await this.repo.get(testId);
      await this.courses.owned(t.courseId, a);
      return this.repo.listAttempts(q, { testId });
    }
    return this.repo.listAttempts(q, { studentId: a.id });
  }
}
