import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  annualitaOf,
  annualitaRange,
  daysBetween,
  isoDate,
  monthsInPeriod,
  rateCoverage,
  settlementPeriods,
  yearMonth,
} from '../src/period';

const OCTOBER = { month: 10, day: 1 };
const MAY = { month: 5, day: 1 };

describe('isoDate', () => {
  it.each(['2026-02-28', '2024-02-29', '2000-02-29', '2026-12-31', '2026-01-01', '0000-01-01'])(
    'accepts %s',
    (value) => {
      expect(isoDate(value)).toBe(value);
    },
  );

  it.each([
    ['2026-02-30', 'day past the end of February'],
    ['2026-02-29', 'leap day in a common year'],
    ['2100-02-29', 'leap day in a century year'],
    ['1900-02-29', 'leap day in a century year'],
    ['2026-04-31', 'day past the end of April'],
    ['2026-13-01', 'month 13'],
    ['2026-00-10', 'month 0'],
    ['2026-04-00', 'day 0'],
    ['2026-4-1', 'missing zero padding'],
    ['26-04-01', 'two-digit year'],
    ['20260401', 'no separators'],
    ['2026-04-01T00:00:00Z', 'with a time'],
    [' 2026-04-01', 'leading space'],
    ['2026-04-01\n', 'trailing newline'],
    ['2026-08', 'a month, not a date'],
    ['', 'empty string'],
    ['today', 'not a date'],
  ])('throws for %s (%s)', (value) => {
    expect(() => isoDate(value)).toThrow(RangeError);
  });

  it('is a branded type that a plain string does not satisfy', () => {
    // @ts-expect-error a plain string is not an ISODate: it must go through isoDate()
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
  });
});

describe('yearMonth', () => {
  it.each(['2026-08', '2026-01', '2026-12', '0000-01'])('accepts %s', (value) => {
    expect(yearMonth(value)).toBe(value);
  });

  it.each(['2026-13', '2026-00', '2026-8', '26-08', '2026-08-01', '202608', ' 2026-08', '', 'aug'])(
    'throws for %j',
    (value) => {
      expect(() => yearMonth(value)).toThrow(RangeError);
    },
  );

  it('is a branded type that a plain string does not satisfy', () => {
    // @ts-expect-error a plain string is not a YearMonth: it must go through yearMonth()
    expect(addMonths('2026-08', 1)).toBe('2026-09');
  });
});

describe('addDays', () => {
  it.each([
    ['2026-02-28', 1, '2026-03-01'],
    ['2024-02-28', 1, '2024-02-29'],
    ['2024-02-28', 2, '2024-03-01'],
    ['2000-02-28', 2, '2000-03-01'],
    ['1900-02-28', 1, '1900-03-01'],
    ['2026-12-31', 1, '2027-01-01'],
    ['2026-01-01', -1, '2025-12-31'],
    ['2026-03-01', -1, '2026-02-28'],
    ['2026-08-15', 0, '2026-08-15'],
    ['2026-01-01', 365, '2027-01-01'],
    ['2024-01-01', 366, '2025-01-01'],
    ['2026-01-31', 30, '2026-03-02'],
    ['2026-03-28', 1, '2026-03-29'],
    ['2026-03-29', 1, '2026-03-30'],
  ])('adds to %s the %d days giving %s', (start, days, expected) => {
    expect(addDays(isoDate(start), days)).toBe(expected);
  });

  it.each([1.5, Number.NaN, Number.POSITIVE_INFINITY])('throws for the non-integer %s', (days) => {
    expect(() => addDays(isoDate('2026-02-28'), days)).toThrow(RangeError);
  });

  it('throws when the result leaves the years 0000-9999', () => {
    expect(() => addDays(isoDate('9999-12-31'), 1)).toThrow(RangeError);
    expect(() => addDays(isoDate('0000-01-01'), -1)).toThrow(RangeError);
    expect(addDays(isoDate('9999-12-30'), 1)).toBe('9999-12-31');
    expect(addDays(isoDate('0000-01-02'), -1)).toBe('0000-01-01');
  });

  it('agrees with UTC calendar arithmetic on every day for two centuries from 1900', () => {
    const first = isoDate('1900-01-01');
    const mismatches: string[] = [];
    for (let offset = 0; offset <= 73_000; offset += 1) {
      const expected = new Date(Date.UTC(1900, 0, 1 + offset)).toISOString().slice(0, 10);
      const actual = addDays(first, offset);
      if (actual !== expected) mismatches.push(`+${offset}: ${actual} instead of ${expected}`);
    }
    expect(mismatches).toEqual([]);
  });
});

describe('daysBetween', () => {
  it('is the signed number of days a minus b', () => {
    expect(daysBetween(isoDate('2026-03-29'), isoDate('2026-03-28'))).toBe(1);
    expect(daysBetween(isoDate('2026-03-28'), isoDate('2026-03-29'))).toBe(-1);
    expect(daysBetween(isoDate('2026-03-29'), isoDate('2026-03-29'))).toBe(0);
  });

  it.each([
    ['Europe/Rome spring forward', '2026-03-29'],
    ['Europe/Rome fall back', '2026-10-25'],
    ['America/Los_Angeles spring forward', '2026-03-08'],
    ['America/Los_Angeles fall back', '2026-11-01'],
    ['Pacific/Auckland spring forward', '2026-09-27'],
    ['Pacific/Auckland fall back', '2026-04-05'],
  ])('counts whole days across the %s change (%s)', (_label, day) => {
    const date = isoDate(day);
    expect(daysBetween(addDays(date, 1), date)).toBe(1);
    expect(daysBetween(date, addDays(date, -1))).toBe(1);
    expect(daysBetween(addDays(date, 7), addDays(date, -7))).toBe(14);
  });

  it('counts whole years and leap years', () => {
    expect(daysBetween(isoDate('2026-12-31'), isoDate('2025-12-31'))).toBe(365);
    expect(daysBetween(isoDate('2024-12-31'), isoDate('2023-12-31'))).toBe(366);
    expect(daysBetween(isoDate('2029-03-31'), isoDate('2024-04-01'))).toBe(1825);
  });

  it('covers the whole supported range', () => {
    expect(daysBetween(isoDate('9999-12-31'), isoDate('0000-01-01'))).toBe(3_652_424);
  });

  it('agrees with UTC millisecond differences', () => {
    const dayMs = 86_400_000;
    const samples = [
      [1970, 0, 1],
      [1999, 11, 31],
      [2000, 1, 29],
      [2024, 1, 29],
      [2026, 2, 29],
      [2026, 9, 25],
      [2100, 2, 1],
    ] as const;
    for (const [ya, ma, da] of samples) {
      for (const [yb, mb, db] of samples) {
        const a = new Date(Date.UTC(ya, ma, da));
        const b = new Date(Date.UTC(yb, mb, db));
        expect(
          daysBetween(isoDate(a.toISOString().slice(0, 10)), isoDate(b.toISOString().slice(0, 10))),
        ).toBe((a.getTime() - b.getTime()) / dayMs);
      }
    }
  });

  it('is the inverse of addDays', () => {
    const base = isoDate('2026-08-17');
    for (const offset of [-1000, -366, -1, 0, 1, 59, 365, 4000]) {
      expect(daysBetween(addDays(base, offset), base)).toBe(offset);
    }
  });
});

describe('monthsInPeriod', () => {
  it('lists the months of the period, both ends included', () => {
    expect(monthsInPeriod(isoDate('2026-08-01'), isoDate('2026-09-30'))).toEqual([
      '2026-08',
      '2026-09',
    ]);
  });

  it('returns one month when start and end are in the same month', () => {
    expect(monthsInPeriod(isoDate('2026-08-15'), isoDate('2026-08-20'))).toEqual(['2026-08']);
    expect(monthsInPeriod(isoDate('2026-08-15'), isoDate('2026-08-15'))).toEqual(['2026-08']);
  });

  it('crosses the year boundary', () => {
    expect(monthsInPeriod(isoDate('2025-11-10'), isoDate('2026-02-01'))).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
    ]);
  });

  it('spans a whole lease year', () => {
    const months = monthsInPeriod(isoDate('2025-10-01'), isoDate('2026-09-30'));
    expect(months).toHaveLength(12);
    expect(months[0]).toBe('2025-10');
    expect(months[11]).toBe('2026-09');
  });

  it('throws when the end is before the start', () => {
    expect(() => monthsInPeriod(isoDate('2026-09-01'), isoDate('2026-08-31'))).toThrow(RangeError);
    expect(() => monthsInPeriod(isoDate('2026-08-15'), isoDate('2026-08-14'))).toThrow(RangeError);
  });
});

describe('addMonths', () => {
  it.each([
    ['2026-11', 3, '2027-02'],
    ['2026-01', -1, '2025-12'],
    ['2026-01', 0, '2026-01'],
    ['2026-01', 12, '2027-01'],
    ['2026-01', -13, '2024-12'],
    ['2026-12', 1, '2027-01'],
    ['2026-08', 1, '2026-09'],
    ['2026-08', 120, '2036-08'],
  ])('adds to %s the %d months giving %s', (start, months, expected) => {
    expect(addMonths(yearMonth(start), months)).toBe(expected);
  });

  it.each([1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'throws for the non-integer %s',
    (months) => {
      expect(() => addMonths(yearMonth('2026-01'), months)).toThrow(RangeError);
    },
  );

  it('throws when the result leaves the years 0000-9999', () => {
    expect(() => addMonths(yearMonth('9999-12'), 1)).toThrow(RangeError);
    expect(() => addMonths(yearMonth('0000-01'), -1)).toThrow(RangeError);
    expect(addMonths(yearMonth('9999-11'), 1)).toBe('9999-12');
  });
});

describe('annualitaOf', () => {
  it.each([
    ['2026-09-30', OCTOBER, '2025-26'],
    ['2026-10-01', OCTOBER, '2026-27'],
    ['2026-04-30', MAY, '2025-26'],
    ['2026-05-01', MAY, '2026-27'],
  ])('labels %s with the start %j as %s', (date, start, expected) => {
    expect(annualitaOf(isoDate(date), start)).toBe(expected);
  });

  it('covers the first and last day of a lease year', () => {
    expect(annualitaOf(isoDate('2025-10-01'), OCTOBER)).toBe('2025-26');
    expect(annualitaOf(isoDate('2026-01-01'), OCTOBER)).toBe('2025-26');
    expect(annualitaOf(isoDate('2026-12-31'), OCTOBER)).toBe('2026-27');
    expect(annualitaOf(isoDate('2027-09-30'), OCTOBER)).toBe('2026-27');
  });

  it('works for a calendar-year start and a start on the last day of the year', () => {
    expect(annualitaOf(isoDate('2026-03-01'), { month: 1, day: 1 })).toBe('2026-27');
    expect(annualitaOf(isoDate('2026-12-30'), { month: 12, day: 31 })).toBe('2025-26');
    expect(annualitaOf(isoDate('2026-12-31'), { month: 12, day: 31 })).toBe('2026-27');
  });

  it('works for a start in the middle of a month and across leap days', () => {
    expect(annualitaOf(isoDate('2026-10-14'), { month: 10, day: 15 })).toBe('2025-26');
    expect(annualitaOf(isoDate('2026-10-15'), { month: 10, day: 15 })).toBe('2026-27');
    expect(annualitaOf(isoDate('2024-02-29'), { month: 3, day: 1 })).toBe('2023-24');
    expect(annualitaOf(isoDate('2024-03-01'), { month: 3, day: 1 })).toBe('2024-25');
  });

  it('writes the two-digit end year across the century', () => {
    expect(annualitaOf(isoDate('2099-10-01'), OCTOBER)).toBe('2099-00');
    expect(annualitaOf(isoDate('2100-09-30'), OCTOBER)).toBe('2099-00');
  });

  it('throws when the lease year would start before year 0000', () => {
    expect(() => annualitaOf(isoDate('0000-03-01'), OCTOBER)).toThrow(RangeError);
  });

  it.each([
    [{ month: 0, day: 1 }, 'month 0'],
    [{ month: 13, day: 1 }, 'month 13'],
    [{ month: 1.5, day: 1 }, 'fractional month'],
    [{ month: 10, day: 0 }, 'day 0'],
    [{ month: 10, day: 32 }, 'day 32'],
    [{ month: 4, day: 31 }, 'day past the end of April'],
    [{ month: 2, day: 30 }, 'day past the end of February'],
    [{ month: 2, day: 29 }, 'a start that does not exist every year'],
    [{ month: 10, day: Number.NaN }, 'NaN day'],
  ])('throws for the invalid start %j (%s)', (start) => {
    expect(() => annualitaOf(isoDate('2026-10-01'), start)).toThrow(RangeError);
  });
});

describe('annualitaRange', () => {
  it('gives the first and last day of the lease year', () => {
    expect(annualitaRange('2026-27', OCTOBER)).toEqual({ from: '2026-10-01', to: '2027-09-30' });
    expect(annualitaRange('2025-26', MAY)).toEqual({ from: '2025-05-01', to: '2026-04-30' });
  });

  it('works for a calendar-year start and across leap days', () => {
    expect(annualitaRange('2026-27', { month: 1, day: 1 })).toEqual({
      from: '2026-01-01',
      to: '2026-12-31',
    });
    expect(annualitaRange('2023-24', { month: 3, day: 1 })).toEqual({
      from: '2023-03-01',
      to: '2024-02-29',
    });
  });

  it('works across the century', () => {
    expect(annualitaRange('2099-00', OCTOBER)).toEqual({ from: '2099-10-01', to: '2100-09-30' });
  });

  it('is the inverse of annualitaOf', () => {
    for (const start of [OCTOBER, MAY, { month: 1, day: 1 }, { month: 3, day: 1 }]) {
      for (const label of ['2023-24', '2024-25', '2025-26', '2026-27']) {
        const { from, to } = annualitaRange(label, start);
        expect(annualitaOf(from, start)).toBe(label);
        expect(annualitaOf(to, start)).toBe(label);
        expect(annualitaOf(addDays(from, -1), start)).not.toBe(label);
        expect(annualitaOf(addDays(to, 1), start)).not.toBe(label);
      }
    }
  });

  it.each([
    ['2026-28', 'second year is not the year after the first'],
    ['2026-26', 'second year equals the first'],
    ['2026/27', 'wrong separator'],
    ['26-27', 'two-digit first year'],
    ['2026-2027', 'four-digit second year'],
    ['2026', 'a single year'],
    ['', 'empty string'],
  ])('throws for the label %j (%s)', (label) => {
    expect(() => annualitaRange(label, OCTOBER)).toThrow(RangeError);
  });

  it('throws for an invalid start', () => {
    expect(() => annualitaRange('2026-27', { month: 13, day: 1 })).toThrow(RangeError);
  });

  it('throws when the lease year ends after year 9999', () => {
    expect(() => annualitaRange('9999-00', OCTOBER)).toThrow(RangeError);
  });
});

describe('settlementPeriods', () => {
  it('gives one period per lease year for an annual contract', () => {
    expect(
      settlementPeriods(
        { start: yearMonth('2025-10'), end: yearMonth('2027-09'), settlement: 'annuale' },
        OCTOBER,
      ),
    ).toEqual([
      { label: '2025-26', from: '2025-10', to: '2026-09' },
      { label: '2026-27', from: '2026-10', to: '2027-09' },
    ]);
  });

  it('gives a single period for the whole contract', () => {
    expect(
      settlementPeriods(
        { start: yearMonth('2024-04'), end: yearMonth('2029-03'), settlement: 'intero-contratto' },
        OCTOBER,
      ),
    ).toEqual([{ label: '2024-29', from: '2024-04', to: '2029-03' }]);
  });

  it('ignores the lease year start for a whole-contract settlement', () => {
    const contract = {
      start: yearMonth('2024-04'),
      end: yearMonth('2029-03'),
      settlement: 'intero-contratto',
    } as const;
    expect(settlementPeriods(contract, MAY)).toEqual(settlementPeriods(contract, OCTOBER));
  });

  it('clips the first and last periods to the contract', () => {
    expect(
      settlementPeriods(
        { start: yearMonth('2025-12'), end: yearMonth('2027-03'), settlement: 'annuale' },
        OCTOBER,
      ),
    ).toEqual([
      { label: '2025-26', from: '2025-12', to: '2026-09' },
      { label: '2026-27', from: '2026-10', to: '2027-03' },
    ]);
  });

  it('clips both ends of a long contract against a lease year starting in May', () => {
    const periods = settlementPeriods(
      { start: yearMonth('2024-04'), end: yearMonth('2029-03'), settlement: 'annuale' },
      MAY,
    );
    expect(periods).toEqual([
      { label: '2023-24', from: '2024-04', to: '2024-04' },
      { label: '2024-25', from: '2024-05', to: '2025-04' },
      { label: '2025-26', from: '2025-05', to: '2026-04' },
      { label: '2026-27', from: '2026-05', to: '2027-04' },
      { label: '2027-28', from: '2027-05', to: '2028-04' },
      { label: '2028-29', from: '2028-05', to: '2029-03' },
    ]);
  });

  it('handles a one-month contract', () => {
    expect(
      settlementPeriods(
        { start: yearMonth('2026-03'), end: yearMonth('2026-03'), settlement: 'annuale' },
        OCTOBER,
      ),
    ).toEqual([{ label: '2025-26', from: '2026-03', to: '2026-03' }]);
  });

  it('handles a lease year starting in January', () => {
    expect(
      settlementPeriods(
        { start: yearMonth('2025-11'), end: yearMonth('2026-02'), settlement: 'annuale' },
        { month: 1, day: 1 },
      ),
    ).toEqual([
      { label: '2025-26', from: '2025-11', to: '2025-12' },
      { label: '2026-27', from: '2026-01', to: '2026-02' },
    ]);
  });

  it('covers every month of the contract exactly once', () => {
    const periods = settlementPeriods(
      { start: yearMonth('2023-07'), end: yearMonth('2028-02'), settlement: 'annuale' },
      OCTOBER,
    );
    expect(periods[0]?.from).toBe('2023-07');
    expect(periods[periods.length - 1]?.to).toBe('2028-02');
    periods.slice(1).forEach((period, index) => {
      expect(period.from).toBe(addMonths(periods[index]?.to ?? period.from, 1));
    });
  });

  it('throws when the contract ends before it starts', () => {
    expect(() =>
      settlementPeriods(
        { start: yearMonth('2026-09'), end: yearMonth('2026-08'), settlement: 'annuale' },
        OCTOBER,
      ),
    ).toThrow(RangeError);
    expect(() =>
      settlementPeriods(
        { start: yearMonth('2026-09'), end: yearMonth('2026-08'), settlement: 'intero-contratto' },
        OCTOBER,
      ),
    ).toThrow(RangeError);
  });

  it('throws for a lease year that does not start on the first of a month', () => {
    expect(() =>
      settlementPeriods(
        { start: yearMonth('2025-10'), end: yearMonth('2026-09'), settlement: 'annuale' },
        { month: 10, day: 15 },
      ),
    ).toThrow(RangeError);
  });

  it('throws for an invalid lease year start', () => {
    expect(() =>
      settlementPeriods(
        { start: yearMonth('2025-10'), end: yearMonth('2026-09'), settlement: 'annuale' },
        { month: 13, day: 1 },
      ),
    ).toThrow(RangeError);
  });

  it('throws for an unknown settlement kind', () => {
    expect(() =>
      settlementPeriods(
        { start: yearMonth('2025-10'), end: yearMonth('2026-09'), settlement: 'mensile' as never },
        OCTOBER,
      ),
    ).toThrow(RangeError);
  });
});

describe('rateCoverage', () => {
  it.each([
    ['2025-10', 3, 1, { from: '2025-10', to: '2026-01' }],
    ['2025-05', 3, 3, { from: '2026-01', to: '2026-04' }],
    ['2026-01', 3, 3, { from: '2026-09', to: '2026-12' }],
    ['2026-01', 3, 2, { from: '2026-05', to: '2026-08' }],
    ['2026-01', 1, 1, { from: '2026-01', to: '2026-12' }],
    ['2026-01', 12, 12, { from: '2026-12', to: '2026-12' }],
    ['2025-11', 2, 2, { from: '2026-05', to: '2026-10' }],
    ['2026-01', 4, 4, { from: '2026-10', to: '2026-12' }],
    ['2026-01', 6, 6, { from: '2026-11', to: '2026-12' }],
  ])('covers the months of %s split in %d rates, rate %d', (start, count, index, expected) => {
    expect(rateCoverage(yearMonth(start), count, index)).toEqual(expected);
  });

  it.each([1, 2, 3, 4, 6, 12])('splits the year into %d contiguous rates', (count) => {
    const start = yearMonth('2025-10');
    const rates = Array.from({ length: count }, (_, index) =>
      rateCoverage(start, count, index + 1),
    );
    expect(rates[0]?.from).toBe('2025-10');
    expect(rates[count - 1]?.to).toBe('2026-09');
    rates.slice(1).forEach((rate, index) => {
      expect(rate.from).toBe(addMonths(rates[index]?.to ?? rate.from, 1));
    });
  });

  it.each([
    [5, 1, 'a rate count that does not divide 12'],
    [24, 1, 'a rate count above 12'],
    [0, 1, 'zero rates'],
    [-3, 1, 'a negative rate count'],
    [1.5, 1, 'a fractional rate count'],
    [Number.NaN, 1, 'NaN rates'],
    [3, 0, 'rate index 0 (indexes are 1-based)'],
    [3, 4, 'rate index above the rate count'],
    [3, -1, 'a negative rate index'],
    [3, 1.5, 'a fractional rate index'],
    [3, Number.NaN, 'a NaN rate index'],
  ])('throws for %d rates, rate %d (%s)', (count, index) => {
    expect(() => rateCoverage(yearMonth('2026-01'), count, index)).toThrow(RangeError);
  });
});
