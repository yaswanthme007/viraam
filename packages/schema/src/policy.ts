import { z } from 'zod';
import { AmountBand, PayeeNovelty, Verdict } from './common';
import { EvidenceCode } from './evidence';

/** Schema for services/gateway/config/policy.yaml. The bank's rules are data, not code. */
export const PolicyCondition = z
  .object({
    evidenceAll: z.array(EvidenceCode).min(1).optional(),
    evidenceAny: z.array(EvidenceCode).min(1).optional(),
    sessionRiskAtLeast: z.number().int().min(0).max(100).optional(),
    deviceVerdictIn: z.array(Verdict).min(1).optional(),
    amountBandIn: z.array(AmountBand).min(1).optional(),
    payeeNoveltyIn: z.array(PayeeNovelty).min(1).optional(),
  })
  .strict()
  .refine((c) => Object.keys(c).length > 0, 'a rule needs at least one condition');
export type PolicyCondition = z.infer<typeof PolicyCondition>;

export const PolicyRule = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    description: z.string().min(1),
    when: PolicyCondition,
    outcome: Verdict,
  })
  .strict();
export type PolicyRule = z.infer<typeof PolicyRule>;

export const PolicyConfig = z
  .object({
    version: z.number().int(),
    name: z.string(),
    attestation: z
      .object({
        maxAgeSeconds: z.number().int().positive(),
        maxFutureSkewSeconds: z.number().int().min(0),
        nonceTtlSeconds: z.number().int().positive(),
      })
      .strict(),
    unattested: z.object({ outcome: z.enum(['ALLOW', 'REJECT']), note: z.string().optional() }).strict(),
    stepUp: z.object({ coolingSeconds: z.number().int().min(0) }).strict(),
    hold: z
      .object({ expirySeconds: z.number().int().positive(), onExpiry: z.literal('DENY') })
      .strict(),
    rules: z.array(PolicyRule),
    default: Verdict,
  })
  .strict();
export type PolicyConfig = z.infer<typeof PolicyConfig>;
