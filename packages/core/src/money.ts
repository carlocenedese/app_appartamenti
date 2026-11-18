/**
 * Money in whole euro cents. Amounts are never decimals: every figure in the engine is a
 * `Cents`, a branded safe integer, so a stray `number` cannot slip into a calculation.
 */
export type Cents = number & { readonly __brand: 'Cents' };

/**
 * Brands a number as an amount in cents.
 * Throws a `RangeError` unless `n` is an integer within the safe integer range.
 */
export function cents(n: number): Cents {
  if (!Number.isSafeInteger(n)) {
    throw new RangeError(`Not an amount in cents: ${String(n)} (expected a safe integer)`);
  }
  // `n === 0` is also true for negative zero: normalise it to plain zero.
  return (n === 0 ? 0 : n) as Cents;
}

// Optional sign, optional leading currency (with an optional sign after it), the digits with
// their separators, optional trailing currency. Spaces (`\s` also covers the non-breaking
// U+00A0 and the narrow non-breaking U+202F) are free around the sign and the currency markers;
// inside the digits a single space may only separate thousands, which `integerDigits` checks.
const EURO_INPUT = /^\s*(-?)\s*(?:(€|EUR)\s*(-?)\s*)?([\d.,](?:[\d.,\s]*[\d.,])?)\s*(€|EUR)?\s*$/i;
// A thousands-grouped integer: "1.234", "12.345.678". The first group has no leading zero.
const THOUSANDS_GROUPED = /^[1-9]\d{0,2}(?:\.\d{3})+$/;
// The same with one space as the separator: "1 234", "1 234 567". Never mixed with dots.
const THOUSANDS_SPACED = /^[1-9]\d{0,2}(?:\s\d{3})+$/;
const PLAIN_DIGITS = /^\d+$/;
// Exactly two decimals, as the Python reader (R49, M1): «1,5» or «12.5» are never guessed.
const TWO_DIGITS = /^\d{2}$/;

/**
 * The digits of an integer part written plainly, with thousands dots or with thousands spaces,
 * else `undefined`.
 */
function integerDigits(raw: string): string | undefined {
  if (PLAIN_DIGITS.test(raw)) return raw;
  if (THOUSANDS_GROUPED.test(raw)) return raw.replaceAll('.', '');
  if (THOUSANDS_SPACED.test(raw)) return raw.replace(/\s/g, '');
  return undefined;
}

/**
 * Parses an amount written the Italian way (or close to it) into cents.
 *
 * - Spaces (also non-breaking ones) around the sign and the currency are ignored; `€` and
 *   `EUR` are ignored too, at most one currency marker.
 * - Inside the digits a space is allowed only as a thousands separator, before every group of
 *   exactly three digits ("1 234,56", "1 234 567,00"), and never together with thousands dots.
 *   "98 46" or "9 8,46" throw: a misread amount must never be silent.
 * - A leading `-` is allowed, before or after the currency marker.
 * - With a comma, the comma is the decimal separator (exactly 2 digits) and dots are thousands
 *   separators; a dot after the comma is an error ("1,234.56").
 * - Without a comma, a last group of exactly 2 digits after the dot makes the dot the decimal
 *   separator ("98.46"); otherwise the dots are thousands separators ("1.234" is 1234 euro).
 *
 * Anything else (empty input, several commas, misplaced thousands groups, one or more than two
 * decimals (M1: «1,5», «1.234,5», «12.5»), amounts beyond the safe integers) throws a `RangeError` instead of guessing.
 */
export function parseEuro(input: string): Cents {
  const fail = (reason: string): never => {
    throw new RangeError(`Not an euro amount: ${JSON.stringify(input)} (${reason})`);
  };

  const match = EURO_INPUT.exec(input);
  if (match === null) return fail('unrecognised format');
  const [, leadingSign = '', prefixCurrency, signAfterCurrency = '', digits = '', suffixCurrency] =
    match;
  if (leadingSign !== '' && signAfterCurrency !== '') return fail('two minus signs');
  if (prefixCurrency !== undefined && suffixCurrency !== undefined) {
    return fail('two currency markers');
  }

  let integerPart: string | undefined;
  let decimalPart = '';
  if (digits.includes(',')) {
    const parts = digits.split(',');
    if (parts.length > 2) return fail('more than one decimal comma');
    const [rawInteger = '', rawDecimal = ''] = parts;
    if (rawDecimal.includes('.')) return fail('a dot after the decimal comma');
    if (!TWO_DIGITS.test(rawDecimal)) return fail('expected two decimal digits');
    integerPart = integerDigits(rawInteger);
    decimalPart = rawDecimal;
  } else {
    const parts = digits.split('.');
    const last = parts[parts.length - 1] ?? '';
    if (parts.length > 1 && TWO_DIGITS.test(last)) {
      // The dot is the decimal separator, so there is room for no other dot.
      if (parts.length > 2) return fail('mixed decimal and thousands dots');
      integerPart = integerDigits(parts[0] ?? '');
      decimalPart = last;
    } else {
      integerPart = integerDigits(digits);
    }
  }
  if (integerPart === undefined) return fail('malformed integer part or thousands groups');

  const absolute = Number(integerPart) * 100 + Number(decimalPart.padEnd(2, '0'));
  if (!Number.isSafeInteger(absolute)) return fail('amount out of range');
  const negative = leadingSign !== '' || signAfterCurrency !== '';
  return cents(negative ? -absolute : absolute);
}

/**
 * Formats cents as `€ 1.234,56`; negative amounts as `- € 63,00`.
 * Written by hand, not with `Intl`, so the output does not depend on the runtime's locale data.
 */
export function formatEuro(amount: Cents): string {
  const absolute = Math.abs(amount);
  const fraction = absolute % 100;
  const units = (absolute - fraction) / 100;
  const grouped = String(units).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const text = `€ ${grouped},${String(fraction).padStart(2, '0')}`;
  return amount < 0 ? `- ${text}` : text;
}

/** A weight as an exact fraction `numerator / 2^exponent`: every finite double is one. */
function toDyadic(weight: number): { numerator: bigint; exponent: number } {
  let scaled = weight;
  let exponent = 0;
  // Doubling is exact in floating point and a non-integer double stays below 2^53.
  while (!Number.isInteger(scaled)) {
    scaled *= 2;
    exponent += 1;
  }
  return { numerator: BigInt(scaled), exponent };
}

/**
 * Splits `total` among the given weights so that the parts always sum to `total`.
 *
 * Largest-remainder method on the absolute total: every part gets the floor of its exact
 * share, then the cents left over go one each to the largest fractional remainders (on equal
 * remainders, to the earliest weights). The sign is applied afterwards, so splitting `-n` is the
 * mirror image of splitting `n`. Weights may be non-integers; they are compared exactly (with
 * integer arithmetic), so equal weights always tie.
 *
 * Throws a `RangeError` if a weight is negative, `NaN` or infinite, or if no weight is positive.
 */
export function splitCents(total: Cents, weights: readonly number[]): Cents[] {
  weights.forEach((weight, index) => {
    if (!Number.isFinite(weight) || weight < 0) {
      throw new RangeError(`Invalid weight at index ${index}: ${String(weight)}`);
    }
  });

  // Bring all weights over a common power-of-two denominator.
  const dyadics = weights.map(toDyadic);
  const commonExponent = dyadics.reduce((max, { exponent }) => Math.max(max, exponent), 0);
  const scaledWeights = dyadics.map(({ numerator, exponent }) => {
    return numerator << BigInt(commonExponent - exponent);
  });
  const weightSum = scaledWeights.reduce((sum, weight) => sum + weight, 0n);
  if (weightSum === 0n) {
    throw new RangeError('Cannot split: at least one weight must be greater than zero');
  }

  const magnitude = BigInt(Math.abs(total));
  const shares = scaledWeights.map((weight, index) => {
    const product = magnitude * weight;
    return { index, quotient: product / weightSum, remainder: product % weightSum };
  });
  const allocated = shares.reduce((sum, { quotient }) => sum + quotient, 0n);
  const leftover = Number(magnitude - allocated);

  // The leftover is smaller than the number of non-zero remainders, so zero weights never win.
  const byRemainder = [...shares].sort((a, b) => {
    if (a.remainder !== b.remainder) return a.remainder > b.remainder ? -1 : 1;
    return a.index - b.index;
  });
  for (const share of byRemainder.slice(0, leftover)) share.quotient += 1n;

  const sign = total < 0 ? -1 : 1;
  return shares.map(({ quotient }) => cents(sign * Number(quotient)));
}
