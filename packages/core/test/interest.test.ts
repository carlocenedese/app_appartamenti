import { describe, expect, it } from 'vitest';
import { legalInterest } from '../src/interest';
import type { RatePeriod } from '../src/interest';
import { cents } from '../src/money';
import type { Cents } from '../src/money';
import { isoDate } from '../src/period';

// Example rates (basis points), not checked against official sources: the real ones come from the
// user's configuration.
const RATES: RatePeriod[] = [
  { year: 2025, rateBp: 200 },
  { year: 2026, rateBp: 160 },
];

const interest = (principal: number, rates: RatePeriod[], from: string, to: string): Cents =>
  legalInterest(cents(principal), rates, isoDate(from), isoDate(to));

describe('legalInterest', () => {
  it('computes the Berchet example: 5 whole months in 2025 and 7 in 2026', () => {
    // 50000 * 200 * 5 + 50000 * 160 * 7 = 106 000 000; / 120 000 = 883.33 -> 883.
    expect(interest(50000, RATES, '2025-08-01', '2026-07-31')).toBe(883);
  });

  it('rounds once on the total, not once per year', () => {
    // Per year: 416.67 -> 417 and 466.67 -> 467, which would sum to 884.
    expect(interest(50000, [{ year: 2025, rateBp: 200 }], '2025-08-01', '2025-12-31')).toBe(417);
    expect(interest(50000, [{ year: 2026, rateBp: 160 }], '2026-01-01', '2026-07-31')).toBe(467);
    expect(interest(50000, RATES, '2025-08-01', '2026-07-31')).toBe(883);
  });

  it('does not depend on the order of the rates', () => {
    expect(interest(50000, [...RATES].reverse(), '2025-08-01', '2026-07-31')).toBe(883);
  });

  it('ignores rates of years outside the period', () => {
    const rates = [...RATES, { year: 2030, rateBp: 400 }];
    expect(interest(50000, rates, '2025-08-01', '2026-07-31')).toBe(883);
  });

  describe('whole months only', () => {
    it('does not count a partial first month', () => {
      // September-December 2025 (4 months) and January-July 2026 (7 months).
      expect(interest(50000, RATES, '2025-08-02', '2026-07-31')).toBe(800);
    });

    it('does not count a partial last month', () => {
      // August-December 2025 (5 months) and January-June 2026 (6 months): 98 000 000 / 120 000.
      expect(interest(50000, RATES, '2025-08-01', '2026-07-30')).toBe(817);
    });

    it('counts a single month only when it is complete', () => {
      const rates = [{ year: 2026, rateBp: 1200 }];
      expect(interest(10000, rates, '2026-03-01', '2026-03-31')).toBe(100);
      expect(interest(10000, rates, '2026-03-01', '2026-03-30')).toBe(0);
      expect(interest(10000, rates, '2026-03-02', '2026-03-31')).toBe(0);
    });

    it('uses the real length of February, leap years included', () => {
      const rates = [
        { year: 2027, rateBp: 1200 },
        { year: 2028, rateBp: 1200 },
      ];
      expect(interest(10000, rates, '2027-02-01', '2027-02-28')).toBe(100);
      expect(interest(10000, rates, '2028-02-01', '2028-02-28')).toBe(0);
      expect(interest(10000, rates, '2028-02-01', '2028-02-29')).toBe(100);
    });

    it('treats both ends as included', () => {
      const rates = [{ year: 2026, rateBp: 1200 }];
      expect(interest(10000, rates, '2026-01-01', '2026-02-28')).toBe(200);
    });

    it('is zero, with no rate needed, when no month is complete', () => {
      expect(interest(50000, [], '2026-03-10', '2026-03-10')).toBe(0);
      expect(interest(50000, [], '2026-03-10', '2026-04-20')).toBe(0);
    });

    it('counts a whole year of whole months at the yearly rate', () => {
      // 1000.00 euro at 2%.
      expect(interest(100000, [{ year: 2026, rateBp: 200 }], '2026-01-01', '2026-12-31')).toBe(
        2000,
      );
    });

    it('does not need the rate of a year that has no complete month', () => {
      // January 2026 is partial: only the 5 months of 2025 count.
      expect(interest(50000, [{ year: 2025, rateBp: 200 }], '2025-08-01', '2026-01-15')).toBe(417);
    });
  });

  describe('rounding', () => {
    it('rounds half up', () => {
      // 600 * 100 / 120 000 = 0.5 -> 1; 1800 * 100 / 120 000 = 1.5 -> 2; 599 -> 0.499.
      const rates = [{ year: 2026, rateBp: 100 }];
      expect(interest(600, rates, '2026-01-01', '2026-01-31')).toBe(1);
      expect(interest(1800, rates, '2026-01-01', '2026-01-31')).toBe(2);
      expect(interest(599, rates, '2026-01-01', '2026-01-31')).toBe(0);
    });

    it('is zero for a zero principal or a zero rate', () => {
      expect(interest(0, RATES, '2025-08-01', '2026-07-31')).toBe(0);
      expect(interest(50000, [{ year: 2026, rateBp: 0 }], '2026-01-01', '2026-12-31')).toBe(0);
    });
  });

  describe('integer arithmetic', () => {
    it('is exact on a large principal', () => {
      // 99 999 999 * 200 * 12 / 120 000 = 1 999 999.98 -> 2 000 000.
      const rates = [{ year: 2026, rateBp: 200 }];
      expect(interest(99_999_999, rates, '2026-01-01', '2026-12-31')).toBe(2_000_000);
    });

    it('does not lose precision when the product exceeds 2^53', () => {
      // The product is 100 999 999 996 979 999 = 120 000 * 841 666 666 641 + 59 999, just under the
      // half: it rounds down. In doubles it becomes 100 999 999 996 980 000, exactly the half, and
      // would round up to ...642.
      const rates = [{ year: 2026, rateBp: 101 }];
      expect(interest(999_999_999_970_099, rates, '2026-01-01', '2026-01-31')).toBe(
        841_666_666_641,
      );
    });

    it('throws when the result is not a safe integer', () => {
      // Twice the largest safe integer: 200% over a whole year.
      const rates = [{ year: 2026, rateBp: 20000 }];
      expect(() => interest(Number.MAX_SAFE_INTEGER, rates, '2026-01-01', '2026-12-31')).toThrow(
        RangeError,
      );
    });
  });

  describe('errors', () => {
    it('throws, naming the year, when the rate of a year with whole months is missing', () => {
      expect(() =>
        interest(50000, [{ year: 2025, rateBp: 200 }], '2025-08-01', '2026-07-31'),
      ).toThrow(/2026/);
      expect(() => interest(50000, [], '2025-08-01', '2026-07-31')).toThrow(/2025/);
    });

    it('throws when the period ends before it starts', () => {
      expect(() => interest(50000, RATES, '2026-07-31', '2025-08-01')).toThrow(RangeError);
      expect(() => interest(50000, RATES, '2026-03-02', '2026-03-01')).toThrow(RangeError);
    });

    it('throws on a negative principal', () => {
      expect(() => interest(-1, RATES, '2025-08-01', '2026-07-31')).toThrow(RangeError);
    });

    it('throws on a principal that is not an integer', () => {
      expect(() => interest(500.5, RATES, '2025-08-01', '2026-07-31')).toThrow(RangeError);
    });

    it('throws on duplicate years, even with equal rates', () => {
      const rates = [...RATES, { year: 2025, rateBp: 200 }];
      expect(() => interest(50000, rates, '2025-08-01', '2026-07-31')).toThrow(/2025/);
    });

    it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('throws on the rate %s', (rateBp) => {
      expect(() => interest(50000, [{ year: 2026, rateBp }], '2026-01-01', '2026-12-31')).toThrow(
        RangeError,
      );
    });

    it('throws on a rate that is invalid even for a year outside the period', () => {
      const rates = [...RATES, { year: 2030, rateBp: -5 }];
      expect(() => interest(50000, rates, '2025-08-01', '2026-07-31')).toThrow(/2030/);
    });

    it('throws on a year that is not an integer', () => {
      const rates = [...RATES, { year: 2026.5, rateBp: 100 }];
      expect(() => interest(50000, rates, '2025-08-01', '2026-07-31')).toThrow(RangeError);
    });
  });
});
