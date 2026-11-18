import { describe, expect, it } from 'vitest';
import { caparraReturn } from '../src/caparra';
import type { CaparraReturnInput } from '../src/caparra';
import { cents } from '../src/money';

const input = (
  caparra: number,
  interest: number,
  conguaglio: number,
  extraCharges: { label: string; amount: number }[] = [],
): CaparraReturnInput => ({
  caparra: cents(caparra),
  interest: cents(interest),
  conguaglio: cents(conguaglio),
  extraCharges: extraCharges.map(({ label, amount }) => ({ label, amount: cents(amount) })),
});

const sumOfLines = (lines: { amount: number }[]): number =>
  lines.reduce((sum, { amount }) => sum + amount, 0);

describe('caparraReturn', () => {
  it('computes the Appartamento A example: 500,00 + 8,83 - 460,21 - 33,50 = 15,12', () => {
    const result = caparraReturn(input(50000, 883, 46021, [{ label: 'Zanzariera', amount: 3350 }]));
    expect(result.total).toBe(1512);
    expect(result.lines).toEqual([
      { label: 'Caparra', amount: 50000 },
      { label: 'Interessi legali', amount: 883 },
      { label: 'Conguaglio bollette', amount: -46021 },
      { label: 'Zanzariera', amount: -3350 },
    ]);
  });

  it('has a total equal to the sum of the line amounts', () => {
    const cases = [
      input(50000, 883, 46021, [{ label: 'Zanzariera', amount: 3350 }]),
      input(50000, 0, 0),
      input(50000, 883, -12000),
      input(50000, 883, 60000, [
        { label: 'Pulizia', amount: 2000 },
        { label: 'Imposta di registro', amount: 3350 },
      ]),
    ];
    for (const caseInput of cases) {
      const { total, lines } = caparraReturn(caseInput);
      expect(total).toBe(sumOfLines(lines));
    }
  });

  it('shows the conguaglio as a deduction and keeps the extra charges in input order', () => {
    const { lines } = caparraReturn(
      input(50000, 883, 46021, [
        { label: 'Pulizia', amount: 2000 },
        { label: 'Imposta di registro', amount: 3350 },
        { label: 'Zanzariera', amount: 1500 },
      ]),
    );
    expect(lines.map(({ label }) => label)).toEqual([
      'Caparra',
      'Interessi legali',
      'Conguaglio bollette',
      'Pulizia',
      'Imposta di registro',
      'Zanzariera',
    ]);
    expect(lines.map(({ amount }) => amount)).toEqual([50000, 883, -46021, -2000, -3350, -1500]);
  });

  it('adds a conguaglio in the tenant favour back', () => {
    const { total, lines } = caparraReturn(input(50000, 883, -12000));
    expect(total).toBe(62883);
    expect(lines[2]).toEqual({ label: 'Conguaglio bollette', amount: 12000 });
  });

  it('keeps the three fixed lines, with zero amounts, when there is nothing to settle', () => {
    const { total, lines } = caparraReturn(input(50000, 0, 0));
    expect(total).toBe(50000);
    expect(lines).toEqual([
      { label: 'Caparra', amount: 50000 },
      { label: 'Interessi legali', amount: 0 },
      { label: 'Conguaglio bollette', amount: 0 },
    ]);
    expect(Object.is(lines[2]?.amount, 0)).toBe(true);
  });

  it('returns a negative total when the deductions exceed the caparra', () => {
    const { total } = caparraReturn(input(50000, 883, 60000));
    expect(total).toBe(-9117);
  });

  it('does not change its input', () => {
    const original = input(50000, 883, 46021, [{ label: 'Zanzariera', amount: 3350 }]);
    const copy = structuredClone(original);
    caparraReturn(original);
    expect(original).toEqual(copy);
  });

  it('throws when the total is not a safe integer', () => {
    expect(() => caparraReturn(input(Number.MAX_SAFE_INTEGER, 1, 0))).toThrow(RangeError);
  });
});
