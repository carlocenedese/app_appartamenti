import { describe, expect, it } from 'vitest';
import { whoPaid } from '../src/income';
import type { IncomeContext } from '../src/income';
import {
  AccountSchema,
  BankTransactionSchema,
  PayerSchema,
  PaymentSchema,
  TenancySchema,
  TenantSchema,
} from '../src/model';
import type { BankTransaction } from '../src/model';
import { ibanEndingWith } from './helpers/iban-build';

const base = { v: 1, rev: 1 };
const OWN_A = ibanEndingWith('1');
const OWN_B = ibanEndingWith('2');
const PAYER_IBAN = ibanEndingWith('77');
// One digit changed at run time: never a whole invented IBAN in the file.
const BAD_IBAN = PAYER_IBAN.replace(/\d$/, (d) => String((Number(d) + 1) % 10));

const account = (id: string, apartmentId: string, iban?: string, deleted?: boolean) =>
  AccountSchema.parse({
    ...base,
    id,
    apartmentId,
    label: 'Conto',
    bankProfileId: 'bp1',
    ...(iban === undefined ? {} : { iban }),
    ...(deleted === undefined ? {} : { deleted }),
  });

const tenant = (id: string, name: string, deleted?: boolean) =>
  TenantSchema.parse({ ...base, id, name, ...(deleted === undefined ? {} : { deleted }) });

const tenancy = (over: Record<string, unknown>) =>
  TenancySchema.parse({
    ...base,
    apartmentId: 'a1',
    from: '2026-01',
    monthlyRent: 40000,
    monthlyForfait: 5000,
    ...over,
  });

const payer = (over: Record<string, unknown>) =>
  PayerSchema.parse({ ...base, validFrom: '2026-01-01', source: 'confirmed', ...over });

const payment = (over: Record<string, unknown>) =>
  PaymentSchema.parse({
    ...base,
    apartmentId: 'a1',
    date: '2026-03-02',
    amount: 45000,
    confirmed: true,
    kind: 'canone',
    source: 'csv',
    ...over,
  });

const tx = (over: Record<string, unknown> = {}): BankTransaction =>
  BankTransactionSchema.parse({
    ...base,
    id: 'tx1',
    apartmentId: 'a1',
    accountId: 'c1',
    date: '2026-03-05',
    amount: 50000,
    description: 'Bonifico a vostro favore',
    statementHash: 'h1',
    ...over,
  });

const ctx = (over: Partial<IncomeContext> = {}): IncomeContext => ({
  accounts: [account('c1', 'a1', OWN_A), account('c2', 'a2', OWN_B)],
  apartments: [],
  tenancies: [],
  tenants: [],
  payers: [],
  payments: [],
  ...over,
});

describe('whoPaid: skip', () => {
  it('skips a row without account, or with a deleted or unknown one', () => {
    expect(whoPaid(tx({ accountId: undefined }), ctx())).toEqual({
      kind: 'skip',
      reason: 'no-account',
    });
    expect(whoPaid(tx({ accountId: 'nope' }), ctx())).toEqual({
      kind: 'skip',
      reason: 'no-account',
    });
    const gone = ctx({ accounts: [account('c1', 'a1', OWN_A, true)] });
    expect(whoPaid(tx(), gone)).toEqual({ kind: 'skip', reason: 'no-account' });
  });

  it('skips money from an own account, also of another apartment, written with spaces', () => {
    const spaced = OWN_B.replace(/(.{4})/g, '$1 ').toLowerCase();
    expect(whoPaid(tx({ counterparty: { iban: spaced, name: 'Io' } }), ctx())).toEqual({
      kind: 'skip',
      reason: 'own-account',
    });
  });

  it('does not count the IBAN of a deleted account as own', () => {
    const c = ctx({ accounts: [account('c1', 'a1', OWN_A), account('c2', 'a2', OWN_B, true)] });
    expect(whoPaid(tx({ counterparty: { iban: OWN_B } }), c).kind).toBe('ask');
  });
});

describe('whoPaid: known payers', () => {
  const key = `iban:${PAYER_IBAN}`;

  it('knows the tenant from one valid IBAN payer, whatever the name says', () => {
    const c = ctx({ payers: [payer({ id: 'p1', key, tenantId: 't1' })] });
    const expected = { kind: 'known', tenantId: 't1', key };
    expect(whoPaid(tx({ counterparty: { iban: PAYER_IBAN, name: 'Mario Rossi' } }), c)).toEqual(
      expected,
    );
    expect(whoPaid(tx({ counterparty: { iban: PAYER_IBAN, name: 'Altro Nome' } }), c)).toEqual(
      expected,
    );
  });

  it('knows the tenant from one valid name payer when the row has no IBAN', () => {
    const c = ctx({ payers: [payer({ id: 'p1', key: 'name:mario rossi', tenantId: 't1' })] });
    expect(whoPaid(tx({ counterparty: { name: ' MARIO  Rossi' } }), c)).toEqual({
      kind: 'known',
      tenantId: 't1',
      key: 'name:mario rossi',
    });
  });

  it('a payer of a deleted tenant does not count (user1, 15 Nov 2026)', () => {
    const c = ctx({
      tenants: [tenant('t1', 'Zoe Bianchi', true)],
      tenancies: [tenancy({ id: 'n1', tenantId: 't1' })],
      payers: [payer({ id: 'p1', key, tenantId: 't1' })],
    });
    const row = tx({ counterparty: { iban: PAYER_IBAN } });
    expect(whoPaid(row, c)).toEqual({ kind: 'ask', reason: 'new-payer', tenantIds: ['t1'], key });
    // A payer of a deleted tenant still keeps the key from being automatic: only the live ones
    // are candidates (user1, 15 Nov 2026).
    const two = { ...c, payers: [...c.payers, payer({ id: 'p2', key, tenantId: 't2' })] };
    expect(whoPaid(row, two)).toEqual({
      kind: 'ask',
      reason: 'multi-tenant',
      tenantIds: ['t2'],
      key,
    });
    // An expired payer of the deleted tenant does not block.
    const expired = {
      ...two,
      payers: [
        payer({ id: 'p1', key, tenantId: 't1', validTo: '2026-01-31' }),
        payer({ id: 'p2', key, tenantId: 't2' }),
      ],
    };
    expect(whoPaid(row, expired)).toEqual({ kind: 'known', tenantId: 't2', key });
  });

  it('an invalid IBAN never falls back on the name payer: invalid-iban (user1, 15 Nov 2026)', () => {
    const c = ctx({
      tenancies: [tenancy({ id: 'n1', tenantId: 't1' })],
      payers: [payer({ id: 'p1', key: 'name:mario rossi', tenantId: 't1' })],
    });
    for (const iban of [BAD_IBAN, 'IT60', 'non un iban']) {
      expect(whoPaid(tx({ counterparty: { iban, name: 'Mario Rossi' } }), c)).toEqual({
        kind: 'ask',
        reason: 'invalid-iban',
        tenantIds: ['t1'],
      });
    }
    // A blank IBAN is no IBAN: the name payer holds.
    expect(whoPaid(tx({ counterparty: { iban: '  ', name: 'Mario Rossi' } }), c)).toMatchObject({
      kind: 'known',
    });
  });

  it('asks among only the tenants of several valid payers with the same key', () => {
    const c = ctx({
      tenants: [tenant('t1', 'Zoe Bianchi'), tenant('t2', 'Anna Neri')],
      tenancies: [tenancy({ id: 'n3', tenantId: 't3' })],
      payers: [
        payer({ id: 'p1', key, tenantId: 't1' }),
        payer({ id: 'p2', key, tenantId: 't2' }),
        payer({ id: 'p3', key, tenantId: 't3', deleted: true }),
        payer({ id: 'p4', key, tenantId: 't4', validTo: '2026-02-28' }),
      ],
    });
    expect(whoPaid(tx({ counterparty: { iban: PAYER_IBAN } }), c)).toEqual({
      kind: 'ask',
      reason: 'multi-tenant',
      tenantIds: ['t2', 't1'],
      key,
    });
  });

  it('asks with the name payer on top when the row brings an IBAN (decision B)', () => {
    // t1 is a relative paying under another name; t2 wins every other criterion.
    const c = ctx({
      tenants: [tenant('t1', 'Zoe Bianchi'), tenant('t2', 'Anna Neri')],
      tenancies: [
        tenancy({ id: 'n1', tenantId: 't1' }),
        tenancy({ id: 'n2', tenantId: 't2', monthlyRent: 45000 }),
      ],
      payers: [payer({ id: 'p1', key: 'name:mario rossi', tenantId: 't1' })],
    });
    expect(whoPaid(tx({ counterparty: { iban: PAYER_IBAN, name: 'Mario Rossi' } }), c)).toEqual({
      kind: 'ask',
      reason: 'name-only-payer',
      tenantIds: ['t1', 't2'],
      key,
    });
  });

  it('lets the IBAN payer win over a name payer of another tenant', () => {
    const c = ctx({
      payers: [
        payer({ id: 'p1', key, tenantId: 't1' }),
        payer({ id: 'p2', key: 'name:mario rossi', tenantId: 't2' }),
      ],
    });
    expect(whoPaid(tx({ counterparty: { iban: PAYER_IBAN, name: 'Mario Rossi' } }), c)).toEqual({
      kind: 'known',
      tenantId: 't1',
      key,
    });
  });

  it('skips an own account even when a valid payer has its IBAN', () => {
    const c = ctx({ payers: [payer({ id: 'p1', key: `iban:${OWN_B}`, tenantId: 't1' })] });
    expect(whoPaid(tx({ counterparty: { iban: OWN_B } }), c)).toEqual({
      kind: 'skip',
      reason: 'own-account',
    });
  });
});

describe('whoPaid: new payer', () => {
  it('orders by name, then expected amount, then presence without rent, then name', () => {
    const c = ctx({
      tenants: [
        tenant('t-anna', 'Anna Bruni'),
        tenant('t-bice', 'Bice Conti'),
        tenant('t-pia', 'Pia Galli'),
        tenant('t-ugo', 'Ugo Riva'),
        tenant('t-zeno', 'Zeno Verdi'),
      ],
      tenancies: [
        // Zeno left in February: only the name puts him first.
        tenancy({ id: 'n-zeno', tenantId: 't-zeno', to: '2026-02' }),
        // Ugo's rent is the amount, though March is paid.
        tenancy({ id: 'n-ugo', tenantId: 't-ugo', monthlyRent: 45000 }),
        tenancy({ id: 'n-pia', tenantId: 't-pia' }),
        tenancy({ id: 'n-anna', tenantId: 't-anna' }),
        tenancy({ id: 'n-bice', tenantId: 't-bice' }),
        tenancy({ id: 'n-other', tenantId: 't-elsewhere', apartmentId: 'a2' }),
      ],
      payments: [
        payment({ id: 'm-ugo', tenantId: 't-ugo' }),
        payment({ id: 'm-anna', tenantId: 't-anna', date: '2026-04-01', forMonth: '2026-03' }),
        payment({ id: 'm-bice', tenantId: 't-bice', confirmed: false }),
        // None of these pays Pia's March rent.
        payment({ id: 'm-pia1', tenantId: 't-pia', deleted: true }),
        payment({ id: 'm-pia2', tenantId: 't-pia', kind: 'caparra' }),
        payment({ id: 'm-pia3', tenantId: 't-pia', forMonth: '2026-02' }),
      ],
    });
    const row = tx({ description: 'Bonifico da verdi ZENO canone', counterparty: undefined });
    expect(whoPaid(row, c)).toEqual({
      kind: 'ask',
      reason: 'new-payer',
      tenantIds: ['t-zeno', 't-ugo', 't-pia', 't-anna', 't-bice'],
    });
  });

  it('reads the name also from the counterparty, never from part of a word', () => {
    const c = ctx({
      tenants: [tenant('t1', 'Anna Bruni'), tenant('t2', 'Ugo Riva')],
      tenancies: [tenancy({ id: 'n1', tenantId: 't1' }), tenancy({ id: 'n2', tenantId: 't2' })],
    });
    const byName = whoPaid(tx({ counterparty: { name: 'Ugo Riva' } }), c);
    expect(byName).toEqual({
      kind: 'ask',
      reason: 'new-payer',
      tenantIds: ['t2', 't1'],
      key: 'name:ugo riva',
    });
    const partial = whoPaid(tx({ description: 'Ugo Rivas' }), c);
    expect(partial).toMatchObject({ tenantIds: ['t1', 't2'] });
  });

  it('lists a tenant with two presences once, uses the presence of the month for the amount', () => {
    const c = ctx({
      tenants: [tenant('t1', 'Anna Bruni'), tenant('t2', 'Bice Conti')],
      tenancies: [
        tenancy({ id: 'n1', tenantId: 't1' }),
        tenancy({ id: 'n2a', tenantId: 't2', room: 'A', to: '2026-02' }),
        tenancy({ id: 'n2b', tenantId: 't2', room: 'B', from: '2026-03', monthlyRent: 45000 }),
        tenancy({ id: 'n2c', tenantId: 't2', monthlyRent: 99999, deleted: true }),
      ],
    });
    expect(whoPaid(tx(), c)).toEqual({ kind: 'ask', reason: 'new-payer', tenantIds: ['t2', 't1'] });
  });

  it('keeps a presence without tenant record, ordered by its id, and never shows names', () => {
    const c = ctx({
      tenants: [tenant('t1', 'zz Bruni'), tenant('t-gone', 'Aldo Gone', true)],
      tenancies: [
        tenancy({ id: 'n1', tenantId: 't1' }),
        tenancy({ id: 'n2', tenantId: 't-missing' }),
        tenancy({ id: 'n3', tenantId: 't-gone' }),
      ],
    });
    // A deleted tenant has no name either, so "Aldo" in the text does not lift it.
    const result = whoPaid(tx({ description: 'Aldo Gone' }), c);
    expect(result).toEqual({
      kind: 'ask',
      reason: 'new-payer',
      tenantIds: ['t-gone', 't-missing', 't1'],
    });
    const text = JSON.stringify(result);
    for (const word of ['Bruni', 'Aldo', 'Gone']) expect(text).not.toContain(word);
    expect(text).not.toContain('IT');
  });

  it('asks with no candidates when the apartment has no presence', () => {
    expect(whoPaid(tx({ counterparty: { iban: PAYER_IBAN } }), ctx())).toEqual({
      kind: 'ask',
      reason: 'new-payer',
      tenantIds: [],
      key: `iban:${PAYER_IBAN}`,
    });
  });

  it('breaks a tie on the same name by id', () => {
    const c = ctx({
      tenants: [tenant('t2', 'Anna Bruni'), tenant('t1', 'Anna Bruni')],
      tenancies: [tenancy({ id: 'n2', tenantId: 't2' }), tenancy({ id: 'n1', tenantId: 't1' })],
    });
    expect(whoPaid(tx(), c)).toMatchObject({ tenantIds: ['t1', 't2'] });
  });

  it('does not count a rent paid for another apartment as paid here', () => {
    const c = ctx({
      tenants: [tenant('t1', 'Zoe Bianchi'), tenant('t2', 'Anna Neri')],
      tenancies: [
        tenancy({ id: 'n1', tenantId: 't1' }),
        tenancy({ id: 'n1b', tenantId: 't1', apartmentId: 'a2' }),
        tenancy({ id: 'n2', tenantId: 't2' }),
      ],
      payments: [
        payment({ id: 'm1', tenantId: 't1', apartmentId: 'a2' }),
        payment({ id: 'm2', tenantId: 't2' }),
      ],
    });
    expect(whoPaid(tx(), c)).toMatchObject({ tenantIds: ['t1', 't2'] });
  });
});
