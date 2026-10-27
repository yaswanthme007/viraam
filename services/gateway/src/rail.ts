import type { PaymentIntent } from '@viraam/schema';

/**
 * MOCK payment rail. Stands in for the bank's UPI switch / NPCI. It accepts
 * every instruction and hands back a fake reference number. No money moves,
 * nothing leaves this process.
 */
export class MockRail {
  private counter = 0;
  readonly ledger: Array<{ rrn: string; paymentId: string; payeeVpa: string; amountPaise: number; settledAt: number }> = [];

  settle(intent: PaymentIntent, now: number): { rrn: string; settledAt: number } {
    this.counter += 1;
    const rrn = 'MOCKRRN' + String(this.counter).padStart(6, '0');
    this.ledger.push({ rrn, paymentId: intent.paymentId, payeeVpa: intent.payeeVpa, amountPaise: intent.amountPaise, settledAt: now });
    return { rrn, settledAt: now };
  }

  reset(): void {
    this.counter = 0;
    this.ledger.length = 0;
  }
}
