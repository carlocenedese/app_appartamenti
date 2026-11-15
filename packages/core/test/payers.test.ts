import { describe, expect, it } from 'vitest';
import { firstPresenceDay, nameInText, payerKeyOf, nameKeyOf, validPayers } from '../src/payers';
import { ISODateSchema, PayerSchema, TenancySchema, TenantSchema } from '../src/model';
import type { Payer, Tenancy } from '../src/model';

// A wrong check digit made at run time: no whole made-up IBAN is written in the file.
const BAD_IBAN = 'IT60X0542811101000000123456'.replace(/6$/, '7');

const day = (text: string) => ISODateSchema.parse(text);

const payer = (over: Record<string, unknown>): Payer =>
  PayerSchema.parse({
    id: 'p1',
    v: 1,
    rev: 1,
    key: 'name:mario rossi',
    tenantId: 't1',
    validFrom: '2025-01-01',
    source: 'manual',
    ...over,
  });

const tenancy = (over: Record<string, unknown>): Tenancy =>
  TenancySchema.parse({
    id: 'n1',
    v: 1,
    rev: 1,
    apartmentId: 'a1',
    tenantId: 't1',
    from: '2025-03',
    monthlyRent: 0,
    monthlyForfait: 0,
    ...over,
  });

describe('payerKeyOf', () => {
  it('prefers a valid IBAN, normalised', () => {
    expect(payerKeyOf({ iban: 'it60 x054 2811 1010 0000 0123 456', name: 'Mario Rossi' })).toBe(
      'iban:IT60X0542811101000000123456',
    );
  });
  it('falls back to the name when the IBAN check fails', () => {
    expect(payerKeyOf({ iban: BAD_IBAN, name: 'Mario Rossi' })).toBe('name:mario rossi');
    expect(payerKeyOf({ iban: BAD_IBAN })).toBeUndefined();
  });
  it('gives the same key to one IBAN under different names', () => {
    const iban = 'IT60X0542811101000000123456';
    expect(payerKeyOf({ iban, name: 'Mario Rossi' })).toBe(
      payerKeyOf({ iban, name: 'Anna Verdi' }),
    );
  });
  it('folds the name', () => {
    expect(payerKeyOf({ name: '  Mario  ROSSI\n' })).toBe('name:mario rossi');
  });
  it('gives nothing for a blank name or no counterparty', () => {
    expect(payerKeyOf({ name: '   ' })).toBeUndefined();
    expect(payerKeyOf(undefined)).toBeUndefined();
    expect(payerKeyOf({})).toBeUndefined();
  });
});

describe('nameKeyOf', () => {
  it('gives the name key even with an IBAN', () => {
    expect(nameKeyOf({ name: 'Mario  Rossi' })).toBe('name:mario rossi');
    expect(nameKeyOf({ name: ' ' })).toBeUndefined();
    expect(nameKeyOf(undefined)).toBeUndefined();
  });
});

describe('validPayers', () => {
  const key = 'name:mario rossi';
  it('excludes deleted, not yet valid and expired payers', () => {
    const list = [
      payer({ id: 'a', deleted: true }),
      payer({ id: 'b', validFrom: '2025-06-01' }),
      payer({ id: 'c', validTo: '2025-04-30' }),
      payer({ id: 'd', tenantId: 't9', validTo: '2025-05-01' }),
    ];
    expect(validPayers(list, key, day('2025-05-01'), []).map((p) => p.id)).toEqual(['d']);
  });
  it('keeps one record per tenant, sorted by tenantId', () => {
    const list = [
      payer({ id: 'x', tenantId: 't2' }),
      payer({ id: 'y', tenantId: 't1' }),
      payer({ id: 'z', tenantId: 't1' }),
    ];
    expect(validPayers(list, key, day('2025-05-01'), []).map((p) => p.tenantId)).toEqual([
      't1',
      't2',
    ]);
  });
  it('includes both ends of the validity', () => {
    const list = [
      payer({ id: 'a', validFrom: '2025-05-01' }),
      payer({ id: 'b', tenantId: 't2', validTo: '2025-05-01' }),
    ];
    expect(validPayers(list, key, day('2025-05-01'), []).map((p) => p.id)).toEqual(['a', 'b']);
  });
  it('picks the record with the smallest id whatever the input order', () => {
    const z = payer({ id: 'z', source: 'confirmed' });
    const y = payer({ id: 'y', source: 'manual' });
    for (const list of [
      [z, y],
      [y, z],
    ]) {
      const [only] = validPayers(list, key, day('2025-05-01'), []);
      expect([only?.id, only?.source]).toEqual(['y', 'manual']);
    }
  });
  it('ignores the payers of a deleted tenant, as if they were not there (user1, 15 Nov 2026)', () => {
    const tenants = [
      TenantSchema.parse({ id: 't1', v: 1, rev: 2, name: 'Nome Inventato', deleted: true }),
      TenantSchema.parse({ id: 't2', v: 1, rev: 1, name: 'Altro Nome' }),
    ];
    const list = [
      payer({ id: 'a' }),
      payer({ id: 'b', tenantId: 't2' }),
      payer({ id: 'c', tenantId: 't3' }),
    ];
    expect(validPayers(list, key, day('2025-05-01'), tenants).map((p) => p.id)).toEqual(['b', 'c']);
  });
  it('ignores other keys', () => {
    expect(validPayers([payer({ key: 'name:altro' })], key, day('2025-05-01'), [])).toEqual([]);
  });
});

describe('nameInText', () => {
  it('matches whole words in any order', () => {
    expect(nameInText('Mario Rossi', ['BONIFICO DA ROSSI MARIO'])).toBe(true);
    expect(nameInText('Mario Rossi', ['bonifico', 'da MARIO e ROSSI'])).toBe(true);
    expect(nameInText('Mario Rossi', ['MARIO', 'ROSSI'])).toBe(true);
  });
  it('rejects glued words and longer words', () => {
    expect(nameInText('Mario Rossi', ['MARIOROSSI'])).toBe(false);
    expect(nameInText('Mario Rossi', ['MARIO ROSSINI'])).toBe(false);
  });
  it('rejects an empty name', () => {
    expect(nameInText('  ', ['MARIO'])).toBe(false);
  });
});

describe('firstPresenceDay', () => {
  it('takes the oldest live presence of that tenant in that apartment', () => {
    const list = [
      tenancy({ id: '1', from: '2025-03' }),
      tenancy({ id: '2', from: '2024-10' }),
      tenancy({ id: '3', from: '2020-01', apartmentId: 'a2' }),
      tenancy({ id: '4', from: '2019-01', deleted: true }),
      tenancy({ id: '5', from: '2015-01', tenantId: 't2' }),
    ];
    expect(firstPresenceDay(list, 't1', 'a1')).toBe('2024-10-01');
    expect(firstPresenceDay(list, 't1', 'a3')).toBeUndefined();
  });
});
