/**
 * Review of 18 Nov 2026 («annullo»): the undo of an operation that created a record is refused
 * while a live record on another path points at it (U1, U2, U7). From the probes of the review.
 */
import { describe, expect, it } from 'vitest';
import {
  MovementClassSchema,
  TenantSchema,
  confirmOutgoing,
  countByType,
  loadAll,
  recordPath,
  recordSchemas,
  runOutgoing,
  saveApartment,
  saveContract,
  savePayable,
  saveTenancy,
  undoBlockedBy,
  undoDependents,
  undoOperation,
} from '../src/index';
import type { RecordKind } from '../src/index';
import { MemoryStore } from './helpers/memory-store';

const clock = () => '2026-11-14T09:00:00.000Z';
const ids = (p: string) => {
  let n = 0;
  return () => `${p}-${String(++n)}`;
};
const base = { v: 1, rev: 1 };
async function put(store: MemoryStore, kind: RecordKind, records: Record<string, unknown>[]) {
  for (const r of records) {
    await store.writeJsonAtomic(recordPath(kind, r.id as string), recordSchemas[kind].parse(r));
  }
}
const operationOf = (r: { status: string }) => {
  if (!('operationId' in r) || typeof r.operationId !== 'string') {
    throw new Error(JSON.stringify(r));
  }
  return r.operationId;
};

describe('undo of a creation with live records pointing at it', () => {
  it('U1: refuses the undo of an apartment while its stays, contracts and payables live', async () => {
    const store = new MemoryStore();
    await store.writeJsonAtomic(
      recordPath('tenant', 't1'),
      TenantSchema.parse({ ...base, id: 't1', name: 'Inquilino Fittizio' }),
    );
    const op = operationOf(
      await saveApartment(
        store,
        {
          id: 'apx',
          name: 'Appartamento X',
          locatore: 'Locatore fittizio',
          posti: 2,
          annualitaStart: { month: 1, day: 1 },
          condoDifferenceTo: 'owner',
        },
        'p1',
        clock,
        ids('a'),
      ),
    );
    expect(await undoBlockedBy(store, op)).toEqual([]);
    const tenancy = operationOf(
      await saveTenancy(
        store,
        {
          id: 'ten1',
          apartmentId: 'apx',
          tenantId: 't1',
          from: '2026-01',
          monthlyRent: 50000,
          monthlyForfait: 5000,
        } as never,
        'p1',
        clock,
        ids('t'),
      ),
    );
    await saveContract(
      store,
      {
        id: 'c1',
        apartmentId: 'apx',
        type: '4+4',
        start: '2026-01',
        end: '2029-12',
        settlement: 'annuale',
        tenancyIds: ['ten1'],
      } as never,
      'p1',
      clock,
      ids('c'),
    );
    const payable = await savePayable(
      store,
      { apartmentId: 'apx', kind: 'registro', dueDate: '2026-12-01', expected: 6700 } as never,
      'p1',
      clock,
      ids('s'),
    );
    const payableId = (payable as { payableId: string }).payableId;
    expect(await undoBlockedBy(store, op)).toEqual(['c1', payableId, 'ten1'].sort());
    const refs = await undoDependents(store, op);
    expect(countByType(refs)).toEqual({ contract: 1, payable: 1, tenancy: 1 });
    // U7: the stay is in the contract written after it, on another path.
    expect(await undoBlockedBy(store, tenancy)).toEqual(['c1']);
    expect(await undoDependents(store, 'nope')).toEqual([]);
  });

  it('U2: refuses the undo of outgoing.confirm while a class made by its rule lives', async () => {
    const store = new MemoryStore();
    const SUPPLIER = 'IT04X0542811101000000000401';
    const tx = (id: string, date: string, amount: number) => ({
      ...base,
      id,
      apartmentId: 'berchet',
      accountId: 'acc-berchet',
      date,
      amount,
      description: 'ADDEBITO FORNITORE INVENTATO',
      statementHash: 's',
      counterparty: { name: 'Fornitore Inventato', iban: SUPPLIER },
    });
    await put(store, 'apartment', [
      {
        ...base,
        id: 'berchet',
        name: 'berchet',
        locatore: 'Locatore fittizio',
        posti: 2,
        annualitaStart: { month: 1, day: 1 },
      },
    ]);
    await put(store, 'account', [
      {
        ...base,
        id: 'acc-berchet',
        apartmentId: 'berchet',
        label: 'Conto',
        bankProfileId: 'bp',
        iban: 'IT85X0542811101000000000301',
      },
    ]);
    await put(store, 'transaction', [tx('x', '2027-02-10', -4000)]);
    await runOutgoing(store, 'p1', clock, ids('r0'));
    const op = operationOf(
      await confirmOutgoing(
        store,
        { proposalId: 'p-uscita-x', kind: 'altro', apartmentId: 'berchet', rememberRule: true },
        'p1',
        clock,
        ids('c'),
      ),
    );
    // The class of `x` is written by the same operation: not a blocker.
    expect(await undoBlockedBy(store, op)).toEqual([]);
    await put(store, 'transaction', [tx('y', '2028-02-10', -4200)]);
    await runOutgoing(store, 'p1', clock, ids('r'));
    expect(await undoBlockedBy(store, op)).toEqual(['mc-y']);
    expect(countByType(await undoDependents(store, op))).toEqual({ movementClass: 1 });
    // Once the class of `y` is undone, the confirmation can go.
    const { operations } = await import('../src/index').then((m) => m.readJournal(store));
    const reconcile = operations.at(-1);
    if (reconcile === undefined) throw new Error('no operation');
    await undoOperation(store, reconcile.id, 'p1', clock, ids('u'));
    expect(await undoBlockedBy(store, op)).toEqual([]);
    expect(
      (await loadAll(store, 'movementClass', MovementClassSchema)).records.map((c) => c.id),
    ).toEqual(['mc-x']);
  });
});
