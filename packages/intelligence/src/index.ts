/**
 * @viraam/intelligence: the decision logic that runs on the device.
 *
 * Everything exported from here is deterministic and rule-based. The optional
 * model-based pieces live in ./ai and are imported separately via
 * "@viraam/intelligence/ai". Nothing in this file imports from ./ai, so that
 * folder can be deleted without breaking the build or the demo.
 */
export * from './types';
export { THRESHOLDS, deriveEvidence, derivePayeeNovelty } from './rules/evidence';
export { RULE_WEIGHTS, COMBINATION_BONUS, VERDICT_THRESHOLDS, RuleBasedRiskScorer, decideVerdict } from './rules/scorer';
export { TemplateCopyGenerator, REASON_ORDER, orderEvidence, deviceReason, contactReason } from './rules/copy';
export { assessSession, type AssessOptions } from './assess';

import { TemplateCopyGenerator } from './rules/copy';
import { RuleBasedRiskScorer } from './rules/scorer';

export const defaultScorer = new RuleBasedRiskScorer();
export const defaultCopy = new TemplateCopyGenerator();
