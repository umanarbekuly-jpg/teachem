import { Injectable } from "@nestjs/common";
import { PaymentStatus, Prisma } from "@prisma/client";
import {
  Database,
  Transaction,
} from "../../infrastructure/database/database.module";
import { pageArgs, paged } from "../../common/http";
import { PaymentQuery } from "./payments.dto";
@Injectable()
export class PaymentsRepository {
  constructor(private db: Database) {}
  find(id: string, tx: Transaction = this.db) {
    return tx.payment.findUniqueOrThrow({
      where: { id },
      include: { history: { orderBy: { createdAt: "asc" } } },
    });
  }
  byKey(key: string, tx: Transaction) {
    return tx.payment.findUnique({ where: { idempotencyKey: key } });
  }
  unfinished(enrollmentId: string, tx: Transaction) {
    return tx.payment.findFirst({
      where: { enrollmentId, status: { in: ["pending", "awaiting_review"] } },
    });
  }
  create(tx: Transaction, data: Prisma.PaymentUncheckedCreateInput) {
    return tx.payment.create({ data });
  }
  async list(q: PaymentQuery, studentId?: string) {
    const where: Prisma.PaymentWhereInput = {
      status: q.status,
      ...(studentId ? { enrollment: { studentId } } : {}),
    };
    const [items, total] = await Promise.all([
      this.db.payment.findMany({
        where,
        ...pageArgs(q),
        orderBy: { createdAt: "desc" },
        include: {
          enrollment: {
            select: {
              course: { select: { id: true, title: true } },
              student: { select: { id: true, name: true } },
            },
          },
        },
      }),
      this.db.payment.count({ where }),
    ]);
    return paged(items, total, q);
  }
  history(
    tx: Transaction,
    paymentId: string,
    actorId: string,
    fromStatus: PaymentStatus | null,
    toStatus: PaymentStatus,
    reason?: string,
  ) {
    return tx.paymentStatusHistory.create({
      data: { paymentId, actorId, fromStatus, toStatus, reason },
    });
  }
  transition(
    tx: Transaction,
    id: string,
    from: PaymentStatus,
    to: PaymentStatus,
    data: Prisma.PaymentUncheckedUpdateManyInput = {},
  ) {
    return tx.payment.updateMany({
      where: { id, status: from },
      data: { ...data, status: to },
    });
  }
}
