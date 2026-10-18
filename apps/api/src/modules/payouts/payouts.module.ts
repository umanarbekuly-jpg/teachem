import {
  BadRequestException,
  Controller,
  Get,
  Injectable,
  Module,
  Query,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import {
  Database,
  Transaction,
} from "../../infrastructure/database/database.module";
import {
  Actor,
  CurrentUser,
  PageDto,
  pageArgs,
  paged,
  Roles,
} from "../../common/http";
export function calculatePayout(amountMinor: number, commissionBps: number) {
  const commissionMinor = Math.floor((amountMinor * commissionBps) / 10000);
  return {
    grossMinor: amountMinor,
    commissionMinor,
    netMinor: amountMinor - commissionMinor,
  };
}
@Injectable()
export class PayoutsRepository {
  constructor(private db: Database) {}
  create(
    tx: Transaction,
    paymentId: string,
    tutorId: string,
    amountMinor: number,
    commissionBps: number,
  ) {
    return tx.payout.create({
      data: {
        paymentId,
        tutorId,
        ...calculatePayout(amountMinor, commissionBps),
      },
    });
  }
  async list(q: PageDto, tutorId?: string) {
    const where = { ...(tutorId ? { tutorId } : {}) };
    const [items, total] = await Promise.all([
      this.db.payout.findMany({
        where,
        ...pageArgs(q),
        orderBy: { createdAt: "desc" },
        include: { tutor: { select: { id: true, name: true } } },
      }),
      this.db.payout.count({ where }),
    ]);
    return paged(items, total, q);
  }
  async finance(tutorId: string) {
    const totals = await this.db.payout.groupBy({
      by: ["status"],
      where: { tutorId },
      _sum: { netMinor: true },
    });
    const pending =
      totals.find((t) => t.status === "pending")?._sum.netMinor ?? 0;
    const paid = totals.find((t) => t.status === "paid")?._sum.netMinor ?? 0;
    return {
      accruedMinor: pending + paid,
      pendingMinor: pending,
      paidMinor: paid,
      currency: "KZT",
    };
  }
  async markPaid(
    tx: Transaction,
    id: string,
    actorId: string,
    reference: string,
  ) {
    const p = await tx.payout.findUniqueOrThrow({ where: { id } });
    if (p.status === "paid") return p;
    const result = await tx.payout.updateMany({
      where: { id, status: "pending" },
      data: {
        status: "paid",
        paidAt: new Date(),
        paidById: actorId,
        reference,
      },
    });
    if (result.count !== 1)
      throw new BadRequestException("Выплата уже обработана");
    return tx.payout.findUniqueOrThrow({ where: { id } });
  }
}
@Injectable()
export class PayoutsService {
  constructor(private repo: PayoutsRepository) {}
  create(
    tx: Transaction,
    paymentId: string,
    tutorId: string,
    amountMinor: number,
    commissionBps: number,
  ) {
    return this.repo.create(tx, paymentId, tutorId, amountMinor, commissionBps);
  }
  list(q: PageDto, tutorId?: string) {
    return this.repo.list(q, tutorId);
  }
  finance(id: string) {
    return this.repo.finance(id);
  }
  markPaid(tx: Transaction, id: string, actorId: string, reference: string) {
    return this.repo.markPaid(tx, id, actorId, reference);
  }
}
@ApiTags("payouts")
@Roles("tutor")
@Controller("tutors/me")
export class PayoutsController {
  constructor(private service: PayoutsService) {}
  @Get("finances") finance(@CurrentUser() a: Actor) {
    return this.service.finance(a.id);
  }
  @Get("payouts") list(@CurrentUser() a: Actor, @Query() q: PageDto) {
    return this.service.list(q, a.id);
  }
}
@Module({
  controllers: [PayoutsController],
  providers: [PayoutsRepository, PayoutsService],
  exports: [PayoutsService],
})
export class PayoutsModule {}
