import type { DeviceSignals, EvidenceCode, PayeeNovelty } from '@viraam/schema';
import { EVIDENCE_CODES } from '@viraam/schema';

/** Every threshold in one place. Changing a number here changes behaviour; nothing else is hidden. */
export const THRESHOLDS = {
  longCallSeconds: 30 * 60,
  sideloadWindowHours: 72,
  rapidAppSwitchesPer60s: 8,
  recentPayeeDays: 7,
} as const;

function isOffPattern(hour: number, usual: { start: number; end: number }): boolean {
  return usual.start <= usual.end ? hour < usual.start || hour >= usual.end : hour < usual.start && hour >= usual.end;
}

/**
 * Reduce raw device signals to evidence codes. Pure and deterministic:
 * same signals in, same codes out, in canonical order.
 */
export function deriveEvidence(s: DeviceSignals): EvidenceCode[] {
  const hits: Record<EvidenceCode, boolean> = {
    CALL_ACTIVE_GT_30M: s.call.active && s.call.durationSeconds > THRESHOLDS.longCallSeconds,
    REMOTE_ACCESS_SERVICE_ACTIVE: s.remoteAccessServiceActive,
    SCREEN_SHARE_ACTIVE: s.screenShareActive,
    SIDELOADED_APP_RECENT:
      s.sideloadedAppInstalledHoursAgo !== null && s.sideloadedAppInstalledHoursAgo <= THRESHOLDS.sideloadWindowHours,
    PAYEE_FIRST_SEEN: s.payeeHistory.previousPayments === 0,
    AMOUNT_GT_P99: s.amountStats.amountPaise > s.amountStats.p99AmountPaise,
    OFF_PATTERN_HOUR: isOffPattern(s.localTime.hour, s.usualActiveHours),
    RAPID_APP_SWITCHING: s.appSwitchesLast60s >= THRESHOLDS.rapidAppSwitchesPer60s,
  };
  return EVIDENCE_CODES.filter((c) => hits[c]);
}

export function derivePayeeNovelty(s: DeviceSignals): PayeeNovelty {
  if (s.payeeHistory.previousPayments === 0) return 'FIRST_SEEN';
  if (s.payeeHistory.firstPaidDaysAgo !== null && s.payeeHistory.firstPaidDaysAgo < THRESHOLDS.recentPayeeDays) {
    return 'RECENT';
  }
  return 'KNOWN';
}
