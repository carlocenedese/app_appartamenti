import { commitChange } from './journal';
import { SupplierProfileSchema } from './model';
import type { SupplierProfile } from './model';
import { recordPath } from './store/records';
import type { Store } from './store/store';

export type SeedSkip = { id: string | null; reason: 'invalid' | 'exists' };

/**
 * Writes the bundled supplier profiles that are not on disk yet, in one `profiles.seed`
 * operation. A seed is valid when `SupplierProfileSchema` accepts it as given (with its `id`,
 * `v`, `rev`). Invalid seeds and ones whose record exists (or came earlier in `seeds`) are
 * skipped, reported by `id` and reason only. Nothing is written when nothing is left.
 */
export async function seedProfiles(
  store: Store,
  seeds: unknown[],
  profileId: string,
  clock: () => string,
  newId: () => string,
): Promise<{ written: SupplierProfile[]; skipped: SeedSkip[] }> {
  const written: SupplierProfile[] = [];
  const skipped: SeedSkip[] = [];
  const seen = new Set<string>();
  for (const seed of seeds) {
    const parsed = SupplierProfileSchema.safeParse(seed);
    if (!parsed.success) {
      const id = (seed as { id?: unknown } | null)?.id;
      skipped.push({ id: typeof id === 'string' ? id : null, reason: 'invalid' });
      continue;
    }
    const profile = parsed.data;
    if (
      seen.has(profile.id) ||
      (await store.readJson(recordPath('supplierProfile', profile.id))) !== undefined
    ) {
      skipped.push({ id: profile.id, reason: 'exists' });
      continue;
    }
    seen.add(profile.id);
    written.push(profile);
  }
  if (written.length > 0) {
    await commitChange(
      store,
      {
        profileId,
        kind: 'profiles.seed',
        summary: `Profili dei fornitori iniziali: ${String(written.length)}`,
        changes: written.map((p) => ({
          path: recordPath('supplierProfile', p.id),
          before: undefined,
          after: p,
        })),
      },
      clock,
      newId,
    );
  }
  return { written, skipped };
}
