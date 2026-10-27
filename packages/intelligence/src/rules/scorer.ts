import type { EvidenceCode, Verdict } from '@viraam/schema';
import type { RiskScore, RiskScorer } from '../types';

/** Points per evidence code. A long call on its own (20) stays well under the STEP_UP line (40). */
export const RULE_WEIGHTS: Record<EvidenceCode, number> = {
  CALL_ACTIVE_GT_30M: 20,
  REMOTE_ACCESS_SERVICE_ACTIVE: 30,
  SCREEN_SHARE_ACTIVE: 25,
  SIDELOADED_APP_RECENT: 15,
  PAYEE_FIRST_SEEN: 15,
  AMOUNT_GT_P99: 15,
  OFF_PATTERN_HOUR: 10,
  RAPID_APP_SWITCHING: 10,
};

/** Being on a call WHILE someone can see or drive your screen is the coercion signature. */
export const COMBINATION_BONUS = 20;

export const VERDICT_THRESHOLDS = { stepUpAt: 40, holdAt: 70 } as const;

export class RuleBasedRiskScorer implements RiskScorer {
  readonly id = 'rules-v1';

  score(evidence: readonly EvidenceCode[]): RiskScore {
    const contributions: Record<string, number> = {};
    for (const code of evidence) contributions[code] = RULE_WEIGHTS[code];
    const has = (c: EvidenceCode) => evidence.includes(c);
    if (has('CALL_ACTIVE_GT_30M') && (has('REMOTE_ACCESS_SERVICE_ACTIVE') || has('SCREEN_SHARE_ACTIVE'))) {
      contributions.COMBINATION_CALL_WITH_SCREEN_CONTROL = COMBINATION_BONUS;
    }
    const total = Object.values(contributions).reduce((a, b) => a + b, 0);
    return { sessionRisk: Math.min(100, total), contributions };
  }
}

/**
 * The device's own verdict. Hard rules first (they can't be outvoted by a
 * score), then thresholds. The bank re-decides from evidence with its own
 * policy; this verdict is advisory input to that policy.
 */
export function decideVerdict(evidence: readonly EvidenceCode[], sessionRisk: number): { verdict: Verdict; rule: string } {
  const has = (c: EvidenceCode) => evidence.includes(c);
  const screenControl = has('REMOTE_ACCESS_SERVICE_ACTIVE') || has('SCREEN_SHARE_ACTIVE');
  if (has('CALL_ACTIVE_GT_30M') && screenControl && has('PAYEE_FIRST_SEEN')) {
    return { verdict: 'HOLD', rule: 'hard:call+screen-control+new-payee' };
  }
  if (sessionRisk >= VERDICT_THRESHOLDS.holdAt) return { verdict: 'HOLD', rule: `risk>=${VERDICT_THRESHOLDS.holdAt}` };
  if (sessionRisk >= VERDICT_THRESHOLDS.stepUpAt) return { verdict: 'STEP_UP', rule: `risk>=${VERDICT_THRESHOLDS.stepUpAt}` };
  return { verdict: 'ALLOW', rule: 'below-thresholds' };
}
