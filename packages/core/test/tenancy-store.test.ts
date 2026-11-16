import { describe, expect, it } from 'vitest';
import {
  ContractSchema,
  TenancySchema,
  checkBeds,
  commitChange,
  endTenancy,
  loadAll,
  recordPath,
  recordSchemas,
  recordTakeover,
  saveTenancy,
  undoBlockedBy,
  settlementPeriods,
  undoOperation,
  yearMonth,
} from '../src/index';
import type { RecordKind, SaveTenancyInput, TakeoverInput } from '../src/index';
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
  apartmentId: 'pulci',
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
        id: 'pulci',
        name: 'pulci',
        locatore: 'user2',
        posti: 2,
        rooms: ['A', 'B'],
        annualitaStart: { month: 10, day: 1 },
      },
      {
        ...base,
        id: 'lovarini',
        name: 'lovarini',
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
        id: 'ctr-pulci',
        apartmentId: 'pulci',
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
        apartmentId: 'lovarini',
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
  apartmentId: 'pulci',
  tenantId: 'ten-carla',
  room: 'B',
  from: yearMonth('2025-11'),
  monthlyRent: cents(36000),
  monthlyForfait: cents(3000),
  expectedDeposit: cents(50000),
  contractId: 'ctr-pulci',
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
const contract = async (store: MemoryStore, id = 'ctr-pulci') =>
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
      arrival({ id, tenantId, apartmentId: 'lovarini', room: undefined, contractId: undefined });
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
      id: 'berchet',
      name: 'berchet',
      locatore: 'user1',
      posti: 1,
      annualitaStart: { month: 10, day: 1 },
    };
    const ctr = {
      ...base,
      id: 'ctr-b',
      apartmentId: 'berchet',
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
      [tenancy('tcy-a', { apartmentId: 'berchet', room: undefined, to: '2027-09' })],
      's3',
    );
    await seed(store, 'contract', [ctr], 's4');
    const second = settlementPeriods(ContractSchema.parse(ctr), apt.annualitaStart)[1]?.label;
    return { store, second };
  }
  const recovery = (periodLabel: string | undefined, status = 'da-recuperare') => ({
    ...base,
    id: 'rec-1',
    apartmentId: 'berchet',
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
      apartmentId: 'pulci',
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
      (a) => a.id === 'pulci',
    );
    await commitChange(
      store,
      {
        profileId: 'p1',
        kind: 'test.seed',
        summary: 'Dati di prova.',
        changes: [
          {
            path: recordPath('apartment', 'pulci'),
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
          apartmentId: 'pulci',
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
