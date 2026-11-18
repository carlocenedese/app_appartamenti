import { describe, expect, it } from 'vitest';
import {
  BankTransactionSchema,
  PayerSchema,
  PaymentSchema,
  TenancySchema,
  TenantSchema,
  cancelAutomaticPayment,
  cents,
  checkConsistency,
  commitChange,
  confirmIncome,
  loadAll,
  readJournal,
  recordPath,
  repairDiverged,
  runReconcile,
  saveTenant,
  saveTenantCard,
  undoOperation,
  yearMonth,
} from '../src/index';
import type { ConfirmIncomeInput } from '../src/index';
import { clock, ids, snapshot, year, yearStore } from './helpers/income-year';
import { MemoryStore } from './helpers/memory-store';

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
const parentIban = (): string =>
  (year.records.transaction as { id: string; counterparty?: { iban?: string } }[]).find(
    (t) => t.id === 'tx-carla-2026-01',
  )?.counterparty?.iban ?? '';
/** Fails the first write of `failAt` (after the journal), as an interruption would. */
class FailingStore extends MemoryStore {
  constructor(private failAt: string | undefined) {
    super();
  }
  override async writeJsonAtomic(path: string, value: unknown): Promise<void> {
    if (path === this.failAt) {
      this.failAt = undefined;
      throw new Error('interrupted');
    }
    return super.writeJsonAtomic(path, value);
  }
}
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
    // E8: the same name and language again write nothing.
    expect(
      await saveTenant(
        store,
        { id: 't-new', name: 'Nome Cambiato', language: 'en' },
        'p1',
        clock,
        ids('c'),
      ),
    ).toBeUndefined();
  });

  it('brings a deleted tenant back with a new rev', async () => {
    const store = await yearStore();
    await saveTenant(store, { id: 't-new', name: 'Nome Inventato' }, 'p1', clock, ids('a'));
    const saved = (await loadAll(store, 'tenant', TenantSchema)).records.find(
      (x) => x.id === 't-new',
    );
    await commitChange(
      store,
      {
        profileId: 'p1',
        kind: 'test',
        summary: 'x',
        changes: [{ path: recordPath('tenant', 't-new'), before: saved, after: undefined }],
      },
      clock,
      ids('d'),
    );
    await saveTenant(store, { id: 't-new', name: 'Nome Inventato' }, 'p1', clock, ids('b'));
    const t = (await loadAll(store, 'tenant', TenantSchema)).records.find((x) => x.id === 't-new');
    expect(t).toEqual({ id: 't-new', v: 1, rev: 3, name: 'Nome Inventato' });
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
    // The dry run counts its own automatic payment as paid, as the written one is.
    expect(dry.status === 'reconciled' && first.status === 'reconciled' && dry.arrears).toEqual(
      first.status === 'reconciled' && first.arrears,
    );
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
    await saveTenant(
      store,
      { id: 't-anna', name: 'Anna Verdi', language: 'it' },
      'p1',
      clock,
      ids('a'),
    );
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

  it('E7: the next proposal of the same payer, now automatic, is stale: run riconcilia again', async () => {
    const store = await yearStore();
    await confirmIncome(store, bruno(), 'p1', clock, ids('op'));
    const next = bruno({ proposalId: 'p-chi-tx-bruno-2026-02', parts: [canone('2026-02', 43000)] });
    expect(await confirmIncome(store, next, 'p1', clock, ids('x'))).toEqual({
      status: 'refused',
      reason: 'stale-proposal',
    });
  });

  it('B17: a rent month outside the presence or already paid is confirmed with a warning', async () => {
    const store = await yearStore();
    const r = await confirmIncome(
      store,
      bruno({ parts: [canone('2025-06', 43000)] }),
      'p1',
      clock,
      ids('op'),
    );
    expect(r).toMatchObject({
      status: 'confirmed',
      warnings: [{ code: 'month-outside-presence', month: '2025-06' }],
    });
    // «Solo questa volta»: February stays a «chi»; confirmed for January, a month already paid.
    const once = await yearStore();
    await confirmIncome(once, bruno({ rememberPayer: false }), 'p1', clock, ids('a'));
    const twice = await confirmIncome(
      once,
      bruno({ proposalId: 'p-chi-tx-bruno-2026-02', parts: [canone('2026-01', 43000)] }),
      'p1',
      clock,
      ids('b'),
    );
    expect(twice).toMatchObject({
      status: 'confirmed',
      warnings: [{ code: 'month-already-paid', month: '2026-01' }],
    });
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
        'no-presence',
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

  it('refuses a tenant without a presence in the apartment, for a new payer and for a «cosa»', async () => {
    const store = await yearStore();
    expect(
      await confirmIncome(store, bruno({ tenantId: 't-carla' }), 'p1', clock, ids('x')),
    ).toEqual({ status: 'refused', reason: 'no-presence' });
    await runReconcile(store, 'p1', clock, ids('r'));
    // Anna's February is held by Bruno's open «chi» of January: a «cosa» for Anna only.
    const feb = { proposalId: 'p-cosa-tx-anna-2026-02', parts: [canone('2026-02', 45000)] };
    // Carla has no presence in Anna's apartment: never allowed outside the candidates.
    const carla = bruno({ ...feb, tenantId: 't-carla' });
    expect(await confirmIncome(store, carla, 'p1', clock, ids('x'))).toEqual({
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

  it('undoing a whole reconciliation brings its movements back to automatic, never undone (user1, 15 Nov 2026)', async () => {
    const store = await yearStore();
    const r = await runReconcile(store, 'p1', clock, ids('op'));
    if (r.status !== 'reconciled' || r.operationId === undefined) throw new Error('none');
    // A reconciliation of a single payment, undone whole: still back to normal.
    expect(r.written).toBe(1);
    await undoOperation(store, r.operationId, 'p1', clock, ids('u'));
    const again = await runReconcile(store, 'p1', clock, ids('d'), { dryRun: true });
    expect(again).toEqual({ ...r, operationId: undefined });
    expect(again).not.toHaveProperty('operationId');
  });

  it('confirming an invalid-iban «chi» never saves a payer (user1, 15 Nov 2026)', async () => {
    const store = await yearStore();
    const path = recordPath('transaction', 'tx-bruno-2026-01');
    const tx = BankTransactionSchema.parse(await store.readJson(path));
    // One digit changed at run time: never a whole invented IBAN in the file.
    const bad = brunoIban().replace(/\d$/, (d) => String((Number(d) + 1) % 10));
    await store.writeJsonAtomic(path, { ...tx, counterparty: { ...tx.counterparty, iban: bad } });
    const proposal = (await proposalsOf(store)).find((p) => p.id === 'p-chi-tx-bruno-2026-01');
    expect(proposal).toMatchObject({ reason: 'invalid-iban' });
    expect(proposal).not.toHaveProperty('key');
    expect(await confirmIncome(store, bruno(), 'p1', clock, ids('c'))).toEqual({
      status: 'confirmed',
      operationId: 'c-1',
      paymentIds: ['pay-tx-bruno-2026-01-1'],
    });
    expect((await payers(store)).some((p) => p.tenantId === 't-bruno')).toBe(false);
  });

  /** Confirms Anna's February «cosa» (held by Bruno's open «chi») and undoes that confirmation. */
  const undoneAnnaFeb = async () => {
    const store = await yearStore();
    const feb = bruno({
      proposalId: 'p-cosa-tx-anna-2026-02',
      tenantId: 't-anna',
      parts: [canone('2026-02', 45000)],
    });
    const c = await confirmIncome(store, feb, 'p1', clock, ids('op'));
    if (c.status !== 'confirmed') throw new Error('refused');
    await undoOperation(store, c.operationId, 'p1', clock, ids('u'));
    return store;
  };

  it('an undone confirmation is undone, and is confirmed again by hand as rent or as something else', async () => {
    const store = await undoneAnnaFeb();
    expect(
      (await proposalsOf(store)).find((p) => p.transactionId === 'tx-anna-2026-02'),
    ).toMatchObject({ id: 'p-cosa-tx-anna-2026-02', reason: 'undone', tenantIds: ['t-anna'] });
    const asOther = {
      proposalId: 'p-cosa-tx-anna-2026-02',
      tenantId: 't-anna',
      parts: [{ kind: 'altro' as const, forMonth: yearMonth('2026-02'), amount: cents(45000) }],
      rememberPayer: true,
    };
    const confirmed = await confirmIncome(store, asOther, 'p1', clock, ids('c'));
    expect(confirmed).toEqual({
      status: 'confirmed',
      operationId: 'c-1',
      paymentIds: ['pay-tx-anna-2026-02-1'],
    });
    const live = await payments(store);
    expect(live.map((p) => [p.id, p.kind, p.rev])).toEqual([['pay-tx-anna-2026-02-1', 'altro', 3]]);
    expect((await proposalsOf(store)).some((p) => p.transactionId === 'tx-anna-2026-02')).toBe(
      false,
    );
  });

  it('reassigns an undone confirmation to another tenant of the apartment: the key then has two payers', async () => {
    const store = await undoneAnnaFeb();
    const toBruno = bruno({
      proposalId: 'p-cosa-tx-anna-2026-02',
      parts: [canone('2026-02', 45000)],
    });
    expect(await confirmIncome(store, toBruno, 'p1', clock, ids('c'))).toEqual({
      status: 'confirmed',
      operationId: 'c-1',
      paymentIds: ['pay-tx-anna-2026-02-1'],
      payerId: 'payer-tx-anna-2026-02',
    });
    expect((await payers(store)).find((p) => p.id === 'payer-tx-anna-2026-02')).toMatchObject({
      tenantId: 't-bruno',
      validFrom: '2026-01-01',
    });
    // Anna's key now belongs to two tenants: never automatic again (decision 5).
    expect(
      (await proposalsOf(store)).find((p) => p.transactionId === 'tx-anna-2026-03'),
    ).toMatchObject({ step: 'chi', reason: 'multi-tenant', tenantIds: ['t-anna', 't-bruno'] });
  });

  it('refuses a deleted tenant, even with a live presence, and a tenant whose only presence is deleted', async () => {
    const store = await yearStore();
    const tenants = (await loadAll(store, 'tenant', TenantSchema)).records;
    const bruno0 = tenants.find((t) => t.id === 't-bruno');
    await store.writeJsonAtomic(recordPath('tenant', 't-bruno'), { ...bruno0, deleted: true });
    // Carla gets a presence in Anna's apartment, deleted.
    await store.writeJsonAtomic(
      recordPath('tenancy', 'ten-carla-a1'),
      TenancySchema.parse({
        id: 'ten-carla-a1',
        v: 1,
        rev: 2,
        deleted: true,
        apartmentId: 'a1',
        tenantId: 't-carla',
        from: '2026-01',
        monthlyRent: 40000,
        monthlyForfait: 5000,
      }),
    );
    const before = await snapshot(store);
    const anna = { proposalId: 'p-cosa-tx-anna-2026-02', parts: [canone('2026-02', 45000)] };
    for (const tenantId of ['t-bruno', 't-carla']) {
      expect(
        await confirmIncome(store, bruno({ ...anna, tenantId }), 'p1', clock, ids('x')),
      ).toEqual({
        status: 'refused',
        reason: 'tenant-not-allowed',
      });
    }
    // A deleted tenant is refused among the candidates too.
    expect(
      await confirmIncome(
        store,
        bruno({ proposalId: 'p-chi-tx-bruno-2026-01' }),
        'p1',
        clock,
        ids('x'),
      ),
    ).toEqual({
      status: 'refused',
      reason: 'tenant-not-allowed',
    });
    expect(await snapshot(store)).toEqual(before);
  });

  it('a payer of several tenants is confirmed only for one present in the apartment', async () => {
    const store = await yearStore();
    // The parent's key also names Anna, who lives in the other apartment.
    const key = `iban:${parentIban()}`;
    for (const [id, tenantId] of [
      ['pr-p-anna', 't-anna'],
      ['pr-p-carla', 't-carla'],
    ] as const) {
      await store.writeJsonAtomic(
        recordPath('payer', id),
        PayerSchema.parse({
          id,
          v: 1,
          rev: 1,
          key,
          tenantId,
          validFrom: '2026-01-01',
          source: 'confirmed',
        }),
      );
    }
    const before = await snapshot(store);
    const input = {
      proposalId: 'p-chi-tx-carla-2026-01',
      parts: [canone('2026-01', 41000)],
      rememberPayer: true,
    };
    expect(
      await confirmIncome(store, { ...input, tenantId: 't-anna' }, 'p1', clock, ids('x')),
    ).toEqual({
      status: 'refused',
      reason: 'no-presence',
    });
    expect(
      await confirmIncome(store, { ...input, tenantId: 't-bruno' }, 'p1', clock, ids('x')),
    ).toEqual({
      status: 'refused',
      reason: 'tenant-not-allowed',
    });
    expect(await snapshot(store)).toEqual(before);
    // Dario is present in a2 though not a candidate: allowed, and his payer is written.
    expect(
      await confirmIncome(store, { ...input, tenantId: 't-dario' }, 'p1', clock, ids('c')),
    ).toMatchObject({ status: 'confirmed', payerId: 'payer-tx-carla-2026-01' });
  });

  it('an interrupted confirmation leaves the store diverged, and the next one is refused', async () => {
    const store = await yearStore(
      new FailingStore(recordPath('payment', 'pay-tx-bruno-2026-01-2')),
    );
    const parts = [canone('2026-01', 40000), canone('2026-01', 3000)];
    await expect(confirmIncome(store, bruno({ parts }), 'p1', clock, ids('op'))).rejects.toThrow(
      'interrupted',
    );
    // The second part and the payer are missing: the journal is ahead of them.
    const missing = [
      recordPath('payer', 'payer-tx-bruno-2026-01'),
      recordPath('payment', 'pay-tx-bruno-2026-01-2'),
    ];
    expect((await checkConsistency(store)).map((p) => p.path)).toEqual(missing);
    const before = await snapshot(store);
    expect(await confirmIncome(store, bruno({ parts }), 'p1', clock, ids('op2'))).toEqual({
      status: 'refused',
      reason: 'inconsistent-store',
    });
    expect(await runReconcile(store, 'p1', clock, ids('r'))).toEqual({
      status: 'refused',
      reason: 'inconsistent-store',
    });
    expect(await snapshot(store)).toEqual(before);
    for (const path of missing) await repairDiverged(store, path);
    expect(await checkConsistency(store)).toEqual([]);
  });

  it('never puts names, IBANs, descriptions or amounts in a summary', async () => {
    const store = await yearStore();
    const newId = ids('op');
    await saveTenant(
      store,
      { id: 't-anna', name: 'Anna Verdi', language: 'it' },
      'p1',
      clock,
      newId,
    );
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

describe('cancelAutomaticPayment (user1, 15 Nov 2026)', () => {
  it('cancels one automatic payment in an operation of its own: undone, and an undo brings it back', async () => {
    const store = await yearStore();
    await runReconcile(store, 'p1', clock, ids('r'));
    const c = await cancelAutomaticPayment(store, 'pay-tx-anna-2026-01', 'p1', clock, ids('c'));
    expect(c).toEqual({ status: 'cancelled', operationId: 'c-1' });
    const { operations } = await readJournal(store);
    expect(operations.find((o) => o.id === 'c-1')).toMatchObject({
      kind: 'income.cancel-payment',
      apartmentId: 'a1',
      summary: 'Annullato un pagamento automatico.',
    });
    expect((await payments(store)).some((p) => p.id === 'pay-tx-anna-2026-01')).toBe(false);
    expect(
      (await proposalsOf(store)).find((p) => p.transactionId === 'tx-anna-2026-01'),
    ).toMatchObject({ id: 'p-cosa-tx-anna-2026-01', reason: 'undone', tenantIds: ['t-anna'] });
    expect(await runReconcile(store, 'p1', clock, ids('r2'))).toMatchObject({ written: 0 });

    // The whole reconciliation cannot be undone over the cancellation (R121).
    await expect(undoOperation(store, 'r-1', 'p1', clock, ids('z'))).rejects.toThrow(
      'depend on it',
    );
    await undoOperation(store, 'c-1', 'p1', clock, ids('u'));
    expect((await payments(store)).map((p) => p.id)).toEqual(['pay-tx-anna-2026-01']);
    expect((await proposalsOf(store)).some((p) => p.transactionId === 'tx-anna-2026-01')).toBe(
      false,
    );
  });

  it('refuses without writing: unknown or already cancelled, not automatic, inconsistent store', async () => {
    const store = await yearStore();
    await runReconcile(store, 'p1', clock, ids('r'));
    await confirmIncome(store, bruno(), 'p1', clock, ids('k'));
    await cancelAutomaticPayment(store, 'pay-tx-anna-2026-01', 'p1', clock, ids('c'));
    const before = await snapshot(store);
    for (const [id, reason] of [
      ['nessuno', 'unknown-payment'],
      ['pay-tx-anna-2026-01', 'unknown-payment'],
      ['pay-tx-bruno-2026-01-1', 'not-automatic'],
    ] as const) {
      expect(await cancelAutomaticPayment(store, id, 'p1', clock, ids('x'))).toEqual({
        status: 'refused',
        reason,
      });
    }
    expect(await snapshot(store)).toEqual(before);
    store.putRaw(recordPath('payment', 'pay-tx-bruno-2026-01-1'), '{"id":"x","v":1,"rev":1}\n');
    expect(
      await cancelAutomaticPayment(store, 'pay-tx-bruno-2026-01-1', 'p1', clock, ids('y')),
    ).toEqual({ status: 'refused', reason: 'inconsistent-store' });
  });
});

describe('saveTenantCard (plan 17, R311)', () => {
  it('saves the card, then unchanged; refuses an unknown tenant, an empty or bad card', async () => {
    const store = new MemoryStore();
    await saveTenant(store, { id: 'ten-1', name: 'Anna Prova' }, 'p1', clock, ids('t'));
    const save = (tenantId: string, card: Record<string, unknown>, prefix: string) =>
      saveTenantCard(store, { tenantId, card }, 'p1', clock, ids(prefix));
    expect(await save('ten-1', { taxCode: 'CODICE-PROVA' }, 'a')).toEqual({
      status: 'saved',
      operationId: 'a-1',
    });
    expect(await save('ten-1', { taxCode: 'CODICE-PROVA' }, 'b')).toEqual({ status: 'unchanged' });
    const before = await snapshot(store);
    expect(await save('ten-9', { taxCode: 'X' }, 'c')).toEqual({
      status: 'refused',
      reason: 'unknown-tenant',
    });
    expect(await save('ten-1', {}, 'd')).toEqual({ status: 'refused', reason: 'invalid-card' });
    expect(await save('ten-1', { birthDate: '2005-13-01' }, 'e')).toEqual({
      status: 'refused',
      reason: 'invalid-card',
    });
    expect(await snapshot(store)).toEqual(before);
    // The tenant record never holds the card: writing the name again leaves it alone.
    await saveTenant(store, { id: 'ten-1', name: 'Anna Prova Due' }, 'p1', clock, ids('f'));
    expect(await save('ten-1', { taxCode: 'CODICE-PROVA' }, 'g')).toEqual({ status: 'unchanged' });
    const { operations } = await readJournal(store);
    expect(operations.find((o) => o.kind === 'tenant.card')?.summary).toBe(
      'Scheda riservata dell’inquilino salvata.',
    );
  });
});
