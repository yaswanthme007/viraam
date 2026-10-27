import type { EvidenceCode } from '@viraam/schema';
import { AMOUNT_BAND_LABEL } from '@viraam/schema';
import type { DeviceCopyInput, InterventionCopy, InterventionCopyGenerator, TrustedCopyInput } from '../types';

const COERCION_FACT =
  'Police, courts, banks and tax officials never ask you to move money over a call or video call. There is no such thing as a "digital arrest".';

function clock(hour: number, minute: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
}

/** Fixed, display order for reasons: the most coercion-specific evidence first. */
export const REASON_ORDER: EvidenceCode[] = [
  'CALL_ACTIVE_GT_30M',
  'REMOTE_ACCESS_SERVICE_ACTIVE',
  'SCREEN_SHARE_ACTIVE',
  'PAYEE_FIRST_SEEN',
  'AMOUNT_GT_P99',
  'OFF_PATTERN_HOUR',
  'SIDELOADED_APP_RECENT',
  'RAPID_APP_SWITCHING',
];

/** Local, first-person phrasing. May use raw signals because it never leaves the phone. */
export function deviceReason(code: EvidenceCode, s: DeviceCopyInput['signals']): string {
  switch (code) {
    case 'CALL_ACTIVE_GT_30M':
      return `You've been on a call for ${Math.floor(s.call.durationSeconds / 60)} minutes.`;
    case 'REMOTE_ACCESS_SERVICE_ACTIVE':
      return 'An app that can control your screen is switched on.';
    case 'SCREEN_SHARE_ACTIVE':
      return 'Your screen is being shared with someone.';
    case 'PAYEE_FIRST_SEEN':
      return "You've never paid this person before.";
    case 'AMOUNT_GT_P99':
      return 'This is much larger than your usual payments.';
    case 'OFF_PATTERN_HOUR':
      return `It's ${clock(s.localTime.hour, s.localTime.minute)}, outside the hours you usually pay.`;
    case 'SIDELOADED_APP_RECENT':
      return 'An app from outside the Play Store was installed recently.';
    case 'RAPID_APP_SWITCHING':
      return "You're switching between apps very quickly, as if following instructions.";
  }
}

/** Third-person phrasing for the trusted contact. Evidence codes only. */
export function contactReason(code: EvidenceCode, name: string): string {
  switch (code) {
    case 'CALL_ACTIVE_GT_30M':
      return `${name} has been on a phone call for over 30 minutes.`;
    case 'REMOTE_ACCESS_SERVICE_ACTIVE':
      return `An app that can control ${name}'s screen is switched on.`;
    case 'SCREEN_SHARE_ACTIVE':
      return `${name}'s screen is being shared.`;
    case 'PAYEE_FIRST_SEEN':
      return `${name} has never paid this person before.`;
    case 'AMOUNT_GT_P99':
      return `It's far larger than ${name}'s usual payments.`;
    case 'OFF_PATTERN_HOUR':
      return `It's outside the hours ${name} usually pays.`;
    case 'SIDELOADED_APP_RECENT':
      return 'An app from outside the Play Store was installed recently.';
    case 'RAPID_APP_SWITCHING':
      return `${name} is switching apps rapidly, as if being coached.`;
  }
}

export function orderEvidence(evidence: readonly EvidenceCode[]): EvidenceCode[] {
  return REASON_ORDER.filter((c) => evidence.includes(c));
}

function isCoercionShape(evidence: readonly EvidenceCode[]): boolean {
  return (
    evidence.includes('CALL_ACTIVE_GT_30M') &&
    (evidence.includes('REMOTE_ACCESS_SERVICE_ACTIVE') || evidence.includes('SCREEN_SHARE_ACTIVE'))
  );
}

/** The default copy generator: deterministic templates. No model involved. */
export class TemplateCopyGenerator implements InterventionCopyGenerator {
  readonly id: string = 'templates-v1';

  protected order(evidence: readonly EvidenceCode[]): EvidenceCode[] {
    return orderEvidence(evidence);
  }

  forDevice(input: DeviceCopyInput): InterventionCopy {
    const reasons = this.order(input.evidence).map((c) => deviceReason(c, input.signals));
    const fact = isCoercionShape(input.evidence) ? COERCION_FACT : undefined;
    if (input.verdict === 'HOLD') {
      return {
        headline: "Let's pause this payment.",
        body: `Your money stays with you. We've asked ${input.contactName} to check in. It's safe to hang up the call now.`,
        reasons,
        fact,
      };
    }
    if (input.verdict === 'STEP_UP') {
      const secs = input.coolingSeconds ?? 30;
      return {
        headline: `Take ${secs} seconds before this goes.`,
        body: 'Nothing is wrong yet. A short pause is the best protection against pressure. If you still want to pay after the timer, confirm and it goes through.',
        reasons,
        fact,
      };
    }
    return { headline: 'All clear.', body: 'Nothing unusual about this payment.', reasons };
  }

  forTrustedContact(input: TrustedCopyInput): InterventionCopy {
    const n = input.requesterName;
    const amount = AMOUNT_BAND_LABEL[input.amountBand];
    return {
      headline: `${n}'s payment is paused`,
      body: `A payment of ${amount} is frozen until you respond. Before deciding, call ${n} on their usual number. Scammers often keep victims on the line so no one else can reach them.`,
      reasons: this.order(input.evidence).map((c) => contactReason(c, n)),
      fact: isCoercionShape(input.evidence) ? COERCION_FACT : undefined,
    };
  }
}
