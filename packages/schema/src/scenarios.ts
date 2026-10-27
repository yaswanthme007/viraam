import type { DeviceSignals } from './signals';
import type { Verdict } from './common';

/**
 * Synthetic demo identities. Every name, VPA and id below is invented.
 * VPAs use the fictitious "@mockupi" handle so they can't be mistaken for real accounts.
 */
export const DEMO_IDENTITIES = {
  device: {
    deviceId: 'dev_7f3a9c2e1b5d',
    keyId: 'key_dev_asha_demo_01',
    /** Seed label for the demo key. See packages/crypto deriveDemoKeyPair. Demo only. */
    keySeedLabel: 'device:asha-demo',
    ownerName: 'Asha',
    payerVpa: 'asha.demo@mockupi',
  },
  trustedContact: {
    contactId: 'tc_ravi_demo',
    keyId: 'key_tc_ravi_demo_01',
    keySeedLabel: 'trusted-contact:ravi-demo',
    name: 'Ravi',
  },
} as const;

/** Everything in DeviceSignals except fields the collector fills at collect time. */
export type ScenarioSignals = Omit<DeviceSignals, 'capturedAt' | 'amountStats'> & { p99AmountPaise: number };

export type ScenarioExpectation = Verdict | 'UNPROTECTED';

export interface DemoScenario {
  id: string;
  number: number;
  title: string;
  tagline: string;
  /** What VIRAAM should do. Used by the end-to-end verifier and shown in the device app. */
  expected: ScenarioExpectation;
  viraamEnabled: boolean;
  payee: { name: string; vpa: string };
  amountPaise: number;
  signals: ScenarioSignals;
  /** In the HOLD scenario, what the trusted contact does in the demo script. */
  trustedContactAction?: 'APPROVE' | 'DENY';
  /** Shown only in the demo controls, so the audience knows what the "sensors" are reporting. */
  story: string;
}

const NORMAL_USER = {
  p99AmountPaise: 25_000 * 100,
  usualActiveHours: { start: 7, end: 23 },
} as const;

const DIGITAL_ARREST_SIGNALS: ScenarioSignals = {
  ...NORMAL_USER,
  localTime: { hour: 2, minute: 14 },
  call: { active: true, durationSeconds: 47 * 60 + 12 },
  remoteAccessServiceActive: true,
  screenShareActive: false,
  sideloadedAppInstalledHoursAgo: null,
  appSwitchesLast60s: 3,
  payeeHistory: { previousPayments: 0, firstPaidDaysAgo: null },
};

const DIGITAL_ARREST_PAYEE = { name: 'Verification Escrow Desk', vpa: 'escrow.verify.demo@mockupi' };

export const DEMO_SCENARIOS: DemoScenario[] = [
  {
    id: 'normal',
    number: 1,
    title: 'Normal payment',
    tagline: 'Small amount, known payee',
    expected: 'ALLOW',
    viraamEnabled: true,
    payee: { name: 'Sharma Kirana Store', vpa: 'sharma.kirana.demo@mockupi' },
    amountPaise: 340 * 100,
    signals: {
      ...NORMAL_USER,
      localTime: { hour: 11, minute: 5 },
      call: { active: false, durationSeconds: 0 },
      remoteAccessServiceActive: false,
      screenShareActive: false,
      sideloadedAppInstalledHoursAgo: null,
      appSwitchesLast60s: 1,
      payeeHistory: { previousPayments: 42, firstPaidDaysAgo: 610 },
    },
    story: 'Mid-morning. Paying the local store Asha pays every week. Nothing unusual.',
  },
  {
    id: 'digital-arrest',
    number: 2,
    title: 'Digital arrest',
    tagline: '47-min call, remote access, new payee, 2:14 AM',
    expected: 'HOLD',
    viraamEnabled: true,
    payee: DIGITAL_ARREST_PAYEE,
    amountPaise: 2_00_000 * 100,
    signals: DIGITAL_ARREST_SIGNALS,
    trustedContactAction: 'DENY',
    story:
      'A caller posing as an officer has kept Asha on the line for 47 minutes, talked them into installing a "verification" remote-access tool, and is now directing a ₹2,00,000 "safe custody" transfer.',
  },
  {
    id: 'false-positive-guard',
    number: 3,
    title: 'False positive guard',
    tagline: 'Long genuine call, known payee, normal amount',
    expected: 'ALLOW',
    viraamEnabled: true,
    payee: { name: 'Meera (sister)', vpa: 'meera.demo@mockupi' },
    amountPaise: 1_450 * 100,
    signals: {
      ...NORMAL_USER,
      localTime: { hour: 19, minute: 40 },
      call: { active: true, durationSeconds: 52 * 60 },
      remoteAccessServiceActive: false,
      screenShareActive: false,
      sideloadedAppInstalledHoursAgo: null,
      appSwitchesLast60s: 2,
      payeeHistory: { previousPayments: 18, firstPaidDaysAgo: 400 },
    },
    story: 'An hour-long family call. Asha splits a dinner bill with their sister mid-call. A long call alone is not coercion.',
  },
  {
    id: 'viraam-disabled',
    number: 4,
    title: 'VIRAAM disabled',
    tagline: 'Same as #2, layer switched off',
    expected: 'UNPROTECTED',
    viraamEnabled: false,
    payee: DIGITAL_ARREST_PAYEE,
    amountPaise: 2_00_000 * 100,
    signals: DIGITAL_ARREST_SIGNALS,
    story: "Identical situation to #2, but the phone has no VIRAAM layer. This is today's rail.",
  },
  {
    id: 'cooling-off',
    number: 5,
    title: 'Cooling-off (bonus)',
    tagline: 'Late, large, new payee, no call',
    expected: 'STEP_UP',
    viraamEnabled: true,
    payee: { name: 'Lakeview Rentals', vpa: 'lakeview.rent.demo@mockupi' },
    amountPaise: 48_000 * 100,
    signals: {
      ...NORMAL_USER,
      localTime: { hour: 23, minute: 30 },
      call: { active: false, durationSeconds: 0 },
      remoteAccessServiceActive: false,
      screenShareActive: false,
      sideloadedAppInstalledHoursAgo: null,
      appSwitchesLast60s: 2,
      payeeHistory: { previousPayments: 0, firstPaidDaysAgo: null },
    },
    story:
      'A late-night deposit to a new landlord. Unusual but plausibly genuine, so VIRAAM asks for a short pause and a re-confirm instead of a hold.',
  },
];

export function getScenario(id: string): DemoScenario {
  const s = DEMO_SCENARIOS.find((x) => x.id === id);
  if (!s) throw new Error(`unknown scenario ${id}`);
  return s;
}

/** Materialise a scenario into a full DeviceSignals snapshot, as a collector would. */
export function scenarioSignals(scenario: DemoScenario, amountPaise: number, now: number): DeviceSignals {
  const { p99AmountPaise, ...rest } = scenario.signals;
  return { ...rest, capturedAt: now, amountStats: { amountPaise, p99AmountPaise } };
}
