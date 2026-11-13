import { describe, expect, it } from 'vitest';
import {
  BillSchema,
  CORE_SCHEMA_VERSION,
  CORE_VERSION,
  DROPBOX_CONFLICT_RULE,
  JOURNAL_DIR,
  assessWorkspace,
  createUser,
  loadAll,
} from '../src/index';
import type { ConflictNameRule } from '../src/index';
import { WORKSPACE_PATH } from '../src/store/store';
import { MemoryStore } from './helpers/memory-store';

const app = { version: CORE_VERSION, schemaVersion: CORE_SCHEMA_VERSION };
const clock = () => '2026-11-13T09:00:00.000Z';
function ids(): () => string {
  let n = 0;
  return () => `op-${String(++n)}`;
}
const workspace = (extra: Record<string, unknown> = {}) => ({
  workspaceId: 'ws-1',
  name: 'Casa',
  schemaVersion: CORE_SCHEMA_VERSION,
  minAppVersion: CORE_VERSION,
  createdAt: clock(),
  ...extra,
});

/** A folder with a valid workspace.json and one user created through the journal. */
async function cleanFolder(extra: Record<string, unknown> = {}): Promise<MemoryStore> {
  const store = new MemoryStore();
  await createUser(store, { id: 'u1', name: 'Anna' }, 'u1', clock, ids());
  await store.writeJsonAtomic(WORKSPACE_PATH, workspace(extra));
  return store;
}

const userJson = (id: string) => JSON.stringify({ id, v: 1, rev: 1, name: 'Bruno' });

describe('assessWorkspace', () => {
  it('finds a clean folder writable', async () => {
    const store = await cleanFolder();
    expect(await assessWorkspace(store, app)).toEqual({
      compat: 'ok',
      sync: 'ok',
      writable: true,
      problems: [],
    });
  });

  it('is behind and not writable when a record in the journal has not arrived', async () => {
    const full = await cleanFolder();
    // Only the journal and workspace.json arrived; the user record did not.
    const store = new MemoryStore();
    for (const name of await full.list(JOURNAL_DIR)) {
      store.putRaw(`${JOURNAL_DIR}/${name}`, full.getRaw(`${JOURNAL_DIR}/${name}`) ?? '');
    }
    await store.writeJsonAtomic(WORKSPACE_PATH, workspace());
    const result = await assessWorkspace(store, app);
    expect(result).toMatchObject({ compat: 'ok', sync: 'behind', writable: false });
    expect(result.problems).toEqual([{ path: '_app/dati/user/u1.json', reason: 'diverged' }]);
  });

  it('is read-only for a folder with a newer schemaVersion', async () => {
    const store = await cleanFolder({ schemaVersion: CORE_SCHEMA_VERSION + 1 });
    expect(await assessWorkspace(store, app)).toMatchObject({
      compat: 'readonly',
      sync: 'ok',
      writable: false,
    });
  });

  it('is upgrade-needed for an older schemaVersion', async () => {
    const newerApp = { ...app, schemaVersion: CORE_SCHEMA_VERSION + 1 };
    expect(await assessWorkspace(await cleanFolder(), newerApp)).toMatchObject({
      compat: 'upgrade-needed',
      writable: false,
    });
  });

  it('is invalid and not writable for a broken, wrong or missing workspace.json, without throwing', async () => {
    const broken = await cleanFolder();
    broken.putRaw(WORKSPACE_PATH, '{"workspaceId": "ws-1", "na');
    const wrong = await cleanFolder({ minAppVersion: 'latest' });
    const missing = new MemoryStore();
    for (const store of [broken, wrong, missing]) {
      expect(await assessWorkspace(store, app)).toMatchObject({
        compat: 'invalid',
        sync: 'ok',
        writable: false,
      });
    }
  });

  it('lists a conflict copy and a duplicate id as problems that do not block', async () => {
    const store = await cleanFolder();
    store.putRaw('_app/dati/user/u1 (conflicted copy 2026-11-13).json', userJson('u1'));
    store.putRaw('_app/dati/user/u2.json', userJson('u2'));
    store.putRaw('_app/dati/user/u2 - Copia.json', userJson('u2'));
    const result = await assessWorkspace(store, app);
    expect(result).toMatchObject({ compat: 'ok', sync: 'ok', writable: true });
    expect(result.problems).toEqual([
      {
        path: '_app/dati/user/u1 (conflicted copy 2026-11-13).json',
        reason: 'conflicted-copy',
        originalPath: '_app/dati/user/u1.json',
      },
      { path: '_app/dati/user/u2 - Copia.json', reason: 'duplicate-id' },
    ]);
  });

  it('uses the conflict rules it is given', async () => {
    const store = await cleanFolder();
    store.putRaw('_app/dati/user/u1 2.json', userJson('u1'));
    const plain = await assessWorkspace(store, app);
    expect(plain.problems).toEqual([{ path: '_app/dati/user/u1 2.json', reason: 'duplicate-id' }]);
    const both = await assessWorkspace(store, app, [DROPBOX_CONFLICT_RULE, ICLOUD_TEST_RULE]);
    expect(both.problems).toEqual([
      { path: '_app/dati/user/u1 2.json', reason: 'conflicted-copy' },
    ]);
  });

  it('checks every kind of record in recordSchemas, such as tenancy', async () => {
    const store = await cleanFolder();
    store.putRaw('_app/dati/tenancy/t1 (conflicted copy 2026-11-13).json', '{}');
    const result = await assessWorkspace(store, app);
    expect(result.writable).toBe(true);
    expect(result.problems).toEqual([
      {
        path: '_app/dati/tenancy/t1 (conflicted copy 2026-11-13).json',
        reason: 'conflicted-copy',
        originalPath: '_app/dati/tenancy/t1.json',
      },
    ]);
  });

  it('is behind for an operation file cut short or from a newer app', async () => {
    const truncated = new MemoryStore();
    await truncated.writeJsonAtomic(WORKSPACE_PATH, workspace());
    truncated.putRaw(`${JOURNAL_DIR}/op.json`, '{"id": "op-1", "v": 1, "chan');
    const result = await assessWorkspace(truncated, app);
    expect(result).toMatchObject({ compat: 'ok', sync: 'behind', writable: false });
    expect(result.problems).toEqual([{ path: `${JOURNAL_DIR}/op.json`, reason: 'malformed-json' }]);

    const future = await cleanFolder();
    future.putRaw(`${JOURNAL_DIR}/op.json`, JSON.stringify({ id: 'op-9', v: 2 }));
    expect(await assessWorkspace(future, app)).toMatchObject({
      sync: 'behind',
      writable: false,
      problems: [{ path: `${JOURNAL_DIR}/op.json`, reason: 'future-version' }],
    });
  });

  it('lists a conflict copy of an operation without blocking, with the rules it is given', async () => {
    const store = await cleanFolder();
    const [name] = await store.list(JOURNAL_DIR);
    const stem = (name ?? '').slice(0, -'.json'.length);
    const text = store.getRaw(`${JOURNAL_DIR}/${name ?? ''}`) ?? '';
    store.putRaw(`${JOURNAL_DIR}/${stem} (conflicted copy).json`, text);
    store.putRaw(`${JOURNAL_DIR}/${stem} 2.json`, text);
    const plain = await assessWorkspace(store, app);
    expect(plain).toMatchObject({ sync: 'ok', writable: true });
    expect(plain.problems.map(({ path, reason }) => [path, reason])).toEqual([
      [`${JOURNAL_DIR}/${stem} (conflicted copy).json`, 'conflicted-copy'],
      [`${JOURNAL_DIR}/${stem} 2.json`, 'duplicate-id'],
    ]);
    const both = await assessWorkspace(store, app, [DROPBOX_CONFLICT_RULE, ICLOUD_TEST_RULE]);
    expect(both).toMatchObject({ sync: 'ok', writable: true });
    expect(both.problems.map(({ reason }) => reason)).toEqual([
      'conflicted-copy',
      'conflicted-copy',
    ]);
  });

  it('lets a failure of the store itself go up', async () => {
    class BrokenStore extends MemoryStore {
      override async readJson(): Promise<unknown> {
        throw new Error('disk gone');
      }
    }
    await expect(assessWorkspace(new BrokenStore(), app)).rejects.toThrow('disk gone');
  });
});

// A made-up second service for the test: copies named "<name> <n>.json".
const ICLOUD_TEST_RULE: ConflictNameRule = {
  service: 'icloud-test',
  isConflictName: (name) => / [0-9]+\.json$/.test(name),
};

describe('conflict name rules', () => {
  it('Dropbox recognises its own markers and not the other service names', () => {
    expect(DROPBOX_CONFLICT_RULE.isConflictName('x (conflicted copy 2026-11-05).json')).toBe(true);
    expect(
      DROPBOX_CONFLICT_RULE.isConflictName('x (Copia in conflitto di N 2026-11-05).json'),
    ).toBe(true);
    expect(DROPBOX_CONFLICT_RULE.isConflictName('x 2.json')).toBe(false);
    expect(ICLOUD_TEST_RULE.isConflictName('x 2.json')).toBe(true);
  });

  it('loadAll without rules behaves as before, with rules it uses any of them', async () => {
    const store = new MemoryStore();
    const bill = {
      id: 'b',
      v: 1,
      rev: 1,
      apartmentId: 'a',
      category: 'gas',
      supplier: 'S',
      periodStart: '2026-01-01',
      periodEnd: '2026-01-31',
      amount: 1,
      includedInConguaglio: true,
      sharedWithTenants: true,
      fileHash: 'h',
      filePath: 'f.pdf',
    };
    store.putRaw('_app/dati/bill/b 2.json', JSON.stringify(bill));
    store.putRaw('_app/dati/bill/b (conflicted copy).json', JSON.stringify(bill));
    expect((await loadAll(store, 'bill', BillSchema)).problems.map((p) => p.reason)).toEqual([
      'conflicted-copy',
      'id-mismatch',
    ]);
    const withRules = await loadAll(store, 'bill', BillSchema, {}, [
      DROPBOX_CONFLICT_RULE,
      ICLOUD_TEST_RULE,
    ]);
    expect(withRules.problems.map((p) => p.reason)).toEqual(['conflicted-copy', 'conflicted-copy']);
  });
});
