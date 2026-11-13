import { describe, expect, it } from 'vitest';
import { SupplySchema } from '../src/model';
import { draftProblem, draftToSupply, draftTotal, newDraft } from '../src/supply-link';

const row = (apartmentId: string, basisPoints: number) => ({ apartmentId, basisPoints });
const draft = (rows: { apartmentId: string; basisPoints: number }[], note = '') => ({
  label: 'UT-1',
  rows,
  note,
});
const ids = { newId: () => 's1' };

describe('newDraft', () => {
  it('one suggestion gives one row at 100%', () => {
    expect(newDraft('UT-1', [{ apartmentId: 'a1' }]).rows).toEqual([row('a1', 10000)]);
  });
  it('no or several suggestions give empty rows', () => {
    expect(newDraft('UT-1', []).rows).toEqual([]);
    expect(newDraft('UT-1', [{ apartmentId: 'a1' }, { apartmentId: 'a2' }]).rows).toEqual([
      row('', 0),
      row('', 0),
    ]);
  });
});

describe('draftProblem', () => {
  it('total below', () => {
    expect(draftProblem(draft([row('a', 8500)]))).toBe('Il totale è 85,00%: manca il 15,00%');
  });
  it('total above', () => {
    expect(draftProblem(draft([row('a', 10001)]))).toBe(
      'Il totale è 100,01%: sono 0,01% di troppo',
    );
    expect(draftProblem(draft([row('a', 5000), row('b', 5100)]))).toBe(
      'Il totale è 101,00%: sono 1,00% di troppo',
    );
  });
  it('9999 is a problem with two decimals', () => {
    expect(draftProblem(draft([row('a', 6666), row('b', 3333)]))).toBe(
      'Il totale è 99,99%: manca il 0,01%',
    );
  });
  it('repeated apartment, no row, missing apartment', () => {
    expect(draftProblem(draft([row('a', 5000), row('a', 5000)]))).toBe(
      'Lo stesso appartamento compare due volte.',
    );
    expect(draftProblem(draft([]))).toBe('Scegli almeno un appartamento.');
    expect(draftProblem(draft([row('', 10000)]))).toBe("Scegli l'appartamento di ogni riga.");
  });
  it('valid drafts', () => {
    expect(draftProblem(draft([row('a', 10000)]))).toBeUndefined();
    expect(draftProblem(draft([row('a', 3333), row('b', 6667)]))).toBeUndefined();
    expect(draftTotal(draft([row('a', 3333), row('b', 6667)]))).toBe(10000);
  });
});

describe('draftToSupply', () => {
  it('builds a valid supply, the note is not part of it', () => {
    const supply = draftToSupply(draft([row('a', 3333), row('b', 6667)], 'nota'), ids);
    expect(supply).toEqual({
      id: 's1',
      label: 'UT-1',
      apartments: [
        { apartmentId: 'a', weight: 3333 },
        { apartmentId: 'b', weight: 6667 },
      ],
    });
    expect(SupplySchema.safeParse({ ...supply, v: 1, rev: 1 }).success).toBe(true);
  });
  it('an empty note changes nothing', () => {
    expect(draftToSupply(draft([row('a', 10000)], ''), ids)).toEqual(
      draftToSupply(draft([row('a', 10000)], 'x'), ids),
    );
  });
  it('throws RangeError on a problem', () => {
    expect(() => draftToSupply(draft([row('a', 9999)]), ids)).toThrow(RangeError);
    expect(() => draftToSupply(draft([row('a', 5000), row('a', 5000)]), ids)).toThrow(RangeError);
  });
});
