import { Global, Injectable, Logger, Module } from "@nestjs/common";
export interface NotificationMessage {
  type: string;
  recipientId: string;
  entityId: string;
}
export abstract class NotificationProvider {
  abstract send(message: NotificationMessage): Promise<void>;
}
@Injectable()
export class NoopNotificationProvider extends NotificationProvider {
  private logger = new Logger("Notifications");
  async send(message: NotificationMessage) {
    this.logger.log(
      JSON.stringify({ type: message.type, delivery: "disabled" }),
    );
  }
}
// Durable external jobs must use a transactional outbox before enabling BullMQ.
export abstract class JobPublisher {
  abstract publish(
    type: string,
    payload: Record<string, unknown>,
  ): Promise<void>;
}
@Global()
@Module({
  providers: [
    { provide: NotificationProvider, useClass: NoopNotificationProvider },
  ],
  exports: [NotificationProvider],
})
export class NotificationsModule {}
