import {
  Global,
  Injectable,
  Module,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";
@Injectable()
export class Database
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit() {
    if (process.env.EXPORT_OPENAPI !== "1") await this.$connect();
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
  async atomic<T>(
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.$transaction(work, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2034" &&
          attempt < 3
        )
          continue;
        throw error;
      }
    }
  }
}
export type Transaction = Prisma.TransactionClient;
@Global()
@Module({ providers: [Database], exports: [Database] })
export class DatabaseModule {}
