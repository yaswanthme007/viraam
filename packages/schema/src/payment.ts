import { z } from 'zod';
import { AmountBand, PayeeNovelty, Verdict } from './common';
import { EvidenceCode } from './evidence';
import { SignedAttestation } from './attestation';

export const Vpa = z.string().regex(/^[a-z0-9.\-_]{2,64}@[a-z]{2,32}$/, 'VPA like name@bank');

/** The payment instruction itself. The bank sees this today anyway; VIRAAM adds nothing to it. */
export const PaymentIntent = z
  .object({
    paymentId: z.string().regex(/^pay_[a-z0-9]{6,40}$/),
    payerVpa: Vpa,
    payeeVpa: Vpa,
    payeeName: z.string().min(1).max(80),
    amountPaise: z.number().int().positive().max(1_00_00_000 * 100),
  })
  .strict();
export type PaymentIntent = z.infer<typeof PaymentIntent>;

/** Values that go into `paymentBinding`. */
export function paymentBindingInput(intent: Pick<PaymentIntent, 'paymentId' | 'payeeVpa' | 'amountPaise'>) {
  return { paymentId: intent.paymentId, payeeVpa: intent.payeeVpa, amountPaise: intent.amountPaise };
}

/** Demo-only label so the console can say "Scenario 2 · Digital arrest" on a projector. Carries no user data. */
export const DemoTag = z.object({ scenarioId: z.string().max(40), label: z.string().max(80) }).strict();
export type DemoTag = z.infer<typeof DemoTag>;

export const PaymentSubmission = z
  .object({
    intent: PaymentIntent,
    /** null = the device has no VIRAAM layer (today's world). */
    attestation: SignedAttestation.nullable(),
    demo: DemoTag.optional(),
  })
  .strict();
export type PaymentSubmission = z.infer<typeof PaymentSubmission>;

export const ConfirmSubmission = z.object({ attestation: SignedAttestation }).strict();
export type ConfirmSubmission = z.infer<typeof ConfirmSubmission>;

export type CheckResult = 'pass' | 'fail' | 'skipped';
export interface VerificationChecks {
  schema: CheckResult;
  knownKey: CheckResult;
  signature: CheckResult;
  fresh: CheckResult;
  binding: CheckResult;
  nonceUnused: CheckResult;
}

export type PolicyOutcome = Verdict;
/** UNATTESTED = no VIRAAM attestation at all; REJECTED = attestation failed verification. */
export type DecisionOutcome = PolicyOutcome | 'UNATTESTED' | 'REJECTED';

export type PaymentStatus =
  | 'COOLING' // STEP_UP: waiting out the cooling period, then re-confirm
  | 'AWAITING_CONTACT' // HOLD: frozen, trusted contact notified
  | 'SETTLED' // mock rail accepted it
  | 'DECLINED' // denied by contact, expired, or cancelled by user
  | 'REJECTED'; // attestation failed verification

export type HoldResolution = 'APPROVED' | 'DENIED' | 'EXPIRED' | 'CANCELLED_BY_USER';

export interface HoldInfo {
  holdId: string;
  contactId: string;
  contactName: string;
  requesterName: string;
  createdAt: number;
  expiresAt: number;
  resolution?: HoldResolution;
  resolvedAt?: number;
}

/** The gateway's record of a payment, as sent to the device and console. */
export interface PaymentRecord {
  paymentId: string;
  deviceId: string | null;
  payeeName: string;
  payeeVpa: string;
  amountPaise: number;
  amountBand: AmountBand;
  status: PaymentStatus;
  outcome: DecisionOutcome;
  /** False when the payment went through without any VIRAAM attestation. */
  protected: boolean;
  evidence: EvidenceCode[];
  sessionRisk: number | null;
  deviceVerdict: Verdict | null;
  payeeNovelty: PayeeNovelty | null;
  scorer: string | null;
  matchedRule: { id: string; description: string } | null;
  checks: VerificationChecks | null;
  rejectReason?: string;
  statusDetail: string;
  coolingUntil?: number;
  confirmations: number;
  hold?: HoldInfo;
  rail?: { rrn: string; settledAt: number };
  demo?: DemoTag;
  createdAt: number;
  updatedAt: number;
}

/** What a trusted contact sees. Deliberately less than the bank sees: band, not amount; no payee identity. */
export interface HoldBrief {
  holdId: string;
  paymentId: string;
  requesterName: string;
  contactId: string;
  contactName: string;
  amountBand: AmountBand;
  payeeNovelty: PayeeNovelty;
  evidence: EvidenceCode[];
  createdAt: number;
  expiresAt: number;
  resolution?: HoldResolution;
}

export type GatewayEvent =
  | { type: 'payment.updated'; payment: PaymentRecord }
  | { type: 'hold.requested'; brief: HoldBrief }
  | { type: 'hold.resolved'; brief: HoldBrief }
  | { type: 'snapshot'; payments?: PaymentRecord[]; holds?: HoldBrief[] }
  | { type: 'reset' };
