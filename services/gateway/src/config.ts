import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { z } from 'zod';
import { ContactId, DeviceId, KeyId, PolicyConfig } from '@viraam/schema';

export const CONFIG_DIR = fileURLToPath(new URL('../config/', import.meta.url));

export function loadPolicy(path = CONFIG_DIR + 'policy.yaml'): PolicyConfig {
  const parsed = PolicyConfig.safeParse(parse(readFileSync(path, 'utf8')));
  if (!parsed.success) {
    throw new Error(`Invalid policy file ${path}:\n${parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')}`);
  }
  const ids = new Set<string>();
  for (const r of parsed.data.rules) {
    if (ids.has(r.id)) throw new Error(`Duplicate rule id "${r.id}" in ${path}`);
    ids.add(r.id);
  }
  return parsed.data;
}

export const Registry = z.object({
  _comment: z.string().optional(),
  keys: z.array(
    z.object({
      keyId: KeyId,
      role: z.enum(['device', 'trusted-contact']),
      subjectId: z.string(),
      publicKey: z.string().regex(/^[0-9a-f]{64}$/),
    }),
  ),
  enrolments: z.array(
    z.object({
      deviceId: DeviceId,
      ownerDisplayName: z.string(),
      trustedContact: z.object({ contactId: ContactId, displayName: z.string() }),
    }),
  ),
});
export type Registry = z.infer<typeof Registry>;

export function loadRegistry(path = CONFIG_DIR + 'registry.json'): Registry {
  return Registry.parse(JSON.parse(readFileSync(path, 'utf8')));
}
