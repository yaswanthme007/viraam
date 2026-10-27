import {
  ATTESTATION_DOMAIN,
  RESOLUTION_DOMAIN,
  paymentBindingInput,
  type AttestationPayload,
  type PaymentIntent,
  type ResolutionPayload,
  type SignedAttestation,
  type SignedResolution,
} from '@viraam/schema';
import { canonicalJson, sha256Hex, signPayload } from './index';

/** sha256 over the canonical {paymentId, payeeVpa, amountPaise}. Ties an attestation to one payment. */
export function paymentBinding(intent: Pick<PaymentIntent, 'paymentId' | 'payeeVpa' | 'amountPaise'>): string {
  return sha256Hex(canonicalJson(paymentBindingInput(intent)));
}

export function signAttestation(payload: AttestationPayload, keyId: string, privateKeyHex: string): SignedAttestation {
  return { alg: 'Ed25519', keyId, payload, signature: signPayload(ATTESTATION_DOMAIN, payload, privateKeyHex) };
}

export function signResolution(payload: ResolutionPayload, keyId: string, privateKeyHex: string): SignedResolution {
  return { alg: 'Ed25519', keyId, payload, signature: signPayload(RESOLUTION_DOMAIN, payload, privateKeyHex) };
}
