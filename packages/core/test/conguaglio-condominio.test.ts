// Condominium instalments in the settlement (section 42, R3; Review Focus 7). The example is the
// one of section 42: 4 beds, fiscal year May 2026 - April 2027, 4 instalments of 3 months (the
// real plans have 3 instalments of 4 months). A, B, C stay all year, E until July, D from August.
import { describe, expect, it } from 'vitest';
import {
  allocateInstalment,
  annualitaRange,
  calcConguaglio,
  cents,
  SettlementInputError,
  rateCoverage,
  yearMonth,
} from '../src/index';
import type { BillMatch, Instalment, Tenancy } from '../src/index';
import {
  apartment,
  instalment,
  match,
  mulberry32,
  period,
  shuffled,
  sum,
  tenancy,
} from './helpers/conguaglio-builders';

const CONDOMINIO_START = { month: 5, day: 1 };
const ESERCIZIO = annualitaRange('2026-27', CONDOMINIO_START);

const TENANCIES: Tenancy[] = [
  tenancy('a', '2026-05', undefined),
  tenancy('b', '2026-05', undefined),
  tenancy('c', '2026-05', undefined),
  tenancy('d', '2026-08', undefined),
  tenancy('e', '2026-05', '2026-07'),
];

/** Instalment `index` of 4: the owner's 24,00 € a year come off in four parts of 6,00 €. */
function rata(index: number, extra: Partial<Instalment> = {}): Instalment {
  const coverage = rateCoverage(yearMonth('2026-05'), 4, index);
  return instalment(`cond-${index}`, {
    rateIndex: index,
    rateCount: 4,
    rata: cents(15000),
    quotaProprieta: cents(2400),
    conguaglioPrec: cents(index === 1 ? 4800 : 0),
    coversFrom: coverage.from,
    coversTo: coverage.to,
    ...extra,
  });
}

function calc(instalments: Instalment[], matches: BillMatch[], tenancies = TENANCIES) {
  return calcConguaglio({
    apartment: apartment({ posti: 4, condominioStart: CONDOMINIO_START }),
    period: period('2026-05', '2027-04', '2026-27'),
    bills: [],
    instalments,
    matches,
    tenancies,
    payments: [],
  });
}

type Result = ReturnType<typeof calc>;
const view = (result: Result) =>
  result.tenants.map((t) => [t.tenantId, t.condominio.rata, t.condominio.conguaglioPrec, t.due]);
const shared = (result: Result): number =>
  sum(result.tenants.map((t) => t.condominio.rata + t.condominio.conguaglioPrec)) +
  result.unassigned;

describe('Step 3: condominium instalments (R3)', () => {
  const first = rata(1);
  const second = rata(2);

  it('allocates the instalment net of the owner share over its months, last year over 12', () => {
    const parts = allocateInstalment(first, cents(19800), ESERCIZIO);
    expect(parts).toHaveLength(12);
    expect(parts.slice(0, 3)).toEqual([
      { month: '2026-05', rata: 4800, conguaglioPrec: 400 },
      { month: '2026-06', rata: 4800, conguaglioPrec: 400 },
      { month: '2026-07', rata: 4800, conguaglioPrec: 400 },
    ]);
    expect(parts.slice(3).every((p) => p.rata === 0 && p.conguaglioPrec === 400)).toBe(true);
    expect(parts[11]?.month).toBe('2027-04');
  });

  it('needs the fiscal year to spread last year settlement', () => {
    expect(() => allocateInstalment(first, cents(19800))).toThrow(RangeError);
  });

  it('charges the first instalment as in section 42', () => {
    const result = calc([first, second], [match(first, 19800)]);
    expect(view(result)).toEqual([
      ['a', 3600, 1200, 4800],
      ['b', 3600, 1200, 4800],
      ['c', 3600, 1200, 4800],
      ['d', 0, 900, 900],
      ['e', 3600, 300, 3900],
    ]);
    expect(result.unassigned).toBe(0);
    expect(shared(result) + 600).toBe(19800);
    expect(result.tenants[0]?.byCategory).toEqual({ condominio: 4800 });
    expect(result.tenants[0]?.spese).toBe(0);
    expect(result.pending).toEqual([{ itemType: 'instalment', itemId: 'cond-2' }]);
  });

  it('adds the second instalment only once it is matched', () => {
    const before = calc([first, second], [match(first, 19800)]);
    const after = calc([first, second], [match(first, 19800), match(second, 15000)]);
    const added = after.tenants.map((t, i) => [t.tenantId, t.due - (before.tenants[i]?.due ?? 0)]);
    expect(added).toEqual([
      ['a', 3600],
      ['b', 3600],
      ['c', 3600],
      ['d', 3600],
      ['e', 0],
    ]);
    expect(after.pending).toEqual([]);
  });

  it('sends the share of an empty bed to unassigned', () => {
    const withoutD = TENANCIES.filter((t) => t.tenantId !== 'd');
    const result = calc([first, second], [match(first, 19800), match(second, 15000)], withoutD);
    // Last year: 1,00 € a bed for August-April; second instalment: 12,00 € a bed for 3 months.
    expect(result.unassigned).toBe(900 + 3600);
    expect(shared(result) + 1200).toBe(19800 + 15000);
  });

  it('shares 100,01 € over 3 months to the cent', () => {
    const odd = rata(1, { rata: cents(10001), quotaProprieta: cents(0), conguaglioPrec: cents(0) });
    expect(sum(allocateInstalment(odd, cents(10001), ESERCIZIO).map((p) => p.rata))).toBe(10001);
    const result = calc([odd], [match(odd, 10001)]);
    expect(shared(result)).toBe(10001);
  });

  it('charges the whole instalment when the owner share is 0', () => {
    const whole = rata(1, { quotaProprieta: cents(0), conguaglioPrec: cents(0) });
    const result = calc([whole], [match(whole, 15000)]);
    expect(shared(result)).toBe(15000);
    expect(result.tenants[0]?.condominio.rata).toBe(3750);
  });

  it('keeps an instalment with a different debit pending', () => {
    const result = calc([first], [match(first, 19700)]);
    expect(result.pending).toEqual([
      { itemType: 'instalment', itemId: 'cond-1', reason: 'importo diverso' },
    ]);
    expect(result.tenants.every((t) => t.due === 0)).toBe(true);
    expect(result.unassigned).toBe(0);
  });

  it('gives back last year credit in the same shares', () => {
    const credit = rata(1, { conguaglioPrec: cents(-4800) });
    const result = calc([credit], [match(credit, 10200)]);
    expect(view(result)).toEqual([
      ['a', 3600, -1200, 2400],
      ['b', 3600, -1200, 2400],
      ['c', 3600, -1200, 2400],
      ['d', 0, -900, -900],
      ['e', 3600, -300, 3300],
    ]);
  });

  it('spreads last year settlement paid on its own over the 12 months, without owner share', () => {
    // The record repeats the owner's yearly 24,00 €, as every record of the fiscal year does.
    const alone = rata(1, { rata: cents(0), conguaglioPrec: cents(4800) });
    expect(allocateInstalment(alone, cents(4800), ESERCIZIO).every((p) => p.rata === 0)).toBe(true);
    const result = calc([alone], [match(alone, 4800)]);
    expect(view(result)).toEqual([
      ['a', 0, 1200, 1200],
      ['b', 0, 1200, 1200],
      ['c', 0, 1200, 1200],
      ['d', 0, 900, 900],
      ['e', 0, 300, 300],
    ]);
  });

  it('takes the owner share once a year, from the ordinary instalments only (R-C8)', () => {
    const alone = instalment('cond-0', {
      rateIndex: 1,
      rateCount: 4,
      rata: cents(0),
      quotaProprieta: cents(2400),
      conguaglioPrec: cents(4800),
      coversFrom: yearMonth('2026-05'),
      coversTo: yearMonth('2026-07'),
    });
    const ordinary = [1, 2, 3, 4].map((index) => rata(index, { conguaglioPrec: cents(0) }));
    const items = [alone, ...ordinary];
    const result = calc(
      items,
      items.map((item) => match(item, item.rata + item.conguaglioPrec)),
    );
    expect(result.pending).toEqual([]);
    expect(result.tenants.every((t) => t.condominio.rata >= 0)).toBe(true);
    // Debited 600,00 € + 48,00 €; the owner keeps exactly 24,00 €.
    expect(4 * 15000 + 4800 - shared(result)).toBe(2400);
    expect(sum(result.tenants.map((t) => t.condominio.conguaglioPrec))).toBe(4800);
  });

  it('keeps pending an instalment smaller than its owner share', () => {
    const small = rata(1, { rata: cents(500), conguaglioPrec: cents(0) });
    const result = calc([small], [match(small, 500)]);
    expect(result.pending).toEqual([
      {
        itemType: 'instalment',
        itemId: 'cond-1',
        reason: 'parte della proprietà maggiore della rata',
      },
    ]);
    expect(result.tenants.every((t) => t.due === 0)).toBe(true);
    expect(result.unassigned).toBe(0);
  });

  it('refuses last year settlement without the start of the fiscal year, months aside', () => {
    // Its months are outside the period and it is not even matched: still refused (R-C9).
    const other = rata(1, {
      esercizio: '2030-31',
      coversFrom: yearMonth('2030-05'),
      coversTo: yearMonth('2030-07'),
    });
    const run = () =>
      calcConguaglio({
        apartment: apartment({ posti: 4 }),
        period: period('2026-05', '2027-04', '2026-27'),
        bills: [],
        instalments: [other],
        matches: [],
        tenancies: TENANCIES,
        payments: [],
      });
    expect(run).toThrow(SettlementInputError);
    expect(run).toThrow(
      expect.objectContaining({ code: 'missing-condominio-start', instalmentId: 'cond-1' }),
    );
  });

  it('does not depend on the order of the data', () => {
    const instalments = [first, second, rata(3), rata(4)];
    const matches = instalments.map((item) => match(item, item.rata + item.conguaglioPrec));
    const expected = calc(instalments, matches);
    const next = mulberry32(42);
    for (let i = 0; i < 10; i += 1) {
      const result = calc(
        shuffled(instalments, next),
        shuffled(matches, next),
        shuffled(TENANCIES, next),
      );
      expect(result).toEqual(expected);
    }
    // All four instalments: the tenants' yearly quota (600,00 € - 24,00 €) plus last year.
    expect(shared(expected)).toBe(4 * 15000 - 2400 + 4800);
  });
});

describe('condoDifferenceTo: who bears last year settlement (plan 8, task 4, R193)', () => {
  const first = rata(1);
  const calcWith = (to: 'tenants' | 'owner' | undefined, withStart = true) =>
    calcConguaglio({
      apartment: apartment({
        posti: 4,
        ...(withStart ? { condominioStart: CONDOMINIO_START } : {}),
        ...(to === undefined ? {} : { condoDifferenceTo: to }),
      }),
      period: period('2026-05', '2027-04', '2026-27'),
      bills: [],
      instalments: [first],
      matches: [match(first, 19800)],
      tenancies: TENANCIES,
      payments: [],
    });

  it('tenants and no setting give the same result as today', () => {
    expect(calcWith('tenants')).toEqual(calcWith(undefined));
    expect(calcWith(undefined)).toEqual(calc([first], [match(first, 19800)]));
  });

  it('owner: the debit still must be rata + conguaglioPrec, the settlement reaches nobody', () => {
    const result = calcWith('owner');
    expect(view(result)).toEqual([
      ['a', 3600, 0, 3600],
      ['b', 3600, 0, 3600],
      ['c', 3600, 0, 3600],
      ['d', 0, 0, 0],
      ['e', 3600, 0, 3600],
    ]);
    expect(result.unassignedByBucket.conguaglioPrec).toBe(0);
    expect(shared(result)).toBe(14400);
  });

  it('owner: allocateInstalment leaves the settlement out and needs no fiscal year', () => {
    const parts = allocateInstalment(first, cents(19800), undefined, false);
    expect(parts).toHaveLength(3);
    expect(parts.every((p) => p.rata === 4800 && p.conguaglioPrec === 0)).toBe(true);
    expect(() => calcWith('owner', false)).not.toThrow();
    expect(() => calcWith('tenants', false)).toThrow(SettlementInputError);
  });
});
