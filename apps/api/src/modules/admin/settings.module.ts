import { Global, Injectable, Module } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  Database,
  Transaction,
} from "../../infrastructure/database/database.module";
@Injectable()
export class SettingsService {
  constructor(private db: Database) {}
  async get() {
    const rows = await this.db.platformSetting.findMany();
    return {
      commissionBps: Number(
        rows.find((r) => r.key === "commissionBps")?.value ?? 1000,
      ),
      paymentDetails: String(
        rows.find((r) => r.key === "paymentDetails")?.value ?? "",
      ),
    };
  }
  async update(
    actorId: string,
    data: { commissionBps?: number; paymentDetails?: string },
    tx: Transaction,
  ) {
    for (const [key, value] of Object.entries(data))
      if (value !== undefined)
        await tx.platformSetting.upsert({
          where: { key },
          create: { key, value, updatedById: actorId },
          update: { value, updatedById: actorId },
        });
    return data;
  }
}
@Injectable()
export class AuditService {
  constructor(private db: Database) {}
  write(
    tx: Transaction,
    actorId: string,
    action: string,
    entityType: string,
    entityId: string,
    requestId: string,
    metadata: Prisma.InputJsonValue = {},
  ) {
    return tx.auditLog.create({
      data: { actorId, action, entityType, entityId, requestId, metadata },
    });
  }
}
@Global()
@Module({
  providers: [SettingsService, AuditService],
  exports: [SettingsService, AuditService],
})
export class SettingsModule {}
