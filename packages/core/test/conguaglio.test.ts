// The settlement (conguaglio) of a period: costs split by month and bed among the tenants present
// (section 42, R1-R5, R7). The condominium instalments have their own file
// (conguaglio-condominio.test.ts) and the golden fixtures theirs (conguaglio-golden.test.ts).
import { describe, expect, it } from 'vitest';
import {
  CORE_VERSION,
  InstalmentSchema,
  SettlementInputError,
  allocateBillToMonths,
  allocateInstalment,
  annualitaRange,
  billsForAnnualita,
  calcConguaglio,
  calcConguaglioSupplementare,
  canClosePeriod,
  collectedForfait,
  cents,
  isoDate,
  rateCoverage,
  yearMonth,
} from '../src/index';
import type { Bill, BillMatch, Instalment, Payment, Tenancy } from '../src/index';
import {
  apartment,
  bill,
  instalment,
  match,
  mulberry32,
  payment,
  period,
  shuffled,
  sum,
  tenancy,
} from './helpers/conguaglio-builders';

type CalcInput = Parameters<typeof calcConguaglio>[0];
type CalcResult = ReturnType<typeof calcConguaglio>;

const LEASE_YEAR = period('2026-10', '2027-09', '2026-27');

function calc(input: Partial<CalcInput>): CalcResult {
  return calcConguaglio({
    apartment: apartment(),
    period: LEASE_YEAR,
    bills: [],
    instalments: [],
    matches: [],
    tenancies: [],
    payments: [],
    ...input,
  });
}

function row(result: CalcResult, tenantId: string): CalcResult['tenants'][number] {
  const found = result.tenants.find((t) => t.tenantId === tenantId);
  if (found === undefined) throw new Error(`No row for ${tenantId}`);
  return found;
}

const FOUR_FULL_YEAR = ['a', 'b', 'c', 'd'].map((id) => tenancy(id, '2026-10', undefined));

describe('Step 1: values of the specification', () => {
  it('splits a bill equally over its months', () => {
    const luce = bill('luce', '2026-08-01', '2026-09-30', 21460);
    expect(allocateBillToMonths(luce)).toEqual([
      { month: '2026-08', amount: 10730 },
      { month: '2026-09', amount: 10730 },
    ]);
  });

  it('splits a given amount instead of the bill amount, remainders to the first months', () => {
    const luce = bill('luce', '2026-08-01', '2026-10-31', 21460);
    expect(allocateBillToMonths(luce, cents(100))).toEqual([
      { month: '2026-08', amount: 34 },
      { month: '2026-09', amount: 33 },
      { month: '2026-10', amount: 33 },
    ]);
  });

  it('gives 98,46 € each when 393,84 € go to 4 tenants present all the time', () => {
    const luce = bill('luce', '2026-10-01', '2026-11-30', 39384);
    const result = calc({
      bills: [luce],
      matches: [match(luce, 39384)],
      tenancies: FOUR_FULL_YEAR,
    });
    expect(result.tenants.map((t) => [t.tenantId, t.spese, t.due])).toEqual([
      ['a', 9846, 9846],
      ['b', 9846, 9846],
      ['c', 9846, 9846],
      ['d', 9846, 9846],
    ]);
    expect(result.unassigned).toBe(0);
    expect(result.engineVersion).toBe(CORE_VERSION);
    expect(row(result, 'a').byCategory).toEqual({ elettricita: 9846 });
  });

  it('due plus unassigned plus the flat charge collected equals the costs that entered (200 random cases)', () => {
    const next = mulberry32(20261111);
    const int = (min: number, max: number): number => min + Math.floor(next() * (max - min + 1));
    const months = Array.from({ length: 12 }, (_, i) => {
      const m = 10 + i;
      return `${2026 + Math.floor((m - 1) / 12)}-${String(((m - 1) % 12) + 1).padStart(2, '0')}`;
    });
    for (let run = 0; run < 200; run += 1) {
      const posti = int(1, 5);
      const withRooms = next() < 0.5;
      const rooms = Array.from({ length: posti }, (_, i) => `Posto ${i + 1}`);
      const tenancies: Tenancy[] = [];
      rooms.forEach((room, bed) => {
        let cursor = int(0, 3);
        let n = 0;
        while (cursor < 12 && next() < 0.8) {
          const end = Math.min(11, cursor + int(0, 11));
          tenancies.push(
            tenancy(`t${bed}-${n}`, months[cursor] as string, months[end] as string, {
              ...(withRooms ? { room } : {}),
              monthlyRent: cents(int(20000, 50000)),
              monthlyForfait: cents(int(0, 5000)),
            }),
          );
          n += 1;
          cursor = end + 1 + int(0, 2);
        }
      });
      const bills: Bill[] = [];
      const instalments: Instalment[] = [];
      const matches: BillMatch[] = [];
      let expectedTotal = 0;
      const billCount = int(0, 6);
      for (let b = 0; b < billCount; b += 1) {
        const start = int(0, 11);
        const end = int(start, 11);
        const item = bill(
          `b${b}`,
          `${months[start] as string}-01`,
          `${months[end] as string}-28`,
          int(-5000, 50000),
        );
        bills.push(item);
        const roll = next();
        const paid = next() < 0.8 ? item.amount : int(-5000, 50000);
        if (roll < 0.7) matches.push(match(item, paid));
        else if (roll < 0.9) matches.push(match(item, paid, { confirmed: false, by: 'auto' }));
        const commission = next() < 0.3 ? int(1, 200) : 0;
        if (commission !== 0) matches.push(match(item, commission, { part: 'commission' }));
        if (roll < 0.7) expectedTotal += paid + commission;
      }
      for (let index = 1; index <= 3; index += 1) {
        if (next() < 0.3) continue;
        const coverage = rateCoverage(yearMonth('2026-10'), 3, index);
        const item = instalment(`c${index}`, {
          rateIndex: index,
          rateCount: 3,
          coversFrom: coverage.from,
          coversTo: coverage.to,
          // Some records carry only last year's settlement, some a rata below the owner share.
          rata: cents(next() < 0.2 ? 0 : next() < 0.2 ? int(1, 1000) : int(0, 60000)),
          quotaProprieta: cents(int(0, 3000)),
          conguaglioPrec: cents(int(-5000, 5000)),
          straordinaria: next() < 0.1,
        });
        instalments.push(item);
        const expected = item.rata + item.conguaglioPrec;
        const paid = next() < 0.8 ? expected : expected + int(1, 100);
        matches.push(match(item, paid));
        // The owner's yearly share in three equal parts, the leftover cents to the first; none on
        // a record with rata 0, and a share above the rata keeps the instalment pending (R-C8).
        const share =
          item.rata === 0
            ? 0
            : Math.floor(item.quotaProprieta / 3) + (index <= item.quotaProprieta % 3 ? 1 : 0);
        if (paid === expected && item.straordinaria !== true && share <= item.rata) {
          expectedTotal += paid - share;
        }
      }
      if (next() < 0.5) {
        const tari = instalment('tari', {
          kind: 'tari',
          esercizio: '2027',
          rateIndex: 1,
          rateCount: 3,
          coversFrom: yearMonth('2027-01'),
          coversTo: yearMonth('2027-04'),
          rata: cents(int(1000, 20000)),
        });
        instalments.push(tari);
        matches.push(match(tari, tari.rata));
        expectedTotal += tari.rata;
      }
      const payments: Payment[] = tenancies.flatMap((t) =>
        months
          .filter((m) => m >= t.from && (t.to === undefined || m <= t.to) && next() < 0.7)
          .map((m) => payment(t.tenantId, m, int(0, 60000))),
      );
      const result = calc({
        apartment: apartment({
          posti,
          condominioStart: { month: 10, day: 1 },
          ...(withRooms ? { rooms } : {}),
        }),
        bills,
        instalments,
        matches,
        tenancies,
        payments,
      });
      const tenants = result.tenants;
      for (const t of tenants) {
        // Every rata is non-negative here: no tenant may get a condominium credit from it.
        expect(t.condominio.rata, `case ${run}`).toBeGreaterThanOrEqual(0);
        expect(Number.isSafeInteger(t.due)).toBe(true);
        expect(t.due).toBe(
          t.spese +
            t.condominio.rata +
            t.condominio.conguaglioPrec +
            t.commissione -
            t.forfaitIncassato,
        );
      }
      const total =
        sum(tenants.map((t) => t.due)) +
        result.unassigned +
        sum(tenants.map((t) => t.forfaitIncassato));
      expect(total, `case ${run}`).toBe(expectedTotal);
    }
  });
});

describe('Step 2: review focus', () => {
  const settembreOttobre = bill('luce', '2026-09-01', '2026-10-31', 20000);
  const BERCHET_START = { month: 10, day: 1 };

  it('puts September in 2025-26 and October in 2026-27 (Review Focus 1)', () => {
    const before = billsForAnnualita([settembreOttobre], annualitaRange('2025-26', BERCHET_START));
    const after = billsForAnnualita([settembreOttobre], annualitaRange('2026-27', BERCHET_START));
    expect(before).toEqual([{ month: '2026-09', amount: 10000, bill: settembreOttobre }]);
    expect(after).toEqual([{ month: '2026-10', amount: 10000, bill: settembreOttobre }]);
  });

  it('sends a month without tenants to unassigned, without NaN (Review Focus 2)', () => {
    const luce = bill('luce', '2026-10-01', '2026-11-30', 20000);
    const result = calc({
      bills: [luce],
      matches: [match(luce, 20000)],
      tenancies: [tenancy('a', '2026-11', undefined)],
    });
    // October: nobody, 100,00 € to the owner; November: 25,00 € to A, 75,00 € to empty beds.
    expect(row(result, 'a').spese).toBe(2500);
    expect(result.unassigned).toBe(17500);
    expect(Number.isNaN(result.unassigned)).toBe(false);
  });

  it('returns no tenants for a lease year without tenants', () => {
    const luce = bill('luce', '2026-10-01', '2026-10-31', 20000);
    const result = calc({ bills: [luce], matches: [match(luce, 20000)] });
    expect(result.tenants).toEqual([]);
    expect(result.unassigned).toBe(20000);
  });

  it('lowers the amount due with a credit note', () => {
    const luce = bill('luce', '2026-10-01', '2026-10-31', 20000);
    const nota = bill('nota', '2026-10-01', '2026-10-31', -4000);
    const without = calc({
      bills: [luce],
      matches: [match(luce, 20000)],
      tenancies: FOUR_FULL_YEAR,
    });
    const withCredit = calc({
      bills: [luce, nota],
      matches: [match(luce, 20000), match(nota, -4000)],
      tenancies: FOUR_FULL_YEAR,
    });
    expect(row(without, 'a').due).toBe(5000);
    expect(row(withCredit, 'a').due).toBe(4000);
  });

  it('keeps a bill without a confirmed match pending, out of the amount due (Review Focus 6)', () => {
    const luce = bill('luce', '2026-10-01', '2026-10-31', 20000);
    const gas = bill('gas', '2026-10-01', '2026-10-31', 8000, { category: 'gas' });
    const acqua = bill('acqua', '2026-10-01', '2026-10-31', 4000, { category: 'acqua' });
    const result = calc({
      bills: [luce, gas, acqua],
      matches: [match(luce, 20000), match(acqua, 4000, { confirmed: false, by: 'auto' })],
      tenancies: FOUR_FULL_YEAR,
    });
    expect(row(result, 'a').due).toBe(5000);
    expect(row(result, 'a').byCategory).toEqual({ elettricita: 5000 });
    expect(result.pending).toEqual([
      { itemType: 'bill', itemId: 'acqua' },
      { itemType: 'bill', itemId: 'gas' },
    ]);
  });

  it('uses the amount debited, not the amount of the bill (R2)', () => {
    const luce = bill('luce', '2026-10-01', '2026-10-31', 20000);
    const result = calc({
      bills: [luce],
      matches: [match(luce, 20400)],
      tenancies: FOUR_FULL_YEAR,
    });
    expect(row(result, 'a').spese).toBe(5100);
  });

  it('leaves out bills excluded from the settlement and items outside the period', () => {
    const excluded = bill('privata', '2026-10-01', '2026-10-31', 20000, {
      includedInConguaglio: false,
    });
    const notShared = bill('proprieta', '2026-10-01', '2026-10-31', 20000, {
      sharedWithTenants: false,
    });
    const earlier = bill('vecchia', '2026-08-01', '2026-09-30', 20000);
    const result = calc({ bills: [excluded, notShared, earlier], tenancies: FOUR_FULL_YEAR });
    expect(result.pending).toEqual([]);
    expect(row(result, 'a').due).toBe(0);
    expect(row(result, 'a').byCategory).toEqual({});
  });

  it('lists every tenant present in the period once, sorted, even with two tenancies', () => {
    const result = calc({
      tenancies: [
        tenancy('b', '2026-10', '2026-12'),
        tenancy('a', '2027-01', undefined),
        tenancy('b', '2027-03', '2027-05'),
        tenancy('z', '2025-01', '2026-09'),
      ],
    });
    expect(result.tenants.map((t) => t.tenantId)).toEqual(['a', 'b']);
  });

  it('gives the leftover cents to the first beds in the order of the rooms (R30)', () => {
    const rooms = ['Singola', 'Doppia 1', 'Doppia 2'];
    const luce = bill('luce', '2026-10-01', '2026-10-31', 101);
    const result = calc({
      apartment: apartment({ posti: 3, rooms }),
      bills: [luce],
      matches: [match(luce, 101)],
      tenancies: [
        tenancy('a', '2026-10', undefined, { room: 'Doppia 2' }),
        tenancy('b', '2026-10', undefined, { room: 'Doppia 1' }),
        tenancy('c', '2026-10', undefined, { room: 'Singola' }),
      ],
    });
    expect(result.tenants.map((t) => [t.tenantId, t.spese])).toEqual([
      ['a', 33],
      ['b', 34],
      ['c', 34],
    ]);
  });

  it('without rooms gives the leftover cents to the tenants sorted by id, then empty beds', () => {
    const luce = bill('luce', '2026-10-01', '2026-10-31', 103);
    const result = calc({
      bills: [luce],
      matches: [match(luce, 103)],
      tenancies: [tenancy('b', '2026-10', undefined), tenancy('a', '2026-10', undefined)],
    });
    expect(result.tenants.map((t) => [t.tenantId, t.spese])).toEqual([
      ['a', 26],
      ['b', 26],
    ]);
    expect(result.unassigned).toBe(51);
  });

  describe('input that cannot be settled (R-C9)', () => {
    const luce = bill('luce', '2026-10-01', '2026-10-31', 100);
    const input = { bills: [luce], matches: [match(luce, 100)] };
    const withRooms = apartment({ posti: 2, rooms: ['Uno', 'Due'] });
    const settlementError = (run: () => unknown): SettlementInputError => {
      try {
        run();
      } catch (error) {
        if (error instanceof SettlementInputError) return error;
        throw error;
      }
      throw new Error('No SettlementInputError thrown');
    };

    it('refuses a room that is not a bed', () => {
      const error = settlementError(() =>
        calc({
          ...input,
          apartment: withRooms,
          tenancies: [tenancy('a', '2026-10', undefined, { room: 'Tre' })],
        }),
      );
      expect(error).toMatchObject({ code: 'unknown-room', room: 'Tre', tenantId: 'a' });
      expect(error.name).toBe('SettlementInputError');
      expect(error.message).toContain('non è un posto');
      const missing = settlementError(() =>
        calc({ ...input, apartment: withRooms, tenancies: [tenancy('a', '2026-10', undefined)] }),
      );
      expect(missing).toMatchObject({ code: 'unknown-room', tenancyIds: ['tcy-a-2026-10'] });
      expect(missing.room).toBeUndefined();
    });

    it('refuses two tenants in one room in the same month, with their ids', () => {
      const error = settlementError(() =>
        calc({
          ...input,
          apartment: withRooms,
          tenancies: [
            tenancy('b', '2026-10', '2026-10', { room: 'Uno' }),
            tenancy('a', '2026-10', undefined, { room: 'Uno' }),
          ],
        }),
      );
      expect(error).toMatchObject({
        code: 'room-overlap',
        room: 'Uno',
        month: '2026-10',
        tenancyIds: ['tcy-a-2026-10', 'tcy-b-2026-10'],
      });
      expect(error.message).toContain('correggi le date');
    });

    it('refuses more tenants than beds', () => {
      const error = settlementError(() =>
        calc({
          ...input,
          apartment: apartment({ posti: 1 }),
          tenancies: [tenancy('a', '2026-10', undefined), tenancy('b', '2026-10', undefined)],
        }),
      );
      expect(error).toMatchObject({ code: 'too-many-tenants', month: '2026-10' });
    });

    it.each([
      ['with rooms', withRooms, { room: 'Uno' }, { room: 'Due' }],
      ['without rooms', apartment({ posti: 2 }), {}, {}],
    ])('refuses a room change that counts the same month twice, %s', (_, apt, first, second) => {
      // Months are inclusive: ending in March and starting again in March overlap.
      const tenancies = [
        tenancy('a', '2026-10', '2027-03', first),
        tenancy('a', '2027-03', undefined, second),
      ];
      const error = settlementError(() => calc({ ...input, apartment: apt, tenancies }));
      expect(error).toMatchObject({
        code: 'tenant-overlap',
        tenantId: 'a',
        month: '2027-03',
        tenancyIds: ['tcy-a-2026-10', 'tcy-a-2027-03'],
      });
      const months = [yearMonth('2027-03')];
      const payments = [payment('a', '2027-03', 48000)];
      expect(() => collectedForfait({ tenancies, payments, months })).toThrow(SettlementInputError);
      expect(() => canClosePeriod({ tenancies, payments, months, pending: [] })).toThrow(
        SettlementInputError,
      );
      // Ending in February instead, March is counted once.
      const fixed = [
        tenancy('a', '2026-10', '2027-02', first),
        tenancy('a', '2027-03', undefined, second),
      ];
      const rows = collectedForfait({ tenancies: fixed, payments, months });
      expect(calc({ ...input, apartment: apt, tenancies: fixed }).tenants).toHaveLength(1);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.forfaitCollected).toBe(3000);
    });
  });

  it('ignores deleted records', () => {
    const luce = bill('luce', '2026-10-01', '2026-10-31', 20000);
    const gas = bill('gas', '2026-10-01', '2026-10-31', 8000, { category: 'gas' });
    const base = {
      bills: [luce],
      matches: [match(luce, 20000)],
      tenancies: FOUR_FULL_YEAR,
      payments: [payment('a', '2026-10', 48000)],
    };
    const expected = calc(base);
    const withDeleted = calc({
      bills: [luce, { ...gas, deleted: true }],
      matches: [
        ...base.matches,
        match(gas, 8000),
        match(luce, 500, { id: 'm-extra', transactionId: 'tx-extra', deleted: true }),
      ],
      tenancies: [...FOUR_FULL_YEAR, tenancy('x', '2026-10', undefined, { deleted: true })],
      payments: [...base.payments, payment('b', '2026-10', 48000, { deleted: true })],
    });
    expect(withDeleted).toEqual(expected);
    const deletedMatch = calc({ ...base, matches: [match(luce, 20000, { deleted: true })] });
    expect(deletedMatch.pending).toEqual([{ itemType: 'bill', itemId: 'luce' }]);
  });

  it('ignores records of other apartments', () => {
    const luce = bill('luce', '2026-10-01', '2026-10-31', 20000, { apartmentId: 'altro' });
    const result = calc({
      bills: [luce],
      matches: [match(luce, 20000)],
      tenancies: [...FOUR_FULL_YEAR, tenancy('x', '2026-10', undefined, { apartmentId: 'altro' })],
      payments: [payment('a', '2026-10', 48000, { apartmentId: 'altro' })],
    });
    expect(result.tenants.map((t) => t.tenantId)).toEqual(['a', 'b', 'c', 'd']);
    expect(result.unassigned).toBe(0);
    expect(row(result, 'a').forfaitIncassato).toBe(0);
  });
});

describe('Step 3b: items paid in instalments (R3)', () => {
  const tari = (count: number, index: number): Instalment => {
    const coverage = rateCoverage(yearMonth('2026-01'), count, index);
    return instalment(`tari-${count}-${index}`, {
      kind: 'tari',
      esercizio: '2026',
      rateCount: count,
      rateIndex: index,
      rata: cents(1200),
      coversFrom: coverage.from,
      coversTo: coverage.to,
    });
  };

  it.each([
    [2, 6],
    [4, 3],
    [3, 4],
    [1, 12],
  ])('with %i instalments each covers %i months, in order', (count, length) => {
    const seen: string[] = [];
    for (let index = 1; index <= count; index += 1) {
      const parts = allocateInstalment(tari(count, index), cents(1200));
      expect(parts).toHaveLength(length);
      expect(sum(parts.map((p) => p.rata))).toBe(1200);
      expect(parts.every((p) => p.conguaglioPrec === 0)).toBe(true);
      seen.push(...parts.map((p) => p.month));
    }
    expect(seen).toEqual(
      Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}`),
    );
  });

  it('the model refuses a number of instalments that does not divide 12', () => {
    expect(InstalmentSchema.safeParse({ ...tari(4, 1), rateCount: 5 }).success).toBe(false);
  });

  it('gives no share of an extraordinary instalment to the tenants', () => {
    const straordinaria = instalment('straord', { rata: cents(50000), straordinaria: true });
    expect(
      allocateInstalment(
        straordinaria,
        cents(50000),
        annualitaRange('2026-27', { month: 5, day: 1 }),
      ),
    ).toEqual([]);
    const result = calc({
      apartment: apartment({ condominioStart: { month: 5, day: 1 } }),
      period: period('2026-05', '2027-04', '2026-27'),
      instalments: [straordinaria],
      matches: [match(straordinaria, 50000)],
      tenancies: FOUR_FULL_YEAR.map((t) => ({ ...t, from: yearMonth('2026-05') })),
    });
    expect(result.tenants.every((t) => t.due === 0)).toBe(true);
    expect(result.unassigned).toBe(0);
    expect(result.pending).toEqual([]);
  });

  it('assigns September of the December TARI notice to the earlier Berchet lease year', () => {
    const terzo = instalment('tari-2025-3', {
      kind: 'tari',
      esercizio: '2025',
      rateIndex: 3,
      rateCount: 3,
      rata: cents(12186),
      coversFrom: yearMonth('2025-09'),
      coversTo: yearMonth('2025-12'),
    });
    const berchet = apartment({ posti: 5 });
    const tenants = ['a', 'b', 'c', 'd', 'e'].map((id) => tenancy(id, '2024-10', undefined));
    const input = {
      apartment: berchet,
      instalments: [terzo],
      matches: [match(terzo, 12186)],
      tenancies: tenants,
    };
    const earlier = calc({ ...input, period: period('2024-10', '2025-09', '2024-25') });
    const later = calc({ ...input, period: period('2025-10', '2026-09', '2025-26') });
    const total = (r: CalcResult): number =>
      sum(r.tenants.map((t) => t.byCategory.tari ?? 0)) + r.unassigned;
    expect(total(earlier)).toBe(3047);
    expect(total(later)).toBe(12186 - 3047);
    expect(row(earlier, 'a').byCategory).toEqual({ tari: 610 });
  });

  it('splits a shared TARI by the amount matched to this apartment', () => {
    const quota = instalment('tari-berchet', {
      kind: 'tari',
      esercizio: '2027',
      rateIndex: 1,
      rateCount: 3,
      rata: cents(10075),
      coversFrom: yearMonth('2027-01'),
      coversTo: yearMonth('2027-04'),
    });
    const result = calc({
      instalments: [quota],
      matches: [match(quota, 10104)],
      tenancies: FOUR_FULL_YEAR,
    });
    expect(sum(result.tenants.map((t) => t.spese))).toBe(10104);
  });
});

describe('Step 3c: flat charge (R4)', () => {
  const months = [yearMonth('2026-10')];
  const one = [tenancy('a', '2026-10', undefined)];

  it.each([
    [48000, 3000],
    [46000, 1000],
    [45000, 0],
    [50000, 3000],
  ])('a payment of %i cents collects %i cents of flat charge', (paid, collected) => {
    expect(
      collectedForfait({ tenancies: one, payments: [payment('a', '2026-10', paid)], months }),
    ).toEqual([
      {
        tenantId: 'a',
        month: '2026-10',
        rentDue: 45000,
        forfaitDue: 3000,
        paid,
        forfaitCollected: collected,
      },
    ]);
  });

  it('collects nothing in a month without payments, and the amount due is higher', () => {
    expect(collectedForfait({ tenancies: one, payments: [], months })[0]?.forfaitCollected).toBe(0);
    const luce = bill('luce', '2026-10-01', '2026-11-30', 20000);
    const input = { bills: [luce], matches: [match(luce, 20000)], tenancies: FOUR_FULL_YEAR };
    const paid = calc({
      ...input,
      payments: [payment('a', '2026-10', 48000), payment('a', '2026-11', 48000)],
    });
    const unpaid = calc({ ...input, payments: [payment('a', '2026-10', 48000)] });
    expect(row(paid, 'a').due).toBe(5000 - 6000);
    expect(row(unpaid, 'a').due).toBe(5000 - 3000);
  });

  it('adds up several payments of the same month, whatever their order', () => {
    const payments = [
      payment('a', '2026-10', 20000),
      payment('a', '2026-10', 26000),
      payment('a', '2026-11', 48000),
      payment('b', '2026-10', 47000, { forMonth: undefined, date: isoDate('2026-10-03') }),
    ];
    const next = mulberry32(7);
    const first = calc({ tenancies: FOUR_FULL_YEAR, payments });
    for (let i = 0; i < 5; i += 1) {
      expect(calc({ tenancies: FOUR_FULL_YEAR, payments: shuffled(payments, next) })).toEqual(
        first,
      );
    }
    expect(row(first, 'a').forfaitIncassato).toBe(1000 + 3000);
    expect(row(first, 'b').forfaitIncassato).toBe(2000);
  });

  it('counts neither a deposit nor an unconfirmed payment', () => {
    const payments = [
      payment('a', '2026-10', 50000, { kind: 'caparra' }),
      payment('a', '2026-10', 48000, { confirmed: false }),
    ];
    expect(collectedForfait({ tenancies: one, payments, months })[0]?.forfaitCollected).toBe(0);
  });

  const berchet = [
    tenancy('a', '2026-10', undefined, { monthlyRent: cents(45000) }),
    ...['b', 'c', 'd', 'e'].map((id) =>
      tenancy(id, '2026-10', undefined, { monthlyRent: cents(35000) }),
    ),
  ];

  it('gives no warning when the rents and flat charges add up to the contract', () => {
    const result = calc({
      apartment: apartment({ posti: 5, contrattoMensile: cents(200000) }),
      tenancies: berchet,
    });
    expect(result.warnings).toEqual([]);
  });

  it('warns when they do not, without stopping the calculation', () => {
    const luce = bill('luce', '2026-10-01', '2026-10-31', 50000);
    const result = calc({
      apartment: apartment({ posti: 5, contrattoMensile: cents(199000) }),
      tenancies: berchet,
      bills: [luce],
      matches: [match(luce, 50000)],
    });
    expect(result.warnings).toEqual([
      { code: 'contratto-mensile', expected: 199000, actual: 200000 },
    ]);
    expect(row(result, 'a').spese).toBe(10000);
  });

  it('Lovarini: one period for the whole contract with two takeovers', () => {
    const lovarini = apartment({
      posti: 4,
      rooms: ['R1', 'R2', 'R3', 'R4'],
      annualitaStart: { month: 4, day: 1 },
      condominioStart: { month: 5, day: 1 },
    });
    const tenancies = [
      tenancy('w1', '2024-04', '2026-03', { room: 'R1' }),
      tenancy('w2', '2026-04', '2029-03', { room: 'R1' }),
      tenancy('x', '2024-04', '2029-03', { room: 'R2' }),
      tenancy('y1', '2024-04', '2025-09', { room: 'R3' }),
      tenancy('y2', '2025-10', '2029-03', { room: 'R3' }),
      tenancy('z', '2024-04', '2029-03', { room: 'R4' }),
    ];
    // 4.000,00 € a month over 60 months, and last year's condominium settlement of 2025-26.
    const acqua = bill('acqua', '2024-04-01', '2029-03-31', 240000, { category: 'acqua' });
    const conguaglio = instalment('cond-2025-26-1', {
      esercizio: '2025-26',
      rateIndex: 1,
      rateCount: 3,
      coversFrom: yearMonth('2025-05'),
      coversTo: yearMonth('2025-08'),
      conguaglioPrec: cents(4800),
    });
    const result = calc({
      apartment: lovarini,
      period: period('2024-04', '2029-03', '2024-29'),
      bills: [acqua],
      instalments: [conguaglio],
      matches: [match(acqua, 240000), match(conguaglio, 4800)],
      tenancies,
    });
    const view = result.tenants.map((t) => [
      t.tenantId,
      t.byCategory.acqua,
      t.condominio.conguaglioPrec,
    ]);
    expect(view).toEqual([
      ['w1', 24000, 1100],
      ['w2', 36000, 100],
      ['x', 60000, 1200],
      ['y1', 18000, 500],
      ['y2', 42000, 700],
      ['z', 60000, 1200],
    ]);
  });
});

describe('Step 3d: supplementary settlement (R5)', () => {
  const berchet = apartment({ posti: 5 });
  const annualita = period('2024-10', '2025-09', '2024-25');
  const tenancies = [
    ...['a', 'b', 'c', 'e'].map((id) => tenancy(id, '2024-10', undefined)),
    tenancy('d', '2024-10', '2025-08'),
    tenancy('f', '2025-09', undefined),
  ];
  const internet = bill('internet', '2024-10-01', '2024-10-31', 3000, { category: 'internet' });
  const base = { apartment: berchet, period: annualita, tenancies, instalments: [], payments: [] };
  const snapshot = calcConguaglio({ ...base, bills: [internet], matches: [match(internet, 3000)] });
  const frozen = structuredClone(snapshot);
  const asOf = isoDate('2025-11-20');

  const late9000 = () => {
    const luce = bill('luce-tardiva', '2025-07-01', '2025-09-30', 9000);
    return calcConguaglio({
      ...base,
      bills: [internet, luce],
      matches: [match(internet, 3000), match(luce, 9000)],
    });
  };

  const late = (amount: number) => {
    const luce = bill('luce-tardiva', '2025-07-01', '2025-09-30', amount);
    const current = calcConguaglio({
      ...base,
      bills: [internet, luce],
      matches: [match(internet, 3000), match(luce, amount)],
    });
    return calcConguaglioSupplementare({ current, snapshot, tenancies, asOf });
  };

  it('splits a late bill among those present in its months, departed tenants included', () => {
    const result = late(9000);
    expect(result.tenants.map((t) => [t.tenantId, t.delta, t.departed, t.action])).toEqual([
      ['a', 1800, false, 'da-pagare'],
      ['b', 1800, false, 'da-pagare'],
      ['c', 1800, false, 'da-pagare'],
      ['d', 1200, true, 'da-trattenere-o-richiedere'],
      ['e', 1800, false, 'da-pagare'],
      ['f', 600, false, 'da-pagare'],
    ]);
    expect(sum(result.tenants.map((t) => t.delta))).toBe(9000);
    expect(result.unassignedDelta).toBe(0);
    expect(snapshot).toEqual(frozen);
  });

  it('refunds a late credit note to the same tenants', () => {
    const result = late(-9000);
    expect(result.tenants.map((t) => [t.tenantId, t.delta, t.action])).toEqual([
      ['a', -1800, 'da-rimborsare'],
      ['b', -1800, 'da-rimborsare'],
      ['c', -1800, 'da-rimborsare'],
      ['d', -1200, 'da-rimborsare'],
      ['e', -1800, 'da-rimborsare'],
      ['f', -600, 'da-rimborsare'],
    ]);
  });

  it('gives all deltas 0 when nothing new arrived', () => {
    const current = calcConguaglio({
      ...base,
      bills: [internet],
      matches: [match(internet, 3000)],
    });
    const result = calcConguaglioSupplementare({ current, snapshot, tenancies, asOf });
    expect(result.tenants.map((t) => t.delta)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(result.unassignedDelta).toBe(0);
  });

  it('ignores the flat charge and last year condominium settlement, and reports empty beds', () => {
    const empty = calcConguaglio({ ...base, tenancies: [], bills: [], matches: [] });
    const withOnlyCosts = {
      ...empty,
      unassigned: cents(500 + 70),
      unassignedByBucket: {
        spese: cents(500),
        rata: cents(0),
        conguaglioPrec: cents(70),
        commissione: cents(0),
      },
      tenants: [
        {
          tenantId: 'a',
          spese: cents(100),
          condominio: { rata: cents(10), conguaglioPrec: cents(999) },
          commissione: cents(1),
          forfaitIncassato: cents(3000),
          due: cents(100 + 10 + 999 + 1 - 3000),
          byCategory: {},
        },
      ],
    };
    const result = calcConguaglioSupplementare({
      current: withOnlyCosts,
      snapshot: empty,
      tenancies,
      asOf,
    });
    expect(result.tenants).toEqual([
      { tenantId: 'a', delta: 111, departed: false, action: 'da-pagare' },
    ]);
    expect(result.unassignedDelta).toBe(500);
  });

  it('treats a tenant without tenancies as departed (R-C10)', () => {
    const result = calcConguaglioSupplementare({
      current: late9000(),
      snapshot,
      tenancies: tenancies.filter((t) => t.tenantId !== 'd'),
      asOf,
    });
    expect(result.tenants.find((t) => t.tenantId === 'd')).toEqual({
      tenantId: 'd',
      delta: 1200,
      departed: true,
      action: 'da-trattenere-o-richiedere',
    });
  });

  it('adds up to the net cost of a late condominium instalment, last year settlement left out', () => {
    // 4 beds, one empty from August; condominium year October-September like the lease year.
    const apt = apartment({ posti: 4, condominioStart: { month: 10, day: 1 } });
    const people = [
      tenancy('a', '2024-10', undefined),
      tenancy('b', '2024-10', undefined),
      tenancy('c', '2024-10', undefined),
      tenancy('d', '2024-10', '2025-07'),
    ];
    const rata = instalment('cond-3', {
      esercizio: '2024-25',
      rateIndex: 3,
      rateCount: 3,
      rata: cents(12000),
      quotaProprieta: cents(2400),
      conguaglioPrec: cents(3600),
      coversFrom: yearMonth('2025-06'),
      coversTo: yearMonth('2025-09'),
    });
    const common = {
      apartment: apt,
      period: annualita,
      bills: [],
      tenancies: people,
      payments: [],
    };
    const before = calcConguaglio({ ...common, instalments: [rata], matches: [] });
    const after = calcConguaglio({
      ...common,
      instalments: [rata],
      matches: [match(rata, 15600)],
    });
    expect(after.unassignedByBucket.conguaglioPrec).toBeGreaterThan(0);
    const result = calcConguaglioSupplementare({
      current: after,
      snapshot: before,
      tenancies: people,
      asOf,
    });
    // 120,00 € of rata minus the owner's 8,00 €; the 36,00 € of last year are not part of it.
    expect(sum(result.tenants.map((t) => t.delta)) + result.unassignedDelta).toBe(12000 - 800);
    expect(result.unassignedDelta).toBe(after.unassignedByBucket.rata);
  });
});

describe('Step 3e: closing the period and commission', () => {
  const months = [yearMonth('2026-10'), yearMonth('2026-11')];
  const one = [tenancy('a', '2026-10', undefined)];
  const tariDicembre = {
    itemType: 'instalment' as const,
    itemId: 'tari-3',
    months: ['2026-09', '2026-10', '2026-11', '2026-12'].map(yearMonth),
  };

  it('cannot close with one flat charge missing', () => {
    const payments = [payment('a', '2026-10', 48000), payment('a', '2026-11', 45000)];
    expect(canClosePeriod({ tenancies: one, payments, months, pending: [] })).toEqual({
      ok: false,
      missing: [{ tenantId: 'a', month: '2026-11', kind: 'forfait', amount: 3000 }],
    });
  });

  it('reports the missing rent and flat charge of a short payment', () => {
    const payments = [payment('a', '2026-10', 48000), payment('a', '2026-11', 40000)];
    expect(canClosePeriod({ tenancies: one, payments, months, pending: [] }).missing).toEqual([
      { tenantId: 'a', month: '2026-11', kind: 'rent', amount: 5000 },
      { tenantId: 'a', month: '2026-11', kind: 'forfait', amount: 3000 },
    ]);
  });

  it('cannot close while the December TARI notice is not debited yet', () => {
    const payments = [payment('a', '2026-10', 48000), payment('a', '2026-11', 48000)];
    const outside = { itemType: 'bill' as const, itemId: 'futura', months: [yearMonth('2027-01')] };
    expect(
      canClosePeriod({ tenancies: one, payments, months, pending: [tariDicembre, outside] }),
    ).toEqual({
      ok: false,
      missing: [{ kind: 'item', itemType: 'instalment', itemId: 'tari-3' }],
    });
    expect(canClosePeriod({ tenancies: one, payments, months, pending: [] })).toEqual({
      ok: true,
      missing: [],
    });
  });

  it('adds a matched commission to the bill, split like it (R7)', () => {
    const luce = bill('luce', '2026-10-01', '2026-10-31', 10000);
    const withRow = calc({
      bills: [luce],
      matches: [
        match(luce, 10000),
        match(luce, 80, { part: 'commission', transactionId: 'tx-comm' }),
      ],
      tenancies: FOUR_FULL_YEAR,
    });
    expect(withRow.tenants.map((t) => [t.spese, t.commissione, t.due])).toEqual([
      [2500, 20, 2520],
      [2500, 20, 2520],
      [2500, 20, 2520],
      [2500, 20, 2520],
    ]);
    expect(row(withRow, 'a').byCategory).toEqual({ elettricita: 2500 });
    const without = calc({
      bills: [luce],
      matches: [match(luce, 10000)],
      tenancies: FOUR_FULL_YEAR,
    });
    expect(sum(without.tenants.map((t) => t.spese + t.commissione))).toBe(10000);
  });

  it('ignores a commission whose item has no confirmed debit', () => {
    const luce = bill('luce', '2026-10-01', '2026-10-31', 10000);
    const result = calc({
      bills: [luce],
      matches: [match(luce, 80, { part: 'commission' })],
      tenancies: FOUR_FULL_YEAR,
    });
    expect(result.tenants.every((t) => t.commissione === 0)).toBe(true);
    expect(result.pending).toEqual([{ itemType: 'bill', itemId: 'luce' }]);
  });
});
