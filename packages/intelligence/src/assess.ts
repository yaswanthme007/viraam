import type { DeviceSignals } from '@viraam/schema';
import { amountBandFor } from '@viraam/schema';
import { derivePayeeNovelty, deriveEvidence } from './rules/evidence';
import { decideVerdict, RuleBasedRiskScorer } from './rules/scorer';
import type { RiskScorer, SessionAssessment } from './types';

const RULES = new RuleBasedRiskScorer();

export interface AssessOptions {
  /**
   * Optional extra scorer (e.g. from ./ai). It can only RAISE the session risk
   * above the rule-based score, never lower it, and it cannot override the
   * hard rules in decideVerdict. The rule engine is always the floor.
   */
  advisoryScorer?: RiskScorer | null;
}

/** The whole on-device decision: signals -> evidence -> risk -> verdict. */
export function assessSession(signals: DeviceSignals, options: AssessOptions = {}): SessionAssessment {
  const evidence = deriveEvidence(signals);
  const base = RULES.score(evidence);
  let sessionRisk = base.sessionRisk;
  let scorer = RULES.id;
  const contributions = { ...base.contributions };

  const advisory = options.advisoryScorer;
  if (advisory) {
    const extra = advisory.score(evidence);
    scorer = `${RULES.id}+${advisory.id}`;
    contributions[`advisory:${advisory.id}`] = extra.sessionRisk;
    sessionRisk = Math.max(sessionRisk, extra.sessionRisk);
  }

  const { verdict, rule } = decideVerdict(evidence, sessionRisk);
  return {
    evidence,
    sessionRisk,
    verdict,
    verdictRule: rule,
    payeeNovelty: derivePayeeNovelty(signals),
    amountBand: amountBandFor(signals.amountStats.amountPaise),
    scorer,
    contributions,
  };
}
