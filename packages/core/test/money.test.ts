import { describe, expect, it } from 'vitest';
import { cents, formatEuro, parseEuro, splitCents } from '../src/money';

describe('cents', () => {
  it('accepts integers, including zero and negatives', () => {
    expect(cents(9846)).toBe(9846);
    expect(cents(0)).toBe(0);
    expect(cents(-6300)).toBe(-6300);
  });

  it('accepts the safe integer limits', () => {
    expect(cents(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
    expect(cents(Number.MIN_SAFE_INTEGER)).toBe(Number.MIN_SAFE_INTEGER);
  });

  it('normalises negative zero to zero', () => {
    expect(Object.is(cents(-0), 0)).toBe(true);
  });

  it.each([1.5, 0.1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'throws for the non-integer %s',
    (value) => {
      expect(() => cents(value)).toThrow(RangeError);
    },
  );

  it('throws outside the safe integers', () => {
    expect(() => cents(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
    expect(() => cents(Number.MIN_SAFE_INTEGER - 1)).toThrow(RangeError);
    expect(() => cents(1e300)).toThrow(RangeError);
  });

  it('is a branded type that a plain number does not satisfy', () => {
    // @ts-expect-error a plain number is not Cents: it must go through cents()
    expect(formatEuro(9846)).toBe('€ 98,46');
  });
});

describe('parseEuro', () => {
  it.each([
    ['1.234,56', 123456],
    ['98,46', 9846],
    ['€ 98,46', 9846],
    ['98,46 €', 9846],
    ['EUR 98,46', 9846],
    ['98.46', 9846],
    ['1.234', 123400],
    ['-63,00', -6300],
  ])('parses the brief example %j as %d', (input, expected) => {
    expect(parseEuro(input)).toBe(expected);
  });

  it.each([
    ['63', 6300],
    ['0', 0],
    ['0,05', 5],
    ['0.5', 50],
    ['12.5', 1250],
    ['98,4', 9840],
    ['98,40', 9840],
    ['007,50', 750],
    ['1.000', 100000],
    ['98.465', 9846500],
    ['1.234.567', 123456700],
    ['1.234.567,89', 123456789],
    ['123.456,78', 12345678],
    ['90.071.992.547.409,91', Number.MAX_SAFE_INTEGER],
  ])('parses %j as %d', (input, expected) => {
    expect(parseEuro(input)).toBe(expected);
  });

  it.each([
    ['  98,46  ', 9846],
    ['1 234,56', 123456],
    ['1 234,56', 123456],
    ['1 234,56', 123456],
    ['€98,46', 9846],
    ['EUR98,46', 9846],
    ['eur 98,46', 9846],
    ['98,46 EUR', 9846],
    ['98,46€', 9846],
  ])('ignores spaces and the currency in %j', (input, expected) => {
    expect(parseEuro(input)).toBe(expected);
  });

  it.each([
    ['-63,00', -6300],
    ['- 63,00', -6300],
    ['- € 63,00', -6300],
    ['-€ 63,00', -6300],
    ['-€63,00', -6300],
    ['€ -63,00', -6300],
    ['€-63,00', -6300],
    ['EUR -63,00', -6300],
    ['-63,00 €', -6300],
    ['-1.234,56', -123456],
    ['-90.071.992.547.409,91', Number.MIN_SAFE_INTEGER],
  ])('reads the sign in %j', (input, expected) => {
    expect(parseEuro(input)).toBe(expected);
  });

  it.each([
    ['1 234,56', 123456],
    ['1 234 567,00', 123456700],
    ['- € 1 234,56', -123456],
    ['€ -1 234,56', -123456],
    ['1 234,56 €', 123456],
    ['1\u00a0234\u00a0567,89 EUR', 123456789],
    ['1\u202f234,56', 123456],
    ['\u00a0€\u00a098,46\u00a0', 9846],
    ['12 345', 1234500],
    ['1 234.56', 123456],
  ])('reads a space as thousands separator in %j', (input, expected) => {
    expect(parseEuro(input)).toBe(expected);
  });

  it.each([
    ['98 46', 'space between digits that is not a thousands separator'],
    ['9 8,46', 'space inside the first digits'],
    ['12 34,56', 'space before a group of two digits'],
    ['1 2345,00', 'space before a group of four digits'],
    ['1  234,56', 'two spaces as one separator'],
    ['1 234.567,00', 'space and dot thousands separators mixed'],
    ['1.234 567,00', 'dot and space thousands separators mixed'],
    ['1 234 ,56', 'space before the decimal comma'],
    ['98, 46', 'space after the decimal comma'],
    ['98,4 6', 'space inside the decimals'],
    ['1 234.567', 'space thousands then a dot thousands group'],
    ['0 234,56', 'space-grouped number starting with zero'],
  ])('throws for %j (%s)', (input) => {
    expect(() => parseEuro(input)).toThrow(RangeError);
  });

  it('turns negative zero into zero', () => {
    expect(Object.is(parseEuro('-0,00'), 0)).toBe(true);
  });

  it.each([
    ['abc', 'letters'],
    ['', 'empty string'],
    ['   ', 'only spaces'],
    ['€', 'only a currency symbol'],
    ['-', 'only a sign'],
    ['1,234.56', 'dot after the decimal comma'],
    ['1.234,56.78', 'dot after the decimal comma, twice'],
    ['1,2,3', 'multiple commas'],
    ['1.23,45', 'malformed thousands group (too short)'],
    ['12.3456,00', 'malformed thousands group (too long)'],
    ['0.234,56', 'thousands group starting with zero'],
    ['1.234.56', 'mixed decimal dot and thousands dots'],
    ['1.2345', 'dot followed by four digits'],
    ['98.', 'trailing dot'],
    ['98,', 'trailing comma'],
    [',50', 'no integer part before the comma'],
    ['.5', 'no integer part before the dot'],
    ['.123', 'no integer part before the thousands dot'],
    ['98,465', 'more than two decimals'],
    ['--63,00', 'two leading signs'],
    ['- € -63,00', 'sign before and after the currency'],
    ['+63,00', 'plus sign'],
    ['98,46-', 'trailing sign'],
    ['€ 98,46 €', 'two currency symbols'],
    ['$ 98,46', 'another currency'],
    ['98,46 euro', 'currency word'],
    ['1e3', 'exponent notation'],
    ['99999999999999999999,00', 'beyond the safe integers'],
    ['90.071.992.547.410,00', 'just beyond the safe integers'],
  ])('throws for %j (%s)', (input) => {
    expect(() => parseEuro(input)).toThrow(RangeError);
  });
});

describe('formatEuro', () => {
  it.each([
    [9846, '€ 98,46'],
    [-6300, '- € 63,00'],
    [120000, '€ 1.200,00'],
    [0, '€ 0,00'],
    [5, '€ 0,05'],
    [-5, '- € 0,05'],
    [100, '€ 1,00'],
    [99999, '€ 999,99'],
    [100000, '€ 1.000,00'],
    [123456789, '€ 1.234.567,89'],
    [-123456, '- € 1.234,56'],
    [Number.MAX_SAFE_INTEGER, '€ 90.071.992.547.409,91'],
    [Number.MIN_SAFE_INTEGER, '- € 90.071.992.547.409,91'],
  ])('formats %d as %j', (amount, expected) => {
    expect(formatEuro(cents(amount))).toBe(expected);
  });

  it('round-trips through parseEuro', () => {
    for (const amount of [0, 1, -1, 99, 100, 9846, -6300, 120000, 123456789, -987654321]) {
      expect(parseEuro(formatEuro(cents(amount)))).toBe(amount);
    }
  });
});

describe('splitCents', () => {
  it.each([
    [100, [1, 1, 1], [34, 33, 33]],
    [-100, [1, 1, 1], [-34, -33, -33]],
    [39384, [1, 1, 1, 1], [9846, 9846, 9846, 9846]],
  ])('splits %d by %j into %j', (total, weights, expected) => {
    expect(splitCents(cents(total), weights)).toEqual(expected);
  });

  it('gives the remainders to the largest fractions, then to the earliest', () => {
    // Quotas 1.4, 1.4, 4.2: one cent left, tie between the first two.
    expect(splitCents(cents(7), [1, 1, 3])).toEqual([2, 1, 4]);
    // Quotas 1/3 and 2/3: the larger fraction wins even though it is later.
    expect(splitCents(cents(1), [1, 2])).toEqual([0, 1]);
    // All fractions tie: the earliest indices get the leftover cents.
    expect(splitCents(cents(2), [1, 1, 1, 1])).toEqual([1, 1, 0, 0]);
  });

  it('is symmetric for negative totals', () => {
    expect(splitCents(cents(-7), [1, 1, 3])).toEqual([-2, -1, -4]);
    expect(splitCents(cents(-1), [1, 2])).toEqual([0, -1]);
  });

  it('returns the whole total for a single weight', () => {
    expect(splitCents(cents(9846), [5])).toEqual([9846]);
    expect(splitCents(cents(-9846), [0.001])).toEqual([-9846]);
  });

  it('gives nothing to zero weights', () => {
    expect(splitCents(cents(5), [0, 1])).toEqual([0, 5]);
    expect(splitCents(cents(3), [1, 0, 1])).toEqual([2, 0, 1]);
    expect(splitCents(cents(1), [0, 0, 1, 1])).toEqual([0, 0, 1, 0]);
  });

  it('splits zero into zeros, never into negative zero', () => {
    const parts = splitCents(cents(0), [1, 2, 3]);
    expect(parts).toEqual([0, 0, 0]);
    expect(parts.every((part) => Object.is(part, 0))).toBe(true);
    const fromNegativeZero = splitCents(cents(-0), [1, 1]);
    expect(fromNegativeZero.every((part) => Object.is(part, 0))).toBe(true);
  });

  it('accepts non-integer weights', () => {
    expect(splitCents(cents(100), [0.5, 0.25, 0.25])).toEqual([50, 25, 25]);
    expect(splitCents(cents(100), [1 / 3, 1 / 3, 1 / 3])).toEqual([34, 33, 33]);
    expect(splitCents(cents(10), [0.1, 0.2, 0.7])).toEqual([1, 2, 7]);
  });

  it('treats equal non-integer weights as an exact tie', () => {
    // 0.1 is not exactly representable, but three copies of it are exactly equal.
    expect(splitCents(cents(100), [0.1, 0.1, 0.1])).toEqual([34, 33, 33]);
  });

  it('handles weights of very different magnitude', () => {
    expect(splitCents(cents(100), [1e300, 1])).toEqual([100, 0]);
    expect(splitCents(cents(100), [Number.MIN_VALUE, Number.MIN_VALUE])).toEqual([50, 50]);
    expect(splitCents(cents(3), [Number.MIN_VALUE, 1e308, Number.MIN_VALUE])).toEqual([0, 3, 0]);
  });

  it('is exact at the safe integer limits', () => {
    const max = splitCents(cents(Number.MAX_SAFE_INTEGER), [1, 1, 1]);
    expect(max).toEqual([3002399751580331, 3002399751580330, 3002399751580330]);
    expect(max.reduce((sum, part) => sum + part, 0)).toBe(Number.MAX_SAFE_INTEGER);
    const min = splitCents(cents(Number.MIN_SAFE_INTEGER), [1, 1, 1]);
    expect(min).toEqual(max.map((part) => -part));
  });

  it('always sums to the total and stays within one cent of the exact quota', () => {
    // Deterministic pseudo-random cases (Park-Miller generator, exact in doubles).
    let state = 12345;
    const next = (limit: number): number => {
      state = (state * 48271) % 2147483647;
      return state % limit;
    };
    for (let round = 0; round < 300; round += 1) {
      const total = next(2_000_001) - 1_000_000;
      const weights = Array.from({ length: 1 + next(8) }, () => next(6));
      if (weights.every((weight) => weight === 0)) continue;
      const parts = splitCents(cents(total), weights);
      expect(parts.reduce((sum, part) => sum + part, 0)).toBe(total);
      const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
      parts.forEach((part, index) => {
        const quota = (total * (weights[index] ?? 0)) / weightSum;
        expect(Math.abs(part - quota)).toBeLessThan(1);
      });
    }
  });

  it.each([
    ['an empty list', []],
    ['all zeros', [0, 0]],
    ['a negative weight', [-1, 2]],
    ['NaN', [Number.NaN, 1]],
    ['Infinity', [Number.POSITIVE_INFINITY, 1]],
    ['-Infinity', [Number.NEGATIVE_INFINITY, 1]],
  ])('throws for %s', (_label, weights) => {
    expect(() => splitCents(cents(100), weights)).toThrow(RangeError);
  });

  it('accepts negative zero as a zero weight', () => {
    expect(splitCents(cents(5), [-0, 1])).toEqual([0, 5]);
  });
});
