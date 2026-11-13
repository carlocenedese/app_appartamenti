import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  SupplierProfileSchema,
  loadAll,
  readJournal,
  recordPath,
  seedProfiles,
  undoOperation,
} from '../src/index';
import type { SupplierProfile } from '../src/index';
import { MemoryStore } from './helpers/memory-store';

const clock = () => '2026-11-13T09:00:00.000Z';
function ids(prefix = 'id'): () => string {
  let n = 0;
  return () => `${prefix}-${String(++n)}`;
}
const dir = join(__dirname, '../../../python/seed-profiles');
const seeds: unknown[] = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as unknown);
const dati = async (store: MemoryStore) => await store.list('_app/dati/supplierProfile');

describe('seedProfiles', () => {
  it('writes the eleven seeds in one operation', async () => {
    expect(seeds).toHaveLength(11);
    const store = new MemoryStore();
    const r = await seedProfiles(store, seeds, 'p1', clock, ids());
    expect(r.written).toHaveLength(11);
    expect(r.skipped).toEqual([]);
    expect(await dati(store)).toHaveLength(11);
    const { operations } = await readJournal(store);
    expect(operations).toHaveLength(1);
    expect(operations[0]?.kind).toBe('profiles.seed');
    expect(operations[0]?.summary).toBe('Profili dei fornitori iniziali: 11');
    expect(operations[0]?.changes.every((c) => c.before === undefined)).toBe(true);
  });

  it('skips an invalid seed, with its id when readable', async () => {
    const store = new MemoryStore();
    const bad = { kind: 'tari', category: 'x' };
    const badWithId = { ...(seeds[1] as object), kind: 'tari', category: 'x' };
    const r = await seedProfiles(store, [bad, badWithId, 7, ...seeds.slice(2)], 'p1', clock, ids());
    expect(r.written).toHaveLength(9);
    expect(r.skipped).toEqual([
      { id: null, reason: 'invalid' },
      { id: (seeds[1] as { id: string }).id, reason: 'invalid' },
      { id: null, reason: 'invalid' },
    ]);
  });

  it('does not overwrite an existing record', async () => {
    const store = new MemoryStore();
    const first = seeds[0] as SupplierProfile;
    const stored = { ...first, status: 'confermato' };
    await store.writeJsonAtomic(recordPath('supplierProfile', first.id), stored);
    const r = await seedProfiles(store, seeds, 'p1', clock, ids());
    expect(r.written).toHaveLength(10);
    expect(r.skipped).toEqual([{ id: first.id, reason: 'exists' }]);
    expect(await store.readJson(recordPath('supplierProfile', first.id))).toEqual(stored);
  });

  it('writes the first of duplicate ids only', async () => {
    const store = new MemoryStore();
    const r = await seedProfiles(store, [seeds[0], seeds[0]], 'p1', clock, ids());
    expect(r.written).toHaveLength(1);
    expect(r.skipped).toEqual([{ id: (seeds[0] as { id: string }).id, reason: 'exists' }]);
  });

  it('writes nothing when there is nothing to write', async () => {
    const store = new MemoryStore();
    expect(await seedProfiles(store, [], 'p1', clock, ids())).toEqual({ written: [], skipped: [] });
    const r = await seedProfiles(store, [{}], 'p1', clock, ids());
    expect(r.written).toEqual([]);
    expect(await store.list('_app/journal')).toHaveLength(0);
    expect(await dati(store)).toHaveLength(0);
  });

  it('can be undone', async () => {
    const store = new MemoryStore();
    await seedProfiles(store, seeds, 'p1', clock, ids());
    const { operations } = await readJournal(store);
    await undoOperation(store, operations[0]?.id ?? '', 'p1', clock, ids('u'));
    const { records } = await loadAll(store, 'supplierProfile', SupplierProfileSchema);
    expect(records.filter((p) => !p.deleted)).toHaveLength(0);
  });
});
