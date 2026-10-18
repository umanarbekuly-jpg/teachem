import { BadRequestException, Injectable } from "@nestjs/common";
import { SettingsService } from "../admin/settings.module";
export abstract class PaymentProvider {
  abstract instructions(
    paymentId: string,
    amountMinor: number,
  ): Promise<{
    reference: string;
    amountMinor: number;
    currency: string;
    details: string;
  }>;
}
@Injectable()
export class ManualPaymentProvider extends PaymentProvider {
  constructor(private settings: SettingsService) {
    super();
  }
  async instructions(paymentId: string, amountMinor: number) {
    const s = await this.settings.get();
    if (!s.paymentDetails.trim())
      throw new BadRequestException(
        "Платформа ещё не настроила реквизиты. Оплата временно недоступна",
      );
    return {
      reference: paymentId,
      amountMinor,
      currency: "KZT",
      details: s.paymentDetails,
    };
  }
}
