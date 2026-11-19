// Plan 22, decision 2 of user1 (19 Nov 2026): beds and weights of a supply with a start month
// («valido dal»). Invented data only.
import { describe, expect, it } from 'vitest';
import {
  ApartmentSchema,
  ClosedPeriodError,
  SupplySchema,
  calcConguaglio,
  closePeriod,
  commitChange,
  loadAll,
  readJournal,
  recordPath,
  saveApartment,
  saveSupply,
  saveTenancy,
  undoOperation,
} from '../src/index';
import type { RecordKind } from '../src/index';
import { bedsAt, bedsOver, datedChange, weightsAt, weightsOver } from '../src/valid-from';
import { cents } from '../src/money';
import { yearMonth } from '../src/period';
import { apartment, payment, period, tenancy } from './helpers/conguaglio-builders';
import { clock, ids } from './helpers/income-year';
import { MemoryStore } from './helpers/memory-store';

const twoBedsFromApril = apartment({
  posti: 2,
  rooms: ['A', 'B'],
  earlierBeds: [{ to: yearMonth('2026-03'), posti: 1, rooms: ['A'] }],
});

describe('bedsAt, weightsAt and datedChange', () => {
  it('an entry holds up to its month, the current value after; without entries from always', () => {
    expect(bedsAt(twoBedsFromApril, '2026-03')).toEqual({ posti: 1, rooms: ['A'] });
    expect(bedsAt(twoBedsFromApril, '2026-04')).toEqual({ posti: 2, rooms: ['A', 'B'] });
    expect(bedsAt(apartment({ posti: 3 }), '1990-01')).toEqual({ posti: 3 });
    expect(bedsOver(twoBedsFromApril, '2025-10', '2026-09')).toEqual([
      { from: '2025-10', to: '2026-03', value: { posti: 1, rooms: ['A'] } },
      { from: '2026-04', to: '2026-09', value: { posti: 2, rooms: ['A', 'B'] } },
    ]);
    expect(bedsOver(twoBedsFromApril, '2026-10', '2027-09')).toEqual([
      { from: '2026-10', to: '2027-09', value: { posti: 2, rooms: ['A', 'B'] } },
    ]);
    const supply = {
      apartments: [{ apartmentId: 'x', weight: 10000 }],
      earlierApartments: [
        {
          to: yearMonth('2025-12'),
          apartments: [
            { apartmentId: 'x', weight: 5000 },
            { apartmentId: 'y', weight: 5000 },
          ],
        },
      ],
    };
    expect(weightsAt(supply, '2025-12')).toHaveLength(2);
    expect(weightsAt(supply, '2026-01')).toEqual([{ apartmentId: 'x', weight: 10000 }]);
    expect(weightsOver(supply, '2026-01', '2026-12')).toHaveLength(1);
  });

  it('a later change adds an entry, the same month corrects, an earlier month is refused', () => {
    const first = datedChange(undefined, yearMonth('2026-04'), { posti: 1 });
    expect(first).toEqual([{ posti: 1, to: '2026-03' }]);
    expect(datedChange(first, yearMonth('2026-04'), { posti: 2 })).toEqual(first);
    expect(datedChange(first, yearMonth('2026-03'), { posti: 2 })).toBeUndefined();
    expect(datedChange(first, yearMonth('2026-07'), { posti: 2 })).toEqual([
      { posti: 1, to: '2026-03' },
      { posti: 2, to: '2026-06' },
    ]);
  });

  it('the schema checks each entry (rooms per bed, months in order) and keeps old records valid', () => {
    expect(ApartmentSchema.safeParse(twoBedsFromApril).success).toBe(true);
    expect(ApartmentSchema.safeParse(apartment({ posti: 2 })).success).toBe(true);
    expect(
      ApartmentSchema.safeParse(
        apartment({
          posti: 2,
          earlierBeds: [{ to: yearMonth('2026-03'), posti: 2, rooms: ['A'] }],
        }),
      ).success,
    ).toBe(false);
    expect(
      ApartmentSchema.safeParse(
        apartment({
          earlierBeds: [
            { to: yearMonth('2026-03'), posti: 1 },
            { to: yearMonth('2026-03'), posti: 2 },
          ],
        }),
      ).success,
    ).toBe(false);
    const base = {
      id: 's',
      v: 1,
      rev: 1,
      label: 'U',
      apartments: [{ apartmentId: 'x', weight: 10000 }],
    };
    expect(SupplySchema.safeParse(base).success).toBe(true);
    expect(
      SupplySchema.safeParse({
        ...base,
        earlierApartments: [{ to: '2025-12', apartments: [{ apartmentId: 'x', weight: 9000 }] }],
      }).success,
    ).toBe(false);
  });
});

describe('the settlement reads the beds of each month', () => {
  it('two tenants fit from April, not before', () => {
    const input = (from: string) => ({
      apartment: twoBedsFromApril,
      period: period('2025-10', '2026-09'),
      tenancies: [
        tenancy('t-a', '2025-10', undefined, { room: 'A' }),
        tenancy('t-b', from, undefined, { room: 'B' }),
      ],
      bills: [],
      instalments: [],
      matches: [],
      payments: [],
    });
    expect(() => calcConguaglio(input('2026-04'))).not.toThrow();
    expect(() => calcConguaglio(input('2026-03'))).toThrow(/B/);
  });
});

const QUERY = { apartmentId: 'apt', periodLabel: '2025-26' };

async function put(
  store: MemoryStore,
  kind: RecordKind,
  record: { id: string } & Record<string, unknown>,
) {
  await commitChange(
    store,
    {
      profileId: 'p1',
      kind: 'test.seed',
      summary: 'x',
      changes: [{ path: recordPath(kind, record.id), after: record }],
    },
    clock,
    ids(`seed-${kind}-${record.id}`),
  );
}

/** One bed, one tenant all of 2025-26, the period closed. */
async function closed() {
  const store = new MemoryStore();
  await put(store, 'apartment', apartment({ posti: 1 }));
  await put(store, 'contract', {
    id: 'ctr',
    v: 1,
    rev: 1,
    apartmentId: 'apt',
    type: '1+1',
    start: '2025-10',
    end: '2027-09',
    settlement: 'annuale',
  });
  await put(store, 'tenancy', tenancy('t-a', '2025-10', undefined));
  await put(store, 'tenant', { id: 't-a', v: 1, rev: 1, name: 'Nome Inventato' });
  for (let i = 0; i < 12; i++) {
    const n = 2025 * 12 + 9 + i;
    const m = `${String(Math.floor(n / 12))}-${String((n % 12) + 1).padStart(2, '0')}`;
    await put(store, 'payment', payment('t-a', m, 48000));
  }
  expect((await closePeriod(store, QUERY, 'p1', clock, ids('c'))).status).toBe('closed');
  return store;
}

const beds = async (store: MemoryStore) =>
  (await loadAll(store, 'apartment', ApartmentSchema)).records[0];

describe('saveApartment with «valido dal» and the closed period (F5)', () => {
  it('a change from after the closed period passes and keeps the old beds before it; the undo takes it back', async () => {
    const store = await closed();
    const saved = await saveApartment(
      store,
      { id: 'apt', posti: 2, bedsValidFrom: yearMonth('2026-10') },
      'p1',
      clock,
      ids('a'),
      { confirmed: true },
    );
    expect(saved.status).toBe('updated');
    expect(await beds(store)).toMatchObject({
      posti: 2,
      earlierBeds: [{ to: '2026-09', posti: 1 }],
    });
    // A month before the last change: refused, nothing written.
    expect(
      await saveApartment(
        store,
        { id: 'apt', posti: 3, bedsValidFrom: yearMonth('2026-09') },
        'p1',
        clock,
        ids('b'),
        { confirmed: true },
      ),
    ).toEqual({ status: 'refused', reason: 'valid-from-order' });
    const op = (await readJournal(store)).operations.find((o) => o.kind === 'apartment.save');
    await undoOperation(store, op?.id ?? '', 'p1', clock, ids('u'));
    expect(await beds(store)).not.toHaveProperty('earlierBeds');
    expect((await beds(store))?.posti).toBe(1);
  });

  it('a change from inside the closed period, or without a date, is refused', async () => {
    const store = await closed();
    for (const bedsValidFrom of [yearMonth('2026-06'), undefined]) {
      await expect(
        saveApartment(
          store,
          { id: 'apt', posti: 2, ...(bedsValidFrom === undefined ? {} : { bedsValidFrom }) },
          'p1',
          clock,
          ids('a'),
          { confirmed: true },
        ),
      ).rejects.toBeInstanceOf(ClosedPeriodError);
    }
    expect((await beds(store))?.posti).toBe(1);
  });

  it('fewer beds from a month a stay still needs: refused as a beds conflict', async () => {
    const store = new MemoryStore();
    await put(store, 'apartment', apartment({ posti: 2 }));
    await put(store, 'tenancy', tenancy('t-a', '2025-10', undefined));
    await put(store, 'tenancy', tenancy('t-b', '2025-10', undefined));
    expect(
      await saveApartment(
        store,
        { id: 'apt', posti: 1, bedsValidFrom: yearMonth('2026-04') },
        'p1',
        clock,
        ids('a'),
        { confirmed: true },
      ),
    ).toMatchObject({ status: 'refused', reason: 'beds-conflict', month: '2026-04' });
  });
});

describe('a stay written against dated beds', () => {
  it('a second stay from January is refused where the beds drop to 1 in April', async () => {
    const store = new MemoryStore();
    await put(
      store,
      'apartment',
      apartment({ posti: 1, earlierBeds: [{ to: yearMonth('2026-03'), posti: 2 }] }),
    );
    await put(store, 'tenant', { id: 't-a', v: 1, rev: 1, name: 'Nome Inventato' });
    await put(store, 'tenant', { id: 't-b', v: 1, rev: 1, name: 'Altro Nome' });
    await put(store, 'tenancy', tenancy('t-a', '2025-10', undefined));
    const stay = (to?: string) => ({
      id: 'tcy-b',
      apartmentId: 'apt',
      tenantId: 't-b',
      from: yearMonth('2026-01'),
      ...(to === undefined ? {} : { to: yearMonth(to) }),
      monthlyRent: cents(45000),
      monthlyForfait: cents(3000),
    });
    expect(await saveTenancy(store, stay(), 'p1', clock, ids('t'))).toMatchObject({
      status: 'refused',
      reason: 'beds-conflict',
      month: '2026-04',
    });
    expect((await saveTenancy(store, stay('2026-03'), 'p1', clock, ids('t2'))).status).toBe(
      'saved',
    );
  });
});

describe('saveSupply with «valido dal» (F5)', () => {
  async function linked() {
    const store = new MemoryStore();
    await put(store, 'apartment', apartment({ id: 'x' }));
    await put(store, 'apartment', apartment({ id: 'y' }));
    const draft = {
      label: 'Utenza inventata',
      rows: [
        { apartmentId: 'x', basisPoints: 6000 },
        { apartmentId: 'y', basisPoints: 4000 },
      ],
      note: '',
    };
    expect((await saveSupply(store, draft, 'p1', clock, ids('s'))).status).toBe('saved');
    return { store, draft };
  }

  it('new weights from a month keep the old ones before it; without a date the label is in use', async () => {
    const { store, draft } = await linked();
    const next = {
      ...draft,
      rows: [
        { apartmentId: 'x', basisPoints: 5000 },
        { apartmentId: 'y', basisPoints: 5000 },
      ],
    };
    expect((await saveSupply(store, next, 'p1', clock, ids('t'))).status).toBe('refused');
    const saved = await saveSupply(store, next, 'p1', clock, ids('t'), {
      validFrom: yearMonth('2027-01'),
    });
    expect(saved.status).toBe('saved');
    const [supply] = (await loadAll(store, 'supply', SupplySchema)).records;
    expect(supply).toMatchObject({
      apartments: [{ weight: 5000 }, { weight: 5000 }],
      earlierApartments: [{ to: '2026-12', apartments: [{ weight: 6000 }, { weight: 4000 }] }],
    });
    expect(
      await saveSupply(store, draft, 'p1', clock, ids('v'), { validFrom: yearMonth('2026-06') }),
    ).toMatchObject({ status: 'refused', reason: 'valid-from-order' });
    // Undone: back to the weights from always.
    const op = (await readJournal(store)).operations.find((o) => o.kind === 'supply.update');
    await undoOperation(store, op?.id ?? '', 'p1', clock, ids('u'));
    const [back] = (await loadAll(store, 'supply', SupplySchema)).records;
    expect(back).not.toHaveProperty('earlierApartments');
  });
});
