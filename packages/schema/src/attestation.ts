import { z } from 'zod';
import { AmountBand, PayeeNovelty, Verdict } from './common';
import { EVIDENCE_CODES, EvidenceCode } from './evidence';

/** Signing domains. Prefixed to the canonical payload so a signature for one message type can't be replayed as another. */
export const ATTESTATION_DOMAIN = 'VIRAAM-ATTESTATION-v1';
export const RESOLUTION_DOMAIN = 'VIRAAM-HOLD-RESOLUTION-v1';

const hex = (bytes: number) => z.string().regex(new RegExp(`^[0-9a-f]{${bytes * 2}}$`));

export const DeviceId = z.string().regex(/^dev_[a-z0-9]{8,32}$/, 'pseudonymous device id');
export const ContactId = z.string().regex(/^tc_[a-z0-9_]{3,32}$/);
export const KeyId = z.string().regex(/^key_[a-z0-9_]{3,48}$/);

/**
 * The attestation payload: everything the bank learns about the session.
 * `.strict()` means an unknown field fails validation, so raw data can't be
 * smuggled in by a buggy or compromised client.
 */
export const AttestationPayload = z
  .object({
    version: z.literal(1),
    /** Pseudonymous, per-install. Not an IMEI, phone number or account id. */
    deviceId: DeviceId,
    /** Epoch ms. The gateway rejects anything outside its freshness window. */
    issuedAt: z.number().int().positive(),
    /** 128-bit random. The gateway rejects any nonce it has seen before. */
    nonce: hex(16),
    sessionRisk: z.number().int().min(0).max(100),
    verdict: Verdict,
    evidence: z.array(EvidenceCode).max(EVIDENCE_CODES.length),
    payeeNovelty: PayeeNovelty,
    amountBand: AmountBand,
    /** sha256(canonical({paymentId, payeeVpa, amountPaise})): binds this attestation to exactly one payment. */
    paymentBinding: hex(32),
    /** Which scorer produced sessionRisk, e.g. "rules-v1". Provenance, not data. */
    scorer: z.string().min(1).max(32),
  })
  .strict();
export type AttestationPayload = z.infer<typeof AttestationPayload>;

export const SignedAttestation = z
  .object({
    alg: z.literal('Ed25519'),
    keyId: KeyId,
    payload: AttestationPayload,
    signature: hex(64),
  })
  .strict();
export type SignedAttestation = z.infer<typeof SignedAttestation>;

/** A trusted contact's signed answer to a HOLD. Signed on THEIR device with THEIR key. */
export const ResolutionPayload = z
  .object({
    version: z.literal(1),
    holdId: z.string().regex(/^hold_[a-z0-9]{6,32}$/),
    contactId: ContactId,
    decision: z.enum(['APPROVE', 'DENY']),
    issuedAt: z.number().int().positive(),
    nonce: hex(16),
  })
  .strict();
export type ResolutionPayload = z.infer<typeof ResolutionPayload>;

export const SignedResolution = z
  .object({
    alg: z.literal('Ed25519'),
    keyId: KeyId,
    payload: ResolutionPayload,
    signature: hex(64),
  })
  .strict();
export type SignedResolution = z.infer<typeof SignedResolution>;
