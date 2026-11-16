import { describe, expect, it } from 'vitest';
import {
  AccountSchema,
  BankTransactionSchema,
  CondoDocumentSchema,
  MovementClassSchema,
  condoCheck,
  freeDebits,
  condoDifferences,
  cents,
  isoDate,
  loadCondo,
  recordPath,
  recordSchemas,
} from '../src/index';
import type { BillMatch, CondoDocument, FreeDebit, Instalment, RecordKind } from '../src/index';
import { apartment, instalment, match, mulberry32, shuffled } from './helpers/conguaglio-builders';
import { MemoryStore } from './helpers/memory-store';

// Invented instalments and amounts (plan 8, task 5). Due on 2026-05-10, expected 150,00 €.
const rata = (id: string, extra: Partial<Instalment> = {}) =>
  instalment(id, { rata: cents(15000), ...extra });
const debit = (i: Instalment, amount: number, tx: string, extra: Partial<BillMatch> = {}) =>
  match(i, amount, { transactionId: tx, id: `m-${i.id}-${tx}`, ...extra });
const statusOf = (i: Instalment, matches: BillMatch[], asOf: string) =>
  condoCheck({ instalments: [i], matches, asOf: isoDate(asOf) })[0]?.status;

describe('condoCheck (plan 8, task 5, section 12)', () => {
  const r = rata('r1');

  it('pagata: the real debits add up to rata + conguaglioPrec', () => {
    expect(statusOf(r, [debit(r, 15000, 'tx-1')], '2026-06-01')).toBe('pagata');
    const withPrev = rata('r2', { conguaglioPrec: cents(-2000) });
    expect(statusOf(withPrev, [debit(withPrev, 13000, 'tx-1')], '2026-06-01')).toBe('pagata');
  });

  it('importo-diverso: one real debit of another amount', () => {
    expect(statusOf(r, [debit(r, 14999, 'tx-1')], '2026-06-01')).toBe('importo-diverso');
  });

  it('a payment in two matched parts that add up is pagata, never duplicato (R198)', () => {
    const split = [debit(r, 7500, 'tx-1'), debit(r, 7500, 'tx-2')];
    expect(statusOf(r, split, '2026-06-01')).toBe('pagata');
  });

  it('duplicato: a free movement of the same amount within the window of the due date', () => {
    const paid = [debit(r, 15000, 'tx-1')];
    const check = (free: FreeDebit[]) =>
      condoCheck({ instalments: [r], matches: paid, asOf: isoDate('2026-06-01'), free })[0]?.status;
    const free = (date: string, amount = -15000, apartmentId = 'apt'): FreeDebit => ({
      apartmentId,
      date: isoDate(date),
      amount: cents(amount),
    });
    // Due 2026-05-10, window 5 days before, 10 after.
    expect(check([free('2026-05-05')])).toBe('duplicato');
    expect(check([free('2026-05-20')])).toBe('duplicato');
    expect(check([free('2026-05-04')])).toBe('pagata');
    expect(check([free('2026-05-21')])).toBe('pagata');
    expect(check([free('2026-05-12', -14999)])).toBe('pagata');
    expect(check([free('2026-05-12', -15000, 'apt-2')])).toBe('pagata');
    // Not paid yet: a free movement is a candidate for the match, not a second charge.
    expect(
      condoCheck({
        instalments: [r],
        matches: [],
        asOf: isoDate('2026-06-01'),
        free: [free('2026-05-12')],
      })[0]?.status,
    ).toBe('senza-addebito');
  });

  it('freeDebits: outgoing movements without a match, payment, transfer or exclusion', () => {
    const base = { v: 1 as const, rev: 1, description: 'x', statementHash: 's' };
    const tx = (id: string, amount: number, extra: Record<string, unknown> = {}) =>
      BankTransactionSchema.parse({
        ...base,
        id,
        apartmentId: 'apt-x',
        accountId: 'acc-1',
        date: '2026-05-12',
        amount,
        ...extra,
      });
    const result = freeDebits({
      accounts: [
        AccountSchema.parse({
          ...base,
          id: 'acc-1',
          apartmentId: 'apt',
          label: 'C',
          bankProfileId: 'bp',
        }),
      ],
      transactions: [
        tx('free', -15000),
        tx('classified', -15000),
        tx('in', 15000),
        tx('matched', -15000),
        tx('excluded', -15000),
        tx('gone', -15000, { deleted: true }),
      ],
      classes: [
        MovementClassSchema.parse({
          ...base,
          id: 'mc-classified',
          transactionId: 'classified',
          kind: 'condominio',
          apartmentId: 'apt',
        }),
        MovementClassSchema.parse({
          ...base,
          id: 'mc-excluded',
          transactionId: 'excluded',
          kind: 'escluso',
          excludeReason: 'doppione',
        }),
      ],
      payments: [],
      matches: [debit(r, 15000, 'matched')],
      transfers: [],
    });
    expect(result).toEqual([
      { apartmentId: 'apt', date: '2026-05-12', amount: -15000 },
      { apartmentId: 'apt', date: '2026-05-12', amount: -15000 },
    ]);
  });

  it('senza-addebito from the day after the due date, in-programma up to it', () => {
    expect(statusOf(r, [], '2026-05-10')).toBe('in-programma');
    expect(statusOf(r, [], '2026-05-11')).toBe('senza-addebito');
  });

  it('assunta, and what does not count: unconfirmed, deleted, commission, other items', () => {
    expect(statusOf(r, [debit(r, 15000, 'tx-1', { by: 'assumed' })], '2026-06-01')).toBe('assunta');
    const ignored = [
      debit(r, 15000, 'tx-1', { confirmed: false }),
      debit(r, 15000, 'tx-2', { deleted: true }),
      debit(r, 80, 'tx-3', { part: 'commission' }),
      { ...debit(r, 15000, 'tx-4'), itemId: 'altro' },
    ];
    expect(statusOf(r, ignored, '2026-06-01')).toBe('senza-addebito');
  });

  it('lists ordinary and extraordinary condominium instalments, not the TARI, sorted', () => {
    const items = [
      rata('b', { coversFrom: '2026-08' as Instalment['coversFrom'] }),
      rata('s', { straordinaria: true, apartmentId: 'apt' }),
      rata('a'),
      rata('t', { kind: 'tari' }),
      rata('x', { deleted: true }),
    ];
    const rows = condoCheck({ instalments: items, matches: [], asOf: isoDate('2026-01-01') });
    expect(rows.map((row) => [row.instalmentId, row.straordinaria])).toEqual([
      ['a', false],
      ['s', true],
      ['b', false],
    ]);
    const again = condoCheck({
      instalments: shuffled(items, mulberry32(7)),
      matches: [],
      asOf: isoDate('2026-01-01'),
    });
    expect(again).toEqual(rows);
    expect(rows[0]).toEqual({
      instalmentId: 'a',
      apartmentId: 'apt',
      esercizio: '2026-27',
      rateIndex: 1,
      rateCount: 4,
      straordinaria: false,
      dueDate: '2026-05-10',
      expected: 15000,
      debitDates: [],
      status: 'in-programma',
    });
  });
});

const doc = (kind: 'preventivo' | 'consuntivo', extra: Partial<CondoDocument> = {}) =>
  CondoDocumentSchema.parse({
    id: `condoc-apt-2026-27-${kind}`,
    v: 1,
    rev: 1,
    apartmentId: 'apt',
    esercizio: '2026-27',
    kind,
    total: kind === 'preventivo' ? 120000 : 126000,
    ...extra,
  });

describe('condoDifferences (plan 8, task 5)', () => {
  it('consuntivo − preventivo with the setting; the tenants share only when both give it', () => {
    expect(condoDifferences([apartment()], [doc('preventivo'), doc('consuntivo')])).toEqual([
      {
        apartmentId: 'apt',
        esercizio: '2026-27',
        to: 'tenants',
        preventivo: 120000,
        consuntivo: 126000,
        difference: 6000,
      },
    ]);
    const both = [
      doc('preventivo', { quotaConduttore: cents(80000) }),
      doc('consuntivo', { quotaConduttore: cents(78000) }),
    ];
    expect(condoDifferences([apartment({ condoDifferenceTo: 'owner' })], both)).toEqual([
      expect.objectContaining({
        to: 'owner',
        conduttore: { preventivo: 80000, consuntivo: 78000, difference: -2000 },
      }),
    ]);
  });

  it('nothing without both documents, for a deleted one or an unknown apartment', () => {
    expect(condoDifferences([apartment()], [doc('preventivo')])).toEqual([]);
    expect(
      condoDifferences([apartment()], [doc('preventivo'), doc('consuntivo', { deleted: true })]),
    ).toEqual([]);
    expect(condoDifferences([], [doc('preventivo'), doc('consuntivo')])).toEqual([]);
  });
});

describe('loadCondo (plan 8, task 5)', () => {
  async function storeWith(records: [RecordKind, { id: string } & Record<string, unknown>][]) {
    const store = new MemoryStore();
    for (const [kind, r] of records) {
      await store.writeJsonAtomic(recordPath(kind, r.id), recordSchemas[kind].parse(r));
    }
    return store;
  }

  it('reads, filters by apartment and esercizio, and gives the differences', async () => {
    const store = await storeWith([
      ['apartment', apartment()],
      ['apartment', apartment({ id: 'apt-2' })],
      ['instalment', rata('r1')],
      ['instalment', rata('r2', { esercizio: '2027-28' })],
      ['instalment', rata('r3', { apartmentId: 'apt-2' })],
      ['condoDocument', doc('preventivo')],
      ['condoDocument', doc('consuntivo')],
    ]);
    const all = await loadCondo(store, { asOf: isoDate('2026-06-01') });
    expect(all.status === 'computed' && all.rates.map((r) => r.instalmentId)).toEqual([
      'r1',
      'r2',
      'r3',
    ]);
    const one = await loadCondo(store, {
      asOf: isoDate('2026-06-01'),
      apartmentId: 'apt',
      esercizio: '2026-27',
    });
    expect(one).toMatchObject({
      status: 'computed',
      // No statement covers the period: the instalment is assumed paid (R2, `planMatch`).
      rates: [{ instalmentId: 'r1', status: 'assunta' }],
      differences: [{ apartmentId: 'apt', difference: 6000 }],
      recoveries: [],
      warnings: [],
    });
  });

  it('warns when the recoveries are above an expense edited down after them (R198)', async () => {
    const recovery = {
      id: 'rec-1',
      v: 1,
      rev: 1,
      apartmentId: 'apt',
      instalmentId: 'r1',
      amount: 15001,
      shares: [{ tenantId: 't', amount: 15001 }],
      status: 'da-recuperare',
    };
    const store = await storeWith([
      ['apartment', apartment()],
      ['instalment', rata('r1')],
      ['tenantRecovery', recovery],
    ]);
    expect(await loadCondo(store, { asOf: isoDate('2026-06-01') })).toMatchObject({
      warnings: [{ code: 'recovery-above-expense', instalmentId: 'r1' }],
    });
    const fine = await storeWith([
      ['apartment', apartment()],
      ['instalment', rata('r1')],
      [
        'tenantRecovery',
        { ...recovery, amount: 15000, shares: [{ tenantId: 't', amount: 15000 }] },
      ],
    ]);
    expect(await loadCondo(fine, { asOf: isoDate('2026-06-01') })).toMatchObject({ warnings: [] });
  });

  it('refuses an inconsistent store', async () => {
    const store = await storeWith([['apartment', apartment()]]);
    const { commitChange } = await import('../src/index');
    await commitChange(
      store,
      {
        profileId: 'p',
        kind: 'test',
        summary: 'x',
        changes: [{ path: recordPath('instalment', 'r1'), after: rata('r1') }],
      },
      () => '2026-11-14T09:00:00.000Z',
      () => 'op-1',
    );
    const path = recordPath('instalment', 'r1');
    store.putRaw(path, (store.getRaw(path) ?? '').replace('15000', '1'));
    expect(await loadCondo(store, { asOf: isoDate('2026-06-01') })).toEqual({
      status: 'refused',
      reason: 'inconsistent-store',
    });
  });
});
