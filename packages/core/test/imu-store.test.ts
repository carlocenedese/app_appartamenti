import { describe, expect, it } from 'vitest';
import {
  ImuRuleSchema,
  ImuYearSchema,
  MovementClassSchema,
  assignImuF24,
  confirmOutgoing,
  excludeMovement,
  loadAll,
  planOutgoing,
  readJournal,
  recordPath,
  recordSchemas,
  runReconciliation,
  setImuYear,
  undoOperation,
} from '../src/index';
import type { RecordKind, SetImuYearInput } from '../src/index';
import { cents } from '../src/money';
import { clock, ids, snapshot } from './helpers/income-year';
import { MemoryStore } from './helpers/memory-store';

// Invented amounts only (plan 3d, decision 1): the real IMU totals never enter the repository.
const base = { v: 1, rev: 1 };
const apartment = (id: string) => ({
  ...base,
  id,
  name: id,
  locatore: 'Locatore fittizio',
  posti: 2,
  annualitaStart: { month: 1, day: 1 },
});

async function put(
  store: MemoryStore,
  kind: RecordKind,
  records: ({ id: string } & Record<string, unknown>)[],
) {
  for (const r of records) {
    await store.writeJsonAtomic(recordPath(kind, r.id), recordSchemas[kind].parse(r));
  }
}
async function apartments() {
  const store = new MemoryStore();
  await put(store, 'apartment', [apartment('berchet'), apartment('lovarini')]);
  return store;
}
const berchet = (extra: Partial<SetImuYearInput> = {}): SetImuYearInput => ({
  apartmentId: 'berchet',
  year: '2026',
  f24Group: 'berchet-lovarini',
  rates: [{ index: 1 }, { index: 2 }],
  ...extra,
});
const save = (store: MemoryStore, input: SetImuYearInput, prefix = 'e') =>
  setImuYear(store, input, 'p1', clock, ids(prefix));
const years = async (store: MemoryStore) =>
  (await loadAll(store, 'imuYear', ImuYearSchema, { includeDeleted: true })).records;

describe('setImuYear (plan 3d, task 1)', () => {
  it('saves, updates with a new rev, and writes nothing for the same request again', async () => {
    const store = await apartments();
    expect(await save(store, berchet())).toEqual({
      status: 'saved',
      operationId: 'e-1',
      imuYearId: 'imu-berchet-2026',
    });
    const [op] = (await readJournal(store)).operations;
    expect(op).toMatchObject({
      kind: 'imu.expected',
      apartmentId: 'berchet',
      summary: 'Aggiornati gli importi IMU attesi.',
    });
    const update = berchet({ rates: [{ index: 1, expected: cents(60000) }, { index: 2 }] });
    expect(await save(store, update, 'f')).toMatchObject({ status: 'saved', operationId: 'f-1' });
    expect(await years(store)).toEqual([
      {
        ...base,
        rev: 2,
        id: 'imu-berchet-2026',
        apartmentId: 'berchet',
        year: '2026',
        f24Group: 'berchet-lovarini',
        rates: [{ index: 1, expected: 60000 }, { index: 2 }],
      },
    ]);
    const before = await snapshot(store);
    expect(await save(store, update, 'g')).toEqual({
      status: 'unchanged',
      imuYearId: 'imu-berchet-2026',
    });
    expect(await snapshot(store)).toEqual(before);
  });

  it('a deleted record comes back with a new rev', async () => {
    const store = await apartments();
    await put(store, 'imuYear', [
      {
        ...base,
        rev: 3,
        deleted: true,
        id: 'imu-berchet-2026',
        apartmentId: 'berchet',
        year: '2026',
        f24Group: 'berchet-lovarini',
        rates: [{ index: 1 }, { index: 2 }],
      },
    ]);
    expect(await save(store, berchet())).toMatchObject({ status: 'saved' });
    const [saved] = await years(store);
    expect(saved).toMatchObject({ rev: 4 });
    expect(saved).not.toHaveProperty('deleted');
  });

  it('an annual total without amounts per rate is saved (question 10, data only)', async () => {
    const store = await apartments();
    expect(await save(store, berchet({ annualTotal: cents(130000) }))).toMatchObject({
      status: 'saved',
    });
    expect((await years(store))[0]).toMatchObject({ annualTotal: 130000 });
  });

  it('refusals write nothing', async () => {
    const store = await apartments();
    await save(store, berchet());
    const before = await snapshot(store);
    const refused = (reason: string) => ({ status: 'refused', reason });
    const three = { index: 3 };
    expect(
      await save(store, {
        ...berchet({ rates: [{ index: 1 }, { index: 2 }, three] }),
        apartmentId: 'lovarini',
      }),
    ).toEqual(refused('rates-mismatch'));
    expect(await save(store, berchet({ apartmentId: 'nessuno' }))).toEqual(
      refused('unknown-apartment'),
    );
    expect(await save(store, berchet({ rates: [{ index: 1 }, three] }))).toEqual(
      refused('bad-rates'),
    );
    expect(await save(store, berchet({ rates: [] }))).toEqual(refused('bad-rates'));
    expect(await save(store, berchet({ rates: [{ index: 1, expected: cents(0) }] }))).toEqual(
      refused('bad-rates'),
    );
    expect(await save(store, berchet({ annualTotal: cents(-1) }))).toEqual(refused('bad-rates'));
    expect(await snapshot(store)).toEqual(before);

    // Another year or another group: no mismatch.
    expect(
      await save(store, { ...berchet({ year: '2027', rates: [three] }), apartmentId: 'lovarini' }),
    ).toEqual(refused('bad-rates'));
    expect(
      await save(
        store,
        {
          ...berchet({ f24Group: 'solo-lovarini', rates: [{ index: 1 }] }),
          apartmentId: 'lovarini',
        },
        'x',
      ),
    ).toMatchObject({ status: 'saved' });
  });

  it('a diverged store is inconsistent-store, nothing written', async () => {
    const store = await apartments();
    await save(store, berchet());
    const path = recordPath('imuYear', 'imu-berchet-2026');
    store.putRaw(path, (store.getRaw(path) ?? '').replace('berchet-lovarini', 'altro-gruppo'));
    const before = await snapshot(store);
    expect(await save(store, berchet({ annualTotal: cents(1000) }), 'h')).toEqual({
      status: 'refused',
      reason: 'inconsistent-store',
    });
    expect(await snapshot(store)).toEqual(before);
  });
});

describe('assignImuF24 (plan 3d, task 2)', () => {
  // Own accounts of fixtures/README.md; an invented F24 description and invented amounts.
  const account = (id: string, iban: string) => ({
    ...base,
    id: `acc-${id}`,
    apartmentId: id,
    label: 'Conto',
    bankProfileId: 'bp',
    iban,
  });
  const profile = {
    ...base,
    id: 'bp',
    bank: 'Banca inventata',
    validFrom: '2020-01-01',
    container: 'csv',
    header: { allOf: ['Data'] },
    columns: { date: 'Data', description: ['Descrizione'], amount: 'Importo' },
    dateFormat: 'DD/MM/YYYY',
    f24Pattern: '^PAGAMENTO F24\\b',
  };
  const f24 = (id: string, date: string, amount: number, where = 'berchet') => ({
    ...base,
    id,
    apartmentId: where,
    accountId: `acc-${where}`,
    date,
    amount,
    description: 'PAGAMENTO F24 DELEGA 0001',
    statementHash: 's',
  });
  const imuYear = (apartmentId: string, f24Group = 'berchet-lovarini') => ({
    ...base,
    id: `imu-${apartmentId}-2026`,
    apartmentId,
    year: '2026',
    f24Group,
    rates: [{ index: 1 }, { index: 2 }],
  });
  async function f24Store() {
    const store = new MemoryStore();
    await put(store, 'apartment', ['berchet', 'lovarini', 'pulci'].map(apartment));
    await put(store, 'account', [
      account('berchet', 'IT85X0542811101000000000301'),
      account('lovarini', 'IT09X0542811101000000000311'),
    ]);
    await put(store, 'bankProfile', [profile]);
    await put(store, 'imuYear', [
      imuYear('berchet'),
      imuYear('lovarini'),
      imuYear('pulci', 'pulci'),
    ]);
    await put(store, 'transaction', [
      f24('f', '2026-06-14', -100000),
      f24('g', '2026-06-20', -100000),
    ]);
    return store;
  }
  const rate1 = { f24Group: 'berchet-lovarini', year: '2026', rateIndex: 1 };
  const assign = (
    store: MemoryStore,
    extra: Partial<typeof rate1> & { transactionId?: string } = {},
    prefix = 'a',
  ) => assignImuF24(store, { transactionId: 'f', ...rate1, ...extra }, 'p1', clock, ids(prefix));
  const classes = async (store: MemoryStore) =>
    (await loadAll(store, 'movementClass', MovementClassSchema, { includeDeleted: true })).records;
  const proposalIds = async (store: MemoryStore) =>
    (await planOutgoing(store)).proposals.map((p) => p.id);
  const confirmF24 = (store: MemoryStore, apartmentId: string, transactionId = 'f') =>
    confirmOutgoing(
      store,
      {
        proposalId: `p-f24-${transactionId}`,
        kind: 'tasse',
        apartmentId,
        rememberRule: true,
        f24: true,
      },
      'p1',
      clock,
      ids('c'),
    );
  const refused = (reason: string) => ({ status: 'refused', reason });

  it('from the p-f24- proposal: the class tasse, f24, the apartment of the account, the rate', async () => {
    const store = await f24Store();
    expect(await proposalIds(store)).toEqual(['p-f24-f', 'p-f24-g']);
    expect(await assign(store)).toEqual({
      status: 'assigned',
      operationId: 'a-1',
      classId: 'mc-f',
    });
    expect(await classes(store)).toEqual([
      {
        ...base,
        id: 'mc-f',
        transactionId: 'f',
        kind: 'tasse',
        apartmentId: 'berchet',
        f24: true,
        imu: rate1,
      },
    ]);
    const [op] = (await readJournal(store)).operations;
    expect(op).toMatchObject({
      kind: 'imu.assign',
      apartmentId: 'berchet',
      summary: 'Assegnato un F24 a una rata IMU.',
    });
    expect(await proposalIds(store)).toEqual(['p-f24-g']);

    // Undone: the class is deleted and the proposal comes back.
    await undoOperation(store, 'a-1', 'p1', clock, ids('u'));
    expect(await classes(store)).toMatchObject([{ id: 'mc-f', deleted: true }]);
    expect(await proposalIds(store)).toEqual(['p-f24-f', 'p-f24-g']);
  });

  it('from an F24 confirmed «da ripartire»: the same class with rev + 1; undone, without imu', async () => {
    const store = await f24Store();
    expect(await confirmF24(store, 'berchet')).toMatchObject({ status: 'confirmed' });
    expect(await assign(store)).toEqual({
      status: 'assigned',
      operationId: 'a-1',
      classId: 'mc-f',
    });
    expect(await classes(store)).toEqual([
      expect.objectContaining({
        id: 'mc-f',
        rev: 2,
        f24: true,
        apartmentId: 'berchet',
        imu: rate1,
      }),
    ]);
    // The confirmation under the assignment is not undone without cascade (same path).
    await expect(undoOperation(store, 'c-1', 'p1', clock, ids('u'))).rejects.toThrow(
      /depend on it/,
    );
    await undoOperation(store, 'a-1', 'p1', clock, ids('v'));
    const [back] = await classes(store);
    expect(back).toMatchObject({ id: 'mc-f', rev: 3, f24: true, apartmentId: 'berchet' });
    expect(back).not.toHaveProperty('imu');
  });

  it('refusals write nothing (Review Focus 2)', async () => {
    const store = await f24Store();
    // F24 confirmed in full for Lovarini (question 5 of 3c): no IMU candidate.
    await confirmF24(store, 'lovarini', 'g');
    await put(store, 'transaction', [
      { ...f24('gone', '2026-06-21', -100000), deleted: true },
      { ...f24('plain', '2026-06-22', -100000), description: 'BONIFICO INVENTATO' },
    ]);
    const before = await snapshot(store);
    for (const transactionId of ['g', 'gone', 'plain', 'nessuno']) {
      expect([transactionId, await assign(store, { transactionId })]).toEqual([
        transactionId,
        refused('not-imu-candidate'),
      ]);
    }
    expect(await assign(store, { rateIndex: 3 })).toEqual(refused('unknown-rate'));
    expect(await assign(store, { year: '2027' })).toEqual(refused('unknown-rate'));
    expect(await assign(store, { f24Group: 'pulci' })).toEqual(refused('payer-not-in-group'));
    expect(await snapshot(store)).toEqual(before);

    // A second F24 on the same rate (question 9), and one already assigned.
    await assign(store, {}, 'b');
    await put(store, 'transaction', [f24('h', '2026-06-25', -100000)]);
    const after = await snapshot(store);
    expect(await assign(store, { transactionId: 'h' })).toEqual(refused('rate-already-paid'));
    expect(await assign(store, { rateIndex: 2 })).toEqual(refused('not-imu-candidate'));
    // The same assignment again: unchanged, nothing written.
    expect(await assign(store, {}, 'z')).toEqual({ status: 'unchanged', classId: 'mc-f' });
    expect(await snapshot(store)).toEqual(after);
  });

  it('an excluded movement is no candidate; an assigned one is not excluded', async () => {
    const store = await f24Store();
    await excludeMovement(store, { transactionId: 'g', reason: 'doppione' }, 'p1', clock, ids('x'));
    expect(await assign(store, { transactionId: 'g' })).toEqual(refused('not-imu-candidate'));
    await assign(store);
    expect(
      await excludeMovement(
        store,
        { transactionId: 'f', reason: 'doppione' },
        'p1',
        clock,
        ids('y'),
      ),
    ).toEqual(refused('already-classified'));
  });

  it('a diverged store is inconsistent-store, nothing written', async () => {
    const store = await f24Store();
    await confirmF24(store, 'berchet', 'g');
    const path = recordPath('movementClass', 'mc-g');
    store.putRaw(path, (store.getRaw(path) ?? '').replace('berchet', 'lovarini'));
    const before = await snapshot(store);
    expect(await assign(store)).toEqual(refused('inconsistent-store'));
    expect(await snapshot(store)).toEqual(before);
  });

  it('no run of the reconciliation writes an IMU rate (decision 6)', async () => {
    const store = await f24Store();
    await assign(store);
    await runReconciliation(store, 'p1', clock, ids('r'));
    const withImu = (await classes(store)).filter((c) => c.imu !== undefined);
    expect(withImu.map((c) => c.id)).toEqual(['mc-f']);
    expect(
      (await readJournal(store)).operations
        .filter((o) => o.kind !== 'imu.assign')
        .flatMap((o) => o.changes)
        .some((c) => JSON.stringify(c.after).includes('"imu"')),
    ).toBe(false);
  });

  describe('the learnt rule (plan 3d, task 5; answers of user1 to questions 7 and 8)', () => {
    const rules = async (store: MemoryStore) =>
      (await loadAll(store, 'imuRule', ImuRuleSchema, { includeDeleted: true })).records;
    const remember = (
      store: MemoryStore,
      extra: Partial<typeof rate1> & { transactionId?: string } = {},
      prefix = 'a',
    ) =>
      assignImuF24(
        store,
        { transactionId: 'f', ...rate1, ...extra, rememberRule: true },
        'p1',
        clock,
        ids(prefix),
      );
    const suggestionOf = async (store: MemoryStore, transactionId: string) =>
      (await planOutgoing(store)).proposals.find((p) => p.transactionId === transactionId)
        ?.imuSuggestion;

    it('saves the rule last in the same operation; it suggests, never writes; undone with it', async () => {
      const store = await f24Store();
      expect(await remember(store)).toEqual({
        status: 'assigned',
        operationId: 'a-1',
        classId: 'mc-f',
        ruleId: 'imur-f',
      });
      expect(await rules(store)).toEqual([
        { ...base, id: 'imur-f', accountId: 'acc-berchet', f24Group: 'berchet-lovarini' },
      ]);
      const [op] = (await readJournal(store)).operations;
      expect(op?.changes.map((c) => c.path)).toEqual([
        recordPath('movementClass', 'mc-f'),
        recordPath('imuRule', 'imur-f'),
      ]);
      // The second F24 of the account: the group, its year, the lowest open rate.
      expect(await suggestionOf(store, 'g')).toEqual({
        f24Group: 'berchet-lovarini',
        year: '2026',
        rateIndex: 2,
      });
      await runReconciliation(store, 'p1', clock, ids('r'));
      expect((await classes(store)).map((c) => c.id)).toEqual(['mc-f']);
      // The same group again: no second rule.
      expect(await remember(store, { transactionId: 'g', rateIndex: 2 }, 'b')).toEqual({
        status: 'assigned',
        operationId: 'b-1',
        classId: 'mc-g',
      });
      expect((await rules(store)).map((r) => r.id)).toEqual(['imur-f']);
      await undoOperation(store, 'b-1', 'p1', clock, ids('u'));
      await undoOperation(store, 'a-1', 'p1', clock, ids('v'));
      expect(await rules(store)).toMatchObject([{ id: 'imur-f', deleted: true }]);
      expect(await suggestionOf(store, 'g')).toBeUndefined();
    });

    it('«solo questa volta» saves none; another group ends the rule the day before', async () => {
      const store = await f24Store();
      expect(await assign(store)).toEqual({
        status: 'assigned',
        operationId: 'a-1',
        classId: 'mc-f',
      });
      expect(await rules(store)).toEqual([]);
      await undoOperation(store, 'a-1', 'p1', clock, ids('u'));
      await remember(store, {}, 'b');
      await put(store, 'imuYear', [
        { ...imuYear('berchet', 'berchet-solo'), id: 'imu-berchet-2027', year: '2027' },
      ]);
      await put(store, 'transaction', [f24('k', '2027-06-14', -50000)]);
      expect(await suggestionOf(store, 'k')).toEqual({
        f24Group: 'berchet-lovarini',
      });
      expect(
        await remember(store, { transactionId: 'k', f24Group: 'berchet-solo', year: '2027' }, 'c'),
      ).toMatchObject({ status: 'assigned', ruleId: 'imur-k' });
      expect(await rules(store)).toEqual([
        {
          ...base,
          rev: 2,
          id: 'imur-f',
          accountId: 'acc-berchet',
          f24Group: 'berchet-lovarini',
          validTo: '2027-06-13',
        },
        {
          ...base,
          id: 'imur-k',
          accountId: 'acc-berchet',
          f24Group: 'berchet-solo',
          validFrom: '2027-06-14',
        },
      ]);
      // The older F24 still falls under the older rule.
      expect(await suggestionOf(store, 'g')).toMatchObject({ f24Group: 'berchet-lovarini' });
    });
  });
});
