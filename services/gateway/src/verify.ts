import { paymentBinding, verifyPayload } from '@viraam/crypto';
import {
  ATTESTATION_DOMAIN,
  RESOLUTION_DOMAIN,
  SignedAttestation,
  SignedResolution,
  amountBandFor,
  type AttestationPayload,
  type PaymentIntent,
  type PolicyConfig,
  type ResolutionPayload,
  type VerificationChecks,
} from '@viraam/schema';
import type { Registry } from './config';

/** Remembers nonces until they could no longer pass the freshness check anyway. */
export class NonceStore {
  private seen = new Map<string, number>();
  constructor(private ttlMs: number) {}

  has(nonce: string, now: number): boolean {
    this.sweep(now);
    return this.seen.has(nonce);
  }
  add(nonce: string, now: number): void {
    this.seen.set(nonce, now + this.ttlMs);
  }
  private sweep(now: number): void {
    for (const [n, exp] of this.seen) if (exp <= now) this.seen.delete(n);
  }
}

export type RejectCode =
  | 'MALFORMED'
  | 'UNKNOWN_KEY'
  | 'BAD_SIGNATURE'
  | 'STALE'
  | 'FROM_FUTURE'
  | 'BINDING_MISMATCH'
  | 'REPLAYED_NONCE';

export const REJECT_MESSAGES: Record<RejectCode, string> = {
  MALFORMED: 'Attestation does not match the schema',
  UNKNOWN_KEY: 'Signing key is not enrolled for this device',
  BAD_SIGNATURE: 'Signature does not verify',
  STALE: 'Attestation is too old',
  FROM_FUTURE: 'Attestation is dated in the future',
  BINDING_MISMATCH: 'Attestation was issued for a different payment',
  REPLAYED_NONCE: 'Nonce already used (replay)',
};

export type VerifyResult<T> =
  | { ok: true; payload: T; checks: VerificationChecks }
  | { ok: false; code: RejectCode; checks: VerificationChecks };

const blank = (): VerificationChecks => ({
  schema: 'skipped',
  knownKey: 'skipped',
  signature: 'skipped',
  fresh: 'skipped',
  binding: 'skipped',
  nonceUnused: 'skipped',
});

interface Deps {
  registry: Registry;
  policy: PolicyConfig;
  nonces: NonceStore;
  now: number;
}

function checkFreshness(issuedAt: number, deps: Deps): RejectCode | null {
  const { maxAgeSeconds, maxFutureSkewSeconds } = deps.policy.attestation;
  if (issuedAt > deps.now + maxFutureSkewSeconds * 1000) return 'FROM_FUTURE';
  if (deps.now - issuedAt > maxAgeSeconds * 1000) return 'STALE';
  return null;
}

/**
 * Verify a device attestation for a specific payment. Order matters:
 * schema -> enrolled key -> signature -> freshness -> payment binding -> nonce.
 * The nonce is only consumed once everything else has passed.
 */
export function verifyAttestation(raw: unknown, intent: PaymentIntent, deps: Deps): VerifyResult<AttestationPayload> {
  const checks = blank();
  const fail = (code: RejectCode, key: keyof VerificationChecks) => {
    checks[key] = 'fail';
    return { ok: false as const, code, checks };
  };

  const parsed = SignedAttestation.safeParse(raw);
  if (!parsed.success) return fail('MALFORMED', 'schema');
  checks.schema = 'pass';
  const { keyId, payload, signature } = parsed.data;

  const key = deps.registry.keys.find((k) => k.keyId === keyId && k.role === 'device');
  if (!key || key.subjectId !== payload.deviceId) return fail('UNKNOWN_KEY', 'knownKey');
  checks.knownKey = 'pass';

  if (!verifyPayload(ATTESTATION_DOMAIN, payload, signature, key.publicKey)) return fail('BAD_SIGNATURE', 'signature');
  checks.signature = 'pass';

  const freshness = checkFreshness(payload.issuedAt, deps);
  if (freshness) return fail(freshness, 'fresh');
  checks.fresh = 'pass';

  const expectedBinding = paymentBinding(intent);
  if (payload.paymentBinding !== expectedBinding || payload.amountBand !== amountBandFor(intent.amountPaise)) {
    return fail('BINDING_MISMATCH', 'binding');
  }
  checks.binding = 'pass';

  if (deps.nonces.has(payload.nonce, deps.now)) return fail('REPLAYED_NONCE', 'nonceUnused');
  deps.nonces.add(payload.nonce, deps.now);
  checks.nonceUnused = 'pass';

  return { ok: true, payload, checks };
}

/** Verify a trusted contact's signed approve/deny for a given hold. */
export function verifyResolution(
  raw: unknown,
  expected: { holdId: string; contactId: string },
  deps: Deps,
): VerifyResult<ResolutionPayload> {
  const checks = blank();
  const fail = (code: RejectCode, key: keyof VerificationChecks) => {
    checks[key] = 'fail';
    return { ok: false as const, code, checks };
  };
  const parsed = SignedResolution.safeParse(raw);
  if (!parsed.success) return fail('MALFORMED', 'schema');
  checks.schema = 'pass';
  const { keyId, payload, signature } = parsed.data;

  const key = deps.registry.keys.find((k) => k.keyId === keyId && k.role === 'trusted-contact');
  if (!key || key.subjectId !== payload.contactId || payload.contactId !== expected.contactId) {
    return fail('UNKNOWN_KEY', 'knownKey');
  }
  checks.knownKey = 'pass';

  if (!verifyPayload(RESOLUTION_DOMAIN, payload, signature, key.publicKey)) return fail('BAD_SIGNATURE', 'signature');
  checks.signature = 'pass';

  const freshness = checkFreshness(payload.issuedAt, deps);
  if (freshness) return fail(freshness, 'fresh');
  checks.fresh = 'pass';

  if (payload.holdId !== expected.holdId) return fail('BINDING_MISMATCH', 'binding');
  checks.binding = 'pass';

  if (deps.nonces.has(payload.nonce, deps.now)) return fail('REPLAYED_NONCE', 'nonceUnused');
  deps.nonces.add(payload.nonce, deps.now);
  checks.nonceUnused = 'pass';

  return { ok: true, payload, checks };
}
