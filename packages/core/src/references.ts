/**
 * The references between records (review of 18 Nov 2026, «annullo», U1 and U6): which record
 * points at which by id. One table, read in one pass over the live records, gives both the live
 * records that depend on a record (`recordDependents`, for the guards of undo and of the writes)
 * and the live records that point at a record that is missing or deleted (`referenceProblems`).
 * Only ids are compared: never a name or an amount, and the problems carry kinds and ids only.
 */
import type { ZodType, z } from 'zod';
import { recordSchemas } from './model';
import type { RecordKind } from './model';
import { loadAll } from './store/load';
import { recordPath } from './store/records';
import type { Problem, Store } from './store/store';
import { compareText } from './text';

/** A record named by its kind and id. */
export interface RecordRef {
  type: RecordKind;
  id: string;
}

/** One id a record holds in `field`, pointing at a record of one of the kinds `to`. */
interface Pointer {
  field: string;
  to: readonly RecordKind[];
  id: string;
}

type Of<K extends RecordKind> = z.infer<(typeof recordSchemas)[K]>;

const at = (field: string, to: RecordKind | readonly RecordKind[], ids: (string | undefined)[]) =>
  ids.flatMap((id): Pointer[] =>
    id === undefined ? [] : [{ field, to: typeof to === 'string' ? [to] : to, id }],
  );

/**
 * The matrix of the review: for each kind, the ids its records hold. Kinds absent here point at
 * nothing (`user`, `tenant`, `bankProfile`, `supplierProfile`, `legalRate`, `apartment`).
 * `payment.tenantId` names a tenant, not a stay: whether a stay covers it is `tenancyUndoBlockers`.
 */
const POINTERS: { [K in RecordKind]?: (r: Of<K>) => Pointer[] } = {
  contract: (r) => [
    ...at('apartmentId', 'apartment', [r.apartmentId]),
    ...at('tenancyIds', 'tenancy', r.tenancyIds ?? []),
    ...at('depositPaymentIds', 'payment', r.depositPaymentIds ?? []),
    ...at(
      'takeovers',
      'tenancy',
      (r.takeovers ?? []).flatMap((t) => [t.outTenancyId, t.inTenancyId]),
    ),
  ],
  tenancy: (r) => [
    ...at('apartmentId', 'apartment', [r.apartmentId]),
    ...at('tenantId', 'tenant', [r.tenantId]),
  ],
  supply: (r) =>
    at(
      'apartments',
      'apartment',
      r.apartments.map((a) => a.apartmentId),
    ),
  bill: (r) => at('apartmentId', 'apartment', [r.apartmentId]),
  payment: (r) => [
    ...at('apartmentId', 'apartment', [r.apartmentId]),
    ...at('tenantId', 'tenant', [r.tenantId]),
    ...at('transactionId', 'transaction', [r.transactionId]),
  ],
  transaction: (r) => [
    ...at('apartmentId', 'apartment', [r.apartmentId]),
    ...at('accountId', 'account', [r.accountId]),
  ],
  instalment: (r) => [
    ...at('apartmentId', 'apartment', [r.apartmentId, r.paidFromApartmentId]),
    ...at('supplyId', 'supply', [r.supplyId]),
  ],
  match: (r) => [
    // An `assumed` match has no movement: its `transactionId` is `assumed-<itemId>` (R2).
    ...at('transactionId', 'transaction', [r.by === 'assumed' ? undefined : r.transactionId]),
    ...at('itemId', r.itemType, [r.itemId]),
  ],
  note: (r) => at('targetId', r.targetType, [r.targetId]),
  account: (r) => [
    ...at('apartmentId', 'apartment', [r.apartmentId]),
    ...at('bankProfileId', 'bankProfile', [r.bankProfileId]),
  ],
  statement: (r) => [
    ...at('accountId', 'account', [r.accountId]),
    ...at('bankProfileId', 'bankProfile', [r.bankProfileId]),
    ...at('transactionIds', 'transaction', r.transactionIds),
  ],
  payer: (r) => at('tenantId', 'tenant', [r.tenantId]),
  tenantCard: (r) => at('id', 'tenant', [r.id]),
  movementClass: (r) => [
    ...at('transactionId', 'transaction', [r.transactionId]),
    ...at('apartmentId', 'apartment', [r.apartmentId]),
    ...at('ruleId', 'movementRule', [r.ruleId]),
  ],
  movementRule: (r) => [
    ...at('accountId', 'account', [r.accountId]),
    ...at('apartmentId', 'apartment', [r.apartmentId]),
  ],
  transfer: (r) => [
    ...at('accountId', 'account', [r.fromAccountId, r.toAccountId]),
    ...at('transactionId', 'transaction', [r.outTransactionId, r.inTransactionId]),
  ],
  imuYear: (r) => at('apartmentId', 'apartment', [r.apartmentId]),
  rentYear: (r) => at('apartmentId', 'apartment', [r.apartmentId]),
  imuRule: (r) => at('accountId', 'account', [r.accountId]),
  payable: (r) => [
    ...at('apartmentId', 'apartment', [r.apartmentId]),
    ...at('previousId', 'payable', [r.previousId]),
    ...at('paid.transactionId', 'transaction', [r.paid?.transactionId]),
  ],
  pendingDocument: (r) => at('apartmentId', 'apartment', [r.apartmentId]),
  condoDocument: (r) => at('apartmentId', 'apartment', [r.apartmentId]),
  tenantRecovery: (r) => [
    ...at('apartmentId', 'apartment', [r.apartmentId]),
    ...at('instalmentId', 'instalment', [r.instalmentId]),
    ...at('transactionId', 'transaction', [r.transactionId]),
    ...at(
      'shares.tenantId',
      'tenant',
      r.shares.map((s) => s.tenantId),
    ),
  ],
  taxEstimate: (r) => at('apartmentId', 'apartment', [r.apartmentId]),
  taxPayment: (r) => at('transactionId', 'transaction', [r.transactionId]),
  contact: (r) => [
    ...at('apartmentIds', 'apartment', r.apartmentIds),
    ...at('supplyIds', 'supply', r.supplyIds ?? []),
  ],
  taxConfirmation: (r) => at('apartmentId', 'apartment', [r.apartmentId]),
  consumptionSettings: (r) => at('apartmentId', 'apartment', [r.apartmentId]),
};

/**
 * Pointers `referenceProblems` does not report yet, because some write still leaves them
 * dangling and blocking every write on them would freeze the folder (see «Arretrato» in
 * docs/revisione-2026-11-18-annullo.md): a note on a deleted record (U11), the supply of an
 * instalment or contact (U10, `removeSupply`). `recordDependents` still lists the supplies.
 */
const NOT_CHECKED = new Set(['note.targetId', 'instalment.supplyId', 'contact.supplyIds']);

const KINDS = Object.entries(recordSchemas) as [RecordKind, ZodType<{ id: string }>][];

interface Pointing {
  from: RecordRef;
  field: string;
  to: readonly RecordKind[];
  id: string;
}

/**
 * One pass over the live records: every pointer they hold, and the ids of the records that are
 * live (or that cannot be read: a broken or newer file is reported by `loadAll`, not here).
 */
async function scan(store: Store): Promise<{ pointing: Pointing[]; present: Set<string> }> {
  const pointing: Pointing[] = [];
  const present = new Set<string>();
  for (const [kind, schema] of KINDS) {
    const { records, problems } = await loadAll(store, kind, schema);
    const of = POINTERS[kind] as ((r: unknown) => Pointer[]) | undefined;
    for (const record of records) {
      present.add(`${kind}/${record.id}`);
      for (const p of of?.(record) ?? []) {
        pointing.push({ from: { type: kind, id: record.id }, ...p });
      }
    }
    // A file that is there but not loaded: its id is its name.
    for (const { path } of problems) {
      const name = path.slice(path.lastIndexOf('/') + 1);
      if (name.endsWith('.json')) present.add(`${kind}/${name.slice(0, -5)}`);
    }
  }
  return { pointing, present };
}

const byRef = (a: RecordRef, b: RecordRef) =>
  compareText(a.type, b.type) || compareText(a.id, b.id);

/**
 * The live records that point at one of `targets` (the undo or removal of a target would leave
 * them dangling), each once, sorted by kind then id. Records that are themselves targets are left
 * out, and so are notes: a note on a record that is gone harms nothing (U11), so a note never
 * blocks a write or an undo (one rule for every guard).
 */
export async function recordDependents(
  store: Store,
  targets: readonly RecordRef[],
): Promise<RecordRef[]> {
  if (targets.length === 0) return [];
  const wanted = new Set(targets.map((t) => `${t.type}/${t.id}`));
  const found = new Map<string, RecordRef>();
  for (const p of (await scan(store)).pointing) {
    const key = `${p.from.type}/${p.from.id}`;
    if (
      p.from.type !== 'note' &&
      !wanted.has(key) &&
      p.to.some((kind) => wanted.has(`${kind}/${p.id}`))
    ) {
      found.set(key, p.from);
    }
  }
  return [...found.values()].sort(byRef);
}

/** How many of `refs` there are of each kind, for a message («3 presenze, 1 contratto»). */
export function countByType(refs: readonly RecordRef[]): Partial<Record<RecordKind, number>> {
  const counts: Partial<Record<RecordKind, number>> = {};
  for (const { type } of refs) counts[type] = (counts[type] ?? 0) + 1;
  return counts;
}

/** A live record pointing at a record that is missing or deleted. */
export type ReferenceProblem = Problem & {
  reason: 'dangling-reference';
  /** The record holding the reference. */
  from: RecordRef;
  field: string;
  /** The record it points at. */
  to: RecordRef;
};

/**
 * Every live record that points at a record that is not live (missing or `deleted`), as
 * `dangling-reference` on the path of the record holding it, sorted by path then field. Deleted
 * records are never checked: they may point at anything. Read only.
 */
export async function referenceProblems(store: Store): Promise<ReferenceProblem[]> {
  const { pointing, present } = await scan(store);
  return pointing
    .filter(
      (p) =>
        !NOT_CHECKED.has(`${p.from.type}.${p.field}`) &&
        !p.to.some((kind) => present.has(`${kind}/${p.id}`)),
    )
    .map((p) => ({
      path: recordPath(p.from.type, p.from.id),
      reason: 'dangling-reference' as const,
      from: p.from,
      field: p.field,
      to: { type: p.to[0] ?? p.from.type, id: p.id },
    }))
    .sort((a, b) => compareText(a.path, b.path) || compareText(a.field, b.field));
}
