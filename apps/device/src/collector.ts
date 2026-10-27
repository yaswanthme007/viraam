import { DeviceSignals, scenarioSignals, type DemoScenario, type DeviceSignalCollector, type PaymentContext } from '@viraam/schema';

/**
 * SIMULATED sensor layer. Replays a seeded demo scenario instead of reading the
 * OS. A native Android collector implements the same DeviceSignalCollector
 * interface (see packages/schema/src/signals.ts for the field-by-field mapping).
 */
export class SimulatedDeviceSignalCollector implements DeviceSignalCollector {
  readonly source = 'simulated' as const;
  constructor(private scenario: DemoScenario) {}

  async collect(ctx: PaymentContext): Promise<DeviceSignals> {
    // Validate exactly as a native collector's output would be validated.
    return DeviceSignals.parse(scenarioSignals(this.scenario, ctx.amountPaise, Date.now()));
  }
}
