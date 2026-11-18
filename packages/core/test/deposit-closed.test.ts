// B4, F10 (decided by user1 on 18 Nov 2026): the deposit statement keeps, one labelled line each,
// the settlement of an older closed period not marked settled and the supplementary settlement of
// a closed period; a deposit already returned flags them «da richiedere». Invented data: a one-bed
// apartment, flat charge 30,00 a month (360,00 a year), deposit 500,00.
import { describe, expect, it } from 'vitest';
import {
  closePeriod,
  commitChange,
  loadDepositReturn,
  markTenantSettled,
  recordPath,
  reopenPeriod,
  saveLegalRate,
} from '../src/index';
import type { RecordKind } from '../src/index';
import { isoDate } from '../src/period';
import { apartment, bill, match, payment, tenancy } from './helpers/conguaglio-builders';
import { clock, ids } from './helpers/income-year';
import { MemoryStore } from './helpers/memory-store';

const later = () => '2027-05-02T09:00:00.000Z';

const months = (from: string, count: number) =>
  Array.from({ length: count }, (_, i) => {
    const [y, m] = from.split('-').map(Number) as [number, number];
    const n = y * 12 + m - 1 + i;
    return `${String(Math.floor(n / 12))}-${String((n % 12) + 1).padStart(2, '0')}`;
  });

async function put(
  store: MemoryStore,
  kind: RecordKind,
  record: { id: string } & Record<string, unknown>,
  when: () => string = clock,
) {
  await commitChange(
    store,
    {
      profileId: 'p1',
      kind: 'test.seed',
      summary: 'x',
      changes: [{ path: recordPath(kind, record.id), after: record }],
    },
    when,
    ids(`seed-${kind}-${record.id}`),
  );
}

/** Tenant t-a from October 2025 to `exit`; the 2025-26 bill gives a debt of `debt` cents. */
async function setUp(exit: string, debt: number, contractEnd = '2027-09') {
  const store = new MemoryStore();
  await put(store, 'apartment', apartment({ posti: 1 }));
  await put(store, 'contract', {
    id: 'ctr',
    v: 1,
    rev: 1,
    apartmentId: 'apt',
    type: '1+1',
    start: '2025-10',
    end: contractEnd,
    settlement: 'annuale',
  });
  await put(store, 'tenancy', tenancy('t-a', '2025-10', exit));
  await put(store, 'tenant', { id: 't-a', v: 1, rev: 1, name: 'Nome Inventato' });
  const presentIn2025 = months('2025-10', 12).filter((m) => m <= exit);
  const year = bill('b-anno', '2025-10-01', '2026-06-30', presentIn2025.length * 3000 + debt);
  await put(store, 'bill', year);
  await put(store, 'match', match(year, year.amount));
  for (const m of months('2025-10', 18).filter((x) => x <= exit)) {
    await put(store, 'payment', payment('t-a', m, 48000));
  }
  await put(store, 'payment', {
    id: 'dep',
    v: 1,
    rev: 1,
    apartmentId: 'apt',
    tenantId: 't-a',
    date: '2025-09-25',
    amount: 50000,
    confirmed: true,
    kind: 'caparra',
    source: 'manual',
  });
  for (const y of ['2025', '2026', '2027']) {
    await saveLegalRate(store, { year: y, rateBp: 200 }, 'p1', clock, ids(`rate-${y}`));
  }
  expect(
    (
      await closePeriod(
        store,
        { apartmentId: 'apt', periodLabel: '2025-26' },
        'p1',
        clock,
        ids('c'),
      )
    ).status,
  ).toBe('closed');
  return store;
}

const statement = async (store: MemoryStore) => {
  const r = await loadDepositReturn(store, {
    apartmentId: 'apt',
    tenantId: 't-a',
    extraCharges: [],
  });
  if (r.status !== 'computed') throw new Error(r.reason);
  return r.statement.lines;
};

describe('deposit statement and closed periods (B4, F10)', () => {
  it('an older closed period not marked settled is withheld on its own line', async () => {
    // The tenant leaves in March 2027 with 120,00 of the 2025-26 settlement unpaid.
    const store = await setUp('2027-03', 12000);
    const lines = await statement(store);
    expect(lines).toContainEqual({ label: 'Conguaglio 2025-26 non saldato', amount: -12000 });
    // Marked settled by user1: no line any more.
    await markTenantSettled(
      store,
      { apartmentId: 'apt', periodLabel: '2025-26', tenantId: 't-a', on: '2026-12-01' },
      'p1',
      later,
      ids('s'),
    );
    expect((await statement(store)).map((l) => l.label)).not.toContain(
      'Conguaglio 2025-26 non saldato',
    );
  });

  it('the supplementary of the closed exit period is one line of its own, also when settled', async () => {
    // The tenant left in August 2026, the period is closed; a late bill of 12,00 for July.
    const store = await setUp('2026-08', 0, '2026-09');
    const late = bill('b-tardiva', '2026-07-01', '2026-07-31', 1200, {
      dueDate: isoDate('2026-11-10'),
    });
    await put(store, 'bill', late, later);
    await put(store, 'match', match(late, 1200), later);
    const supplementary = { label: 'Conguaglio supplementare 2025-26', amount: -1200 };
    const before = await statement(store);
    expect(before.filter((l) => l.label.includes('supplementare'))).toEqual([supplementary]);
    // Nothing was due at the closing; the conguaglio line is that, never today's 12,00 again.
    expect(before).toContainEqual({ label: 'Conguaglio bollette', amount: 0 });
    await markTenantSettled(
      store,
      { apartmentId: 'apt', periodLabel: '2025-26', tenantId: 't-a', on: '2026-10-20' },
      'p1',
      later,
      ids('s'),
    );
    const after = await statement(store);
    expect(after.filter((l) => l.amount === -1200)).toEqual([supplementary]);
  });

  it('a deposit already returned is not changed: the lines are «da richiedere»', async () => {
    const store = await setUp('2027-03', 12000);
    await put(
      store,
      'payment',
      {
        id: 'dep-back',
        v: 1,
        rev: 1,
        apartmentId: 'apt',
        tenantId: 't-a',
        date: '2027-04-10',
        amount: -50000,
        confirmed: true,
        kind: 'caparra',
        source: 'manual',
      },
      later,
    );
    expect(
      await loadDepositReturn(store, { apartmentId: 'apt', tenantId: 't-a', extraCharges: [] }),
    ).toEqual({
      status: 'refused',
      reason: 'already-returned',
      toRequest: [{ label: 'Conguaglio 2025-26 non saldato', amount: 12000 }],
    });
  });

  it('a reopened period of the tenant refuses the statement (prudent)', async () => {
    const store = await setUp('2027-03', 12000);
    await reopenPeriod(
      store,
      { apartmentId: 'apt', periodLabel: '2025-26', on: '2027-05-01', reason: 'Correzione' },
      'p1',
      later,
      ids('r'),
    );
    expect(
      await loadDepositReturn(store, { apartmentId: 'apt', tenantId: 't-a', extraCharges: [] }),
    ).toEqual({ status: 'refused', reason: 'period-reopened' });
  });
});
