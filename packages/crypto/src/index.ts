import { ed25519 } from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, hexToBytes, randomBytes, utf8ToBytes } from '@noble/hashes/utils';

export interface KeyPair {
  /** 32-byte Ed25519 secret key, hex. */
  privateKey: string;
  /** 32-byte Ed25519 public key, hex. */
  publicKey: string;
}

/**
 * Deterministic JSON: object keys sorted, no whitespace, undefined dropped.
 * Signer and verifier must produce byte-identical input, regardless of key order.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('non-finite number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return '[' + value.map((v) => canonicalJson(v ?? null)).join(',') + ']';
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return '{' + entries.map(([k, v]) => JSON.stringify(k) + ':' + canonicalJson(v)).join(',') + '}';
}

function message(domain: string, payload: unknown): Uint8Array {
  return utf8ToBytes(domain + '\n' + canonicalJson(payload));
}

export function sha256Hex(input: string): string {
  return bytesToHex(sha256(utf8ToBytes(input)));
}

export function randomNonce(): string {
  return bytesToHex(randomBytes(16));
}

export function randomId(prefix: string, bytes = 8): string {
  return prefix + bytesToHex(randomBytes(bytes));
}

export function generateKeyPair(): KeyPair {
  const sk = ed25519.utils.randomPrivateKey();
  return { privateKey: bytesToHex(sk), publicKey: bytesToHex(ed25519.getPublicKey(sk)) };
}

export function keyPairFromSeed(seedHex: string): KeyPair {
  const sk = hexToBytes(seedHex);
  if (sk.length !== 32) throw new Error('seed must be 32 bytes');
  return { privateKey: seedHex, publicKey: bytesToHex(ed25519.getPublicKey(sk)) };
}

/**
 * DEMO ONLY. Derives a fixed keypair from a public label so the seeded demo is
 * reproducible offline. Anyone can recompute these keys, which is fine for a
 * synthetic demo and unacceptable anywhere else. A real device key is generated
 * inside Android Keystore / StrongBox and never leaves the secure element.
 */
export function deriveDemoKeyPair(label: string): KeyPair {
  return keyPairFromSeed(sha256Hex('viraam-demo-seed:' + label));
}

/** Sign `payload` under a domain separator. Returns a 64-byte signature, hex. */
export function signPayload(domain: string, payload: unknown, privateKeyHex: string): string {
  return bytesToHex(ed25519.sign(message(domain, payload), hexToBytes(privateKeyHex)));
}

/** Constant-shape verify: any malformed input is simply `false`. */
export function verifyPayload(domain: string, payload: unknown, signatureHex: string, publicKeyHex: string): boolean {
  try {
    return ed25519.verify(hexToBytes(signatureHex), message(domain, payload), hexToBytes(publicKeyHex));
  } catch {
    return false;
  }
}
export * from './envelopes';
