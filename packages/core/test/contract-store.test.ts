import { describe, expect, it } from 'vitest';
import {
  ContractSchema,
  RentYearSchema,
  commitChange,
  isoDate,
  loadAll,
  loadContractChecks,
  loadRentYears,
  readJournal,
  recordPath,
  recordSchemas,
  saveContract,
  setContractRent,
  setRentYear,
  undoOperation,
  yearMonth,
} from '../src/index';
import type { ContractInput, RecordKind } from '../src/index';
import { cents } from '../src/money';
import { clock, ids, snapshot } from './helpers/income-year';
import { MemoryStore } from './helpers/memory-store';

// Invented names, amounts and registration codes only (plan 7, fixtures/README.md).
const base = { v: 1, rev: 1 };
const apartment = (id: string) => ({
  ...base,
  id,
  name: id,
  locatore: 'Locatore fittizio',
  posti: 5,
  annualitaStart: { month: 10, day: 1 },
});
const tenancy = (id: string, extra: Record<string, unknown> = {}) => ({
  ...base,
  id,
  apartmentId: 'app-a',
  tenantId: 'ten-anna',
  from: '2025-10',
  to: '2026-09',
  monthlyRent: 35000,
  monthlyForfait: 3000,
  ...extra,
});
const payment = (id: string, extra: Record<string, unknown> = {}) => ({
  ...base,
  id,
  apartmentId: 'app-a',
  tenantId: 'ten-anna',
  date: '2025-09-25',
  amount: 50000,
  confirmed: true,
  kind: 'caparra',
  source: 'manual',
  ...extra,
});

/** Writes records through the journal, as the app would. */
async function seed(
  store: MemoryStore,
  kind: RecordKind,
  records: ({ id: string } & Record<string, unknown>)[],
  prefix: string,
) {
  await commitChange(
    store,
    {
      profileId: 'p1',
      kind: 'test.seed',
      summary: 'Dati di prova.',
      changes: records.map((r) => ({
        path: recordPath(kind, r.id),
        after: recordSchemas[kind].parse(r),
      })),
    },
    clock,
    ids(prefix),
  );
}

async function fixtureStore() {
  const store = new MemoryStore();
  await seed(store, 'apartment', [apartment('app-a'), apartment('app-b')], 's1');
  await seed(
    store,
    'tenancy',
    [
      tenancy('tcy-a'),
      tenancy('tcy-b', { tenantId: 'ten-bruno' }),
      tenancy('tcy-early', { from: '2025-09' }),
      tenancy('tcy-del', { deleted: true }),
      tenancy('tcy-lov', { apartmentId: 'app-b' }),
    ],
    's2',
  );
  await seed(
    store,
    'payment',
    [
      payment('pay-c1'),
      payment('pay-rent', { kind: 'canone' }),
      payment('pay-del', { deleted: true }),
      payment('pay-lov', { apartmentId: 'app-b' }),
    ],
    's3',
  );
  return store;
}

const contract = (extra: Partial<ContractInput> = {}): ContractInput =>
  ({
    id: 'ctr-app-a',
    apartmentId: 'app-a',
    type: '1+1',
    start: '2025-10',
    end: '2027-09',
    settlement: 'annuale',
    agreedRent: true,
    forStudents: true,
    durationMonths: 12,
    signedOn: '2025-09-20',
    registration: { code: 'CODICE-PROVA-0001', date: '2025-10-10' },
    taxRegime: 'cedolare',
    cedolareRateBp: 1000,
    tenancyIds: ['tcy-a'],
    depositPaymentIds: ['pay-c1'],
    ...extra,
  }) as ContractInput;
const save = (store: MemoryStore, input: ContractInput, prefix = 'c') =>
  saveContract(store, input, 'p1', clock, ids(prefix));
const rent = (
  store: MemoryStore,
  from: string,
  prefix = 'r',
  monthlyRent = 160000,
  monthlyAdvance = 15000,
) =>
  setContractRent(
    store,
    {
      contractId: 'ctr-app-a',
      from: yearMonth(from),
      monthlyRent: cents(monthlyRent),
      monthlyAdvance: cents(monthlyAdvance),
    },
    'p1',
    clock,
    ids(prefix),
  );
const contracts = async (store: MemoryStore) =>
  (await loadAll(store, 'contract', ContractSchema, { includeDeleted: true })).records;
const refused = (reason: string) => ({ status: 'refused', reason });

describe('saveContract (plan 7, task 2)', () => {
  it('saves, then writes nothing for the same request', async () => {
    const store = await fixtureStore();
    expect(await save(store, contract())).toEqual({
      status: 'saved',
      operationId: 'c-1',
      contractId: 'ctr-app-a',
    });
    const op = (await readJournal(store)).operations.find((o) => o.id === 'c-1');
    expect(op).toMatchObject({
      kind: 'contract.save',
      apartmentId: 'app-a',
      summary: 'Contratto salvato.',
    });
    expect(op?.summary).not.toMatch(/CODICE|[0-9]/);
    expect(await contracts(store)).toEqual([{ ...contract(), v: 1, rev: 1 }]);
    const before = await snapshot(store);
    expect(await save(store, contract(), 'd')).toEqual({
      status: 'unchanged',
      contractId: 'ctr-app-a',
    });
    expect(await snapshot(store)).toEqual(before);
  });

  it('keeps the rent history on update; refuses dates that leave an entry out', async () => {
    const store = await fixtureStore();
    await save(store, contract());
    await rent(store, '2025-10', 'r');
    await rent(store, '2026-10', 's', 165000);
    const [withRent] = await contracts(store);
    const registration = { code: 'CODICE-PROVA-0001', date: isoDate('2025-10-11') };
    expect(await save(store, contract({ registration }), 'd')).toMatchObject({ status: 'saved' });
    const [updated] = await contracts(store);
    expect(updated).toMatchObject({ rev: 4, registration });
    expect(updated?.rent).toEqual(withRent?.rent);
    const before = await snapshot(store);
    expect(await save(store, contract({ end: yearMonth('2026-09') }), 'e')).toEqual(
      refused('rent-outside-contract'),
    );
    expect(await snapshot(store)).toEqual(before);
  });

  it('keeps the takeovers on update (plan 11): only a takeover writes them', async () => {
    const store = await fixtureStore();
    const takeovers = [{ month: '2026-03', outTenancyId: 'tcy-a', inTenancyId: 'tcy-b' }];
    await seed(store, 'contract', [{ ...base, ...contract(), takeovers }], 't');
    expect(await save(store, contract({ tenancyIds: ['tcy-a', 'tcy-b'] }))).toMatchObject({
      status: 'saved',
    });
    expect((await contracts(store))[0]?.takeovers).toEqual(takeovers); // Leaving a tenancy of the takeover out of tenancyIds is refused, nothing written.
    const before = await snapshot(store);
    expect(await save(store, contract({ tenancyIds: ['tcy-a'] }), 'd')).toEqual(
      refused('takeover-unlinked'),
    );
    expect(await save(store, contract({ tenancyIds: undefined }), 'e')).toEqual(
      refused('takeover-unlinked'),
    );
    expect(await snapshot(store)).toEqual(before);
  });

  it('saves a tenancy outside the dates and leaves it unchanged (Review Focus 1)', async () => {
    const store = await fixtureStore();
    const tenancyPath = recordPath('tenancy', 'tcy-early');
    const tenancyBefore = store.getRaw(tenancyPath);
    expect(await save(store, contract({ tenancyIds: ['tcy-early'] }))).toMatchObject({
      status: 'saved',
    });
    expect(store.getRaw(tenancyPath)).toBe(tenancyBefore);
  });

  it('refusals write nothing', async () => {
    const store = await fixtureStore();
    const before = await snapshot(store);
    for (const [input, reason] of [
      [contract({ apartmentId: 'nessuno' }), 'unknown-apartment'],
      [contract({ tenancyIds: ['tcy-nessuna'] }), 'unknown-tenancy'],
      [contract({ tenancyIds: ['tcy-del'] }), 'unknown-tenancy'],
      [contract({ tenancyIds: ['tcy-lov'] }), 'unknown-tenancy'],
      [contract({ depositPaymentIds: ['pay-rent'] }), 'unknown-deposit'],
      [contract({ depositPaymentIds: ['pay-del'] }), 'unknown-deposit'],
      [contract({ depositPaymentIds: ['pay-lov'] }), 'unknown-deposit'],
      [contract({ depositPaymentIds: ['pay-nessuno'] }), 'unknown-deposit'],
    ] as const) {
      expect(await save(store, input)).toEqual(refused(reason));
    }
    expect(await snapshot(store)).toEqual(before);
  });

  it('an input the schema refuses is invalid-contract, never an exception', async () => {
    const store = await fixtureStore();
    const before = await snapshot(store);
    const withExtra = (extra: Record<string, unknown>) =>
      ({ ...contract(), ...extra }) as unknown as ContractInput;
    for (const input of [
      contract({ start: yearMonth('2027-10') }),
      contract({ taxRegime: 'ordinario' }),
      contract({ taxRegime: undefined }),
      contract({ tenancyIds: ['tcy-a', 'tcy-a'] }),
      contract({ depositPaymentIds: ['pay-c1', 'pay-c1'] }),
      withExtra({ rent: [{ from: '2025-10', monthlyRent: 1, monthlyAdvance: 0 }] }),
      withExtra({ deleted: true }),
      withExtra({ takeovers: [] }),
      withExtra({ type: '2+2' }),
    ]) {
      expect(await save(store, input)).toEqual(refused('invalid-contract'));
    }
    expect(await snapshot(store)).toEqual(before);
  });

  it('a diverged store is inconsistent-store, nothing written', async () => {
    const store = await fixtureStore();
    const path = recordPath('tenancy', 'tcy-a');
    store.putRaw(path, (store.getRaw(path) ?? '').replace('ten-anna', 'ten-altro'));
    const before = await snapshot(store);
    expect(await save(store, contract())).toEqual(refused('inconsistent-store'));
    expect(await rent(store, '2025-10')).toEqual(refused('inconsistent-store'));
    expect(await snapshot(store)).toEqual(before);
  });
});

describe('setContractRent (plan 7, task 2)', () => {
  it('adds in order, replaces the same month, writes nothing for the same entry', async () => {
    const store = await fixtureStore();
    await save(store, contract());
    expect(await rent(store, '2026-10', 'r', 165000)).toEqual({
      status: 'saved',
      operationId: 'r-1',
      contractId: 'ctr-app-a',
    });
    const op = (await readJournal(store)).operations.find((o) => o.id === 'r-1');
    expect(op).toMatchObject({
      kind: 'contract.rent',
      apartmentId: 'app-a',
      summary: 'Aggiornato il canone di un contratto.',
    });
    expect(await rent(store, '2025-10', 's')).toMatchObject({ status: 'saved' });
    const before = await snapshot(store);
    expect(await rent(store, '2025-10', 't')).toEqual({
      status: 'unchanged',
      contractId: 'ctr-app-a',
    });
    expect(await snapshot(store)).toEqual(before);
    expect(await rent(store, '2025-10', 'u', 158000)).toMatchObject({ status: 'saved' });
    expect((await contracts(store))[0]?.rent).toEqual([
      { from: '2025-10', monthlyRent: 158000, monthlyAdvance: 15000 },
      { from: '2026-10', monthlyRent: 165000, monthlyAdvance: 15000 },
    ]);
  });

  it('refusals write nothing', async () => {
    const store = await fixtureStore();
    await save(store, contract());
    const before = await snapshot(store);
    expect(await rent(store, '2025-09')).toEqual(refused('month-outside-contract'));
    expect(await rent(store, '2027-10')).toEqual(refused('month-outside-contract'));
    expect(await rent(store, '2025-10', 'r', 0)).toEqual(refused('bad-amount'));
    expect(await rent(store, '2025-10', 'r', 160000, -1)).toEqual(refused('bad-amount'));
    expect(
      await setContractRent(
        store,
        {
          contractId: 'ctr-nessuno',
          from: yearMonth('2025-10'),
          monthlyRent: cents(1),
          monthlyAdvance: cents(0),
        },
        'p1',
        clock,
        ids('x'),
      ),
    ).toEqual(refused('unknown-contract'));
    expect(await snapshot(store)).toEqual(before);
  });

  it('a deleted contract is unknown-contract', async () => {
    const store = await fixtureStore();
    await save(store, contract());
    await undoOperation(store, 'c-1', 'p1', clock, ids('u'));
    expect(await rent(store, '2025-10')).toEqual(refused('unknown-contract'));
  });
});

describe('undoing the contract operations (plan 7, task 2)', () => {
  it('undo of contract.rent removes the entry', async () => {
    const store = await fixtureStore();
    await save(store, contract());
    await rent(store, '2025-10', 'r');
    await rent(store, '2026-10', 's', 165000);
    await undoOperation(store, 's-1', 'p1', clock, ids('u'));
    expect((await contracts(store))[0]?.rent).toEqual([
      { from: '2025-10', monthlyRent: 160000, monthlyAdvance: 15000 },
    ]);
  });

  it('undo of a creation deletes it; saving again brings it back with a new rev', async () => {
    const store = await fixtureStore();
    await save(store, contract());
    await undoOperation(store, 'c-1', 'p1', clock, ids('u'));
    expect(await contracts(store)).toMatchObject([{ id: 'ctr-app-a', deleted: true }]);
    expect(await save(store, contract(), 'd')).toMatchObject({ status: 'saved' });
    const [back] = await contracts(store);
    expect(back).toMatchObject({ rev: 3 });
    expect(back).not.toHaveProperty('deleted');
  });

  it('undo of an update puts the previous content back', async () => {
    const store = await fixtureStore();
    await save(store, contract());
    const [first] = await contracts(store);
    await save(store, contract({ durationMonths: 24 }), 'd');
    await undoOperation(store, 'd-1', 'p1', clock, ids('u'));
    const [back] = await contracts(store);
    expect({ ...back, rev: 1 }).toEqual(first);
  });
});

describe('loadContractChecks (plan 7, task 3)', () => {
  const asOf = yearMonth('2026-11');

  it('computes the checks of the live records and writes nothing', async () => {
    const store = await fixtureStore();
    await save(store, contract({ tenancyIds: ['tcy-a', 'tcy-early'] }));
    await seed(
      store,
      'contract',
      [
        {
          ...contract({
            id: 'ctr-lov',
            apartmentId: 'app-b',
            tenancyIds: [],
            depositPaymentIds: [],
          }),
          v: 1,
          rev: 1,
        },
      ],
      's4',
    );
    const before = await snapshot(store);
    const result = await loadContractChecks(store, { asOf });
    expect(await snapshot(store)).toEqual(before);
    expect(result.status).toBe('computed');
    if (result.status !== 'computed') return;
    expect(result.contracts.map((c) => c.id)).toEqual(['ctr-app-a', 'ctr-lov']);
    expect(result.checks).toEqual([
      { code: 'tenancy-outside-contract', contractId: 'ctr-app-a', tenancyId: 'tcy-early' },
      { code: 'unlinked-tenancy', contractId: 'ctr-app-a', tenancyId: 'tcy-b' },
      { code: 'unlinked-tenancy', contractId: 'ctr-lov', tenancyId: 'tcy-lov' },
    ]);
    const aptB = await loadContractChecks(store, { asOf, apartmentId: 'app-b' });
    expect(aptB).toEqual({
      status: 'computed',
      contracts: [expect.objectContaining({ id: 'ctr-lov' })],
      checks: [{ code: 'unlinked-tenancy', contractId: 'ctr-lov', tenancyId: 'tcy-lov' }],
    });
  });

  it('a diverged store is inconsistent-store', async () => {
    const store = await fixtureStore();
    const path = recordPath('tenancy', 'tcy-a');
    store.putRaw(path, (store.getRaw(path) ?? '').replace('ten-anna', 'ten-altro'));
    const before = await snapshot(store);
    expect(await loadContractChecks(store, { asOf })).toEqual(refused('inconsistent-store'));
    expect(await snapshot(store)).toEqual(before);
  });
});

describe('setRentYear and loadRentYears (user1, question 1 of plan 7, R182)', () => {
  const write = (store: MemoryStore, totalRent: number, prefix = 'y', apartmentId = 'app-a') =>
    setRentYear(
      store,
      { apartmentId, year: '2026', totalRent: cents(totalRent) },
      'p1',
      clock,
      ids(prefix),
    );

  it('saves the rents of the year typed by user1, then writes nothing for the same total', async () => {
    const store = await fixtureStore();
    expect(await write(store, 1935000)).toEqual({
      status: 'saved',
      operationId: 'y-1',
      rentYearId: 'rent-app-a-2026',
    });
    const op = (await readJournal(store)).operations.find((o) => o.id === 'y-1');
    expect(op).toMatchObject({ kind: 'rent.year', apartmentId: 'app-a' });
    expect(op?.summary).toBe('Aggiornati gli affitti di un anno.'); // no amount in a summary
    const before = await snapshot(store);
    expect(await write(store, 1935000, 'z')).toEqual({
      status: 'unchanged',
      rentYearId: 'rent-app-a-2026',
    });
    expect(await snapshot(store)).toEqual(before);
    expect(await write(store, 1950000, 'w')).toMatchObject({ status: 'saved' });
    await undoOperation(store, 'w-1', 'p1', clock, ids('u'));
    // Undo of the creation marks it deleted; saving again brings it back with a new rev.
    await undoOperation(store, 'y-1', 'p1', clock, ids('v'));
    const stored = async () =>
      (await loadAll(store, 'rentYear', RentYearSchema, { includeDeleted: true })).records[0];
    const gone = await stored();
    expect(gone).toMatchObject({ deleted: true });
    expect(await write(store, 1935000, 'b')).toMatchObject({ status: 'saved' });
    const back = await stored();
    expect(back?.rev).toBe((gone?.rev ?? 0) + 1);
    expect(back).not.toHaveProperty('deleted');
    const years = await loadRentYears(store, {});
    expect(years).toEqual({
      status: 'computed',
      rentYears: [{ apartmentId: 'app-a', year: '2026', totalRent: 1935000 }],
    });
  });

  it('refusals write nothing', async () => {
    const store = await fixtureStore();
    const before = await snapshot(store);
    expect(await write(store, 0)).toEqual(refused('bad-amount'));
    expect(await write(store, -1)).toEqual(refused('bad-amount'));
    expect(await write(store, 1000, 'y', 'nessuno')).toEqual(refused('unknown-apartment'));
    expect(
      await setRentYear(
        store,
        { apartmentId: 'app-a', year: '26', totalRent: cents(1000) },
        'p1',
        clock,
        ids('y'),
      ),
    ).toEqual(refused('bad-year'));
    expect(await snapshot(store)).toEqual(before);
    const path = recordPath('tenancy', 'tcy-a');
    store.putRaw(path, (store.getRaw(path) ?? '').replace('ten-anna', 'ten-altro'));
    expect(await write(store, 1000)).toEqual(refused('inconsistent-store'));
    expect(await loadRentYears(store, {})).toEqual(refused('inconsistent-store'));
  });

  it('the estimate uses the rate of the contracts, by apartment and year', async () => {
    const store = await fixtureStore();
    await save(store, contract());
    await write(store, 1935000);
    await write(store, 1000000, 'l', 'app-b');
    expect(await loadRentYears(store, { apartmentId: 'app-a' })).toEqual({
      status: 'computed',
      rentYears: [
        {
          apartmentId: 'app-a',
          year: '2026',
          totalRent: 1935000,
          cedolareRateBp: 1000,
          cedolareExpected: 193500,
        },
      ],
    });
    // No cedolare contract for Appartamento B: the total only.
    expect(await loadRentYears(store, { apartmentId: 'app-b' })).toEqual({
      status: 'computed',
      rentYears: [{ apartmentId: 'app-b', year: '2026', totalRent: 1000000 }],
    });
  });
});
