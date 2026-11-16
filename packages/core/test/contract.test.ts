import { describe, expect, it } from 'vitest';
import { ContractSchema, rentForMonth, yearMonth } from '../src/index';

// Invented amounts only (plan 7).
const contract = ContractSchema.parse({
  id: 'ctr-berchet',
  v: 1,
  rev: 1,
  apartmentId: 'berchet',
  type: '1+1',
  start: '2025-10',
  end: '2027-09',
  settlement: 'annuale',
  rent: [
    { from: '2025-10', monthlyRent: 160000, monthlyAdvance: 15000 },
    { from: '2026-10', monthlyRent: 165000, monthlyAdvance: 15000 },
  ],
});
const [first, second] = contract.rent ?? [];

describe('rentForMonth (plan 7, task 1)', () => {
  it.each([
    ['2025-09', undefined],
    ['2025-10', first],
    ['2026-09', first],
    ['2026-10', second],
    ['2027-09', second],
  ])('%s', (month, expected) => {
    expect(rentForMonth(contract, yearMonth(month))).toEqual(expected);
  });

  it('no history, no rent', () => {
    expect(rentForMonth({}, yearMonth('2026-01'))).toBeUndefined();
  });
});
