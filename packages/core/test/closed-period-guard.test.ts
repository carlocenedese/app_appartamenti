// F5 (decided by user1 on 18 Nov 2026): while a period is closed, what it counted cannot change
// until it is reopened with a reason; new records are accepted. Invented data: a one-bed
// apartment, one tenant all year, a bill of 90,00 for July–September.
import { describe, expect, it } from 'vitest';
import {
  BillMatchSchema,
  BillSchema,
  ClosedPeriodError,
  ContractSchema,
  InstalmentSchema,
  PaymentSchema,
  TenancySchema,
  TenantRecoverySchema,
  closePeriod,
  commitChange,
  loadAll,
  readJournal,
  recordPath,
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
