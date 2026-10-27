/**
 * OPTIONAL model-based layer. Safe to delete this whole folder.
 *
 * Nothing in the rest of the repo imports this file statically:
 *  - apps/device discovers it with import.meta.glob and hides the toggle if it's gone
 *  - the gateway never uses it; bank policy is pure declarative rules
 *
 * What lives here:
 *  - LogisticRiskScorer: a small logistic model over evidence codes. The
 *    coefficients are hand-set placeholders standing in for a calibrated model;
 *    they were NOT trained on real data (there is no real data in this repo).
 *  - SalienceCopyGenerator: same templates as the default, re-ordered by the
 *    model's per-feature weight. This is the slot where an on-device small
 *    language model could go; whatever goes here must stay grounded in the
 *    evidence codes and work offline.
 *
 * Guard rails enforced OUTSIDE this folder (in ../assess.ts):
 *  - the model only sees evidence codes, never raw signals
 *  - its score can raise session risk above the rule score, never lower it
 *  - hard rules in decideVerdict can't be overridden by any score
 */
import type { EvidenceCode } from '@viraam/schema';
import { TemplateCopyGenerator } from '../rules/copy';
import type { RiskScore, RiskScorer } from '../types';

const INTERCEPT = -4.0;
const COEFFICIENTS: Record<EvidenceCode, number> = {
  CALL_ACTIVE_GT_30M: 1.2,
  REMOTE_ACCESS_SERVICE_ACTIVE: 2.2,
  SCREEN_SHARE_ACTIVE: 1.8,
  SIDELOADED_APP_RECENT: 1.0,
  PAYEE_FIRST_SEEN: 1.1,
  AMOUNT_GT_P99: 1.0,
  OFF_PATTERN_HOUR: 0.6,
  RAPID_APP_SWITCHING: 0.8,
};
const INTERACTION_CALL_X_SCREEN_CONTROL = 1.5;

export class LogisticRiskScorer implements RiskScorer {
  readonly id = 'model-lr-v0';

  score(evidence: readonly EvidenceCode[]): RiskScore {
    const contributions: Record<string, number> = {};
    let z = INTERCEPT;
    for (const code of evidence) {
      z += COEFFICIENTS[code];
      contributions[code] = COEFFICIENTS[code];
    }
    const call = evidence.includes('CALL_ACTIVE_GT_30M');
    const screen = evidence.includes('REMOTE_ACCESS_SERVICE_ACTIVE') || evidence.includes('SCREEN_SHARE_ACTIVE');
    if (call && screen) {
      z += INTERACTION_CALL_X_SCREEN_CONTROL;
      contributions.CALL_X_SCREEN_CONTROL = INTERACTION_CALL_X_SCREEN_CONTROL;
    }
    const p = 1 / (1 + Math.exp(-z));
    return { sessionRisk: Math.round(p * 100), contributions };
  }
}

export class SalienceCopyGenerator extends TemplateCopyGenerator {
  override readonly id = 'salience-v0';

  protected override order(evidence: readonly EvidenceCode[]): EvidenceCode[] {
    return [...evidence].sort((a, b) => COEFFICIENTS[b] - COEFFICIENTS[a]);
  }
}

export const aiModule = {
  scorer: new LogisticRiskScorer(),
  copy: new SalienceCopyGenerator(),
};
