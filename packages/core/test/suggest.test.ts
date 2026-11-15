import { describe, expect, it } from 'vitest';
import { suggestApartments } from '../src/suggest';

const apartments = [
  {
    id: 'a1',
    address: 'Galleria G. Esempio 1',
    cadastre: [{ sheet: '10', parcel: '20', sub: '30' }],
  },
  { id: 'a2', address: 'Via Roma 10', cadastre: undefined },
  { id: 'a3', address: undefined, cadastre: undefined },
];

describe('suggestApartments', () => {
  it('finds by cadastre', () => {
    expect(
      suggestApartments(
        { address: 'Altrove 99', sheet: '10', parcel: '20', sub: '30' },
        apartments,
      ),
    ).toEqual([{ apartmentId: 'a1', origin: 'catasto' }]);
  });

  it('finds by address ignoring case, accents, punctuation and street type', () => {
    expect(suggestApartments({ address: 'GAL. G. ESEMPIO 1' }, apartments)).toEqual([
      { apartmentId: 'a1', origin: 'indirizzo' },
    ]);
    expect(suggestApartments({ address: 'v. ROMA, 10' }, apartments)).toEqual([
      { apartmentId: 'a2', origin: 'indirizzo' },
    ]);
  });

  it('gives one origin per apartment, cadastre first', () => {
    expect(
      suggestApartments(
        { address: 'Via G. Esempio 1', sheet: '10', parcel: '20', sub: '30' },
        apartments,
      ),
    ).toEqual([{ apartmentId: 'a1', origin: 'catasto' }]);
  });

  it('keeps the street type: Viale Roma is not Via Roma, V. Roma is', () => {
    expect(suggestApartments({ address: 'Viale Roma 10' }, apartments)).toEqual([]);
    expect(suggestApartments({ address: 'V. Roma 10' }, apartments)).toEqual([
      { apartmentId: 'a2', origin: 'indirizzo' },
    ]);
    expect(suggestApartments({ address: 'C.so Roma 10' }, apartments)).toEqual([]);
  });

  it('lets an address without a street type match a typed one', () => {
    expect(suggestApartments({ address: 'Roma 10' }, apartments)).toEqual([
      { apartmentId: 'a2', origin: 'indirizzo' },
    ]);
  });

  it('returns only the cadastre matches when there are any', () => {
    expect(
      suggestApartments(
        { address: 'Via Roma 10', sheet: '10', parcel: '20', sub: '30' },
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
