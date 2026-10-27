import { z } from 'zod';

/**
 * Evidence codes are the ONLY situational facts that leave the device.
 * Each one is a boolean fact about the session, never the underlying data.
 */
export const EVIDENCE_CODES = [
  'CALL_ACTIVE_GT_30M',
  'REMOTE_ACCESS_SERVICE_ACTIVE',
  'SCREEN_SHARE_ACTIVE',
  'SIDELOADED_APP_RECENT',
  'PAYEE_FIRST_SEEN',
  'AMOUNT_GT_P99',
  'OFF_PATTERN_HOUR',
  'RAPID_APP_SWITCHING',
] as const;

export const EvidenceCode = z.enum(EVIDENCE_CODES);
export type EvidenceCode = z.infer<typeof EvidenceCode>;

export interface EvidenceInfo {
  /** Short human label, used by the console and trusted-contact app. */
  label: string;
  /** What the code asserts. */
  meaning: string;
  /** What the device deliberately does NOT send to establish this fact. */
  neverSent: string;
}

export const EVIDENCE_CATALOG: Record<EvidenceCode, EvidenceInfo> = {
  CALL_ACTIVE_GT_30M: {
    label: 'On a call for 30+ minutes',
    meaning: 'A voice call has been continuously active for more than 30 minutes at payment time.',
    neverSent: 'Caller number, contact name, call audio, exact duration.',
  },
  REMOTE_ACCESS_SERVICE_ACTIVE: {
    label: 'Remote-control service active',
    meaning: 'A service that can read or drive the screen (e.g. an accessibility-based remote tool) is running.',
    neverSent: 'Which app, its package name, what it can see.',
  },
  SCREEN_SHARE_ACTIVE: {
    label: 'Screen is being shared',
    meaning: 'The screen is being captured or mirrored to another party.',
    neverSent: 'Screen contents, the receiving party, the sharing app.',
  },
  SIDELOADED_APP_RECENT: {
    label: 'App installed outside store recently',
    meaning: 'An app from an unknown source was installed in the last 72 hours.',
    neverSent: 'App name, package, install source, install time.',
  },
  PAYEE_FIRST_SEEN: {
    label: 'First payment to this payee',
    meaning: 'This device has never paid this payee before.',
    neverSent: "The user's payee history or contact list.",
  },
  AMOUNT_GT_P99: {
    label: "Larger than 99% of user's payments",
    meaning: "The amount exceeds the 99th percentile of this user's own past payments.",
    neverSent: "The user's transaction history or the percentile value.",
  },
  OFF_PATTERN_HOUR: {
    label: 'Outside usual hours',
    meaning: 'The payment is outside the hours this user normally transacts.',
    neverSent: "The user's activity timeline or usual hours.",
  },
  RAPID_APP_SWITCHING: {
    label: 'Rapid app switching',
    meaning: 'Unusually frequent switching between apps in the last minute (a coaching signal).',
    neverSent: 'Which apps were opened or in what order.',
  },
};
