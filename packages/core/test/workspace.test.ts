import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CORE_VERSION,
  WorkspaceSchema,
  createWorkspace,
  findWorkspace,
  liveUsers,
  loadAll,
  SupplierProfileSchema,
} from '../src/index';
import type { Store } from '../src/index';
import { WORKSPACE_PATH } from '../src/store/store';
import { MemoryStore } from './helpers/memory-store';

const clock = () => '2026-11-13T09:00:00.000Z';
function ids(prefix: string): () => string {
  let n = 0;
  return () => `${prefix}-${String(++n)}`;
}
const dir = join(__dirname, '../../../python/seed-profiles');
const seeds: unknown[] = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as unknown);
const input = { workspaceId: 'ws-1', name: 'Casa', user: { id: 'u-1', name: 'Anna' } };

/** Fails the `failAt`-th write (1-based) and counts the writes it saw. */
class FlakyStore extends MemoryStore implements Store {
  writes = 0;
  constructor(private readonly failAt: number) {
    super();
  }
  override async writeJsonAtomic(path: string, value: unknown): Promise<void> {
    if (++this.writes === this.failAt) throw new Error('disk gone');
    await super.writeJsonAtomic(path, value);
  }
}

describe('createWorkspace', () => {
  it('creates the user, eleven profiles and a valid workspace.json', async () => {
    const store = new MemoryStore();
    const r = await createWorkspace(store, input, seeds, clock, ids('a'));
    expect(r.seeded).toBe(11);
    expect(r.user.name).toBe('Anna');
    expect(r.workspace).toEqual({
      workspaceId: 'ws-1',
      name: 'Casa',
      schemaVersion: 1,
      minAppVersion: CORE_VERSION,
      createdAt: '2026-11-13T09:00:00.000Z',
    });
    expect(WorkspaceSchema.parse(await store.readJson(WORKSPACE_PATH))).toEqual(r.workspace);
    expect(await findWorkspace(store)).toEqual(r.workspace);
    expect(await liveUsers(store)).toHaveLength(1);
    expect((await loadAll(store, 'supplierProfile', SupplierProfileSchema)).records).toHaveLength(
      11,
    );
  });

  it('refuses when workspace.json exists, valid or not, without naming anything', async () => {
    for (const raw of ['{"x":1}', 'not json']) {
      const store = new MemoryStore();
      store.putRaw(WORKSPACE_PATH, raw);
      const err = await createWorkspace(store, input, seeds, clock, ids('a')).catch(
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(RangeError);
      expect((err as Error).message).not.toMatch(/Casa|Anna/);
      expect(await store.list('_app/dati/user')).toEqual([]);
      expect(store.getRaw(WORKSPACE_PATH)).toBe(raw);
    }
  });

  it('resumes after an interruption at any write, without duplicates', async () => {
    const total = new FlakyStore(0);
    await createWorkspace(total, input, seeds, clock, ids('a'));
    for (let failAt = 1; failAt <= total.writes; failAt++) {
      const store = new FlakyStore(failAt);
      await expect(createWorkspace(store, input, seeds, clock, ids('a'))).rejects.toThrow(
        'disk gone',
      );
      // workspace.json comes last: the last write is the only one that may create it.
      expect(store.getRaw(WORKSPACE_PATH) === undefined).toBe(true);
      const r = await createWorkspace(store, input, seeds, clock, ids('b'));
      expect(r.workspace.workspaceId).toBe('ws-1');
      expect(await liveUsers(store)).toHaveLength(1);
      expect(await store.list('_app/dati/supplierProfile')).toHaveLength(11);
      expect(await findWorkspace(store)).toEqual(r.workspace);
    }
  });

  it('counts only the profiles written by the retry', async () => {
    const total = new FlakyStore(0);
    await createWorkspace(total, input, seeds, clock, ids('a'));
    const store = new FlakyStore(total.writes); // fails on the workspace.json write
    await expect(createWorkspace(store, input, seeds, clock, ids('a'))).rejects.toThrow();
    const r = await createWorkspace(store, input, seeds, clock, ids('b'));
    expect(r.seeded).toBe(0);
  });
});
