import { describe, expect, it } from 'vitest';
import { suggestApartments } from '../src/suggest';

const apartments = [
  {
    id: 'a1',
    address: 'Galleria G. Berchet 3',
    cadastre: [{ sheet: '12', parcel: '345', sub: '6' }],
  },
  { id: 'a2', address: 'Via Roma 10', cadastre: undefined },
  { id: 'a3', address: undefined, cadastre: undefined },
];

describe('suggestApartments', () => {
  it('finds by cadastre', () => {
    expect(
      suggestApartments(
        { address: 'Altrove 99', sheet: '12', parcel: '345', sub: '6' },
        apartments,
      ),
    ).toEqual([{ apartmentId: 'a1', origin: 'catasto' }]);
  });

  it('finds by address ignoring case, accents, punctuation and street type', () => {
    expect(suggestApartments({ address: 'GAL. G. BERCHET 3' }, apartments)).toEqual([
      { apartmentId: 'a1', origin: 'indirizzo' },
    ]);
    expect(suggestApartments({ address: 'v. ROMA, 10' }, apartments)).toEqual([
      { apartmentId: 'a2', origin: 'indirizzo' },
    ]);
  });

  it('gives one origin per apartment, cadastre first', () => {
    expect(
      suggestApartments(
        { address: 'Via G. Berchet 3', sheet: '12', parcel: '345', sub: '6' },
        apartments,
      ),
    ).toEqual([{ apartmentId: 'a1', origin: 'catasto' }]);
  });

  it('does not match the same number in another street', () => {
    expect(suggestApartments({ address: 'Via Milano 10' }, apartments)).toEqual([]);
  });

  it('never suggests an apartment without address and cadastre', () => {
    expect(suggestApartments({ address: 'Via Roma 10' }, apartments.slice(2))).toEqual([]);
  });

  it('returns nothing without a property', () => {
    expect(suggestApartments(undefined, apartments)).toEqual([]);
  });
});
