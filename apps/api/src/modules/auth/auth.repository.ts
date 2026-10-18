import { Injectable } from "@nestjs/common";
import {
  Database,
  Transaction,
} from "../../infrastructure/database/database.module";
@Injectable()
export class AuthRepository {
  constructor(private db: Database) {}
  create(
    id: string,
    userId: string,
    refreshTokenHash: string,
    expiresAt: Date,
  ) {
    return this.db.authSession.create({
      data: { id, userId, refreshTokenHash, expiresAt },
    });
  }
  find(id: string) {
    return this.db.authSession.findUnique({ where: { id } });
  }
  rotate(id: string, previous: string, next: string) {
    return this.db.authSession.updateMany({
      where: {
        id,
        refreshTokenHash: previous,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { refreshTokenHash: next },
    });
  }
  revoke(id: string) {
    return this.db.authSession.updateMany({
      where: { id },
      data: { revokedAt: new Date() },
    });
  }
  revokeUser(userId: string, tx: Transaction) {
    return tx.authSession.updateMany({
      where: { userId },
      data: { revokedAt: new Date() },
    });
  }
}
