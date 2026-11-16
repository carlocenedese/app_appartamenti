/**
 * Writing and reading the condominium records (plan 8): the documents of an apartment and fiscal
 * year (`saveCondoDocument`), the recoveries from tenants (`saveTenantRecovery`) and the owners'
 * check (`loadCondo`). Each write one operation of the journal, nothing written while
 * `checkConsistency` reports a problem, nothing for the same request on the same state. No amount
 * or name in a summary.
 */
import { condoCheck, condoDifferences, condoEstimate, freeDebits } from './condominio';
import type { CondoCheckRow, CondoDifference, CondoEstimate, FreeDebit } from './condominio';
import type { ZodType } from 'zod';
import { checkConsistency, commitChange } from './journal';
import { planMatch } from './match-store';
import { expectedDebit } from './match';
import {
  AccountSchema,
  ApartmentSchema,
  BankTransactionSchema,
  BillMatchSchema,
  MovementClassSchema,
  PaymentSchema,
  TransferSchema,
  CondoDocumentSchema,
  InstalmentSchema,
  TenancySchema,
  TenantRecoverySchema,
} from './model';
import type { BillMatch, CondoDocument, TenantRecovery } from './model';
import type { ISODate } from './period';
import { loadAll } from './store/load';
import { recordPath } from './store/records';
import type { Store } from './store/store';
import { compareText } from './text';

export type SaveCondoDocumentInput = Omit<CondoDocument, 'id' | 'v' | 'rev' | 'deleted'>;

export type SaveCondoDocumentResult =
  | { status: 'saved'; operationId: string; documentId: string }
  | { status: 'unchanged'; documentId: string }
  | {
      status: 'refused';
      reason: 'inconsistent-store' | 'unknown-apartment' | 'invalid-document' | 'id-collision';
    };

/**
 * Creates or replaces `condoc-<apartmentId>-<esercizio>-<kind>` (a new `rev`; a deleted one comes
 * back) in one `condo.document` operation. Refused: the apartment is not live, the schema refuses
 * the document or the fiscal year is not a safe file name part (`invalid-document`).
 */
export async function saveCondoDocument(
  store: Store,
  input: SaveCondoDocumentInput,
  profileId: string,
  clock: () => string,
  newId: () => string,
): Promise<SaveCondoDocumentResult> {
  const refuse = (reason: Extract<SaveCondoDocumentResult, { status: 'refused' }>['reason']) =>
    ({ status: 'refused', reason }) as const;
  if ((await checkConsistency(store)).length > 0) return refuse('inconsistent-store');
  const apartments = (await loadAll(store, 'apartment', ApartmentSchema)).records;
  if (!apartments.some((a) => a.id === input.apartmentId)) return refuse('unknown-apartment');
  // The fiscal year is part of the id, hence of a file name.
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(input.esercizio)) return refuse('invalid-document');
  const id = `condoc-${input.apartmentId}-${input.esercizio}-${input.kind}`;
  const docs = (
    await loadAll(store, 'condoDocument', CondoDocumentSchema, { includeDeleted: true })
  ).records;
  const before = docs.find((d) => d.id === id);
  // `a` + `b-c` and `a-b` + `c` give the same id: never write over another apartment's document.
  if (
    before !== undefined &&
    (before.apartmentId !== input.apartmentId ||
      before.esercizio !== input.esercizio ||
      before.kind !== input.kind)
  ) {
    return refuse('id-collision');
  }
  const record = (rev: number) => CondoDocumentSchema.safeParse({ ...input, id, v: 1, rev });
  const parsed = record((before?.rev ?? 0) + 1);
  if (!parsed.success) return refuse('invalid-document');
  if (
    before !== undefined &&
    before.deleted !== true &&
    JSON.stringify(record(before.rev).data) === JSON.stringify(before)
  ) {
    return { status: 'unchanged', documentId: id };
  }
  const operation = await commitChange(
    store,
    {
      profileId,
      kind: 'condo.document',
      apartmentId: input.apartmentId,
      summary: 'Documento del condominio salvato.',
      changes: [{ path: recordPath('condoDocument', id), before, after: parsed.data }],
    },
    clock,
    newId,
  );
  return { status: 'saved', operationId: operation.id, documentId: id };
}

export type LoadCondoResult =
  | {
      status: 'computed';
      rates: CondoCheckRow[];
      differences: CondoDifference[];
      /** The live recoveries on the instalments read, sorted by id. */
      recoveries: TenantRecovery[];
      /**
       * Instalments whose live recoveries now add up to more than the expense (it was edited down
       * after them): a warning only, nothing is capped (R198).
       */
      warnings: { code: 'recovery-above-expense'; instalmentId: string }[];
    }
  | { status: 'refused'; reason: 'inconsistent-store' };

/**
 * The owners' check on `query.asOf` and the differences of the documents, for one apartment and
 * fiscal year when given; the matches are the saved ones plus the assumed ones of `planMatch`
 * (R2, as the Excel). Writes nothing; refused while `checkConsistency` reports a problem.
 */
export async function loadCondo(
  store: Store,
  query: { asOf: ISODate; apartmentId?: string; esercizio?: string },
): Promise<LoadCondoResult> {
  if ((await checkConsistency(store)).length > 0) {
    return { status: 'refused', reason: 'inconsistent-store' };
  }
  const wanted = (r: { apartmentId: string; esercizio: string }) =>
    (query.apartmentId === undefined || r.apartmentId === query.apartmentId) &&
    (query.esercizio === undefined || r.esercizio === query.esercizio);
  const instalments = (await loadAll(store, 'instalment', InstalmentSchema)).records.filter(wanted);
  const ids = new Set(instalments.map((i) => i.id));
  const recoveries = (await loadAll(store, 'tenantRecovery', TenantRecoverySchema)).records
    .filter((r) => ids.has(r.instalmentId))
    .sort((a, b) => compareText(a.id, b.id));
  const matches = [
    ...(await loadAll(store, 'match', BillMatchSchema)).records,
    ...(await planMatch(store)).assumedMatches,
  ];
  const documents = (await loadAll(store, 'condoDocument', CondoDocumentSchema)).records.filter(
    wanted,
  );
  const apartments = (await loadAll(store, 'apartment', ApartmentSchema)).records;
  const warnings = instalments
    .filter(
      (i) =>
        recoveries.filter((r) => r.instalmentId === i.id).reduce((sum, r) => sum + r.amount, 0) >
        expectedDebit(i),
    )
    .map((i) => ({ code: 'recovery-above-expense' as const, instalmentId: i.id }))
    .sort((a, b) => compareText(a.instalmentId, b.instalmentId));
  return {
    status: 'computed',
    rates: condoCheck({
      instalments,
      matches,
      asOf: query.asOf,
      free: await loadFreeDebits(store, matches),
    }),
    differences: condoDifferences(apartments, documents),
    recoveries,
    warnings,
  };
}

export type LoadCondoEstimateResult =
  | { status: 'computed'; estimate?: CondoEstimate }
  | { status: 'refused'; reason: 'inconsistent-store' | 'unknown-apartment' };

/** `condoEstimate` on the live documents of the store (plan 14, R250). Writes nothing. */
export async function loadCondoEstimate(
  store: Store,
  query: { apartmentId: string; esercizio: string },
): Promise<LoadCondoEstimateResult> {
  if ((await checkConsistency(store)).length > 0) {
    return { status: 'refused', reason: 'inconsistent-store' };
  }
  const apartments = (await loadAll(store, 'apartment', ApartmentSchema)).records;
  if (!apartments.some((a) => a.id === query.apartmentId)) {
    return { status: 'refused', reason: 'unknown-apartment' };
  }
  const documents = (await loadAll(store, 'condoDocument', CondoDocumentSchema)).records;
  const estimate = condoEstimate(documents, query.apartmentId, query.esercizio);
  return { status: 'computed', ...(estimate === undefined ? {} : { estimate }) };
}

/** `freeDebits` on the live records of the store, with `matches` (saved and assumed). */
export async function loadFreeDebits(store: Store, matches: BillMatch[]): Promise<FreeDebit[]> {
  const records = async <T extends { id: string }>(kind: string, schema: ZodType<T>) =>
    (await loadAll(store, kind, schema)).records;
  return freeDebits({
    // Deleted accounts too: the money did move (as `accountBalances`).
    accounts: (await loadAll(store, 'account', AccountSchema, { includeDeleted: true })).records,
    transactions: await records('transaction', BankTransactionSchema),
    classes: await records('movementClass', MovementClassSchema),
    payments: await records('payment', PaymentSchema),
    matches,
    transfers: await records('transfer', TransferSchema),
  });
}

export type SaveTenantRecoveryInput = Omit<TenantRecovery, 'v' | 'rev' | 'deleted'>;

export type SaveTenantRecoveryResult =
  | { status: 'saved'; operationId: string; recoveryId: string }
  | { status: 'unchanged'; recoveryId: string }
  | {
      status: 'refused';
      reason:
        | 'inconsistent-store'
        | 'unknown-apartment'
        | 'not-extraordinary'
        | 'amount-too-high'
        | 'bad-shares'
        | 'invalid-recovery';
    };

/**
 * Creates or replaces a recovery (plan 8, group B, R196) in one `recovery.save` operation.
 * Refused without writing, in this order: `inconsistent-store`; `invalid-recovery` (an id that is
 * not a safe file name part, or a status the schema refuses); `unknown-apartment`;
 * `not-extraordinary` (the instalment is not a live extraordinary condominium instalment of the
 * apartment); `bad-shares` (a tenant twice or without a live tenancy in the apartment, a share
 * not positive, shares that do not add up to the amount); `amount-too-high` (with the other live
 * recoveries of the same instalment, above its expected debit: never more than the expense).
 */
export async function saveTenantRecovery(
  store: Store,
  input: SaveTenantRecoveryInput,
  profileId: string,
  clock: () => string,
  newId: () => string,
): Promise<SaveTenantRecoveryResult> {
  const refuse = (reason: Extract<SaveTenantRecoveryResult, { status: 'refused' }>['reason']) =>
    ({ status: 'refused', reason }) as const;
  if ((await checkConsistency(store)).length > 0) return refuse('inconsistent-store');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(input.id)) return refuse('invalid-recovery');
  const apartments = (await loadAll(store, 'apartment', ApartmentSchema)).records;
  if (!apartments.some((a) => a.id === input.apartmentId)) return refuse('unknown-apartment');
  const instalment = (await loadAll(store, 'instalment', InstalmentSchema)).records.find(
    (i) => i.id === input.instalmentId,
  );
  if (
    instalment === undefined ||
    instalment.apartmentId !== input.apartmentId ||
    instalment.kind !== 'condominio' ||
    instalment.straordinaria !== true
  ) {
    return refuse('not-extraordinary');
  }
  const tenants = new Set(
    (await loadAll(store, 'tenancy', TenancySchema)).records
      .filter((t) => t.apartmentId === input.apartmentId)
      .map((t) => t.tenantId),
  );
  const all = (
    await loadAll(store, 'tenantRecovery', TenantRecoverySchema, { includeDeleted: true })
  ).records;
  const before = all.find((r) => r.id === input.id);
  const record = (rev: number) => TenantRecoverySchema.safeParse({ ...input, v: 1, rev });
  const parsed = record((before?.rev ?? 0) + 1);
  if (!parsed.success) {
    const shapeOk = TenantRecoverySchema.safeParse({
      ...input,
      v: 1,
      rev: 1,
      shares: [{ tenantId: 'x', amount: input.amount }],
    }).success;
    return refuse(shapeOk ? 'bad-shares' : 'invalid-recovery');
  }
  if (input.shares.some((s) => !tenants.has(s.tenantId))) return refuse('bad-shares');
  const others = all
    .filter((r) => r.id !== input.id && r.deleted !== true && r.instalmentId === input.instalmentId)
    .reduce((sum, r) => sum + r.amount, 0);
  if (others + input.amount > expectedDebit(instalment)) return refuse('amount-too-high');
  if (
    before !== undefined &&
    before.deleted !== true &&
    JSON.stringify(record(before.rev).data) === JSON.stringify(before)
  ) {
    return { status: 'unchanged', recoveryId: input.id };
  }
  const operation = await commitChange(
    store,
    {
      profileId,
      kind: 'recovery.save',
      apartmentId: input.apartmentId,
      summary: 'Recupero da un inquilino salvato.',
      changes: [{ path: recordPath('tenantRecovery', input.id), before, after: parsed.data }],
    },
    clock,
    newId,
  );
  return { status: 'saved', operationId: operation.id, recoveryId: input.id };
}
