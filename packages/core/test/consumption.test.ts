import { describe, expect, it } from 'vitest';
import { cents, compareConsumption, isoDate, yearBeforeBill } from '../src/index';
import type { Comparable } from '../src/index';

// Invented bills of one apartment.
function bill(
  id: string,
  start: string,
  end: string,
  amount: number,
  quantity?: string,
  extra: Partial<Comparable> = {},
): Comparable {
  return {
    id,
    apartmentId: 'apt-1',
    category: 'gas',
    periodStart: isoDate(start),
    periodEnd: isoDate(end),
    amount: cents(amount),
    ...(quantity === undefined ? {} : { consumption: { quantity, unit: 'Smc' } }),
    ...extra,
  };
}

const now = bill('b-now', '2026-01-01', '2026-02-28', 12000, '120');

describe('yearBeforeBill', () => {
  it('finds the bill of the same months a year before, same unit, smallest id', () => {
    const a = bill('b-a', '2025-01-01', '2025-02-28', 10000, '100');
    const b = bill('b-b', '2025-01-01', '2025-02-28', 10000, '100');
    const kwh = bill('b-0', '2025-01-01', '2025-02-28', 1, '1', {
      consumption: { quantity: '1', unit: 'kWh' },
    });
    expect(yearBeforeBill(now, [b, kwh, a])?.id).toBe('b-a');
    expect(yearBeforeBill(now, [{ ...a, deleted: true }])).toBeUndefined();
    expect(yearBeforeBill(now, [{ ...a, apartmentId: 'apt-2' }])).toBeUndefined();
  });
});

describe('compareConsumption', () => {
  it('gives the differences with the year before, without levels', () => {
    const prev = bill('b-prev', '2025-01-01', '2025-02-28', 10000, '80');
    const result = compareConsumption(now, [prev], { recentMonths: 0 });
    expect(result.current).toEqual({
      billIds: ['b-now'],
      months: 2,
      amount: 12000,
      consumption: { quantity: '120', unit: 'Smc' },
    });
    expect(result.yearBefore?.reference.billIds).toEqual(['b-prev']);
    // consumption +50 %, amount +20 %, unit price 100/1 vs 125/1 → −20 %
    expect(result.yearBefore?.differences).toEqual([
      { metric: 'consumption', differenceBp: 5000 },
      { metric: 'amount', differenceBp: 2000 },
      { metric: 'unitPrice', differenceBp: -2000 },
    ]);
    expect(result.recent).toBeUndefined();
  });

  it('averages the recent window per month of competence', () => {
    const nov = bill('b-nov', '2025-11-01', '2025-11-30', 3000, '25.5');
    const dec = bill('b-dec', '2025-12-01', '2025-12-31', 3000, '34.5');
    const old = bill('b-old', '2025-09-01', '2025-10-31', 9999, '999');
    const result = compareConsumption(now, [nov, dec, old], { recentMonths: 2 });
    expect(result.recent?.reference).toEqual({
      billIds: ['b-dec', 'b-nov'],
      months: 2,
      amount: 6000,
      consumption: { quantity: '60.0', unit: 'Smc' },
    });
    // 60/month now vs 30/month: +100 %; amount 6000/month vs 3000/month: +100 %; price equal.
    expect(result.recent?.differences).toEqual([
      { metric: 'consumption', differenceBp: 10000 },
      { metric: 'amount', differenceBp: 10000 },
      { metric: 'unitPrice', differenceBp: 0 },
    ]);
  });

  it('marks over only for the thresholds given, exactly at the threshold not over', () => {
    const prev = bill('b-prev', '2025-01-01', '2025-02-28', 10000, '80');
    const result = compareConsumption(now, [prev], {
      recentMonths: 0,
      thresholds: { consumption: 5000, unitPrice: 1999 },
    });
    expect(result.yearBefore?.differences).toEqual([
      { metric: 'consumption', differenceBp: 5000, over: false },
      { metric: 'amount', differenceBp: 2000 },
      { metric: 'unitPrice', differenceBp: -2000, over: true },
    ]);
  });

  it('rounds half away from zero and leaves out metrics without a positive reference', () => {
    const third = bill('b-x', '2026-01-01', '2026-01-31', 1, '1');
    const prev = bill('b-p', '2025-01-01', '2025-01-31', 3, '0');
    // amount 1 vs 3: −6666.67 bp → −6667; consumption reference 0: left out.
    expect(compareConsumption(third, [prev], { recentMonths: 0 }).yearBefore?.differences).toEqual([
      { metric: 'amount', differenceBp: -6667 },
    ]);
    const credit = bill('b-c', '2025-01-01', '2025-01-31', -500);
    const noQty = bill('b-n', '2026-01-01', '2026-01-31', 500);
    expect(compareConsumption(noQty, [credit], { recentMonths: 0 }).yearBefore).toEqual({
      reference: { billIds: ['b-c'], months: 1, amount: -500 },
      differences: [],
    });
  });

  it('refuses months or thresholds that are not whole and non-negative', () => {
    expect(() => compareConsumption(now, [], { recentMonths: -1 })).toThrow(RangeError);
    expect(() =>
      compareConsumption(now, [], { recentMonths: 1, thresholds: { amount: 0.5 } }),
    ).toThrow(RangeError);
  });
});
