import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import {
  Database,
  Transaction,
} from "../../infrastructure/database/database.module";
import { Actor } from "../../common/http";
import { EnrollmentsService } from "../enrollments/enrollments.module";
import { CoursesService } from "../courses/courses.module";
import { FilesService } from "../materials/files.module";
import { SettingsService, AuditService } from "../admin/settings.module";
import { PayoutsService } from "../payouts/payouts.module";
import { PaymentsRepository } from "./payments.repository";
import { PaymentProvider } from "./payments.provider";
import { PaymentQuery, SubmitPaymentDto } from "./payments.dto";
@Injectable()
export class PaymentsService {
  constructor(
    private db: Database,
    private repo: PaymentsRepository,
    private enrollments: EnrollmentsService,
    private courses: CoursesService,
    private files: FilesService,
    private settings: SettingsService,
    private payouts: PayoutsService,
    private audit: AuditService,
    private provider: PaymentProvider,
  ) {}
  async create(enrollmentId: string, a: Actor, key: string) {
    const e = await this.enrollments.own(enrollmentId, a);
    const c = await this.courses.publicGet(e.courseId);
    const settings = await this.settings.get();
    await this.provider.instructions("preview", c.monthlyPriceMinor);
    return this.db.atomic(async (tx) => {
      const existing = await this.repo.byKey(key, tx);
      if (existing) {
        if (existing.enrollmentId !== enrollmentId)
          throw new ConflictException("Ключ уже использован");
        return existing;
      }
      const unfinished = await this.repo.unfinished(enrollmentId, tx);
      if (unfinished) return unfinished;
      const p = await this.repo.create(tx, {
        enrollmentId,
        amountMinor: c.monthlyPriceMinor,
        commissionBps: settings.commissionBps,
        idempotencyKey: key,
      });
      await this.repo.history(tx, p.id, a.id, null, "pending");
      return p;
    });
  }
  async get(id: string, a: Actor) {
    const p = await this.repo.find(id);
    if (a.role !== "SUPERADMIN") await this.enrollments.own(p.enrollmentId, a);
    return p;
  }
  async instructions(id: string, a: Actor) {
    const p = await this.get(id, a);
    return this.provider.instructions(p.id, p.amountMinor);
  }
  list(q: PaymentQuery, studentId?: string) {
    return this.repo.list(q, studentId);
  }
  async submit(id: string, a: Actor, dto: SubmitPaymentDto) {
    const p = await this.get(id, a);
    if (a.role !== "student") throw new ForbiddenException();
    if (dto.receiptAssetId)
      await this.files.assertOwned(dto.receiptAssetId, a.id, "receipt");
    return this.db.atomic(async (tx) => {
      const current = await this.repo.find(p.id, tx);
      if (current.status === "awaiting_review") return current;
      if (current.status !== "pending")
        throw new BadRequestException("Платёж уже обработан");
      const changed = await this.repo.transition(
        tx,
        id,
        "pending",
        "awaiting_review",
        { submittedAt: new Date(), receiptAssetId: dto.receiptAssetId },
      );
      if (changed.count !== 1) throw new ConflictException();
      await this.repo.history(tx, id, a.id, "pending", "awaiting_review");
      return this.repo.find(id, tx);
    });
  }
  async review(
    id: string,
    a: Actor,
    approved: boolean,
    reason: string | undefined,
    requestId: string,
  ) {
    return this.db.atomic(async (tx) => {
      const p = await this.repo.find(id, tx);
      const next = approved ? "approved" : "rejected";
      if (p.status === next) return p;
      if (p.status !== "awaiting_review")
        throw new BadRequestException("Платёж не ожидает проверки");
      const changed = await this.repo.transition(
        tx,
        id,
        "awaiting_review",
        next,
        { reviewerId: a.id, reviewedAt: new Date(), reviewReason: reason },
      );
      if (changed.count !== 1)
        throw new ConflictException("Платёж уже обработан");
      await this.repo.history(tx, id, a.id, "awaiting_review", next, reason);
      if (approved) await this.activate(tx, p);
      await this.audit.write(
        tx,
        a.id,
        `payment.${next}`,
        "Payment",
        id,
        requestId,
        { reason: reason ?? null },
      );
      return this.repo.find(id, tx);
    });
  }
  private async activate(
    tx: Transaction,
    p: {
      id: string;
      enrollmentId: string;
      amountMinor: number;
      commissionBps: number;
    },
  ) {
    const e = await this.enrollments.extend(p.enrollmentId, tx);
    const course = await this.courses.get(e.courseId);
    await this.payouts.create(
      tx,
      p.id,
      course.tutorId,
      p.amountMinor,
      p.commissionBps,
    );
  }
}
