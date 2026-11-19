// F5 (decided by user1 on 18 Nov 2026): while a period is closed, what it counted cannot change
// until it is reopened with a reason; new records are accepted. Invented data: a one-bed
// apartment, one tenant all year, a bill of 90,00 for July–September.
import { describe, expect, it } from 'vitest';
import {
  ApartmentSchema,
  BankTransactionSchema,
  BillMatchSchema,
  BillSchema,
  ClosedPeriodError,
  ContractSchema,
  InstalmentSchema,
  MovementClassSchema,
  PaymentSchema,
  PeriodCloseSchema,
  SupplySchema,
  TenancySchema,
  TenantRecoverySchema,
  checkConsistency,
  closeMarks,
  closePeriod,
  commitChange,
  forkVersions,
  loadAll,
  markPeriodSent,
  markTenantSettled,
  readJournal,
  recordPath,
  recordSchemas,
  reopenPeriod,
  undoFile,
  undoOperation,
} from '../src/index';
import { cents } from '../src/money';
import type { RecordKind } from '../src/index';
import { isoDate, yearMonth } from '../src/period';
import {
  apartment,
  bill,
  instalment,
  match,
  payment,
  tenancy,
} from './helpers/conguaglio-builders';
import { clock, ids } from './helpers/income-year';
import { MemoryStore } from './helpers/memory-store';

const QUERY = { apartmentId: 'apt', periodLabel: '2025-26' };
const MONTHS = Array.from({ length: 12 }, (_, i) => {
  const n = 2025 * 12 + 9 + i;
  return `${String(Math.floor(n / 12))}-${String((n % 12) + 1).padStart(2, '0')}`;
});
const later = () => '2026-11-20T09:00:00.000Z';
const luglio = bill('b-lug', '2026-07-01', '2026-09-30', 9000, { dueDate: isoDate('2026-10-10') });

async function write(
  store: MemoryStore,
  kind: RecordKind,
  after: ({ id: string } & Record<string, unknown>) | undefined,
  before?: { id: string; rev: number } & Record<string, unknown>,
  when: () => string = clock,
  id = 'w',
) {
  const recordId = after?.id ?? before?.id ?? '';
  return commitChange(
    store,
    {
      profileId: 'p1',
      kind: 'test.seed',
      summary: 'x',
      changes: [{ path: recordPath(kind, recordId), before, after }],
    },
    when,
    ids(`${id}-${kind}-${recordId}`),
  );
}

async function closed(extra: [RecordKind, { id: string } & Record<string, unknown>][] = []) {
  const store = new MemoryStore();
  await write(store, 'apartment', apartment({ posti: 1 }));
  await write(store, 'contract', {
    id: 'ctr',
    v: 1,
    rev: 1,
    apartmentId: 'apt',
    type: '1+1',
    start: '2025-10',
    end: '2027-09',
    settlement: 'annuale',
    rent: [{ from: '2025-10', monthlyRent: 45000, monthlyAdvance: 3000 }],
  });
  await write(store, 'tenancy', tenancy('t-a', '2025-10', undefined));
  await write(store, 'tenant', { id: 't-a', v: 1, rev: 1, name: 'Nome Inventato' });
  await write(store, 'bill', luglio);
  await write(store, 'match', match(luglio, 9000));
  for (const m of MONTHS) await write(store, 'payment', payment('t-a', m, 48000));
  for (const [kind, record] of extra) await write(store, kind, record);
  expect((await closePeriod(store, QUERY, 'p1', clock, ids('c'))).status).toBe('closed');
  return store;
}

const one = async <T extends { id: string }>(
  store: MemoryStore,
  kind: RecordKind,
  schema: Parameters<typeof loadAll>[2],
  id: string,
) =>
  (await loadAll(store, kind, schema)).records.find((r) => r.id === id) as unknown as T & {
    rev: number;
  } & Record<string, unknown>;

describe('closed period guard (F5)', () => {
  it('refuses to delete a payment of the period, naming it, until the period is reopened', async () => {
    const store = await closed();
    const first = (await loadAll(store, 'payment', PaymentSchema)).records[0];
    if (first === undefined) throw new Error('payment');
    const attempt = () => write(store, 'payment', undefined, first, later, 'del');
    await expect(attempt()).rejects.toThrow(ClosedPeriodError);
    await expect(attempt()).rejects.toThrow(/2025-26.*riapri il periodo con il motivo/);
    await reopenPeriod(
      store,
      { ...QUERY, on: '2026-11-20', reason: 'Bonifico respinto' },
      'p1',
      later,
      ids('r'),
    );
    await expect(attempt()).resolves.toMatchObject({ kind: 'test.seed' });
  });

  it('accepts a late bill and its match; refuses a change of the amount of the bill counted', async () => {
    const store = await closed();
    const late = bill('b-tardiva', '2026-07-01', '2026-09-30', 4000, {
      dueDate: isoDate('2026-11-10'),
    });
    await write(store, 'bill', late, undefined, later);
    await write(store, 'match', match(late, 4000), undefined, later);
    // The late bill was not there at the closing: it can still be corrected.
    const lateNow = await one(store, 'bill', BillSchema, 'b-tardiva');
    await write(store, 'bill', { ...lateNow, amount: 4100 }, lateNow, later, 'fix');
    const counted = await one(store, 'bill', BillSchema, 'b-lug');
    await expect(
      write(store, 'bill', { ...counted, amount: 9100 }, counted, later, 'fix'),
    ).rejects.toThrow(ClosedPeriodError);
    // The path of the PDF is not something the period counts.
    await write(store, 'bill', { ...counted, filePath: 'altro.pdf' }, counted, later, 'move');
    // Its match is dated after the period but pays a bill of it: refused too.
    const paid = await one(store, 'match', BillMatchSchema, 'm-b-lug-amount-tx');
    await expect(write(store, 'match', undefined, paid, later, 'del')).rejects.toThrow(
      ClosedPeriodError,
    );
  });

  it('a stay can end in a later year; ending it inside the period or a new stay inside is refused', async () => {
    const store = await closed();
    const stay = await one(store, 'tenancy', TenancySchema, 'tcy-t-a-2025-10');
    await expect(
      write(store, 'tenancy', { ...stay, to: '2026-06' }, stay, later, 'end'),
    ).rejects.toThrow(ClosedPeriodError);
    await write(store, 'tenancy', { ...stay, to: '2027-03' }, stay, later, 'end');
    await expect(
      write(store, 'tenancy', tenancy('t-b', '2026-05', undefined), undefined, later),
    ).rejects.toThrow(ClosedPeriodError);
    await write(store, 'tenancy', tenancy('t-c', '2026-10', undefined), undefined, later);
  });

  it('refuses the undo of an operation that touches what the period counted, writing nothing', async () => {
    const store = await closed();
    const { operations } = await readJournal(store);
    const seed = operations.find((o) => o.changes.some((c) => c.path.includes('/payment/')));
    if (seed === undefined) throw new Error('seed');
    await expect(undoOperation(store, seed.id, 'p1', later, ids('u'))).rejects.toThrow(
      ClosedPeriodError,
    );
    expect((await readJournal(store)).operations).toHaveLength(operations.length);
    // The undo of a late bill passes: it did not exist at the closing.
    const late = bill('b-tardiva', '2026-07-01', '2026-09-30', 4000, {
      dueDate: isoDate('2026-11-10'),
    });
    const op = await write(store, 'bill', late, undefined, later);
    await expect(undoOperation(store, op.id, 'p1', later, ids('u'))).resolves.toMatchObject({
      kind: 'undo',
    });
  });
});

describe('closed period guard, kind by kind (F5)', () => {
  const condo = instalment('rata-1', {
    esercizio: '2025-26',
    rateIndex: 1,
    rateCount: 3,
    dueDate: isoDate('2025-10-10'),
    rata: cents(6000),
    coversFrom: yearMonth('2025-10'),
    coversTo: yearMonth('2026-01'),
  });
  const credit = {
    id: 'rec-1',
    v: 1,
    rev: 1,
    apartmentId: 'apt',
    amount: -1500,
    shares: [{ tenantId: 't-a', amount: -1500 }],
    status: 'da-recuperare',
    date: '2026-08-10',
  };
  const deposit = payment('t-a', '2025-09', 50000, { kind: 'caparra', forMonth: undefined });
  const setUp = () =>
    closed([
      ['instalment', condo],
      ['match', match(condo, 6000, { transactionDate: isoDate('2025-10-10') })],
      ['tenantRecovery', credit],
      ['payment', deposit],
    ]);
  const refused = ClosedPeriodError;

  it('contract: a rent of the months of the period is refused, one from a later month passes', async () => {
    const store = await setUp();
    const ctr = await one(store, 'contract', ContractSchema, 'ctr');
    const rent = (from: string) => ({
      ...ctr,
      rent: [...(ctr.rent as object[]), { from, monthlyRent: 46000, monthlyAdvance: 3000 }],
    });
    await expect(write(store, 'contract', rent('2026-03'), ctr, later, 'r')).rejects.toThrow(
      refused,
    );
    await write(store, 'contract', rent('2026-10'), ctr, later, 'r');
  });

  it('instalment and its match: the amount is refused, the file hash passes', async () => {
    const store = await setUp();
    const rata = await one(store, 'instalment', InstalmentSchema, 'rata-1');
    await expect(
      write(store, 'instalment', { ...rata, rata: 6100 }, rata, later, 'x'),
    ).rejects.toThrow(refused);
    await write(store, 'instalment', { ...rata, fileHash: 'hash-nuovo' }, rata, later, 'x');
    const paid = await one(store, 'match', BillMatchSchema, 'm-rata-1-amount-tx');
    await expect(
      write(store, 'match', { ...paid, confirmed: false }, paid, later, 'x'),
    ).rejects.toThrow(refused);
  });

  it('recovery: «non recuperabile» is refused, «recuperata» passes (the settlement does not read it)', async () => {
    const store = await setUp();
    const rec = await one(store, 'tenantRecovery', TenantRecoverySchema, 'rec-1');
    await expect(
      write(store, 'tenantRecovery', { ...rec, status: 'non-recuperabile' }, rec, later, 'x'),
    ).rejects.toThrow(refused);
    await write(store, 'tenantRecovery', { ...rec, status: 'recuperata' }, rec, later, 'x');
  });

  it('a deposit payment is not part of the settlement: it can change', async () => {
    const store = await setUp();
    const dep = await one(store, 'payment', PaymentSchema, deposit.id);
    await write(store, 'payment', { ...dep, note: 'corretta' }, dep, later, 'x');
    await write(store, 'payment', undefined, { ...dep, rev: dep.rev + 1 }, later, 'y');
  });

  it('undoFile refuses before undoing anything when one registration is in the closed period', async () => {
    const store = await setUp();
    const before = (await readJournal(store)).operations.length;
    await expect(undoFile(store, `hash-b-lug`, 'p1', later, ids('u'))).rejects.toThrow(refused);
    expect((await readJournal(store)).operations).toHaveLength(before);
  });
});

/** Another computer with the same folder: every record and journal file copied. */
async function cloneOf(from: MemoryStore): Promise<MemoryStore> {
  const to = new MemoryStore();
  for (const dir of ['_app/journal', ...Object.keys(recordSchemas).map((k) => `_app/dati/${k}`)]) {
    for (const name of await from.list(dir)) {
      to.putRaw(`${dir}/${name}`, from.getRaw(`${dir}/${name}`) ?? '');
    }
  }
  return to;
}

describe('closed period guard, second review', () => {
  it('finding 4: what existed is read from the closing, not the clocks (an operation synced late is new)', async () => {
    const store = await closed();
    const close = (await loadAll(store, 'periodClose', PeriodCloseSchema)).records[0];
    expect(close?.inputs).toContain('bill/b-lug');
    expect(close?.inputs).toContain(
      'payment/' + String((await loadAll(store, 'payment', PaymentSchema)).records[0]?.id),
    );
    // Written on a computer whose clock is behind, arrived after the closing: not in the snapshot.
    const behind = () => '2026-11-01T09:00:00.000Z';
    const synced = bill('b-sync', '2026-08-01', '2026-08-31', 2000, {
      dueDate: isoDate('2026-09-10'),
    });
    await write(store, 'bill', synced, undefined, behind);
    const now = await one(store, 'bill', BillSchema, 'b-sync');
    await write(store, 'bill', { ...now, amount: 2100 }, now, behind, 'fix');
    // A record counted at closing stays refused, whatever the clock of the change.
    const counted = await one(store, 'bill', BillSchema, 'b-lug');
    await expect(
      write(store, 'bill', { ...counted, amount: 1 }, counted, behind, 'fix'),
    ).rejects.toThrow(ClosedPeriodError);
  });

  it('finding 5: without inputs, a record older than the journal stays guarded after a change outside the view', async () => {
    const store = await closed();
    const close = (await loadAll(store, 'periodClose', PeriodCloseSchema)).records[0];
    if (close === undefined) throw new Error('close');
    const old = { ...close, inputs: undefined };
    await write(store, 'periodClose', old, close, clock, 'old');
    store.putRaw(
      recordPath('bill', 'b-raw'),
      JSON.stringify(bill('b-raw', '2026-02-01', '2026-02-28', 1500)),
    );
    const raw = await one(store, 'bill', BillSchema, 'b-raw');
    await write(store, 'bill', { ...raw, filePath: 'spostata.pdf' }, raw, later, 'move');
    const moved = await one(store, 'bill', BillSchema, 'b-raw');
    await expect(
      write(store, 'bill', { ...moved, amount: 1600 }, moved, later, 'fix'),
    ).rejects.toThrow(ClosedPeriodError);
  });

  it('finding 6: a forked closing blocks only its apartment and months; the versions show their marks', async () => {
    const a = await closed();
    const b = await cloneOf(a);
    await markPeriodSent(a, { ...QUERY, on: '2026-11-20' }, 'p1', later, ids('send'));
    await markTenantSettled(
      b,
      { ...QUERY, tenantId: 't-a', on: '2026-12-01' },
      'p2',
      later,
      ids('settle'),
    );
    for (const name of await b.list('_app/journal')) {
      a.putRaw(`_app/journal/${name}`, b.getRaw(`_app/journal/${name}`) ?? '');
    }
    const path = recordPath('periodClose', 'chiusura-apt-2025-26');
    expect(await checkConsistency(a)).toEqual([{ path, reason: 'forked' }]);
    // Another apartment goes on.
    await write(
      a,
      'bill',
      bill('b-altro', '2026-02-01', '2026-02-28', 1000, { apartmentId: 'apt-2' }),
      undefined,
      later,
    );
    // The forked apartment's months are blocked, whatever existed at closing.
    await expect(
      write(a, 'bill', bill('b-nuova', '2026-02-01', '2026-02-28', 1000), undefined, later),
    ).rejects.toThrow(ClosedPeriodError);
    const marks = (await forkVersions(a, path)).map((op) =>
      closeMarks(PeriodCloseSchema.parse(op.changes.find((c) => c.path === path)?.after)),
    );
    expect(marks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sentOn: '2026-11-20', settled: [] }),
        expect.objectContaining({ settled: ['t-a'] }),
      ]),
    );
  });

  it("finding 10: a settlement payment of the previous period dated in the closed months is not the closed period's", async () => {
    const previous = payment('t-a', '2025-11', 5000, {
      id: 'pay-prev',
      kind: 'conguaglio',
      date: isoDate('2025-11-15'),
      forMonth: undefined,
    });
    const store = await closed([
      [
        'contract',
        {
          id: 'ctr-0',
          v: 1,
          rev: 1,
          apartmentId: 'apt',
          type: '1+1',
          start: '2024-10',
          end: '2025-09',
          settlement: 'annuale',
        },
      ],
      ['payment', previous],
    ]);
    const p = await one(store, 'payment', PaymentSchema, 'pay-prev');
    await write(store, 'payment', { ...p, amount: 5200 }, p, later, 'fix');
  });

  it('B: beds are refused naming every closed period to reopen; another field passes', async () => {
    const store = await closed();
    const apt = await one(store, 'apartment', ApartmentSchema, 'apt');
    const refused = write(store, 'apartment', { ...apt, posti: 2 }, apt, later, 'x');
    await expect(refused).rejects.toThrow(ClosedPeriodError);
    await expect(refused).rejects.toThrow(/riapri .*i periodi chiusi dell'appartamento: 2025-26/);
    await write(store, 'apartment', { ...apt, address: 'Indirizzo inventato' }, apt, later, 'x');
  });

  it('finding 2: a new supply is always linked; an existing one changes unless a counted notice uses it', async () => {
    const supply = (id: string, apartments: { apartmentId: string; weight: number }[]) => ({
      id,
      v: 1,
      rev: 1,
      label: id.toUpperCase(),
      apartments,
    });
    // The December notice the closing waits for (R3), of the supply `sup-tari`.
    const notice = instalment('tari-dic', {
      kind: 'tari',
      esercizio: '2025',
      rateIndex: 3,
      rateCount: 3,
      dueDate: isoDate('2025-12-16'),
      rata: cents(3000),
      coversFrom: yearMonth('2025-09'),
      coversTo: yearMonth('2025-12'),
      supplyId: 'sup-tari',
    });
    const store = await closed([
      ['supply', supply('sup-libera', [{ apartmentId: 'apt', weight: 10000 }])],
      ['supply', supply('sup-tari', [{ apartmentId: 'apt', weight: 10000 }])],
      ['instalment', notice],
      ['match', match(notice, 3000, { transactionDate: isoDate('2025-12-16') })],
    ]);
    // A bill with an unknown code: its supply is linked after the closing.
    await write(
      store,
      'supply',
      supply('sup-nuova', [{ apartmentId: 'apt', weight: 10000 }]),
      undefined,
      later,
    );
    const halves = [
      { apartmentId: 'apt', weight: 6000 },
      { apartmentId: 'apt-2', weight: 4000 },
    ];
    const free = await one(store, 'supply', SupplySchema, 'sup-libera');
    await write(store, 'supply', { ...free, apartments: halves }, free, later, 'x');
    const used = await one(store, 'supply', SupplySchema, 'sup-tari');
    await expect(
      write(store, 'supply', { ...used, apartments: halves }, used, later, 'x'),
    ).rejects.toThrow(ClosedPeriodError);
    await expect(write(store, 'supply', undefined, used, later, 'del')).rejects.toThrow(
      ClosedPeriodError,
    );
    // Plan 22, decision 2: new weights from a month after the closed period pass; from a month
    // inside it they are refused (what the period sees of the supply changes).
    const dated = (to: string) => ({
      ...used,
      apartments: halves,
      earlierApartments: [{ to, apartments: used.apartments }],
    });
    await expect(write(store, 'supply', dated('2026-05'), used, later, 'x')).rejects.toThrow(
      ClosedPeriodError,
    );
    await write(store, 'supply', dated('2026-09'), used, later, 'x');
  });

  it('plan 22: beds from a month after the closed period pass, from inside it are refused', async () => {
    const store = await closed();
    const apt = await one(store, 'apartment', ApartmentSchema, 'apt');
    const dated = (to: string) => ({ ...apt, posti: 2, earlierBeds: [{ to, posti: 1 }] });
    await expect(write(store, 'apartment', dated('2026-02'), apt, later, 'x')).rejects.toThrow(
      ClosedPeriodError,
    );
    await write(store, 'apartment', dated('2026-09'), apt, later, 'x');
  });

  it('J: the movement of a counted match and the class of a counted recovery are refused', async () => {
    const tx = (id: string, amount: number) => ({
      id,
      v: 1,
      rev: 1,
      apartmentId: 'apt',
      date: '2026-08-10',
      amount,
      description: 'Movimento inventato',
      statementHash: 'h',
    });
    const store = await closed([
      ['transaction', tx('tx-b-lug', -9000)],
      ['transaction', tx('tx-rec', -1500)],
      [
        'movementClass',
        {
          id: 'mc-tx-rec',
          v: 1,
          rev: 1,
          transactionId: 'tx-rec',
          kind: 'altro',
          apartmentId: 'apt',
        },
      ],
      [
        'tenantRecovery',
        {
          id: 'rec-tx',
          v: 1,
          rev: 1,
          apartmentId: 'apt',
          transactionId: 'tx-rec',
          amount: 1500,
          shares: [{ tenantId: 't-a', amount: 1500 }],
          status: 'da-recuperare',
          date: '2026-08-10',
        },
      ],
    ]);
    const paid = await one(store, 'transaction', BankTransactionSchema, 'tx-b-lug');
    await expect(write(store, 'transaction', undefined, paid, later, 'del')).rejects.toThrow(
      ClosedPeriodError,
    );
    const cls = await one(store, 'movementClass', MovementClassSchema, 'mc-tx-rec');
    const rest = { ...cls, apartmentId: undefined };
    await expect(
      write(
        store,
        'movementClass',
        { ...rest, kind: 'escluso', excludeReason: 'non-reale' },
        cls,
        later,
        'x',
      ),
    ).rejects.toThrow(ClosedPeriodError);
    // A new movement of the period is accepted.
    await write(store, 'transaction', tx('tx-nuovo', -100), undefined, later);
  });

  it('finding 9: a direct undo of a reopening after a change is refused in the core', async () => {
    const store = await closed();
    const reopened = await reopenPeriod(
      store,
      { ...QUERY, on: '2026-11-20', reason: 'Correzione' },
      'p1',
      later,
      ids('r'),
    );
    if (reopened.status !== 'saved') throw new Error('reopen');
    // The stay ends in June: the bill of July–September is no longer the tenant's.
    const stay = await one(store, 'tenancy', TenancySchema, 'tcy-t-a-2025-10');
    await write(store, 'tenancy', { ...stay, to: '2026-06' }, stay, later, 'end');
    await expect(
      undoOperation(store, reopened.operationId, 'p1', later, ids('u')),
    ).rejects.toMatchObject({ name: 'ClosingUndoError', reason: 'reopen-changed' });
  });

  it('finding 4: undoing the undo of a closing after a change is refused too (any depth)', async () => {
    const store = await closed();
    const closeOp = (await readJournal(store)).operations.find((o) => o.kind === 'period.close');
    if (closeOp === undefined) throw new Error('close');
    const undo = await undoOperation(store, closeOp.id, 'p1', later, ids('u'));
    // Open again: a late bill comes in.
    const late = bill('b-tardiva', '2026-07-01', '2026-09-30', 1000, {
      dueDate: isoDate('2026-11-10'),
    });
    await write(store, 'bill', late, undefined, later);
    await write(store, 'match', match(late, 1000), undefined, later);
    await expect(undoOperation(store, undo.id, 'p1', later, ids('uu'))).rejects.toMatchObject({
      name: 'ClosingUndoError',
      reason: 'closing-changed',
    });
  });

  it('finding 4: the undo of a mark (sent) after a late bill is not a closing again: it passes', async () => {
    const store = await closed();
    const sent = await markPeriodSent(store, { ...QUERY, on: '2026-11-20' }, 'p1', later, ids('s'));
    if (sent.status !== 'saved') throw new Error('sent');
    const late = bill('b-tardiva', '2026-07-01', '2026-09-30', 1000, {
      dueDate: isoDate('2026-11-10'),
    });
    await write(store, 'bill', late, undefined, later);
    await expect(
      undoOperation(store, sent.operationId, 'p1', later, ids('u')),
    ).resolves.toMatchObject({
      kind: 'undo',
    });
  });

  it('C: depth 3, undoing again would close a reopened period: the reason is reopen-changed', async () => {
    const store = await closed();
    const reopened = await reopenPeriod(
      store,
      { ...QUERY, on: '2026-11-20', reason: 'Correzione' },
      'p1',
      later,
      ids('r'),
    );
    if (reopened.status !== 'saved') throw new Error('reopen');
    const u1 = await undoOperation(store, reopened.operationId, 'p1', later, ids('u1'));
    const u2 = await undoOperation(store, u1.id, 'p1', later, ids('u2'));
    const stay = await one(store, 'tenancy', TenancySchema, 'tcy-t-a-2025-10');
    await write(store, 'tenancy', { ...stay, to: '2026-06' }, stay, later, 'end');
    await expect(undoOperation(store, u2.id, 'p1', later, ids('u3'))).rejects.toMatchObject({
      name: 'ClosingUndoError',
      reason: 'reopen-changed',
    });
  });
});

describe('closed period guard and F9 a (I1)', () => {
  // Invented: two beds. A's stay has no end and is linked only to an older contract ending in
  // August 2025 (a month's gap): by F9 a A is not in 2025-26. B is the tenant of 2025-26.
  async function gap() {
    const store = new MemoryStore();
    const a = tenancy('t-a', '2024-10', undefined);
    const b = tenancy('t-b', '2025-10', '2026-09');
    await write(store, 'apartment', apartment({ posti: 2 }));
    const base = { v: 1, rev: 1, apartmentId: 'apt', type: '1+1', settlement: 'annuale' };
    await write(store, 'contract', {
      ...base,
      id: 'c0',
      start: '2024-10',
      end: '2025-08',
      tenancyIds: [a.id],
    });
    await write(store, 'contract', {
      ...base,
      id: 'ctr',
      start: '2025-10',
      end: '2026-09',
      tenancyIds: [b.id],
    });
    await write(store, 'tenancy', a);
    await write(store, 'tenancy', b);
    for (const id of ['t-a', 't-b']) {
      await write(store, 'tenant', { id, v: 1, rev: 1, name: 'Nome Inventato' });
    }
    for (const m of MONTHS) await write(store, 'payment', payment('t-b', m, 48000));
    expect((await closePeriod(store, QUERY, 'p1', clock, ids('c'))).status).toBe('closed');
    return { store, a };
  }
  const contractOf = async (store: MemoryStore, id: string) =>
    (await loadAll(store, 'contract', ContractSchema)).records.find((c) => c.id === id) as
      (Record<string, unknown> & { id: string; rev: number; tenancyIds?: string[] }) | undefined;

  it('refuses to link a stay without end to the contract of the closed period', async () => {
    const { store, a } = await gap();
    const ctr = await contractOf(store, 'ctr');
    if (ctr === undefined) throw new Error('contract');
    await expect(
      write(
        store,
        'contract',
        { ...ctr, tenancyIds: [...(ctr.tenancyIds ?? []), a.id] },
        ctr,
        later,
        'link',
      ),
    ).rejects.toThrow(ClosedPeriodError);
  });

  it('refuses to delete or unlink the contract that ends the stay; another change passes', async () => {
    const { store } = await gap();
    const c0 = await contractOf(store, 'c0');
    if (c0 === undefined) throw new Error('contract');
    // Unlinked, the stay would take the contract in force at its start: none from 2024-10
    // without c0, so it would be open and in 2025-26.
    await expect(write(store, 'contract', undefined, c0, later, 'del')).rejects.toThrow(
      ClosedPeriodError,
    );
    // Moving the end of c0 inside the months before the period changes nothing in 2025-26.
    await write(store, 'contract', { ...c0, end: '2025-07' }, c0, later, 'move');
  });
});
