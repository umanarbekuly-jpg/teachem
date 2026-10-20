import { Injectable, UnauthorizedException } from "@nestjs/common";
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
    authVersion: number,
  ) {
    return this.db.atomic(async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      if (user.authVersion !== authVersion || user.blockedAt || user.deletedAt)
        throw new UnauthorizedException(
          "Данные входа изменились. Войдите заново",
        );
      return tx.authSession.create({
        data: { id, userId, refreshTokenHash, expiresAt, authVersion },
      });
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
