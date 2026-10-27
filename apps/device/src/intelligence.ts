import { defaultCopy, type InterventionCopyGenerator, type RiskScorer } from '@viraam/intelligence';

/**
 * The optional AI module is discovered, not imported. If
 * packages/intelligence/src/ai/ is deleted this glob matches nothing, the
 * "model" toggle disappears, and the app runs on the rule engine alone.
 */
const found = import.meta.glob<{ aiModule: { scorer: RiskScorer; copy: InterventionCopyGenerator } }>(
  '../../../packages/intelligence/src/ai/index.ts',
);

export interface AiModule {
  scorer: RiskScorer;
  copy: InterventionCopyGenerator;
}

export async function loadAiModule(): Promise<AiModule | null> {
  const loader = Object.values(found)[0];
  if (!loader) return null;
  try {
    return (await loader()).aiModule;
  } catch {
    return null;
  }
}

export { defaultCopy };
