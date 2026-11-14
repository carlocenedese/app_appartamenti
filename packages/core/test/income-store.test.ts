import { describe, expect, it } from 'vitest';
import {
  BankTransactionSchema,
  PayerSchema,
  PaymentSchema,
  TenantSchema,
  cents,
  commitChange,
  confirmIncome,
  loadAll,
  readJournal,
  recordPath,
  runReconcile,
  saveTenant,
  undoOperation,
  yearMonth,
} from '../src/index';
import type { ConfirmIncomeInput } from '../src/index';
import { clock, ids, snapshot, year, yearStore } from './helpers/income-year';
import type { MemoryStore } from './helpers/memory-store';

const canone = (forMonth: string, amount: number) => ({
  kind: 'canone' as const,
  forMonth: yearMonth(forMonth),
  amount: cents(amount),
});
const bruno = (over: Partial<ConfirmIncomeInput> = {}): ConfirmIncomeInput => ({
  proposalId: 'p-chi-tx-bruno-2026-01',
  tenantId: 't-bruno',
  parts: [canone('2026-01', 43000)],
  rememberPayer: true,
  ...over,
});
const brunoIban = (): string =>
  (year.records.transaction as { id: string; counterparty?: { iban?: string } }[]).find(
    (t) => t.id === 'tx-bruno-2026-01',
  )?.counterparty?.iban ?? '';
const payers = async (store: MemoryStore) => (await loadAll(store, 'payer', PayerSchema)).records;
const payments = async (store: MemoryStore) =>
  (await loadAll(store, 'payment', PaymentSchema)).records;
const proposalsOf = async (store: MemoryStore) => {
  const r = await runReconcile(store, 'p1', clock, ids('dry'), { dryRun: true });
  if (r.status !== 'reconciled') throw new Error('refused');
  return r.proposals;
};

describe('saveTenant', () => {
  it('creates a tenant, then writes a new rev of it', async () => {
    const store = await yearStore();
    const op = await saveTenant(
      store,
      { id: 't-new', name: 'Nome Inventato' },
      'p1',
      clock,
      ids('a'),
    );
    expect(op).toMatchObject({ kind: 'tenant.save', summary: 'Inquilino salvato' });
    await saveTenant(
      store,
      { id: 't-new', name: 'Nome Cambiato', language: 'en' },
      'p1',
      clock,
      ids('b'),
    );
    const t = (await loadAll(store, 'tenant', TenantSchema)).records.find((x) => x.id === 't-new');
    expect(t).toEqual({ id: 't-new', v: 1, rev: 2, name: 'Nome Cambiato', language: 'en' });
  });
});

describe('runReconcile', () => {
  it('writes once: the second run writes nothing, byte for byte; a dry run never writes', async () => {
    const store = await yearStore();
    const before = await snapshot(store);
    const dry = await runReconcile(store, 'p1', clock, ids('d'), { dryRun: true });
    expect(dry).toMatchObject({ status: 'reconciled', written: 1 });
    expect(dry).not.toHaveProperty('operationId');
    expect(await snapshot(store)).toEqual(before);

    const first = await runReconcile(store, 'p1', clock, ids('op'));
    expect(first).toMatchObject({ status: 'reconciled', written: 1, operationId: 'op-1' });
    const { operations } = await readJournal(store);
    expect(operations.map((o) => [o.kind, o.summary])).toEqual([
      ['income.reconcile', 'Riconciliati gli incassi: 1 automatico, 47 da rivedere.'],
    ]);
    const after = await snapshot(store);
    const again = await runReconcile(store, 'p1', clock, ids('op2'));
    expect(again).toEqual({ ...first, written: 0, operationId: undefined });
    expect(again).not.toHaveProperty('operationId');
    expect(await snapshot(store)).toEqual(after);
  });

  it('refuses on a record changed by hand over the journal, also for a dry run', async () => {
    const store = await yearStore();
    await saveTenant(store, { id: 't-anna', name: 'Anna Verdi' }, 'p1', clock, ids('a'));
    store.putRaw(recordPath('tenant', 't-anna'), '{"id":"t-anna","v":1,"rev":1,"name":"Altro"}\n');
    const before = await snapshot(store);
    const refused = { status: 'refused', reason: 'inconsistent-store' };
    expect(await runReconcile(store, 'p1', clock, ids('op'))).toEqual(refused);
    expect(await runReconcile(store, 'p1', clock, ids('op'), { dryRun: true })).toEqual(refused);
    expect(await confirmIncome(store, bruno(), 'p1', clock, ids('op'))).toEqual(refused);
    expect(await snapshot(store)).toEqual(before);
  });
});

describe('confirmIncome', () => {
  it('confirms a «chi»: the payer from the first day of the first presence, and the payments', async () => {
    const store = await yearStore();
    const r = await confirmIncome(store, bruno(), 'p1', clock, ids('op'));
    expect(r).toEqual({
      status: 'confirmed',
      operationId: 'op-1',
      paymentIds: ['pay-tx-bruno-2026-01-1'],
      payerId: 'payer-tx-bruno-2026-01',
    });
    expect((await payers(store)).find((p) => p.tenantId === 't-bruno')).toMatchObject({
      key: `iban:${brunoIban()}`,
      validFrom: '2026-01-01',
      source: 'confirmed',
    });
    expect((await payments(store)).find((p) => p.tenantId === 't-bruno')).toMatchObject({
      date: '2026-01-05',
      amount: 43000,
      kind: 'canone',
      forMonth: '2026-01',
      confirmed: true,
      source: 'csv',
      transactionId: 'tx-bruno-2026-01',
    });
    const { operations } = await readJournal(store);
    expect(operations.map((o) => [o.kind, o.apartmentId, o.summary])).toEqual([
      ['income.confirm', 'a1', 'Confermato un incasso: 1 pagamento.'],
    ]);
    // The next movement of the same payer is no longer a «chi».
    expect((await proposalsOf(store)).some((p) => p.transactionId === 'tx-bruno-2026-02')).toBe(
      false,
    );
  });

  it('splits a movement into parts whose sum is its amount', async () => {
    const store = await yearStore();
    const parts = [
      canone('2026-01', 40000),
      { ...canone('2026-01', 3000), kind: 'altro' as const },
    ];
    const r = await confirmIncome(store, bruno({ parts }), 'p1', clock, ids('op'));
    expect(r).toMatchObject({ paymentIds: ['pay-tx-bruno-2026-01-1', 'pay-tx-bruno-2026-01-2'] });
    const { operations } = await readJournal(store);
    expect(operations[0]?.summary).toBe('Confermato un incasso: 2 pagamenti.');
  });

  it('«solo questa volta» writes the payments and no payer: the next movement is «chi» again', async () => {
    const store = await yearStore();
    const r = await confirmIncome(store, bruno({ rememberPayer: false }), 'p1', clock, ids('op'));
    expect(r).toEqual({
      status: 'confirmed',
      operationId: 'op-1',
      paymentIds: ['pay-tx-bruno-2026-01-1'],
    });
    expect((await payers(store)).some((p) => p.tenantId === 't-bruno')).toBe(false);
    expect(
      (await proposalsOf(store)).find((p) => p.transactionId === 'tx-bruno-2026-02'),
    ).toMatchObject({ id: 'p-chi-tx-bruno-2026-02', step: 'chi', reason: 'new-payer' });
  });

  it('refuses without writing: wrong sum, no parts, stale proposal, tenant not allowed, no presence', async () => {
    const store = await yearStore();
    await runReconcile(store, 'p1', clock, ids('r'));
    await confirmIncome(store, bruno(), 'p1', clock, ids('c'));
    // A movement deleted (as `undoImport` does) and one that got a payment in the meantime.
    const tx = (await loadAll(store, 'transaction', BankTransactionSchema)).records;
    const gone = tx.find((t) => t.id === 'tx-carla-2026-02');
    await commitChange(
      store,
      {
        profileId: 'p1',
        kind: 'test',
        summary: 'x',
        changes: [
          { path: recordPath('transaction', 'tx-carla-2026-02'), before: gone, after: undefined },
          {
            path: recordPath('payment', 'manual-1'),
            after: PaymentSchema.parse({
              id: 'manual-1',
              v: 1,
              rev: 1,
              apartmentId: 'a2',
              tenantId: 't-dario',
              date: '2026-02-02',
              amount: 39000,
              confirmed: true,
              kind: 'canone',
              source: 'manual',
              transactionId: 'tx-dario-2026-02',
            }),
          },
        ],
      },
      clock,
      ids('t'),
    );
    const before = await snapshot(store);
    const cases: [ConfirmIncomeInput, string][] = [
      [
        bruno({
          proposalId: 'p-chi-tx-carla-2026-03',
          tenantId: 't-carla',
          parts: [canone('2026-03', 40999)],
        }),
        'sum-mismatch',
      ],
      [
        bruno({ proposalId: 'p-chi-tx-carla-2026-03', tenantId: 't-carla', parts: [] }),
        'empty-parts',
      ],
      [
        bruno({
          proposalId: 'p-chi-tx-carla-2026-03',
          tenantId: 't-carla',
          parts: [canone('2026-03', 41000), canone('2026-03', 0)],
        }),
        'empty-parts',
      ],
      [bruno(), 'unknown-proposal'], // already confirmed
      [
        bruno({
          proposalId: 'p-chi-tx-carla-2026-02',
          tenantId: 't-carla',
          parts: [canone('2026-02', 41000)],
        }),
        'unknown-proposal',
      ],
      [
        bruno({
          proposalId: 'p-chi-tx-dario-2026-02',
          tenantId: 't-dario',
          parts: [canone('2026-02', 39000)],
        }),
        'unknown-proposal',
      ],
      [bruno({ proposalId: 'p-chi-nope' }), 'unknown-proposal'],
      [
        bruno({
          proposalId: 'p-chi-tx-carla-2026-03',
          tenantId: 't-anna',
          parts: [canone('2026-03', 41000)],
        }),
        'tenant-not-allowed',
      ],
    ];
    for (const [input, reason] of cases) {
      expect(await confirmIncome(store, input, 'p1', clock, ids('x'))).toEqual({
        status: 'refused',
        reason,
      });
    }
    expect(await snapshot(store)).toEqual(before);
  });

  it('refuses a tenant outside the apartment for a new payer, and outside a «cosa»', async () => {
    const store = await yearStore();
    expect(
      await confirmIncome(store, bruno({ tenantId: 't-carla' }), 'p1', clock, ids('x')),
    ).toEqual({ status: 'refused', reason: 'no-presence' });
    await runReconcile(store, 'p1', clock, ids('r'));
    // Anna's February is held by Bruno's open «chi» of January: a «cosa» for Anna only.
    const feb = { proposalId: 'p-cosa-tx-anna-2026-02', parts: [canone('2026-02', 45000)] };
    expect(await confirmIncome(store, bruno({ ...feb }), 'p1', clock, ids('x'))).toEqual({
      status: 'refused',
      reason: 'tenant-not-allowed',
    });
    expect(
      await confirmIncome(store, bruno({ ...feb, tenantId: 't-anna' }), 'p1', clock, ids('y')),
    ).toMatchObject({ status: 'confirmed', paymentIds: ['pay-tx-anna-2026-02-1'] });
  });

  it('undoing a confirmation takes the payer away too, and the «chi» comes back', async () => {
    const store = await yearStore();
    const r = await confirmIncome(store, bruno(), 'p1', clock, ids('op'));
    if (r.status !== 'confirmed') throw new Error('refused');
    await undoOperation(store, r.operationId, 'p1', clock, ids('u'));
    expect((await payers(store)).some((p) => p.tenantId === 't-bruno')).toBe(false);
    expect((await payments(store)).some((p) => p.tenantId === 't-bruno')).toBe(false);
    expect(
      (await proposalsOf(store)).find((p) => p.transactionId === 'tx-bruno-2026-01'),
    ).toMatchObject({ id: 'p-chi-tx-bruno-2026-01', step: 'chi' });
    // Confirmed again: written over the deleted records, with a new rev.
    expect((await confirmIncome(store, bruno(), 'p1', clock, ids('again'))).status).toBe(
      'confirmed',
    );
    expect((await payers(store)).find((p) => p.id === 'payer-tx-bruno-2026-01')?.rev).toBe(3);
  });

  it('an undone automatic payment is confirmed by hand with a new id, as rent or as something else', async () => {
    const store = await yearStore();
    const r = await runReconcile(store, 'p1', clock, ids('op'));
    if (r.status !== 'reconciled' || r.operationId === undefined) throw new Error('none');
    await undoOperation(store, r.operationId, 'p1', clock, ids('u'));
    expect(
      (await proposalsOf(store)).find((p) => p.transactionId === 'tx-anna-2026-01'),
    ).toMatchObject({ id: 'p-cosa-tx-anna-2026-01', reason: 'undone', tenantIds: ['t-anna'] });
    const asOther = {
      proposalId: 'p-cosa-tx-anna-2026-01',
      tenantId: 't-anna',
      parts: [{ kind: 'altro' as const, forMonth: yearMonth('2026-01'), amount: cents(45000) }],
      rememberPayer: true,
    };
    const confirmed = await confirmIncome(store, asOther, 'p1', clock, ids('c'));
    expect(confirmed).toEqual({
      status: 'confirmed',
      operationId: 'c-1',
      paymentIds: ['pay-tx-anna-2026-01-1'],
    });
    const live = await payments(store);
    expect(live.map((p) => [p.id, p.kind])).toEqual([['pay-tx-anna-2026-01-1', 'altro']]);
    expect((await proposalsOf(store)).some((p) => p.transactionId === 'tx-anna-2026-01')).toBe(
      false,
    );
  });

  it('never puts names, IBANs, descriptions or amounts in a summary', async () => {
    const store = await yearStore();
    const newId = ids('op');
    await saveTenant(store, { id: 't-anna', name: 'Anna Verdi' }, 'p1', clock, newId);
    await runReconcile(store, 'p1', clock, newId);
    for (const c of year.expected.confirmations) await confirmIncome(store, c, 'p1', clock, newId);
    await runReconcile(store, 'p1', clock, newId);
    const { operations } = await readJournal(store);
    const text = operations.map((o) => o.summary).join('\n');
    expect(operations).toHaveLength(6);
    for (const bad of [
      'Verdi',
      'Neri',
      'Bianchi',
      'IT',
      'Affitto',
      'Canone',
      '430',
      '450',
      '410',
      '390',
    ]) {
      expect(text).not.toContain(bad);
    }
  });
});
