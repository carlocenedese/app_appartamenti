import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BillMatchSchema,
  MovementClassSchema,
  PaymentSchema,
  TransferSchema,
  cents,
  commitChange,
  confirmIncome,
  confirmMatch,
  confirmTransfer,
  excludeMovement,
  loadAll,
  movementUses,
  readJournal,
  recordPath,
  recordSchemas,
  runReconcile,
  runReconciliation,
  saveTenant,
  yearMonth,
} from '../src/index';
import type { RecordKind } from '../src/index';
import { clock, ids, snapshot } from './helpers/income-year';
import { MemoryStore } from './helpers/memory-store';

type Rec = { id: string } & Record<string, unknown>;
const fixture = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../../fixtures/reconcile/tre-conti.json', import.meta.url)),
    'utf8',
  ),
) as { records: Partial<Record<RecordKind, Rec[]>> };

/** The records of `tre-conti`, written kind by kind; `shuffled` reverses both orders. */
async function treConti(shuffled = false): Promise<MemoryStore> {
  const store = new MemoryStore();
  const kinds = Object.entries(fixture.records) as [RecordKind, Rec[]][];
  for (const [kind, list] of shuffled ? [...kinds].reverse() : kinds) {
    for (const record of shuffled ? [...list].reverse() : list) {
      await store.writeJsonAtomic(recordPath(kind, record.id), recordSchemas[kind].parse(record));
    }
  }
  return store;
}

const reconcile = (store: MemoryStore, prefix = 'r', dryRun = false) =>
  runReconciliation(store, 'p1', clock, ids(prefix), { dryRun });

async function usesOf(store: MemoryStore) {
  return movementUses({
    classes: (await loadAll(store, 'movementClass', MovementClassSchema)).records,
    payments: (await loadAll(store, 'payment', PaymentSchema)).records,
    matches: (await loadAll(store, 'match', BillMatchSchema)).records,
    transfers: (await loadAll(store, 'transfer', TransferSchema)).records,
  });
}

describe('movementUses (plan 3c, task 4)', () => {
  const base = { v: 1 as const, rev: 1 };
  it('gives each live record its use; assumed, unconfirmed and deleted records give none', () => {
    const match = (id: string, transactionId: string, extra = {}) =>
      BillMatchSchema.parse({
        ...base,
        id,
        itemType: 'bill',
        itemId: 'b',
        transactionId,
        transactionDate: '2027-01-01',
        amount: 100,
        part: 'amount',
        confirmed: true,
        by: 'auto',
        ...extra,
      });
    const pay = (id: string, transactionId?: string) =>
      PaymentSchema.parse({
        ...base,
        id,
        apartmentId: 'a',
        tenantId: 't',
        date: '2027-01-01',
        amount: 100,
        confirmed: true,
        kind: 'canone',
        source: 'csv',
        ...(transactionId === undefined ? {} : { transactionId }),
      });
    const uses = movementUses({
      classes: [
        MovementClassSchema.parse({
          ...base,
          id: 'mc-e',
          transactionId: 'e',
          kind: 'escluso',
          excludeReason: 'doppione',
        }),
        MovementClassSchema.parse({
          ...base,
          id: 'mc-c',
          transactionId: 'c',
          kind: 'utenze',
          apartmentId: 'a',
        }),
        MovementClassSchema.parse({
          ...base,
          id: 'mc-gone',
          transactionId: 'gone',
          kind: 'utenze',
          apartmentId: 'a',
          deleted: true,
        }),
      ],
      payments: [pay('pay-p-1', 'p'), pay('pay-p-2', 'p'), pay('pay-none')],
      matches: [
        match('m1', 'm'),
        match('m2', 'm', { part: 'commission' }),
        match('m3', 'x', { confirmed: false }),
        match('m4', 'assumed-b', { by: 'assumed' }),
        match('m5', 'y', { deleted: true }),
      ],
      transfers: [
        TransferSchema.parse({
          ...base,
          id: 'tr-g',
          fromAccountId: 'a1',
          toAccountId: 'a2',
          amount: 100,
          date: '2027-01-01',
          outTransactionId: 'g-out',
          inTransactionId: 'g-in',
          purpose: 'saldo',
          source: 'confirmed',
        }),
        TransferSchema.parse({
          ...base,
          id: 'tr-gone',
          fromAccountId: 'a1',
          toAccountId: 'a2',
          amount: 100,
          date: '2027-01-01',
          outTransactionId: 'z',
          purpose: 'saldo',
          source: 'confirmed',
          deleted: true,
        }),
      ],
    });
    expect(Object.fromEntries(uses)).toEqual({
      e: ['escluso'],
      c: ['classificato'],
      p: ['pagamento'],
      m: ['abbinato'],
      'g-out': ['giroconto'],
      'g-in': ['giroconto'],
    });
  });
});

describe('runReconciliation on tre-conti (plan 3c, task 4)', () => {
  it('writes match.reconcile and then income.reconcile; the credit note is no payment', async () => {
    const store = await treConti();
    const result = await reconcile(store);
    if (result.status !== 'reconciled') throw new Error('refused');
    const { operations } = await readJournal(store);
    expect(operations.map((o) => o.kind)).toEqual(['match.reconcile', 'income.reconcile']);
    // The transfer between Lovarini and Berchet: a first pair, so a proposal with its two legs.
    expect(result.transfers).toEqual({
      status: 'reconciled',
      written: 0,
      completed: 0,
      proposals: [
        {
          id: 'p-giro-tx-l-giro',
          transactionId: 'tx-l-giro',
          fromAccountId: 'acc-lovarini',
          toAccountId: 'acc-berchet',
          legIds: ['tx-b-giro'],
          reason: 'new-pair',
        },
      ],
    });
    expect(result.match).toMatchObject({ status: 'matched', written: 3, yielded: 0 });
    expect(result.match.status === 'matched' && result.match.assumed).toEqual([
      { itemType: 'bill', itemId: 'bill-hera-feb' },
    ]);
    expect(result.income).toMatchObject({ status: 'reconciled', written: 2 });

    const matches = (await loadAll(store, 'match', BillMatchSchema)).records;
    expect(matches.map((m) => m.id).sort()).toEqual([
      'm-bill-bill-hera-gen-amount-tx-b-hera-gen',
      'm-bill-bill-hera-nc-amount-tx-b-nc',
      'm-instalment-inst-l-cond-amount-tx-l-cond',
    ]);
    const payments = (await loadAll(store, 'payment', PaymentSchema)).records;
    expect(payments.map((p) => p.transactionId).sort()).toEqual([
      'tx-b-affitto-gen',
      'tx-b-affitto-mar',
    ]);
    // The credit is matched to the credit note: neither a payment nor an income proposal.
    const income = result.income.status === 'reconciled' ? result.income : undefined;
    expect(income?.proposals.map((p) => p.transactionId)).not.toContain('tx-b-nc');
    expect(income?.proposals.map((p) => p.transactionId)).toContain('tx-l-affitto-gen');

    const uses = await usesOf(store);
    for (const list of uses.values()) expect(list).toHaveLength(1);
    expect(Object.fromEntries(uses)).toEqual({
      'tx-b-affitto-gen': ['pagamento'],
      'tx-b-affitto-mar': ['pagamento'],
      'tx-b-hera-gen': ['abbinato'],
      'tx-b-nc': ['abbinato'],
      'tx-l-cond': ['abbinato'],
      'tx-l-cond-doppio': ['escluso'],
      'tx-p-fornitore-mar': ['classificato'],
    });
  });

  it('gives the same writes and proposals in any order; the second run writes nothing', async () => {
    const plain = await treConti();
    const shuffled = await treConti(true);
    const a = await reconcile(plain);
    const b = await reconcile(shuffled);
    expect(b).toEqual(a);
    expect(await snapshot(shuffled)).toEqual(await snapshot(plain));

    const once = await snapshot(plain);
    const again = await reconcile(plain, 's');
    expect(again).toMatchObject({
      status: 'reconciled',
      match: { written: 0 },
      income: { written: 0 },
    });
    expect(again.status === 'reconciled' && again.match).not.toHaveProperty('operationId');
    expect(again.status === 'reconciled' && again.income).not.toHaveProperty('operationId');
    expect(await snapshot(plain)).toEqual(once);
  });

  it('a dry run of the transfers skips the movements the income would take (fix round 1)', async () => {
    const store = await treConti();
    // −500,00 € from Lovarini to Berchet two days before the automatic March rent of Berchet,
    // with the same amount: in a real run the rent is a payment first, so it is no leg.
    await store.writeJsonAtomic(
      recordPath('transaction', 'tx-l-giro-mar'),
      recordSchemas.transaction.parse({
        id: 'tx-l-giro-mar',
        v: 1,
        rev: 1,
        apartmentId: 'lovarini',
        accountId: 'acc-lovarini',
        date: '2027-03-03',
        amount: -50000,
        description: 'GIROCONTO',
        statementHash: 's-l',
        counterparty: { name: 'Conto Berchet', iban: 'IT85X0542811101000000000301' },
      }),
    );
    const dry = await reconcile(store, 'd', true);
    const real = await reconcile(store);
    if (dry.status !== 'reconciled' || real.status !== 'reconciled') throw new Error('refused');
    expect(real.transfers.proposals).toContainEqual(
      expect.objectContaining({ id: 'p-giro-tx-l-giro-mar', legIds: [] }),
    );
    expect(dry.transfers).toEqual(real.transfers);
  });

  it('a dry run writes nothing and says what a real run writes, the credit note included', async () => {
    const store = await treConti();
    const empty = await snapshot(store);
    const dry = await reconcile(store, 'd', true);
    expect(await snapshot(store)).toEqual(empty);
    const real = await reconcile(store);
    if (dry.status !== 'reconciled' || real.status !== 'reconciled') throw new Error('refused');
    expect({ ...dry.match, operationId: real.match.operationId }).toEqual(real.match);
    expect({ ...dry.income, operationId: real.income.operationId }).toEqual(real.income);
    expect(dry.transfers).toEqual(real.transfers);
  });

  it('refuses a diverged store and writes nothing: no phase runs', async () => {
    const store = await treConti();
    await saveTenant(store, { id: 't-mario', name: 'Mario Inventato' }, 'p1', clock, ids('t'));
    store.putRaw(
      recordPath('tenant', 't-mario'),
      '{"id":"t-mario","v":1,"rev":1,"name":"Altro"}\n',
    );
    const diverged = await snapshot(store);
    expect(await reconcile(store)).toEqual({ status: 'refused', reason: 'inconsistent-store' });
    expect(await reconcile(store, 'd', true)).toEqual({
      status: 'refused',
      reason: 'inconsistent-store',
    });
    expect(await snapshot(store)).toEqual(diverged);
  });

  it('a movement matched by hand in an earlier run is never a payment or a proposal later', async () => {
    const store = await treConti();
    // The credit confirmed by hand on the credit note before any run: one use, abbinato.
    const confirmed = await confirmMatch(
      store,
      {
        parts: [
          {
            itemType: 'bill',
            itemId: 'bill-hera-nc',
            transactionId: 'tx-b-nc',
            amount: cents(-1500),
            part: 'amount',
          },
        ],
      },
      'p1',
      clock,
      ids('c'),
    );
    expect(confirmed.status).toBe('confirmed');
    const result = await reconcile(store);
    if (result.status !== 'reconciled' || result.income.status !== 'reconciled') {
      throw new Error('refused');
    }
    expect(result.income.proposals.map((p) => p.transactionId)).not.toContain('tx-b-nc');
    for (const list of (await usesOf(store)).values()) expect(list).toHaveLength(1);
  });

  it('a confirmed transfer: both legs are giroconto, one use per movement, run again', async () => {
    const store = await treConti();
    expect(
      await confirmTransfer(
        store,
        { proposalId: 'p-giro-tx-l-giro', purpose: 'saldo', rememberPair: true },
        'p1',
        clock,
        ids('g'),
      ),
    ).toMatchObject({ status: 'confirmed', transferId: 'tr-tx-l-giro' });
    const result = await reconcile(store);
    expect(result).toMatchObject({ transfers: { written: 0, proposals: [] } });
    const uses = await usesOf(store);
    for (const list of uses.values()) expect(list).toHaveLength(1);
    expect(uses.get('tx-l-giro')).toEqual(['giroconto']);
    expect(uses.get('tx-b-giro')).toEqual(['giroconto']);
    const once = await snapshot(store);
    await reconcile(store, 's');
    expect(await snapshot(store)).toEqual(once);
  });

  it('a leg of a transfer is never matched to a bill', async () => {
    const store = await treConti();
    // A transfer saved on the debit of the condominium instalment (synthetic, by hand).
    const leg = TransferSchema.parse({
      id: 'tr-tx-l-cond',
      v: 1,
      rev: 1,
      fromAccountId: 'acc-lovarini',
      toAccountId: 'acc-berchet',
      amount: 30000,
      date: '2027-02-16',
      outTransactionId: 'tx-l-cond',
      purpose: 'altro',
      source: 'confirmed',
    });
    await commitChange(
      store,
      {
        profileId: 'p1',
        kind: 'transfer.confirm',
        summary: 'Confermato un giroconto.',
        changes: [{ path: recordPath('transfer', leg.id), before: undefined, after: leg }],
      },
      clock,
      ids('g'),
    );
    const result = await reconcile(store);
    if (result.status !== 'reconciled') throw new Error('refused');
    const matches = (await loadAll(store, 'match', BillMatchSchema)).records;
    expect(matches.map((m) => m.transactionId)).not.toContain('tx-l-cond');
    for (const list of (await usesOf(store)).values()) expect(list).toHaveLength(1);
    expect(
      await confirmMatch(
        store,
        {
          parts: [
            {
              itemType: 'instalment',
              itemId: 'inst-l-cond',
              transactionId: 'tx-l-cond',
              amount: cents(-30000),
              part: 'amount',
            },
          ],
        },
        'p1',
        clock,
        ids('c'),
      ),
    ).toEqual({ status: 'refused', reason: 'transaction-used' });
  });

  it('confirmIncome on a movement matched after the proposal: unknown-proposal (ledger)', async () => {
    const store = await treConti();
    const dry = await runReconcile(store, 'p1', clock, ids('d'), { dryRun: true });
    if (dry.status !== 'reconciled') throw new Error('refused');
    const proposal = dry.proposals.find((p) => p.transactionId === 'tx-b-nc');
    if (proposal === undefined) throw new Error('no proposal on the credit');
    const confirmed = await confirmMatch(
      store,
      {
        parts: [
          {
            itemType: 'bill',
            itemId: 'bill-hera-nc',
            transactionId: 'tx-b-nc',
            amount: cents(-1500),
            part: 'amount',
          },
        ],
      },
      'p1',
      clock,
      ids('c'),
    );
    expect(confirmed.status).toBe('confirmed');
    const before = await snapshot(store);
    expect(
      await confirmIncome(
        store,
        {
          proposalId: proposal.id,
          tenantId: 't-mario',
          parts: [{ kind: 'altro', forMonth: yearMonth('2027-03'), amount: cents(1500) }],
          rememberPayer: false,
        },
        'p1',
        clock,
        ids('i'),
      ),
    ).toEqual({ status: 'refused', reason: 'unknown-proposal' });
    expect(await snapshot(store)).toEqual(before);
  });

  it('includes the exclusion proposals (read only)', async () => {
    const result = await reconcile(await treConti());
    expect(result).toMatchObject({ status: 'reconciled', exclusions: [] });
  });
});

describe('excludeMovement: order of the refusals (plan 3c, task 4, ledger)', () => {
  it('a diverged store and an unknown movement: inconsistent-store first', async () => {
    const store = await treConti();
    await saveTenant(store, { id: 't-mario', name: 'Mario Inventato' }, 'p1', clock, ids('t'));
    store.putRaw(
      recordPath('tenant', 't-mario'),
      '{"id":"t-mario","v":1,"rev":1,"name":"Altro"}\n',
    );
    const diverged = await snapshot(store);
    expect(
      await excludeMovement(
        store,
        { transactionId: 'nessuno', reason: 'doppione' },
        'p1',
        clock,
        ids('x'),
      ),
    ).toEqual({ status: 'refused', reason: 'inconsistent-store' });
    expect(await snapshot(store)).toEqual(diverged);
  });
});
