// F5 (decided by user1 on 18 Nov 2026): while a period is closed, what it counted cannot change
// until it is reopened with a reason; new records are accepted. Invented data: a one-bed
// apartment, one tenant all year, a bill of 90,00 for July–September.
import { describe, expect, it } from 'vitest';
import {
  BillMatchSchema,
  BillSchema,
  ClosedPeriodError,
  PaymentSchema,
  TenancySchema,
  closePeriod,
  commitChange,
  loadAll,
  readJournal,
  recordPath,
  reopenPeriod,
  undoOperation,
} from '../src/index';
import type { RecordKind } from '../src/index';
import { isoDate } from '../src/period';
import { apartment, bill, match, payment, tenancy } from './helpers/conguaglio-builders';
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

async function closed() {
  const store = new MemoryStore();
  await write(store, 'apartment', apartment({ posti: 1 }));
  await write(store, 'contract', {
    id: 'ctr',
    v: 1,
    rev: 1,
    apartmentId: 'apt',
    type: '1+1',
    start: '2025-10',
    end: '2026-09',
    settlement: 'annuale',
  });
  await write(store, 'tenancy', tenancy('t-a', '2025-10', undefined));
  await write(store, 'tenant', { id: 't-a', v: 1, rev: 1, name: 'Nome Inventato' });
  await write(store, 'bill', luglio);
  await write(store, 'match', match(luglio, 9000));
  for (const m of MONTHS) await write(store, 'payment', payment('t-a', m, 48000));
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
