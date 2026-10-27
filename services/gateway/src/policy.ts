import type { AmountBand, EvidenceCode, PayeeNovelty, PolicyConfig, PolicyRule, Verdict } from '@viraam/schema';

export interface PolicyInput {
  evidence: readonly EvidenceCode[];
  sessionRisk: number;
  deviceVerdict: Verdict;
  amountBand: AmountBand;
  payeeNovelty: PayeeNovelty;
}

export interface PolicyDecision {
  outcome: Verdict;
  rule: { id: string; description: string } | null;
}

export function ruleMatches(rule: PolicyRule, input: PolicyInput): boolean {
  const w = rule.when;
  if (w.evidenceAll && !w.evidenceAll.every((c) => input.evidence.includes(c))) return false;
  if (w.evidenceAny && !w.evidenceAny.some((c) => input.evidence.includes(c))) return false;
  if (w.sessionRiskAtLeast !== undefined && input.sessionRisk < w.sessionRiskAtLeast) return false;
  if (w.deviceVerdictIn && !w.deviceVerdictIn.includes(input.deviceVerdict)) return false;
  if (w.amountBandIn && !w.amountBandIn.includes(input.amountBand)) return false;
  if (w.payeeNoveltyIn && !w.payeeNoveltyIn.includes(input.payeeNovelty)) return false;
  return true;
}

/** First matching rule wins. Pure function of (policy file, verified attestation). */
export function evaluatePolicy(policy: PolicyConfig, input: PolicyInput): PolicyDecision {
  for (const rule of policy.rules) {
    if (ruleMatches(rule, input)) return { outcome: rule.outcome, rule: { id: rule.id, description: rule.description } };
  }
  return { outcome: policy.default, rule: null };
}
