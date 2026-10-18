import {
  Controller,
  Get,
  Global,
  Module,
  ServiceUnavailableException,
} from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { ENV, readEnv } from "./config/env";
import {
  Database,
  DatabaseModule,
} from "./infrastructure/database/database.module";
import {
  StorageModule,
  StorageProvider,
} from "./infrastructure/storage/storage.module";
import { NotificationsModule } from "./infrastructure/notifications/notifications.module";
import { AuthModule } from "./modules/auth/auth.module";
import { AuthGuard } from "./modules/auth/auth.guard";
import { UsersModule } from "./modules/users/users.module";
import { TutorsModule } from "./modules/tutors/tutors.module";
import { CoursesModule } from "./modules/courses/courses.module";
import { MaterialsModule } from "./modules/materials/materials.module";
import { FilesModule } from "./modules/materials/files.module";
import { EnrollmentsModule } from "./modules/enrollments/enrollments.module";
import { PaymentsModule } from "./modules/payments/payments.module";
import { PayoutsModule } from "./modules/payouts/payouts.module";
import { TestsModule } from "./modules/tests/tests.module";
import { SessionsModule } from "./modules/sessions/sessions.module";
import { AdminModule } from "./modules/admin/admin.module";
import { SettingsModule } from "./modules/admin/settings.module";
import { Public } from "./common/http";
@Global()
@Module({ providers: [{ provide: ENV, useFactory: readEnv }], exports: [ENV] })
export class ConfigModule {}
@Controller("health")
export class HealthController {
  constructor(
    private db: Database,
    private storage: StorageProvider,
  ) {}
  @Public() @Get("live") live() {
    return { status: "ok" };
  }
  @Public() @Get("ready") async ready() {
    try {
      await Promise.all([this.db.$queryRaw`SELECT 1`, this.storage.healthy()]);
      return { status: "ok" };
    } catch {
      throw new ServiceUnavailableException("Инфраструктура не готова");
    }
  }
}
@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    StorageModule,
    NotificationsModule,
    SettingsModule,
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 120 }]),
    AuthModule,
    UsersModule,
    TutorsModule,
    CoursesModule,
    FilesModule,
    MaterialsModule,
    EnrollmentsModule,
    PaymentsModule,
    PayoutsModule,
    TestsModule,
    SessionsModule,
    AdminModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
