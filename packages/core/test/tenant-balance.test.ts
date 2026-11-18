// Answers D and G of user1 (18 Nov 2026), third review, finding 1: after reopenings, what a
// tenant still owes is the due of the current closing less what earlier closings settled: the
// supplementaries marked settled, newest to oldest, down to the first closing whose main
// settlement was marked, plus that closing's due. Invented amounts.
import { describe, expect, it } from 'vitest';
import { closingOf, tenantBalance } from '../src/index';
import type { ConguaglioResult, PeriodClose, Tenancy } from '../src/index';
import { cents } from '../src/money';
import { isoDate } from '../src/period';

const FORFAIT = 36000;
const snapshot = (due: number) => ({
  tenants: [
    {
      tenantId: 't-a',
      spese: due + FORFAIT,
      rata: 0,
      commissione: 0,
      recupero: 0,
      forfaitIncassato: FORFAIT,
      conguaglioPrec: 0,
    },
  ],
  emptyBeds: 0,
});
type Earlier = { due: number; settled?: boolean; supplementary?: number };
function close(due: number, earlier: Earlier[]): PeriodClose {
  return {
    id: 'chiusura-apt-2025-26',
    v: 1,
    rev: 1,
    apartmentId: 'apt',
    periodLabel: '2025-26',
    from: '2025-10',
    to: '2026-09',
    closedAt: '2027-01-10T09:00:00.000Z',
    engineVersion: '0.1.0',
    snapshot: snapshot(due),
    history: earlier.map((e, i) => ({
      closedAt: `2026-1${String(i)}-10T09:00:00.000Z`,
      engineVersion: '0.1.0',
      snapshot: snapshot(e.due),
      ...(e.settled === true ? { settled: [{ tenantId: 't-a', on: '2026-12-01' }] } : {}),
      ...(e.supplementary === undefined
        ? {}
        : {
            supplementarySettled: [{ tenantId: 't-a', on: '2026-12-02', amount: e.supplementary }],
          }),
      reopened: { on: '2026-12-05', reason: 'Bolletta tardiva' },
    })),
  } as PeriodClose;
}
const remaining = (c: PeriodClose) => tenantBalance(c, 't-a').remaining;

describe('tenantBalance across reopenings (finding 1)', () => {
  it('settled on 1, supplementary settled on 2, closing 3: only the rest (120 + 5 settled)', () => {
    const c = close(13500, [
      { due: 12000, settled: true },
      { due: 13000, supplementary: 500 },
    ]);
    expect(tenantBalance(c, 't-a')).toMatchObject({ status: 'differenza', remaining: 1000 });
  });

  it('settled on 1, nothing on 2, closing 3', () => {
    expect(remaining(close(13000, [{ due: 12000, settled: true }, { due: 12500 }]))).toBe(1000);
  });

  it('only supplementaries settled on 1 and 2: the main due is still owed, less those', () => {
    const c = close(12800, [
      { due: 12000, supplementary: 500 },
      { due: 12500, supplementary: 300 },
    ]);
    expect(remaining(c)).toBe(12000);
  });

  it('a credit of the tenant: settled on 1, the credit grows or shrinks', () => {
    expect(remaining(close(-4000, [{ due: -5000, settled: true }]))).toBe(1000);
    expect(remaining(close(-6000, [{ due: -5000, settled: true }]))).toBe(-1000);
  });

  it('four closings: main settled on 1, supplementaries on 2 and 3', () => {
    const c = close(10700, [
      { due: 10000, settled: true },
      { due: 10200, supplementary: 200 },
      { due: 10500, supplementary: 300 },
    ]);
    expect(remaining(c)).toBe(200);
  });
});

describe('closingOf, third review (finding 6)', () => {
  const tenant = (tenantId: string, conguaglioPrec: number, forfaitIncassato: number) => ({
    tenantId,
    spese: cents(1000),
    condominio: { rata: cents(0), conguaglioPrec: cents(conguaglioPrec) },
    commissione: cents(0),
    forfaitIncassato: cents(forfaitIncassato),
    due: cents(1000 + conguaglioPrec - forfaitIncassato),
    byCategory: {},
  });
  const current = (rows: ReturnType<typeof tenant>[], prec: number) =>
    ({
      engineVersion: '0.1.0',
      tenants: rows,
      unassigned: cents(prec),
      unassignedByBucket: {
        spese: cents(0),
        rata: cents(0),
        conguaglioPrec: cents(prec),
        commissione: cents(0),
      },
      pending: [],
      warnings: [],
    }) as unknown as ConguaglioResult;
  const closed = (fni = 0): PeriodClose =>
    ({
      ...close(0, []),
      history: [],
      snapshot: {
        tenants: ['t-a', 't-b'].map((tenantId) => ({
          tenantId,
          spese: 1000,
          rata: 0,
          commissione: 0,
          recupero: 0,
          forfaitIncassato: 3000,
          conguaglioPrec: 1000,
          ...(fni === 0 ? {} : { forfaitNonIncassato: fni }),
        })),
        emptyBeds: 0,
      },
    }) as unknown as PeriodClose;
  const tenancies: Tenancy[] = [];

  it("K: last year's condominium settlement changed after closing goes into each tenant's delta", () => {
    // 6,00 more each for t-a and t-b; the empty beds' share (4,00 here) is not tracked: the
    // snapshot keeps no empty-bed share of that settlement (open question d).
    const result = closingOf(
      closed(),
      current([tenant('t-a', 1600, 3000), tenant('t-b', 1600, 3000)], 400),
      { tenancies },
      isoDate('2027-01-10'),
    );
    expect(result.tenants.map((t) => t.delta)).toEqual([600, 600]);
    expect(result.tenants.reduce((sum, t) => sum + t.delta, 0)).toBe(1200);
    expect(result).toMatchObject({ changed: true, dataChanged: false, unassignedDelta: 0 });
  });

  it('«da verificare» when more flat charge is collected than was missing at the closing', () => {
    const more = current([tenant('t-a', 1000, 4000), tenant('t-b', 1000, 3000)], 0);
    const without = closingOf(closed(), more, { tenancies }, isoDate('2027-01-10'));
    expect(without.tenants[0]).toMatchObject({ forfaitDelta: -1000, action: 'da-verificare' });
    // 30,00 missing at that closing: 10,00 paid since only reduces it.
    const within = closingOf(closed(3000), more, { tenancies }, isoDate('2027-01-10'));
    expect(within.tenants[0]).toMatchObject({ forfaitDelta: -1000, action: 'nessuna' });
  });
});
