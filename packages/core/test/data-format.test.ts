// Forward compatibility (revisione 2026-11-18, G3): an older app never writes over data a newer
// app wrote, and a change of the schemas cannot go in without raising DATA_FORMAT.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ApartmentSchema,
  CORE_VERSION,
  DATA_FORMAT,
  NewerDataError,
  assessWorkspace,
  commitChange,
  loadAll,
  raiseDataFormat,
  readJournal,
  recordPath,
  recordSchemas,
  saveApartment,
  undoOperation,
} from '../src/index';
import { dropsKeys } from '../src/store/load';
import { WORKSPACE_PATH } from '../src/store/store';
import { fixtureRecords } from './helpers/excel-fixture';
import { MemoryStore } from './helpers/memory-store';

/**
 * The fingerprint of the structure of docs/schemas (descriptions left out) for each data format.
 * When this test fails, the schemas changed: raise DATA_FORMAT in src/version.ts by one and add
 * its fingerprint here (keep the old ones), following the rule in
 * docs/revisione-2026-11-18-dati.md. A change of descriptions only does not change it.
 */
const FINGERPRINTS: Record<number, string> = {
  1: 'b3a6c89ee02f30219d3ab56ea958c3f8b8ca0d7c3ea3dcbfa345baee3423fea4',
  // Review of 18 Nov 2026 (missing functions): workspaceSettings and periodClose.
  2: '90d55b9eef75a2090c533eb1c80b206e9ef00232d0cb0fb61e18d577cf6ab918',
  // Redesign of the forks: the optional `supersedes` of an operation.
  3: '9dbc470c875f141eff3756792d79971ec84ae222f5361b5578852321032e3ebb',
  // Plan 20: sentOn, settled, supplementarySettled, reopened, history, inputs of a periodClose
  // and forfaitNonIncassato of its snapshot (decided by user1, 18 Nov; recomputed in round 2).
  4: '88f3a820d8731704bc87603b070125941d0897f03841715912da92854a27ff9e',
};

const SCHEMAS_DIR = fileURLToPath(new URL('../../../docs/schemas', import.meta.url));

function withoutDescriptions(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutDescriptions);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      // A `description` text, not a property of the record that happens to be called so.
      .filter(([key, item]) => key !== 'description' || typeof item !== 'string')
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => [key, withoutDescriptions(item)]),
  );
}

function schemasFingerprint(): string {
  const hash = createHash('sha256');
  for (const name of readdirSync(SCHEMAS_DIR).sort()) {
    if (!name.endsWith('.json')) continue;
    const schema: unknown = JSON.parse(readFileSync(join(SCHEMAS_DIR, name), 'utf8'));
    hash.update(`${name}\n${JSON.stringify(withoutDescriptions(schema))}\n`);
  }
  return hash.digest('hex');
}

describe('DATA_FORMAT', () => {
  it('has the fingerprint of the current docs/schemas', () => {
    expect(
      FINGERPRINTS[DATA_FORMAT],
      'docs/schemas changed: raise DATA_FORMAT and add its fingerprint',
    ).toBe(schemasFingerprint());
  });

  it('raising it is wired where the desktop opens a folder of an older format', () => {
    const firstRun = readFileSync(
      fileURLToPath(new URL('../../../apps/desktop/src/first-run.ts', import.meta.url)),
      'utf8',
    );
    expect(firstRun).toContain('raiseDataFormat(store)');
  });

  it('keeps a property called description in the fingerprint', () => {
    expect(withoutDescriptions({ properties: { description: { type: 'string' } } })).toEqual({
      properties: { description: { type: 'string' } },
    });
  });

  it('ignores descriptions in the fingerprint', () => {
    expect(
      withoutDescriptions({ b: 1, description: 'x', a: [{ description: 'y', c: 2 }] }),
    ).toEqual({ a: [{ c: 2 }], b: 1 });
  });
});

const clock = () => '2026-11-18T09:00:00.000Z';
function ids(prefix = 'op'): () => string {
  let n = 0;
  return () => `${prefix}-${String(++n)}`;
}
const workspace = (schemaVersion = DATA_FORMAT) => ({
  workspaceId: 'ws-1',
  name: 'Casa',
  schemaVersion,
  minAppVersion: CORE_VERSION,
  createdAt: clock(),
});
const apartment = {
  id: 'Nord',
  v: 1,
  rev: 1,
  name: 'Nord',
  locatore: 'L',
  posti: 3,
  annualitaStart: { month: 9, day: 1 },
  condoDifferenceTo: 'tenants',
};
const PATH = recordPath('apartment', 'Nord');

/** Probe T6: a newer app wrote the apartment with a field this app does not know. */
async function newerRecord(extra: Record<string, unknown>): Promise<MemoryStore> {
  const store = new MemoryStore();
  await store.writeJsonAtomic(WORKSPACE_PATH, workspace());
  await commitChange(
    store,
    {
      profileId: 'u1',
      kind: 'apartment.save',
      summary: 's',
      changes: [{ path: PATH, after: { ...apartment, ...extra } }],
    },
    clock,
    ids('new'),
  );
  return store;
}

describe('a record written by a newer app', () => {
  it('is read, reported as unknown-fields, and the folder is read-only', async () => {
    const store = await newerRecord({ campoNuovo: { importante: 123 } });
    const loaded = await loadAll(store, 'apartment', ApartmentSchema);
    expect(loaded.records.map(({ id }) => id)).toEqual(['Nord']);
    expect(loaded.problems).toEqual([{ path: PATH, reason: 'unknown-fields' }]);
    const assessed = await assessWorkspace(store, {
      version: CORE_VERSION,
      schemaVersion: DATA_FORMAT,
    });
    expect(assessed.writable).toBe(false);
    expect(assessed.reasons).toEqual([{ code: 'newer-data', paths: [PATH] }]);
  });

  it('is never written over by a save: the new field stays (T6)', async () => {
    const store = await newerRecord({ campoNuovo: { importante: 123 } });
    const text = store.getRaw(PATH);
    await expect(
      saveApartment(store, { id: 'Nord', rentLateDays: 4 }, 'u2', clock, ids(), {
        confirmed: true,
      }),
    ).rejects.toBeInstanceOf(NewerDataError);
    expect(store.getRaw(PATH)).toBe(text);
  });

  it('catches a new field in a nested object too', async () => {
    const store = await newerRecord({ annualitaStart: { month: 9, day: 1, hour: 3 } });
    await expect(
      saveApartment(store, { id: 'Nord', rentLateDays: 4 }, 'u2', clock, ids(), {
        confirmed: true,
      }),
    ).rejects.toThrow(/versione più nuova/);
  });

  it('is not written over by an undo either', async () => {
    const store = await newerRecord({ campoNuovo: 1 });
    const [operation] = (await readJournal(store)).operations;
    const text = store.getRaw(PATH);
    await expect(
      undoOperation(store, operation?.id ?? '', 'u2', clock, ids('undo')),
    ).rejects.toBeInstanceOf(NewerDataError);
    expect(store.getRaw(PATH)).toBe(text);
  });

  it('with v above 1 is never written over (T7)', async () => {
    const store = await newerRecord({ v: 2 });
    const raw = await store.readJson(PATH);
    await expect(
      commitChange(
        store,
        {
          profileId: 'u2',
          kind: 'k',
          summary: 's',
          changes: [{ path: PATH, before: raw, after: apartment }],
        },
        clock,
        ids('x'),
      ),
    ).rejects.toBeInstanceOf(NewerDataError);
  });
});

describe('a folder with a newer data format', () => {
  it('is refused by commitChange, writing nothing', async () => {
    const store = new MemoryStore();
    await store.writeJsonAtomic(WORKSPACE_PATH, workspace(DATA_FORMAT + 1));
    await expect(
      commitChange(
        store,
        { profileId: 'u1', kind: 'k', summary: 's', changes: [{ path: PATH, after: apartment }] },
        clock,
        ids(),
      ),
    ).rejects.toThrow(NewerDataError);
    expect(await store.list('_app/journal')).toEqual([]);
    expect(await store.readJson(PATH)).toBeUndefined();
  });

  it('raiseDataFormat leaves a folder at the current format as it is, and needs a workspace', async () => {
    const store = new MemoryStore();
    await expect(raiseDataFormat(store)).rejects.toThrow(RangeError);
    await store.writeJsonAtomic(WORKSPACE_PATH, workspace());
    expect(await raiseDataFormat(store)).toBe('unchanged');
  });
});

describe('the records the app writes', () => {
  it('have no key that their schema drops (no false unknown-fields)', () => {
    const schemas: Record<string, { parse(value: unknown): unknown }> = recordSchemas;
    for (const [kind, records] of Object.entries(fixtureRecords())) {
      const schema = schemas[kind];
      expect(schema, kind).toBeDefined();
      for (const record of records ?? []) {
        expect(dropsKeys(record, schema?.parse(record)), `${kind} ${String(record.id)}`).toBe(
          false,
        );
      }
    }
  });

  it('dropsKeys looks at every depth and ignores the keys parsing adds', () => {
    expect(dropsKeys({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(dropsKeys({ a: [{ x: 1, y: 2 }] }, { a: [{ x: 1 }] })).toBe(true);
    expect(dropsKeys({ a: { b: { c: 1 } } }, { a: { b: {} } })).toBe(true);
    expect(dropsKeys([1, 2], [1, 2])).toBe(false);
    expect(dropsKeys('x', 'x')).toBe(false);
  });
});
