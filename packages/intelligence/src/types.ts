import type { AmountBand, DeviceSignals, EvidenceCode, PayeeNovelty, Verdict } from '@viraam/schema';

/**
 * The two seams where "intelligence" plugs in. Both have deterministic,
 * rule-based defaults in ./rules. Anything model-based lives in ./ai and is
 * optional: delete that folder and the system still runs end to end.
 */

export interface RiskScore {
  /** 0-100 */
  sessionRisk: number;
  /** Points each factor contributed. Kept for explainability; never transmitted. */
  contributions: Partial<Record<string, number>>;
}

export interface RiskScorer {
  readonly id: string;
  /** Scores evidence codes only. Scorers never see raw signals, so they can't learn from what isn't attested. */
  score(evidence: readonly EvidenceCode[]): RiskScore;
}

export interface InterventionCopy {
  headline: string;
  body: string;
  /** One plain-language line per piece of evidence, most important first. */
  reasons: string[];
  /** A grounding fact, e.g. "There is no such thing as a digital arrest." */
  fact?: string;
}

export interface DeviceCopyInput {
  verdict: Verdict;
  evidence: readonly EvidenceCode[];
  /** Raw signals are fine HERE: copy is generated and shown on the device; it is never sent. */
  signals: DeviceSignals;
  contactName: string;
  coolingSeconds?: number;
}

export interface TrustedCopyInput {
  requesterName: string;
  evidence: readonly EvidenceCode[];
  amountBand: AmountBand;
  payeeNovelty: PayeeNovelty;
}

export interface InterventionCopyGenerator {
  readonly id: string;
  /** Shown to the payer on their own phone. */
  forDevice(input: DeviceCopyInput): InterventionCopy;
  /** Shown to the trusted contact. Built from evidence codes only. */
  forTrustedContact(input: TrustedCopyInput): InterventionCopy;
}

export interface SessionAssessment {
  evidence: EvidenceCode[];
  sessionRisk: number;
  verdict: Verdict;
  payeeNovelty: PayeeNovelty;
  amountBand: AmountBand;
  /** e.g. "rules-v1" or "rules-v1+model-lr-v0" */
  scorer: string;
  /** Which on-device rule forced the verdict, if any. */
  verdictRule: string;
  contributions: Partial<Record<string, number>>;
}
