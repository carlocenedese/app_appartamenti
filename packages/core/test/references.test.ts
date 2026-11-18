import { describe, expect, it } from 'vitest';
import {
  countByType,
  recordDependents,
  recordPath,
  recordSchemas,
  referenceProblems,
} from '../src/index';
import type { RecordKind } from '../src/index';
import { MemoryStore } from './helpers/memory-store';

const base = { v: 1, rev: 1 };
async function put(store: MemoryStore, kind: RecordKind, records: Record<string, unknown>[]) {
  for (const r of records) {
    await store.writeJsonAtomic(recordPath(kind, r.id as string), recordSchemas[kind].parse(r));
  }
}
const apartment = (id: string, extra: Record<string, unknown> = {}) => ({
  ...base,
  id,
  name: id,
  locatore: 'Locatore fittizio',
  posti: 2,
  annualitaStart: { month: 1, day: 1 },
  ...extra,
});

async function seeded() {
  const store = new MemoryStore();
  await put(store, 'apartment', [apartment('apx')]);
  await put(store, 'tenant', [{ ...base, id: 't1', name: 'Inquilino Fittizio' }]);
  await put(store, 'tenancy', [
    {
      ...base,
      id: 'ten1',
      apartmentId: 'apx',
      tenantId: 't1',
      from: '2026-01',
      monthlyRent: 50000,
      monthlyForfait: 5000,
    },
  ]);
  await put(store, 'contract', [
    {
      ...base,
      id: 'c1',
      apartmentId: 'apx',
      type: '4+4',
      start: '2026-01',
      end: '2029-12',
      settlement: 'annuale',
      tenancyIds: ['ten1'],
    },
  ]);
  await put(store, 'payable', [
    {
      ...base,
      id: 'scad-1',
      apartmentId: 'apx',
      kind: 'registro',
      dueDate: '2026-12-01',
      expected: 6700,
    },
  ]);
  await put(store, 'contact', [
    { ...base, id: 'k1', role: 'amministratore', name: 'Amministratore', apartmentIds: ['apx'] },
  ]);
  return store;
}

describe('recordDependents', () => {
  it('lists every live record pointing at the targets, by kind then id', async () => {
    const store = await seeded();
    const refs = await recordDependents(store, [{ type: 'apartment', id: 'apx' }]);
    expect(refs).toEqual([
      { type: 'contact', id: 'k1' },
      { type: 'contract', id: 'c1' },
      { type: 'payable', id: 'scad-1' },
      { type: 'tenancy', id: 'ten1' },
    ]);
    expect(countByType(refs)).toEqual({ contact: 1, contract: 1, payable: 1, tenancy: 1 });
    expect(await recordDependents(store, [{ type: 'tenancy', id: 'ten1' }])).toEqual([
      { type: 'contract', id: 'c1' },
    ]);
    expect(await recordDependents(store, [])).toEqual([]);
  });

  it('leaves out deleted records and the targets themselves', async () => {
    const store = await seeded();
    await put(store, 'payable', [
      {
        ...base,
        id: 'scad-2',
        apartmentId: 'apx',
        kind: 'registro',
        dueDate: '2026-12-01',
        expected: 6700,
        previousId: 'scad-1',
        deleted: true,
      },
      {
        ...base,
        id: 'scad-3',
        apartmentId: 'apx',
        kind: 'registro',
        dueDate: '2027-12-01',
        expected: 6700,
        previousId: 'scad-1',
      },
    ]);
    expect(
      await recordDependents(store, [
        { type: 'payable', id: 'scad-1' },
        { type: 'payable', id: 'scad-3' },
      ]),
    ).toEqual([]);
    expect(await recordDependents(store, [{ type: 'payable', id: 'scad-1' }])).toEqual([
      { type: 'payable', id: 'scad-3' },
    ]);
  });
});

describe('referenceProblems', () => {
  it('reports a live statement listing a movement that is gone', async () => {
    const store = await seeded();
    await put(store, 'statement', [
      {
        ...base,
        id: 's1',
        accountId: 'acc',
        bankProfileId: 'bp',
        fileName: 's.csv',
        suggestedPath: 'estratti/s.csv',
        from: '2026-03-01',
        to: '2026-03-31',
        periodSource: 'file',
        rowCount: 1,
        transactionIds: ['tx-gone'],
        held: [],
      },
    ]);
    const fields = (await referenceProblems(store)).map((p) => `${p.field}:${p.to.id}`);
    expect(fields).toContain('transactionIds:tx-gone');
  });

  it('finds nothing in a store whose references all hold', async () => {
    expect(await referenceProblems(await seeded())).toEqual([]);
  });

  it('reports each live record pointing at a missing or deleted record, kinds and ids only', async () => {
    const store = await seeded();
    await put(store, 'apartment', [apartment('apx', { deleted: true })]);
    await put(store, 'match', [
      {
        ...base,
        id: 'm1',
        itemType: 'bill',
        itemId: 'nope',
        transactionId: 'tx-gone',
        transactionDate: '2026-03-01',
        amount: 100,
        part: 'amount',
        confirmed: true,
        by: 'manual',
      },
      {
        ...base,
        id: 'm3',
        itemType: 'bill',
        itemId: 'nope',
        transactionId: 'assumed-nope',
        transactionDate: '2026-03-01',
        amount: 100,
        part: 'amount',
        confirmed: true,
        by: 'assumed',
      },
    ]);
    const problems = await referenceProblems(store);
    expect(problems.map((p) => [p.path, p.field, p.to.type, p.to.id])).toEqual([
      [recordPath('contact', 'k1'), 'apartmentIds', 'apartment', 'apx'],
      [recordPath('contract', 'c1'), 'apartmentId', 'apartment', 'apx'],
      [recordPath('match', 'm1'), 'itemId', 'bill', 'nope'],
      [recordPath('match', 'm1'), 'transactionId', 'transaction', 'tx-gone'],
      [recordPath('match', 'm3'), 'itemId', 'bill', 'nope'],
      [recordPath('payable', 'scad-1'), 'apartmentId', 'apartment', 'apx'],
      [recordPath('tenancy', 'ten1'), 'apartmentId', 'apartment', 'apx'],
    ]);
    expect(problems.every((p) => p.reason === 'dangling-reference')).toBe(true);
  });

  it('accepts a match on an instalment, a file it cannot read, and skips deleted holders and notes', async () => {
    const store = await seeded();
    await put(store, 'instalment', [
      {
        ...base,
        id: 'i1',
        apartmentId: 'apx',
        kind: 'tari',
        esercizio: '2026',
        rateIndex: 1,
        rateCount: 1,
        dueDate: '2026-05-01',
        rata: 1000,
        quotaProprieta: 0,
        conguaglioPrec: 0,
        coversFrom: '2026-01',
        coversTo: '2026-12',
      },
    ]);
    store.putRaw(recordPath('transaction', 'tx-broken'), '{ cut short');
    await put(store, 'match', [
      {
        ...base,
        id: 'm1',
        itemType: 'instalment',
        itemId: 'i1',
        transactionId: 'tx-broken',
        transactionDate: '2026-03-01',
        amount: 100,
        part: 'amount',
        confirmed: true,
        by: 'manual',
      },
      {
        ...base,
        id: 'm2',
        itemType: 'bill',
        itemId: 'nope',
        transactionId: 'nope',
        transactionDate: '2026-03-01',
        amount: 100,
        part: 'amount',
        confirmed: true,
        by: 'manual',
        deleted: true,
      },
    ]);
    await put(store, 'note', [
      {
        ...base,
        id: 'n1',
        targetType: 'bill',
        targetId: 'gone',
        text: 'x',
        profileId: 'p1',
        at: '2026-11-14T09:00:00.000Z',
      },
    ]);
    expect(await referenceProblems(store)).toEqual([]);
    expect(await recordDependents(store, [{ type: 'bill', id: 'gone' }])).toEqual([]);
  });
});
