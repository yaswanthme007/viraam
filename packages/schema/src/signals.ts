import { z } from 'zod';

/**
 * RAW device signals. These NEVER leave the device.
 *
 * They exist only in memory on the phone, long enough for the on-device rule
 * engine to reduce them to evidence codes. Note what is absent even here:
 * no phone numbers, no contact names, no app names, no screen contents.
 * A collector only reports the minimum needed to evaluate each rule.
 */
export const DeviceSignals = z
  .object({
    /** Epoch ms when the snapshot was taken. */
    capturedAt: z.number().int(),
    /** Device-local wall clock at payment time. */
    localTime: z.object({ hour: z.number().int().min(0).max(23), minute: z.number().int().min(0).max(59) }),
    /** Is a voice call active right now, and for how long. No number, no audio. */
    call: z.object({ active: z.boolean(), durationSeconds: z.number().int().min(0) }),
    /** Any enabled service that can read/drive the UI (accessibility-based remote control). */
    remoteAccessServiceActive: z.boolean(),
    /** Is the screen currently being captured / mirrored. */
    screenShareActive: z.boolean(),
    /** Hours since the most recent install from an unknown source, or null if none. */
    sideloadedAppInstalledHoursAgo: z.number().min(0).nullable(),
    /** Number of foreground app switches in the last 60 seconds. */
    appSwitchesLast60s: z.number().int().min(0),
    /** Local payment history for THIS payee only. */
    payeeHistory: z.object({
      previousPayments: z.number().int().min(0),
      firstPaidDaysAgo: z.number().min(0).nullable(),
    }),
    /** Amount being paid vs. the user's own 99th percentile, computed locally. */
    amountStats: z.object({ amountPaise: z.number().int().positive(), p99AmountPaise: z.number().int().positive() }),
    /** The user's usual transacting window, learned locally. [start, end) in local hours. */
    usualActiveHours: z.object({ start: z.number().int().min(0).max(23), end: z.number().int().min(1).max(24) }),
  })
  .strict();
export type DeviceSignals = z.infer<typeof DeviceSignals>;

/** What the collector is told about the payment being attempted. */
export interface PaymentContext {
  payeeVpa: string;
  amountPaise: number;
}

/**
 * The seam between VIRAAM and the operating system.
 *
 * In this prototype the only implementation is `SimulatedDeviceSignalCollector`
 * (apps/device) which replays seeded demo scenarios. A native Android collector
 * would implement this same interface, roughly as follows:
 *
 * | Field                          | Android source (indicative)                                                        |
 * |--------------------------------|------------------------------------------------------------------------------------|
 * | call.active / durationSeconds  | TelephonyManager + TelephonyCallback.CallStateListener (READ_PHONE_STATE); timer  |
 * | remoteAccessServiceActive      | AccessibilityManager.getEnabledAccessibilityServiceList(FEEDBACK_ALL_MASK) filtered |
 * |                                | to services with canRetrieveWindowContent / canPerformGestures                     |
 * | screenShareActive              | WindowManager.addScreenRecordingCallback (API 35+); DisplayManager virtual displays |
 * | sideloadedAppInstalledHoursAgo | PackageManager.getInstallSourceInfo + PackageInfo.firstInstallTime                 |
 * | appSwitchesLast60s             | UsageStatsManager.queryEvents (ACTIVITY_RESUMED), with PACKAGE_USAGE_STATS consent |
 * | payeeHistory / amountStats     | The payment app's own local transaction store                                      |
 * | localTime / usualActiveHours   | System clock + a locally learned histogram                                         |
 *
 * Contract every implementation must honour:
 *  - Return only the fields above. Never return identifiers, names or content.
 *  - Never persist or transmit the snapshot; it is consumed by the rule engine and dropped.
 *  - When a signal is unavailable (permission denied, old OS), report the
 *    benign value (false / 0 / null). VIRAAM must degrade to "less evidence", never to "block".
 */
export interface DeviceSignalCollector {
  /** Where the signals come from. Shown in the UI so a simulated source is never mistaken for a real one. */
  readonly source: 'simulated' | 'android-native' | 'ios-native';
  collect(context: PaymentContext): Promise<DeviceSignals>;
}
