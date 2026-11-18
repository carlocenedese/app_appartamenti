import { describe, expect, it } from 'vitest';
import {
  BillSchema,
  CORE_SCHEMA_VERSION,
  CORE_VERSION,
  DEFAULT_CONFLICT_RULES,
  DROPBOX_CONFLICT_RULE,
  JOURNAL_DIR,
  assessWorkspace,
  checkConsistency,
  createUser,
  saveApartment,
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
      reasons: [],
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

  it('blocks on a conflict copy, never ignored (G2), and lists a duplicate id that does not block', async () => {
    const store = await cleanFolder();
    store.putRaw('_app/dati/user/u1 (conflicted copy 2026-11-13).json', userJson('u1'));
    store.putRaw('_app/dati/user/u2.json', userJson('u2'));
    store.putRaw('_app/dati/user/u2 - Copia.json', userJson('u2'));
    const result = await assessWorkspace(store, app);
    expect(result).toMatchObject({ compat: 'ok', sync: 'ok', writable: false });
    expect(result.reasons).toEqual([
      { code: 'conflict-copies', paths: ['_app/dati/user/u1 (conflicted copy 2026-11-13).json'] },
    ]);
    expect(result.problems).toEqual([
      {
        path: '_app/dati/user/u1 (conflicted copy 2026-11-13).json',
        reason: 'conflicted-copy',
        originalPath: '_app/dati/user/u1.json',
      },
      { path: '_app/dati/user/u2 - Copia.json', reason: 'duplicate-id' },
    ]);
  });

  it('blocks on a conflict copy of workspace.json', async () => {
    const store = await cleanFolder();
    store.putRaw('_app/workspace (conflicted copy 2026-11-13).json', JSON.stringify(workspace()));
    const result = await assessWorkspace(store, app);
    expect(result).toMatchObject({ compat: 'ok', sync: 'ok', writable: false });
    expect(result.problems).toEqual([
      {
        path: '_app/workspace (conflicted copy 2026-11-13).json',
        reason: 'conflicted-copy',
        originalPath: WORKSPACE_PATH,
      },
    ]);
  });

  it('uses the conflict rules it is given', async () => {
    const store = await cleanFolder();
    store.putRaw('_app/dati/user/u1 2.json', userJson('u1'));
    const plain = await assessWorkspace(store, app, [DROPBOX_CONFLICT_RULE]);
    expect(plain.problems).toEqual([{ path: '_app/dati/user/u1 2.json', reason: 'duplicate-id' }]);
    expect(plain.writable).toBe(true);
    const both = await assessWorkspace(store, app, [DROPBOX_CONFLICT_RULE, ICLOUD_TEST_RULE]);
    const icloud = {
      path: '_app/dati/user/u1 2.json',
      reason: 'conflicted-copy',
      originalPath: '_app/dati/user/u1.json',
    };
    expect(both.problems).toEqual([icloud]);
    // iCloud is a default rule now.
    expect((await assessWorkspace(store, app)).problems).toEqual([icloud]);
  });

  it('checks every kind of record in recordSchemas, such as tenancy', async () => {
    const store = await cleanFolder();
    store.putRaw('_app/dati/tenancy/t1 (conflicted copy 2026-11-13).json', '{}');
    const result = await assessWorkspace(store, app);
    expect(result.writable).toBe(false);
    expect(result.problems).toEqual([
      {
        path: '_app/dati/tenancy/t1 (conflicted copy 2026-11-13).json',
        reason: 'conflicted-copy',
        originalPath: '_app/dati/tenancy/t1.json',
      },
    ]);
  });

  it('is behind for an operation file cut short, and asks for a newer app for one from a newer app (G7)', async () => {
    const truncated = new MemoryStore();
    await truncated.writeJsonAtomic(WORKSPACE_PATH, workspace());
    truncated.putRaw(`${JOURNAL_DIR}/op.json`, '{"id": "op-1", "v": 1, "chan');
    const result = await assessWorkspace(truncated, app);
    expect(result).toMatchObject({ compat: 'ok', sync: 'behind', writable: false });
    expect(result.problems).toEqual([{ path: `${JOURNAL_DIR}/op.json`, reason: 'malformed-json' }]);
    expect(result.reasons).toEqual([
      { code: 'damaged-journal', paths: [`${JOURNAL_DIR}/op.json`] },
    ]);

    const future = await cleanFolder();
    future.putRaw(`${JOURNAL_DIR}/op.json`, JSON.stringify({ id: 'op-9', v: 2 }));
    expect(await assessWorkspace(future, app)).toMatchObject({
      sync: 'ok',
      writable: false,
      problems: [{ path: `${JOURNAL_DIR}/op.json`, reason: 'future-version' }],
      reasons: [{ code: 'newer-data', paths: [`${JOURNAL_DIR}/op.json`] }],
    });
  });

  it('blocks on a conflict copy of an operation, with the rules it is given', async () => {
    const store = await cleanFolder();
    const [name] = await store.list(JOURNAL_DIR);
    const stem = (name ?? '').slice(0, -'.json'.length);
    const text = store.getRaw(`${JOURNAL_DIR}/${name ?? ''}`) ?? '';
    store.putRaw(`${JOURNAL_DIR}/${stem} (conflicted copy).json`, text);
    store.putRaw(`${JOURNAL_DIR}/${stem} 2.json`, text);
    const plain = await assessWorkspace(store, app, [DROPBOX_CONFLICT_RULE]);
    expect(plain).toMatchObject({ sync: 'ok', writable: false });
    expect(plain.problems.map(({ path, reason }) => [path, reason])).toEqual([
      [`${JOURNAL_DIR}/${stem} (conflicted copy).json`, 'conflicted-copy'],
      [`${JOURNAL_DIR}/${stem} 2.json`, 'duplicate-id'],
    ]);
    const both = await assessWorkspace(store, app, [DROPBOX_CONFLICT_RULE, ICLOUD_TEST_RULE]);
    expect(both).toMatchObject({ sync: 'ok', writable: false });
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

  it('loadAll uses Dropbox and iCloud by default, and the rules it is given otherwise', async () => {
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
      'conflicted-copy',
    ]);
    const dropboxOnly = await loadAll(store, 'bill', BillSchema, {}, [DROPBOX_CONFLICT_RULE]);
    expect(dropboxOnly.problems.map((p) => p.reason)).toEqual(['conflicted-copy', 'id-mismatch']);
    const withRules = await loadAll(store, 'bill', BillSchema, {}, [
      DROPBOX_CONFLICT_RULE,
      ICLOUD_TEST_RULE,
    ]);
    expect(withRules.problems.map((p) => p.reason)).toEqual(['conflicted-copy', 'conflicted-copy']);
  });
});

describe('conflict copies of the review (revisione 2026-11-18, G2)', () => {
  const names = [
    "u1 (user2's conflicted copy 2026-11-05).json",
    'u1 (Copia in conflitto di user2 2026-11-05).json',
    'u1 (copia in conflitto di PC-WIN 05-11-2026).json',
    'u1 (Case Conflict).json',
    'u1 (Selective Sync Conflict).json',
    'u1 (conflicted copy 2026-11-05) (1).json',
    'u1 2.json',
  ];

  it('are all found by the default rules, with the original they come from', async () => {
    for (const name of names) {
      const store = await cleanFolder();
      store.putRaw(`_app/dati/user/${name}`, userJson('u1'));
      const result = await assessWorkspace(store, app);
      expect(result.writable).toBe(false);
      expect(result.problems).toEqual([
        {
          path: `_app/dati/user/${name}`,
          reason: 'conflicted-copy',
          originalPath: '_app/dati/user/u1.json',
        },
      ]);
    }
  });

  it('block every store through checkConsistency, also in the journal', async () => {
    const store = await cleanFolder();
    store.putRaw('_app/dati/user/u1 (Copia in conflitto di PC 2026-11-05).json', userJson('u1'));
    const problems = await checkConsistency(store);
    expect(problems.map(({ reason }) => reason)).toEqual(['conflicted-copy']);
    const apartment = { id: 'Nord', name: 'Nord', locatore: 'L', posti: 3 };
    const saved = await saveApartment(
      store,
      { ...apartment, annualitaStart: { month: 9, day: 1 }, condoDifferenceTo: 'tenants' },
      'u1',
      clock,
      ids(),
    );
    expect(saved).toEqual({ status: 'refused', reason: 'inconsistent-store' });
    const [op] = await store.list(JOURNAL_DIR);
    const journal = await cleanFolder();
    journal.putRaw(`${JOURNAL_DIR}/${(op ?? '').replace('.json', ' 2.json')}`, '{}');
    expect((await checkConsistency(journal)).map(({ reason }) => reason)).toEqual([
      'conflicted-copy',
    ]);
  });

  it('are not hit by the names the app writes', () => {
    for (const name of ['u1.json', '20261102T100000000Z-u1-op-12.json', 'apt-2.json']) {
      expect(DEFAULT_CONFLICT_RULES.some((rule) => rule.isConflictName(name))).toBe(false);
    }
  });
});
