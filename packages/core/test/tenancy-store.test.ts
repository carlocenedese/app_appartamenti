import { describe, expect, it } from 'vitest';
import {
  ContractSchema,
  NoteSchema,
  TenancySchema,
  notesFor,
  checkBeds,
  commitChange,
  endTenancy,
  loadAll,
  recordPath,
  recordSchemas,
  recordRoomSwap,
  recordTakeover,
  saveTenancy,
  buildConguaglioWorkbook,
  calcConguaglio,
  collectedForfait,
  contractChecks,
  saveContract,
  depositChecks,
  loadExcelInput,
  undoBlockedBy,
  settlementPeriods,
  undoOperation,
  yearMonth,
} from '../src/index';
import type {
  ContractInput,
  RecordKind,
  RoomSwapInput,
  SaveTenancyInput,
  TakeoverInput,
} from '../src/index';
import { bill, match } from './helpers/conguaglio-builders';
import { cents } from '../src/money';
import { clock, ids, snapshot } from './helpers/income-year';
import { MemoryStore } from './helpers/memory-store';

// Invented names and amounts only (plan 11): Anna Prova leaves, Bruno Esempio takes over.
const base = { v: 1, rev: 1 };

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

const tenancy = (id: string, extra: Record<string, unknown> = {}) => ({
  ...base,
  id,
  apartmentId: 'app-c',
  tenantId: 'ten-anna',
  room: 'A',
  from: '2025-10',
  to: '2026-09',
  monthlyRent: 35000,
  monthlyForfait: 3000,
  ...extra,
});

async function fixtureStore() {
  const store = new MemoryStore();
  await seed(
    store,
    'apartment',
    [
      {
        ...base,
        id: 'app-c',
        name: 'app-c',
        locatore: 'user2',
        posti: 2,
        rooms: ['A', 'B'],
        annualitaStart: { month: 10, day: 1 },
      },
      {
        ...base,
        id: 'app-b',
        name: 'app-b',
        locatore: 'user1',
        posti: 1,
        annualitaStart: { month: 10, day: 1 },
      },
    ],
    's1',
  );
  await seed(
    store,
    'tenant',
    ['ten-anna', 'ten-bruno', 'ten-carla'].map((id) => ({ ...base, id, name: id })),
    's2',
  );
  await seed(store, 'tenancy', [tenancy('tcy-anna')], 's3');
  await seed(
    store,
    'contract',
    [
      {
        ...base,
        id: 'ctr-app-c',
        apartmentId: 'app-c',
        type: '1+1',
        start: '2025-10',
        end: '2026-09',
        settlement: 'annuale',
        tenancyIds: ['tcy-anna'],
        rent: [{ from: '2025-10', monthlyRent: 70000, monthlyAdvance: 6000 }],
      },
      {
        ...base,
        id: 'ctr-lov',
        apartmentId: 'app-b',
        type: '3+2',
        start: '2024-04',
        end: '2029-03',
        settlement: 'intero-contratto',
      },
    ],
    's4',
  );
  return store;
}

const arrival = (extra: Partial<SaveTenancyInput> = {}): SaveTenancyInput => ({
  id: 'tcy-carla',
  apartmentId: 'app-c',
  tenantId: 'ten-carla',
  room: 'B',
  from: yearMonth('2025-11'),
  monthlyRent: cents(36000),
  monthlyForfait: cents(3000),
  expectedDeposit: cents(50000),
  contractId: 'ctr-app-c',
  ...extra,
});
const takeover = (extra: Partial<TakeoverInput> = {}): TakeoverInput => ({
  outTenancyId: 'tcy-anna',
  lastMonth: yearMonth('2026-02'),
  incoming: {
    id: 'tcy-bruno',
    tenantId: 'ten-bruno',
    monthlyRent: cents(36000),
    monthlyForfait: cents(3000),
    expectedDeposit: cents(50000),
  },
  ...extra,
});
const tenancies = async (store: MemoryStore) =>
  (await loadAll(store, 'tenancy', TenancySchema, { includeDeleted: true })).records;
const contract = async (store: MemoryStore, id = 'ctr-app-c') =>
  (await loadAll(store, 'contract', ContractSchema, { includeDeleted: true })).records.find(
    (c) => c.id === id,
  );

describe('checkBeds (plan 11)', () => {
  it('throws what calcConguaglio would throw', () => {
    const apartment = recordSchemas.apartment.parse({
      ...base,
      id: 'x',
      name: 'x',
      locatore: 'user1',
      posti: 1,
      annualitaStart: { month: 10, day: 1 },
    });
    const t = (id: string, tenantId: string) =>
      TenancySchema.parse({ ...tenancy(id), apartmentId: 'x', tenantId, room: undefined });
    expect(() =>
      checkBeds(apartment, [t('a', 'ten-a'), t('b', 'ten-b')], [yearMonth('2025-10')]),
    ).toThrow(expect.objectContaining({ code: 'too-many-tenants' }));
    expect(() => checkBeds(apartment, [t('a', 'ten-a')], [yearMonth('2025-10')])).not.toThrow();
  });
});

describe('saveTenancy (plan 11, task 2)', () => {
  it('saves and links to the contract, then writes nothing for the same request', async () => {
    const store = await fixtureStore();
    expect(await saveTenancy(store, arrival(), 'p1', clock, ids('a'))).toEqual({
      status: 'saved',
      operationId: 'a-1',
      tenancyId: 'tcy-carla',
    });
    expect((await tenancies(store)).find((t) => t.id === 'tcy-carla')).toMatchObject({
      rev: 1,
      expectedDeposit: 50000,
      room: 'B',
    });
    expect((await contract(store))?.tenancyIds).toEqual(['tcy-anna', 'tcy-carla']);
    const before = await snapshot(store);
    expect(await saveTenancy(store, arrival(), 'p1', clock, ids('b'))).toEqual({
      status: 'unchanged',
      tenancyId: 'tcy-carla',
    });
    expect(await snapshot(store)).toEqual(before);
    // An update keeps the link and writes only the tenancy.
    expect(
      await saveTenancy(store, arrival({ monthlyRent: cents(37000) }), 'p1', clock, ids('c')),
    ).toMatchObject({ status: 'saved' });
    expect((await tenancies(store)).find((t) => t.id === 'tcy-carla')?.rev).toBe(2);
    expect((await contract(store))?.rev).toBe(2);
  });

  it('refusals write nothing, in order', async () => {
    const store = await fixtureStore();
    const before = await snapshot(store);
    const cases: [SaveTenancyInput, string, object?][] = [
      [arrival({ id: 'con spazio' }), 'invalid-tenancy'],
      [arrival({ to: yearMonth('2025-10') }), 'invalid-tenancy'],
      [arrival({ monthlyRent: cents(-1) }), 'invalid-tenancy'],
      [arrival({ expectedDeposit: cents(0) }), 'invalid-tenancy'],
      [arrival({ apartmentId: 'nessuno' }), 'unknown-apartment'],
      [arrival({ tenantId: 'ten-nessuno' }), 'unknown-tenant'],
      [arrival({ contractId: 'ctr-lov' }), 'unknown-contract'],
      [arrival({ contractId: 'ctr-nessuno' }), 'unknown-contract'],
      [arrival({ room: 'A' }), 'beds-conflict', { code: 'room-overlap', month: '2025-11' }],
      [arrival({ room: 'C' }), 'beds-conflict', { code: 'unknown-room', month: '2025-11' }],
      [
        arrival({ tenantId: 'ten-anna', room: 'B' }),
        'beds-conflict',
        { code: 'tenant-overlap', month: '2025-11' },
      ],
    ];
    for (const [input, reason, extra] of cases) {
      expect(await saveTenancy(store, input, 'p1', clock, ids('x'))).toEqual({
        status: 'refused',
        reason,
        ...extra,
      });
    }
    expect(await snapshot(store)).toEqual(before);
  });

  it('more tenants than beds is beds-conflict too-many-tenants', async () => {
    const store = await fixtureStore();
    const lov = (id: string, tenantId: string) =>
      arrival({ id, tenantId, apartmentId: 'app-b', room: undefined, contractId: undefined });
    expect(await saveTenancy(store, lov('t-1', 'ten-anna'), 'p1', clock, ids('l'))).toMatchObject({
      status: 'saved',
    });
    expect(await saveTenancy(store, lov('t-2', 'ten-bruno'), 'p1', clock, ids('m'))).toEqual({
      status: 'refused',
      reason: 'beds-conflict',
      code: 'too-many-tenants',
      month: '2025-11',
    });
  });

  it('an old conflict outside the months written does not block a correction', async () => {
    const store = await fixtureStore();
    await seed(store, 'tenancy', [tenancy('tcy-old', { tenantId: 'ten-bruno' })], 'o');
    // tcy-anna and tcy-old share room A in every month: shortening tcy-old to before is allowed.
    const fix = await saveTenancy(
      store,
      arrival({
        id: 'tcy-old',
        tenantId: 'ten-bruno',
        room: 'A',
        from: yearMonth('2024-10'),
        to: yearMonth('2025-09'),
        contractId: undefined,
      }),
      'p1',
      clock,
      ids('f'),
    );
    expect(fix).toMatchObject({ status: 'saved' });
  });
});

describe('endTenancy (plan 11, task 2)', () => {
  it('writes the last month, then nothing; refusals write nothing', async () => {
    const store = await fixtureStore();
    const end = (tenancyId: string, lastMonth: string, prefix: string) =>
      endTenancy(store, { tenancyId, lastMonth: yearMonth(lastMonth) }, 'p1', clock, ids(prefix));
    expect(await end('tcy-anna', '2026-02', 'e')).toMatchObject({ status: 'saved' });
    expect((await tenancies(store))[0]).toMatchObject({ to: '2026-02', rev: 2 });
    expect(await end('tcy-anna', '2026-02', 'f')).toMatchObject({ status: 'unchanged' });
    const before = await snapshot(store);
    expect(await end('tcy-nessuna', '2026-02', 'g')).toMatchObject({ reason: 'unknown-tenancy' });
    expect(await end('tcy-anna', '2025-09', 'g')).toMatchObject({ reason: 'invalid-tenancy' });
    expect(await snapshot(store)).toEqual(before);
  });

  it('a longer stay that no longer fits is beds-conflict', async () => {
    const store = await fixtureStore();
    await seed(
      store,
      'tenancy',
      [tenancy('tcy-next', { tenantId: 'ten-bruno', from: '2026-10', to: undefined })],
      'n',
    );
    expect(
      await endTenancy(
        store,
        { tenancyId: 'tcy-anna', lastMonth: yearMonth('2026-10') },
        'p1',
        clock,
        ids('e'),
      ),
    ).toEqual({
      status: 'refused',
      reason: 'beds-conflict',
      code: 'room-overlap',
      month: '2026-10',
    });
  });
});

describe('a shorter stay and the recoveries (plan 11, review)', () => {
  async function twoYears() {
    const store = new MemoryStore();
    const apt = {
      ...base,
      id: 'app-a',
      name: 'app-a',
      locatore: 'user1',
      posti: 1,
      annualitaStart: { month: 10, day: 1 },
    };
    const ctr = {
      ...base,
      id: 'ctr-b',
      apartmentId: 'app-a',
      type: '1+1',
      start: '2025-10',
      end: '2027-09',
      settlement: 'annuale',
      tenancyIds: ['tcy-a'],
    };
    await seed(store, 'apartment', [apt], 's1');
    await seed(
      store,
      'tenant',
      [
        { ...base, id: 'ten-anna', name: 'ten-anna' },
        { ...base, id: 'ten-bruno', name: 'ten-bruno' },
      ],
      's2',
    );
    await seed(
      store,
      'tenancy',
      [tenancy('tcy-a', { apartmentId: 'app-a', room: undefined, to: '2027-09' })],
      's3',
    );
    await seed(store, 'contract', [ctr], 's4');
    const second = settlementPeriods(ContractSchema.parse(ctr), apt.annualitaStart)[1]?.label;
    return { store, second };
  }
  const recovery = (periodLabel: string | undefined, status = 'da-recuperare') => ({
    ...base,
    id: 'rec-1',
    apartmentId: 'app-a',
    instalmentId: 'str-1',
    amount: 2000,
    shares: [{ tenantId: 'ten-anna', amount: 2000 }],
    status,
    periodLabel,
  });

  it('refuses has-recoveries when the tenant would be absent from the recovery period', async () => {
    const { store, second } = await twoYears();
    await seed(store, 'tenantRecovery', [recovery(second)], 'r');
    const before = await snapshot(store);
    const end = (prefix: string) =>
      endTenancy(
        store,
        { tenancyId: 'tcy-a', lastMonth: yearMonth('2026-05') },
        'p1',
        clock,
        ids(prefix),
      );
    expect(await end('e')).toEqual({ status: 'refused', reason: 'has-recoveries' });
    const take = takeover({ outTenancyId: 'tcy-a', lastMonth: yearMonth('2026-05') });
    expect(await recordTakeover(store, take, 'p1', clock, ids('t'))).toEqual({
      status: 'refused',
      reason: 'has-recoveries',
    });
    expect(await snapshot(store)).toEqual(before);
    // Still present in the period (ends in it): allowed.
    expect(
      await endTenancy(
        store,
        { tenancyId: 'tcy-a', lastMonth: yearMonth('2026-12') },
        'p1',
        clock,
        ids('f'),
      ),
    ).toMatchObject({ status: 'saved' });
  });

  it('saveTenancy refuses the same shorter stay (review of 18 Nov 2026, U4)', async () => {
    const { store, second } = await twoYears();
    await seed(store, 'tenantRecovery', [recovery(second)], 'r');
    const [stay] = (await loadAll(store, 'tenancy', TenancySchema)).records;
    if (stay === undefined) throw new Error('no stay');
    const save = (to: string, prefix: string) =>
      saveTenancy(store, { ...stay, to: yearMonth(to) }, 'p1', clock, ids(prefix));
    expect(await save('2026-05', 's')).toEqual({ status: 'refused', reason: 'has-recoveries' });
    expect(await save('2026-12', 't')).toMatchObject({ status: 'saved' });
  });

  it('a non-recuperabile recovery or one without a period does not block', async () => {
    for (const r of [recovery(undefined), recovery('2026-27', 'non-recuperabile')]) {
      const { store } = await twoYears();
      await seed(store, 'tenantRecovery', [r], 'r');
      expect(
        await endTenancy(
          store,
          { tenancyId: 'tcy-a', lastMonth: yearMonth('2026-05') },
          'p1',
          clock,
          ids('e'),
        ),
      ).toMatchObject({ status: 'saved' });
    }
  });
});

describe('recordTakeover (plan 11, task 2)', () => {
  it('an incoming tenancy after the end of the contract is invalid-tenancy', async () => {
    const store = await fixtureStore();
    await saveTenancy(store, arrival({ to: undefined }), 'p1', clock, ids('a'));
    const take = takeover({ outTenancyId: 'tcy-carla', lastMonth: yearMonth('2026-09') });
    expect(await recordTakeover(store, take, 'p1', clock, ids('t'))).toEqual({
      status: 'refused',
      reason: 'invalid-tenancy',
    });
  });

  it('ends the outgoing tenancy, starts the incoming one, records it in the contract', async () => {
    const store = await fixtureStore();
    expect(await recordTakeover(store, takeover(), 'p1', clock, ids('t'))).toEqual({
      status: 'saved',
      operationId: 't-1',
      tenancyId: 'tcy-bruno',
    });
    const [anna, bruno] = await tenancies(store);
    expect(anna).toMatchObject({ id: 'tcy-anna', to: '2026-02', rev: 2 });
    expect(bruno).toEqual({
      ...base,
      id: 'tcy-bruno',
      apartmentId: 'app-c',
      tenantId: 'ten-bruno',
      room: 'A',
      from: '2026-03',
      to: '2026-09',
      monthlyRent: 36000,
      monthlyForfait: 3000,
      expectedDeposit: 50000,
    });
    const c = await contract(store);
    expect(c).toMatchObject({
      rev: 2,
      tenancyIds: ['tcy-anna', 'tcy-bruno'],
      takeovers: [{ month: '2026-03', outTenancyId: 'tcy-anna', inTenancyId: 'tcy-bruno' }],
      rent: [{ from: '2025-10', monthlyRent: 70000, monthlyAdvance: 6000 }],
    });
    const before = await snapshot(store);
    expect(await recordTakeover(store, takeover(), 'p1', clock, ids('u'))).toEqual({
      status: 'unchanged',
      tenancyId: 'tcy-bruno',
    });
    const other = takeover();
    other.incoming = { ...other.incoming, monthlyRent: cents(40000) };
    expect(await recordTakeover(store, other, 'p1', clock, ids('u'))).toMatchObject({
      reason: 'tenancy-exists',
    });
    expect(await snapshot(store)).toEqual(before);
  });

  it('refusals write nothing, in order', async () => {
    const store = await fixtureStore();
    await seed(store, 'tenancy', [tenancy('tcy-free', { tenantId: 'ten-carla', room: 'B' })], 'f');
    const before = await snapshot(store);
    const incoming = (extra: object) => ({ incoming: { ...takeover().incoming, ...extra } });
    const cases: [Partial<TakeoverInput>, string][] = [
      [{ outTenancyId: 'tcy-nessuna' }, 'unknown-tenancy'],
      [{ lastMonth: yearMonth('2025-09') }, 'invalid-tenancy'],
      [{ lastMonth: yearMonth('2026-09') }, 'invalid-tenancy'],
      [incoming({ id: 'con spazio' }), 'invalid-tenancy'],
      [incoming({ monthlyForfait: cents(-1) }), 'invalid-tenancy'],
      [incoming({ tenantId: 'ten-nessuno' }), 'unknown-tenant'],
      [incoming({ tenantId: 'ten-anna' }), 'same-tenant'],
      [{ outTenancyId: 'tcy-free', ...incoming({ tenantId: 'ten-bruno' }) }, 'no-contract'],
      [incoming({ id: 'tcy-free' }), 'tenancy-exists'],
      [incoming({ tenantId: 'ten-carla' }), 'beds-conflict'],
    ];
    for (const [extra, reason] of cases) {
      expect(await recordTakeover(store, takeover(extra), 'p1', clock, ids('x'))).toMatchObject({
        status: 'refused',
        reason,
      });
    }
    expect(await snapshot(store)).toEqual(before);
  });
});

describe('undoing the tenancy operations (plan 11, task 2)', () => {
  it('undo of a takeover puts the outgoing tenancy and the contract back', async () => {
    const store = await fixtureStore();
    const [annaBefore] = await tenancies(store);
    const contractBefore = await contract(store);
    await recordTakeover(store, takeover(), 'p1', clock, ids('t'));
    expect(await undoBlockedBy(store, 't-1')).toEqual([]);
    await undoOperation(store, 't-1', 'p1', clock, ids('u'));
    const [anna, bruno] = await tenancies(store);
    expect({ ...anna, rev: 1 }).toEqual(annaBefore);
    expect(bruno).toMatchObject({ deleted: true });
    expect({ ...(await contract(store)), rev: 1 }).toEqual(contractBefore);
  });

  it('an undone exit whose room is taken since is blocked by the new tenancy', async () => {
    const store = await fixtureStore();
    await endTenancy(
      store,
      { tenancyId: 'tcy-anna', lastMonth: yearMonth('2026-02') },
      'p1',
      clock,
      ids('e'),
    );
    await saveTenancy(
      store,
      arrival({ id: 'tcy-bruno', tenantId: 'ten-bruno', room: 'A', from: yearMonth('2026-03') }),
      'p1',
      clock,
      ids('a'),
    );
    expect(await undoBlockedBy(store, 'e-1')).toEqual(['tcy-bruno']);
    // Undoing the arrival first frees the room.
    await undoOperation(store, 'a-1', 'p1', clock, ids('u'));
    expect(await undoBlockedBy(store, 'e-1')).toEqual([]);
  });

  it('an undo that would put a tenancy in a room that no longer exists is blocked by it', async () => {
    const store = await fixtureStore();
    const [anna] = await tenancies(store);
    await saveTenancy(
      store,
      {
        ...arrival({ id: 'tcy-anna', tenantId: 'ten-anna', room: 'B', from: yearMonth('2025-10') }),
        to: yearMonth('2026-09'),
        contractId: undefined,
      },
      'p1',
      clock,
      ids('r'),
    );
    expect(anna?.room).toBe('A');
    const apt = (await loadAll(store, 'apartment', recordSchemas.apartment)).records.find(
      (a) => a.id === 'app-c',
    );
    await commitChange(
      store,
      {
        profileId: 'p1',
        kind: 'test.seed',
        summary: 'Dati di prova.',
        changes: [
          {
            path: recordPath('apartment', 'app-c'),
            before: apt,
            after: recordSchemas.apartment.parse({ ...apt, rev: 2, rooms: ['B', 'C'] }),
          },
        ],
      },
      clock,
      ids('z'),
    );
    expect(await undoBlockedBy(store, 'r-1')).toEqual(['tcy-anna']);
  });

  it('a payment or a recovery of the only stay blocks the undo of its creation', async () => {
    const store = await fixtureStore();
    await saveTenancy(store, arrival(), 'p1', clock, ids('a'));
    await seed(
      store,
      'payment',
      [
        {
          ...base,
          id: 'pay-c1',
          apartmentId: 'app-c',
          tenantId: 'ten-carla',
          date: '2025-10-25',
          amount: 50000,
          confirmed: true,
          kind: 'caparra',
          source: 'manual',
        },
      ],
      'p',
    );
    expect(await undoBlockedBy(store, 'a-1')).toEqual(['pay-c1']);
    // A second stay of the same tenant in the apartment covers the payment.
    await seed(
      store,
      'tenancy',
      [
        tenancy('tcy-carla-2', {
          tenantId: 'ten-carla',
          room: 'B',
          from: '2026-10',
          to: '2027-09',
        }),
      ],
      'q',
    );
    expect(await undoBlockedBy(store, 'a-1')).toEqual([]);
  });
});

// Plan 18: Anna (room A) and Bruno (room B) swap rooms from 2026-03. Invented names and amounts.
async function swapStore(bruno: Record<string, unknown> = {}) {
  const store = await fixtureStore();
  await saveTenancy(
    store,
    {
      ...arrival({
        id: 'tcy-bruno',
        tenantId: 'ten-bruno',
        room: 'B',
        from: yearMonth('2025-10'),
        monthlyRent: cents(36000),
        monthlyForfait: cents(2000),
      }),
      to: yearMonth('2026-09'),
      ...bruno,
    },
    'p1',
    clock,
    ids('b'),
  );
  return store;
}

const swap = (extra: Partial<RoomSwapInput> = {}): RoomSwapInput => ({
  apartmentId: 'app-c',
  tenancyIdA: 'tcy-anna',
  tenancyIdB: 'tcy-bruno',
  month: yearMonth('2026-03'),
  ...extra,
});

describe('recordRoomSwap (plan 18)', () => {
  it('ends both stays the month before and starts both in the other room, in one operation', async () => {
    const store = await swapStore();
    const contractBefore = await contract(store);
    const result = await recordRoomSwap(store, swap(), 'p1', clock, ids('w'));
    expect(result).toEqual({
      status: 'saved',
      operationId: 'w-1',
      tenancyIds: ['tcy-anna-2026-03', 'tcy-bruno-2026-03'],
      warnings: ['swap-rent-unchanged', 'swap-forfait-unchanged'],
    });
    const byId = new Map((await tenancies(store)).map((t) => [t.id, t]));
    expect(byId.get('tcy-anna')).toMatchObject({ room: 'A', to: '2026-02' });
    expect(byId.get('tcy-bruno')).toMatchObject({ room: 'B', to: '2026-02' });
    expect(byId.get('tcy-anna-2026-03')).toEqual({
      ...base,
      id: 'tcy-anna-2026-03',
      apartmentId: 'app-c',
      tenantId: 'ten-anna',
      room: 'B',
      from: '2026-03',
      to: '2026-09',
      monthlyRent: 35000,
      monthlyForfait: 3000,
    });
    expect(byId.get('tcy-bruno-2026-03')).toEqual({
      ...base,
      id: 'tcy-bruno-2026-03',
      apartmentId: 'app-c',
      tenantId: 'ten-bruno',
      room: 'A',
      from: '2026-03',
      to: '2026-09',
      monthlyRent: 36000,
      monthlyForfait: 2000,
      expectedDeposit: 50000,
    });
    const after = await contract(store);
    expect(after?.tenancyIds).toEqual([
      'tcy-anna',
      'tcy-bruno',
      'tcy-anna-2026-03',
      'tcy-bruno-2026-03',
    ]);
    expect(after?.rent).toEqual(contractBefore?.rent);
    expect(after?.takeovers).toBeUndefined();
    // The same request writes nothing and says the same.
    const before = await snapshot(store);
    expect(await recordRoomSwap(store, swap(), 'p1', clock, ids('x'))).toEqual({
      status: 'unchanged',
      tenancyIds: ['tcy-anna-2026-03', 'tcy-bruno-2026-03'],
      warnings: ['swap-rent-unchanged', 'swap-forfait-unchanged'],
    });
    expect(await snapshot(store)).toEqual(before);
  });

  it('H5: writes a note in the history of the contract, once, and the undo takes it back', async () => {
    const store = await swapStore();
    const notes = async () =>
      (await loadAll(store, 'note', NoteSchema, { includeDeleted: true })).records;
    // A refused swap writes no note.
    expect(
      await recordRoomSwap(store, swap({ month: yearMonth('2025-10') }), 'p1', clock, ids('v')),
    ).toMatchObject({ status: 'refused' });
    expect(await notes()).toEqual([]);
    await recordRoomSwap(store, swap(), 'p1', clock, ids('w'));
    expect(await notes()).toEqual([
      {
        ...base,
        id: 'note-tcy-anna-2026-03',
        targetType: 'contract',
        targetId: 'ctr-app-c',
        text: 'Scambio di posto dal 2026-03: ten-anna dal posto A al posto B, ten-bruno dal posto B al posto A.',
        profileId: 'p1',
        at: clock(),
        visibleToTenants: false,
      },
    ]);
    expect(await notesFor(store, 'contract', 'ctr-app-c')).toHaveLength(1);
    // The same request again writes nothing, no second note.
    await recordRoomSwap(store, swap(), 'p1', clock, ids('x'));
    expect(await notes()).toHaveLength(1);
    await undoOperation(store, 'w-1', 'p1', clock, ids('u'));
    expect(await notesFor(store, 'contract', 'ctr-app-c')).toEqual([]);
  });

  it('takes the rents given from the month of the swap, without the rent warning', async () => {
    const store = await swapStore();
    const rents = { monthlyRentA: cents(36000), monthlyRentB: cents(35000) };
    const result = await recordRoomSwap(store, swap(rents), 'p1', clock, ids('w'));
    expect(result).toMatchObject({ status: 'saved', warnings: ['swap-forfait-unchanged'] });
    const byId = new Map((await tenancies(store)).map((t) => [t.id, t]));
    expect(byId.get('tcy-anna')?.monthlyRent).toBe(35000);
    expect(byId.get('tcy-anna-2026-03')?.monthlyRent).toBe(36000);
    expect(byId.get('tcy-bruno-2026-03')?.monthlyRent).toBe(35000);
    expect(await recordRoomSwap(store, swap(rents), 'p1', clock, ids('x'))).toMatchObject({
      status: 'unchanged',
    });
    // The same swap with another rent is not the same request.
    expect(
      await recordRoomSwap(store, swap({ monthlyRentA: cents(1) }), 'p1', clock, ids('x')),
    ).toEqual({ status: 'refused', reason: 'tenancy-exists' });
  });

  it('gives no warning when the two rents and flat charges are equal', async () => {
    const store = await swapStore({ monthlyRent: cents(35000), monthlyForfait: cents(3000) });
    const result = await recordRoomSwap(store, swap(), 'p1', clock, ids('w'));
    expect(result).toMatchObject({ status: 'saved' });
    expect(result).not.toHaveProperty('warnings');
  });

  it('refuses without writing', async () => {
    const store = await swapStore();
    await seed(
      store,
      'tenancy',
      [
        tenancy('tcy-carla', { tenantId: 'ten-carla', from: '2026-10', to: '2027-09' }),
        tenancy('tcy-lov', { apartmentId: 'app-b', tenantId: 'ten-carla', room: undefined }),
      ],
      'c',
    );
    const before = await snapshot(store);
    const cases: [Partial<RoomSwapInput>, string][] = [
      [{ tenancyIdB: 'tcy-nope' }, 'unknown-tenancy'],
      [{ apartmentId: 'app-b' }, 'unknown-tenancy'],
      [{ tenancyIdB: 'tcy-anna' }, 'same-tenant'],
      [{ apartmentId: 'app-b', tenancyIdA: 'tcy-lov', tenancyIdB: 'tcy-lov' }, 'same-tenant'],
      [{ tenancyIdB: 'tcy-carla' }, 'same-room'],
      [{ month: yearMonth('2025-10') }, 'invalid-tenancy'],
      [{ month: yearMonth('2026-10') }, 'invalid-tenancy'],
      [{ monthlyRentA: cents(-1) }, 'invalid-tenancy'],
    ];
    for (const [extra, reason] of cases) {
      expect(await recordRoomSwap(store, swap(extra), 'p1', clock, ids('w'))).toEqual({
        status: 'refused',
        reason,
      });
    }
    expect(await snapshot(store)).toEqual(before);
  });

  it('refuses a stay without a room', async () => {
    const store = await fixtureStore();
    await seed(
      store,
      'tenancy',
      ['ten-bruno', 'ten-carla'].map((tenantId) =>
        tenancy(`tcy-${tenantId}`, { apartmentId: 'app-b', tenantId, room: undefined }),
      ),
      'c',
    );
    const input = swap({
      apartmentId: 'app-b',
      tenancyIdA: 'tcy-ten-bruno',
      tenancyIdB: 'tcy-ten-carla',
    });
    expect(await recordRoomSwap(store, input, 'p1', clock, ids('w'))).toEqual({
      status: 'refused',
      reason: 'no-room',
    });
  });

  it('refuses a stay outside the contract, two contracts, a taken id and a bed conflict', async () => {
    const unlinked = await swapStore({ contractId: undefined });
    expect(await recordRoomSwap(unlinked, swap(), 'p1', clock, ids('w'))).toEqual({
      status: 'refused',
      reason: 'no-contract',
    });
    await seed(
      unlinked,
      'contract',
      [
        {
          ...base,
          id: 'ctr-app-c-2',
          apartmentId: 'app-c',
          type: '1+1',
          start: '2025-10',
          end: '2026-09',
          settlement: 'annuale',
          tenancyIds: ['tcy-bruno'],
        },
      ],
      'k',
    );
    expect(await recordRoomSwap(unlinked, swap(), 'p1', clock, ids('w'))).toEqual({
      status: 'refused',
      reason: 'different-contract',
    });

    const taken = await swapStore();
    await seed(
      taken,
      'tenancy',
      [tenancy('tcy-bruno-2026-03', { apartmentId: 'app-b', room: undefined })],
      'c',
    );
    expect(await recordRoomSwap(taken, swap(), 'p1', clock, ids('w'))).toEqual({
      status: 'refused',
      reason: 'tenancy-exists',
    });

    // Bruno leaves room B in June and Carla arrives there in July: Anna cannot move in until September.
    const beds = await swapStore({ to: yearMonth('2026-06') });
    await saveTenancy(
      beds,
      arrival({ room: 'B', from: yearMonth('2026-07'), to: yearMonth('2026-09') }),
      'p1',
      clock,
      ids('c'),
    );
    expect(await recordRoomSwap(beds, swap(), 'p1', clock, ids('w'))).toEqual({
      status: 'refused',
      reason: 'beds-conflict',
      code: 'room-overlap',
      month: '2026-07',
    });
  });

  it('refuses a stay leaving in a takeover, an id too long, and takes the ids given', async () => {
    const store = await swapStore();
    await recordTakeover(
      store,
      takeover({
        lastMonth: yearMonth('2026-05'),
        incoming: {
          id: 'tcy-carla',
          tenantId: 'ten-carla',
          monthlyRent: cents(35000),
          monthlyForfait: cents(3000),
        },
      }),
      'p1',
      clock,
      ids('t'),
    );
    expect(await recordRoomSwap(store, swap(), 'p1', clock, ids('w'))).toEqual({
      status: 'refused',
      reason: 'pending-takeover',
    });
    const fresh = await swapStore();
    expect(
      await recordRoomSwap(fresh, swap({ idB: 'x'.repeat(65) }), 'p1', clock, ids('w')),
    ).toEqual({ status: 'refused', reason: 'id-too-long', part: 'b' });
    expect(
      await recordRoomSwap(fresh, swap({ idA: 'same', idB: 'same' }), 'p1', clock, ids('w')),
    ).toEqual({ status: 'refused', reason: 'invalid-tenancy' });
    const given = swap({ idA: 'tcy-anna-2', idB: 'tcy-bruno-2' });
    expect(await recordRoomSwap(fresh, given, 'p1', clock, ids('w'))).toMatchObject({
      status: 'saved',
      tenancyIds: ['tcy-anna-2', 'tcy-bruno-2'],
    });
    expect(await recordRoomSwap(fresh, given, 'p1', clock, ids('x'))).toMatchObject({
      status: 'unchanged',
    });
  });

  it('keeps the new stays linked: contratto refuses to drop them, a repeated swap links them again', async () => {
    const store = await swapStore();
    await recordRoomSwap(store, swap(), 'p1', clock, ids('w'));
    const stored = await contract(store);
    if (stored === undefined) throw new Error('no contract');
    const input = Object.fromEntries(
      Object.entries(stored).filter(([k]) => !['v', 'rev', 'rent', 'takeovers'].includes(k)),
    ) as ContractInput;
    expect(
      await saveContract(
        store,
        { ...input, tenancyIds: ['tcy-anna', 'tcy-bruno', 'tcy-anna-2026-03'] },
        'p1',
        clock,
        ids('k'),
      ),
    ).toEqual({ status: 'refused', reason: 'swap-unlinked' });
    expect(await saveContract(store, input, 'p1', clock, ids('k'))).toMatchObject({
      status: 'unchanged',
    });
    // Written by hand without the new stays: a warning, and the same swap links them again.
    await commitChange(
      store,
      {
        profileId: 'p1',
        kind: 'test.seed',
        summary: 'Dati di prova.',
        changes: [
          {
            path: recordPath('contract', stored.id),
            before: stored,
            after: ContractSchema.parse({
              ...stored,
              rev: stored.rev + 1,
              tenancyIds: ['tcy-anna', 'tcy-bruno'],
            }),
          },
        ],
      },
      clock,
      ids('z'),
    );
    const checks = contractChecks({
      contracts: [(await contract(store)) as NonNullable<Awaited<ReturnType<typeof contract>>>],
      tenancies: await tenancies(store),
      payments: [],
      asOf: yearMonth('2026-04'),
    });
    expect(checks.filter((c) => c.code === 'unlinked-tenancy').map((c) => c.tenancyId)).toEqual([
      'tcy-anna-2026-03',
      'tcy-bruno-2026-03',
    ]);
    expect(await recordRoomSwap(store, swap(), 'p1', clock, ids('r'))).toMatchObject({
      status: 'saved',
      operationId: 'r-1',
    });
    expect((await contract(store))?.tenancyIds).toEqual([
      'tcy-anna',
      'tcy-bruno',
      'tcy-anna-2026-03',
      'tcy-bruno-2026-03',
    ]);
  });

  it('a repeated swap ignores an exit written since on a new stay; a second swap chains', async () => {
    const store = await swapStore();
    await recordRoomSwap(store, swap(), 'p1', clock, ids('w'));
    await endTenancy(
      store,
      { tenancyId: 'tcy-anna-2026-03', lastMonth: yearMonth('2026-08') },
      'p1',
      clock,
      ids('e'),
    );
    expect(await recordRoomSwap(store, swap(), 'p1', clock, ids('x'))).toMatchObject({
      status: 'unchanged',
    });
    const back = await recordRoomSwap(
      store,
      swap({
        tenancyIdA: 'tcy-anna-2026-03',
        tenancyIdB: 'tcy-bruno-2026-03',
        month: yearMonth('2026-06'),
      }),
      'p1',
      clock,
      ids('y'),
    );
    expect(back).toMatchObject({
      status: 'saved',
      tenancyIds: ['tcy-anna-2026-03-2026-06', 'tcy-bruno-2026-03-2026-06'],
    });
    const byId = new Map((await tenancies(store)).map((t) => [t.id, t]));
    expect(byId.get('tcy-anna-2026-03-2026-06')).toMatchObject({ room: 'A', to: '2026-08' });
    expect(byId.get('tcy-bruno-2026-03-2026-06')).toMatchObject({ room: 'B', to: '2026-09' });
  });

  it('refuses two contracts, one tenant twice, and a month that is the start of one stay', async () => {
    const twice = await swapStore();
    await seed(
      twice,
      'contract',
      [
        {
          ...base,
          id: 'ctr-app-c-2',
          apartmentId: 'app-c',
          type: '1+1',
          start: '2025-10',
          end: '2026-09',
          settlement: 'annuale',
          tenancyIds: ['tcy-anna'],
        },
      ],
      'k',
    );
    expect(await recordRoomSwap(twice, swap(), 'p1', clock, ids('w'))).toEqual({
      status: 'refused',
      reason: 'no-contract',
    });
    const again = await swapStore();
    await seed(
      again,
      'tenancy',
      [tenancy('tcy-anna-bis', { room: 'B', from: '2026-10', to: '2027-09' })],
      'c',
    );
    expect(
      await recordRoomSwap(again, swap({ tenancyIdB: 'tcy-anna-bis' }), 'p1', clock, ids('w')),
    ).toEqual({ status: 'refused', reason: 'same-tenant' });
    const late = await swapStore({ from: yearMonth('2026-03') });
    expect(await recordRoomSwap(late, swap(), 'p1', clock, ids('w'))).toEqual({
      status: 'refused',
      reason: 'invalid-tenancy',
    });
  });

  it('swaps two of three tenants and leaves the third alone', async () => {
    const store = new MemoryStore();
    await seed(
      store,
      'apartment',
      [
        {
          ...base,
          id: 'tre',
          name: 'tre',
          locatore: 'user1',
          posti: 3,
          rooms: ['A', 'B', 'C'],
          annualitaStart: { month: 10, day: 1 },
        },
      ],
      's1',
    );
    await seed(
      store,
      'tenant',
      ['ten-anna', 'ten-bruno', 'ten-carla'].map((id) => ({ ...base, id, name: id })),
      's2',
    );
    const three = ['ten-anna', 'ten-bruno', 'ten-carla'].map((tenantId, i) =>
      tenancy(`tcy-${String(i)}`, { apartmentId: 'tre', tenantId, room: ['A', 'B', 'C'][i] }),
    );
    await seed(store, 'tenancy', three, 's3');
    await seed(
      store,
      'contract',
      [
        {
          ...base,
          id: 'ctr-tre',
          apartmentId: 'tre',
          type: '1+1',
          start: '2025-10',
          end: '2026-09',
          settlement: 'annuale',
          tenancyIds: three.map((t) => t.id),
        },
      ],
      's4',
    );
    const result = await recordRoomSwap(
      store,
      { apartmentId: 'tre', tenancyIdA: 'tcy-0', tenancyIdB: 'tcy-2', month: yearMonth('2026-01') },
      'p1',
      clock,
      ids('w'),
    );
    expect(result).toMatchObject({
      status: 'saved',
      tenancyIds: ['tcy-0-2026-01', 'tcy-2-2026-01'],
    });
    const byId = new Map((await tenancies(store)).map((t) => [t.id, t]));
    expect(byId.get('tcy-1')).toMatchObject({ room: 'B', to: '2026-09', rev: 1 });
    expect(byId.get('tcy-0-2026-01')).toMatchObject({ tenantId: 'ten-anna', room: 'C' });
    expect(byId.get('tcy-2-2026-01')).toMatchObject({ tenantId: 'ten-carla', room: 'A' });
  });

  it('is undone in one step, and an undo that puts two stays in a room is blocked', async () => {
    const store = await swapStore();
    const before = await tenancies(store);
    const contractBefore = await contract(store);
    await recordRoomSwap(store, swap(), 'p1', clock, ids('w'));
    expect(await undoBlockedBy(store, 'w-1')).toEqual([]);
    await undoOperation(store, 'w-1', 'p1', clock, ids('u'));
    const after = new Map((await tenancies(store)).map((t) => [t.id, t]));
    for (const t of before) expect({ ...after.get(t.id), rev: t.rev }).toEqual(t);
    expect(after.get('tcy-anna-2026-03')).toMatchObject({ deleted: true });
    expect(after.get('tcy-bruno-2026-03')).toMatchObject({ deleted: true });
    expect({ ...(await contract(store)), rev: contractBefore?.rev }).toEqual(contractBefore);

    // After the swap Anna leaves room B in May and Carla arrives there in June.
    const blocked = await swapStore();
    await recordRoomSwap(blocked, swap(), 'p1', clock, ids('w'));
    await endTenancy(
      blocked,
      { tenancyId: 'tcy-anna-2026-03', lastMonth: yearMonth('2026-05') },
      'p1',
      clock,
      ids('e'),
    );
    await saveTenancy(
      blocked,
      arrival({ room: 'B', from: yearMonth('2026-06'), to: yearMonth('2026-09') }),
      'p1',
      clock,
      ids('c'),
    );
    expect(await undoBlockedBy(blocked, 'w-1')).toEqual(['tcy-carla']);
  });

  it('settles each tenant in the room of each month, rents and deposits as before', async () => {
    const store = await swapStore();
    const depositsBefore = depositChecks({ tenancies: await tenancies(store), payments: [] });
    await recordRoomSwap(
      store,
      swap({ monthlyRentA: cents(36000), monthlyRentB: cents(35000) }),
      'p1',
      clock,
      ids('w'),
    );
    expect(depositChecks({ tenancies: await tenancies(store), payments: [] })).toEqual(
      depositsBefore,
    );
    const ctr = await contract(store);
    if (ctr === undefined) throw new Error('no contract');
    const [label] = settlementPeriods(ctr, { month: 10, day: 1 }).map((p) => p.label);
    const loaded = await loadExcelInput(store, { apartmentId: 'app-c', periodLabel: label ?? '' });
    if (loaded.status !== 'ok') throw new Error(loaded.reason);
    // One bill of one month before the swap and one after: the odd cent goes to room A (R30).
    const luce = (id: string, from: string, to: string) =>
      bill(id, from, to, 10001, { apartmentId: 'app-c' });
    const early = luce('luce-1', '2026-01-01', '2026-01-31');
    const later = luce('luce-2', '2026-04-01', '2026-04-30');
    const input = {
      ...loaded.input,
      bills: [early, later],
      matches: [match(early, 10001), match(later, 10001)],
    };
    const result = calcConguaglio(input);
    expect(result.tenants.map((t) => [t.tenantId, t.spese])).toEqual([
      ['ten-anna', 5001 + 5000],
      ['ten-bruno', 5000 + 5001],
    ]);
    const rows = collectedForfait({
      tenancies: input.tenancies,
      payments: [],
      months: [yearMonth('2026-02'), yearMonth('2026-03')],
    });
    expect(rows.map((r) => [r.tenantId, r.month, r.rentDue, r.forfaitDue])).toEqual([
      ['ten-anna', '2026-02', 35000, 3000],
      ['ten-anna', '2026-03', 36000, 3000],
      ['ten-bruno', '2026-02', 36000, 2000],
      ['ten-bruno', '2026-03', 35000, 2000],
    ]);
    // The workbook: one row per stay in «Affitti versati», both rooms of each tenant in «Conguagli».
    const { sheets } = buildConguaglioWorkbook(input);
    const cells = (name: string, width: number) => {
      const rows = sheets.find((x) => x.name === name)?.rows ?? [];
      const start = rows.findIndex((r) => r[0]?.kind === 'text' && r[0].value === 'Posto') + 1;
      return rows
        .slice(start)
        .filter((r) => r[1]?.kind === 'text' && r[1].value.startsWith('ten-'))
        .map((r) => r.slice(0, width).map((c) => (c === null ? null : 'value' in c ? c.value : c)));
    };
    expect(cells('Affitti versati', 3)).toEqual([
      ['A', 'ten-anna', 38000],
      ['A', 'ten-bruno', 37000],
      ['B', 'ten-bruno', 38000],
      ['B', 'ten-anna', 39000],
    ]);
    expect(cells('Conguagli', 4).map((r) => [r[0], r[1], r[3]])).toEqual([
      ['A, B', 'ten-anna', 12],
      ['B, A', 'ten-bruno', 12],
    ]);
  });
});
