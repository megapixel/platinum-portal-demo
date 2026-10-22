// payment - PaymentProvider interface. The prototype settles instantly; production uses a real gateway.
import { uid } from '../utils.js';

/**
 * interface PaymentProvider {
 *   charge(req: { invoice, amount, payer }): Promise<{ ok: boolean, method: string, reference: string }>;
 * }
 */
export class MockPaymentProvider {
  async charge({ amount }) {
    void amount;
    return { ok: true, method: 'PAYNOW', reference: `MOCK-${uid('tx').slice(3, 12).toUpperCase()}` };
  }
}

export class GatewayPaymentProvider {
  constructor(config) { this.config = config; }
  async charge() {
    // TODO: create a PayNow QR or card checkout session with the chosen gateway (Stripe, HitPay, Adyen: TBC).
    // TODO: mark the invoice paid only from the gateway's signed webhook, never from the browser.
    throw new Error('GatewayPaymentProvider is not implemented in the prototype.');
  }
}

export const paymentProvider = new MockPaymentProvider();
