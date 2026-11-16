import { describe, expect, it } from 'vitest';
import {
  buildConguaglioWorkbook,
  commitChange,
  loadExcelInput,
  planMatch,
  recordPath,
  writeRecord,
  writeXlsx,
} from '../src/index';
import type { RecordKind } from '../src/index';
import { FIXTURE, fixtureInput } from './helpers/excel-fixture';
import { clock, ids, snapshot } from './helpers/income-year';
import { MemoryStore } from './helpers/memory-store';

const QUERY = { apartmentId: 'apt-nord', periodLabel: '2026-27' };

const account = {
  id: 'acc-nord',
  v: 1,
  rev: 1,
  apartmentId: 'apt-nord',
  label: 'Conto Nord',
  bankProfileId: 'bp-sintetico',
};
const statement = (id: string, from: string, to: string) => ({
  id,
  v: 1,
  rev: 1,
  accountId: 'acc-nord',
  bankProfileId: 'bp-sintetico',
  fileName: `${id}.xlsx`,
  suggestedPath: `Nord/Estratti/${id}.xlsx`,
  from,
  to,
  periodSource: 'file',
  rowCount: 0,
  transactionIds: [],
  held: [],
});

/**
 * The fixture as a store: every record except the assumed match (assumed matches are never
 * saved), one account and statements for October-December 2026 and July-September 2027, so the
 * gas bill of March 2027 has no statement and the water bill of July 2027 waits for its debit.
 */
async function fixtureStore(
  extra: Partial<Record<RecordKind, { id: string; rev: number }[]>> = {},
) {
  const store = new MemoryStore();
  const records: Partial<Record<RecordKind, { id: string; rev: number }[]>> = {
    apartment: FIXTURE.apartments,
    contract: FIXTURE.contracts,
    tenant: FIXTURE.tenants,
    tenancy: FIXTURE.tenancies,
    bill: FIXTURE.bills,
    instalment: FIXTURE.instalments,
    match: FIXTURE.matches.filter((m) => m.by !== 'assumed'),
    payment: FIXTURE.payments,
    account: [account],
    statement: [
      statement('st-1', '2026-10-01', '2026-12-31'),
      statement('st-2', '2027-07-01', '2027-09-30'),
    ],
    ...extra,
  };
  for (const [kind, list] of Object.entries(records) as [
    RecordKind,
    { id: string; rev: number }[],
  ][]) {
    for (const record of list) {
      await writeRecord(store, recordPath(kind, record.id), record, {
        expectedRev: null,
      });
    }
  }
  return store;
}

describe('loadExcelInput', () => {
  it('loads the apartment and the period, with the assumed matches of planMatch', async () => {
    const store = await fixtureStore();
    const before = await snapshot(store);
    const loaded = await loadExcelInput(store, QUERY);
    if (loaded.status !== 'ok') throw new Error(loaded.reason);
    expect(loaded.input.period).toEqual({ label: '2026-27', from: '2026-10', to: '2027-09' });
    expect(loaded.input.matches.filter((m) => m.by === 'assumed').map((m) => m.itemId)).toEqual([
      'bill-gas',
    ]);
    const gas = buildConguaglioWorkbook(loaded.input).sheets[0]?.rows.find(
      (r) => r[0]?.value === 'Gas',
    );
    expect(gas?.[6]).toEqual({ kind: 'text', value: 'assunta, non verificata' });
    // The same file as the one built from the fixture.
    expect(writeXlsx(buildConguaglioWorkbook(loaded.input))).toEqual(
      writeXlsx(buildConguaglioWorkbook(fixtureInput())),
    );
    expect(await snapshot(store)).toEqual(before);
  });

  it('leaves the gas bill pending once a statement covers its month', async () => {
    const store = await fixtureStore();
    await writeRecord(
      store,
      recordPath('statement', 'st-3'),
      statement('st-3', '2027-03-01', '2027-03-31'),
      { expectedRev: null },
    );
    const loaded = await loadExcelInput(store, QUERY);
    if (loaded.status !== 'ok') throw new Error(loaded.reason);
    const types = buildConguaglioWorkbook(loaded.input).sheets[0]?.rows.map((r) => r[0]?.value);
    expect(types).not.toContain('Gas');
  });

  it('keeps planMatch.run as it was', async () => {
    const plan = await planMatch(await fixtureStore());
    expect(plan.run.assumed).toEqual([{ itemType: 'bill', itemId: 'bill-gas' }]);
    expect(plan.assumedMatches.map((m) => m.id)).toEqual([
      'm-bill-bill-gas-amount-assumed-bill-gas',
    ]);
    expect('assumedMatches' in plan.run).toBe(false);
  });

  it.each([
    [
      'an unknown apartment',
      { apartmentId: 'apt-ovest', periodLabel: '2026-27' },
      'unknown-apartment',
    ],
    [
      'a deleted apartment',
      { apartmentId: 'apt-sud', periodLabel: '2026-27' },
      'unknown-apartment',
    ],
    [
      'a period of no contract',
      { apartmentId: 'apt-nord', periodLabel: '2030-31' },
      'unknown-period',
    ],
  ])('refuses %s, writing nothing', async (_, query, reason) => {
    const sud = FIXTURE.apartments.find((a) => a.id === 'apt-sud');
    const store = await fixtureStore({
      apartment: FIXTURE.apartments.map((a) => (a === sud ? { ...a, deleted: true } : a)),
    });
    const before = await snapshot(store);
    expect(await loadExcelInput(store, query)).toEqual({ status: 'refused', reason });
    expect(await snapshot(store)).toEqual(before);
  });

  it('refuses two contracts with the same label and other months', async () => {
    const [contract] = FIXTURE.contracts;
    const store = await fixtureStore({
      contract: [
        ...FIXTURE.contracts,
        { ...contract, id: 'ctr-nord-2', start: '2027-01', end: '2027-09' } as {
          id: string;
          rev: number;
        },
      ],
    });
    expect(await loadExcelInput(store, QUERY)).toEqual({
      status: 'refused',
      reason: 'ambiguous-period',
    });
  });

  it('refuses a store whose record diverged from the journal, writing nothing', async () => {
    const store = await fixtureStore();
    const tenant = FIXTURE.tenants[0];
    const path = recordPath('tenant', tenant?.id ?? '');
    await commitChange(
      store,
      {
        profileId: 'p1',
        kind: 'test.write',
        summary: 'Prova.',
        changes: [{ path, before: tenant, after: { ...tenant, rev: 2 } }],
      },
      clock,
      ids('op'),
    );
    store.putRaw(path, (store.getRaw(path) ?? '').replace('Anna Prova', 'Anna Diversa'));
    const before = await snapshot(store);
    expect(await loadExcelInput(store, QUERY)).toEqual({
      status: 'refused',
      reason: 'inconsistent-store',
    });
    expect(await snapshot(store)).toEqual(before);
  });
});
