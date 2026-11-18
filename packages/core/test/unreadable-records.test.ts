// A record the app cannot read never drops out of a calculation without a word (revisione
// 2026-11-18, G6). Probe T13: a bill with a category this app does not know, or with v 2, gave an
// Excel without that bill.
import { describe, expect, it } from 'vitest';
import {
  UnreadableRecordsError,
  isoDate,
  loadAccountBalances,
  loadDashboard,
  loadExcelInput,
  loadScadenzario,
  loadTaxTable,
  recordPath,
  recordSchemas,
  writeRecord,
} from '../src/index';
import { fixtureRecords } from './helpers/excel-fixture';
import type { StoreRecords } from './helpers/excel-fixture';
import { MemoryStore } from './helpers/memory-store';

async function build(mutate: (records: StoreRecords) => void = () => undefined) {
  const store = new MemoryStore();
  const records = fixtureRecords();
  mutate(records);
  for (const [kind, list] of Object.entries(records)) {
    for (const record of list ?? []) {
      await writeRecord(store, recordPath(kind, record.id), record, { expectedRev: null });
    }
  }
  return store;
}

const query = { apartmentId: 'apt-nord', periodLabel: '2026-27' };
const today = isoDate('2027-01-10');
const entryPoints: [string, (store: MemoryStore) => Promise<unknown>][] = [
  ['loadExcelInput', (store) => loadExcelInput(store, query)],
  ['loadDashboard', (store) => loadDashboard(store, { today, taxYear: '2026' })],
  ['loadTaxTable', (store) => loadTaxTable(store, { year: '2026', today })],
  ['loadScadenzario', (store) => loadScadenzario(store, { today })],
  ['loadAccountBalances', (store) => loadAccountBalances(store)],
];

describe('a record that cannot be read', () => {
  it('stops the Excel instead of leaving the bill out (T13)', async () => {
    const mutations: ((records: StoreRecords) => void)[] = [
      (r) => {
        r.bill = r.bill?.map((b, i) => (i === 0 ? { ...b, category: 'teleriscaldamento' } : b));
      },
      (r) => {
        r.bill = r.bill?.map((b, i) => (i === 0 ? { ...b, v: 2 } : b));
      },
    ];
    for (const mutate of mutations) {
      const failure = loadExcelInput(await build(mutate), query);
      await expect(failure).rejects.toBeInstanceOf(UnreadableRecordsError);
      await expect(failure).rejects.toMatchObject({ kind: 'bill' });
    }
  });

  it('of any kind makes every entry point refuse, or leaves its result unchanged', async () => {
    const baseline = new Map<string, unknown>();
    const clean = await build();
    for (const [name, run] of entryPoints) baseline.set(name, await run(clean));
    for (const [name, result] of baseline) {
      expect((result as { status?: string }).status, name).not.toBe('refused');
    }
    for (const kind of Object.keys(recordSchemas)) {
      for (const [name, run] of entryPoints) {
        const store = await build();
        store.putRaw(`_app/dati/${kind}/broken.json`, '{"id": "broken", "v": 2}');
        let outcome: unknown;
        try {
          outcome = await run(store);
        } catch (error) {
          expect(error, `${name} with a broken ${kind}`).toBeInstanceOf(UnreadableRecordsError);
          continue;
        }
        expect(outcome, `${name} read ${kind} without the broken one`).toEqual(baseline.get(name));
      }
    }
  });
});
