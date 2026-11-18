/**
 * Writing and reading the condominium records (plan 8): the documents of an apartment and fiscal
 * year (`saveCondoDocument`), the recoveries from tenants (`saveTenantRecovery`) and the owners'
 * check (`loadCondo`). Each write one operation of the journal, nothing written while
 * `checkConsistency` reports a problem, nothing for the same request on the same state. No amount
 * or name in a summary.
 */
import {
  condoCheck,
  condoDifferences,
  condoEstimate,
  esercizioForm,
  freeDebits,
} from './condominio';
import type { CondoCheckRow, CondoDifference, CondoEstimate, FreeDebit } from './condominio';
import type { ZodType } from 'zod';
import { commitChange, writesBlocked } from './journal';
import { expectedDebit } from './match';
import { planMatch } from './match-store';
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
import type { BillMatch, CondoDocument, Instalment, TenantRecovery } from './model';
import type { ISODate, YearMonth } from './period';
import { annualitaRange, rateCoverage } from './period';
import { recordDependents } from './references';
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
    }
  /** The documents of the apartment with the other form (R310): the ones to correct, or this. */
  | { status: 'refused'; reason: 'esercizio-format'; documentIds: string[] };

/**
 * Creates or replaces `condoc-<apartmentId>-<esercizio>-<kind>` (a new `rev`; a deleted one comes
 * back) in one `condo.document` operation. Refused: the apartment is not live, the schema refuses
 * the document or the fiscal year is not a safe file name part (`invalid-document`); a fiscal year
 * of another form than the other live documents of the apartment (`2026` beside `2025-26`): one
 * form per apartment (answer of user1, 17 November 2026, R310), `esercizio-format`.
 */
export async function saveCondoDocument(
  store: Store,
  input: SaveCondoDocumentInput,
  profileId: string,
  clock: () => string,
  newId: () => string,
): Promise<SaveCondoDocumentResult> {
  const refuse = (
    reason: Exclude<
      Extract<SaveCondoDocumentResult, { status: 'refused' }>['reason'],
      'esercizio-format'
    >,
  ) => ({ status: 'refused', reason }) as const;
  if (await writesBlocked(store)) return refuse('inconsistent-store');
  const apartments = (await loadAll(store, 'apartment', ApartmentSchema)).records;
  if (!apartments.some((a) => a.id === input.apartmentId)) return refuse('unknown-apartment');
  // The fiscal year is part of the id, hence of a file name.
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(input.esercizio)) return refuse('invalid-document');
  const id = `condoc-${input.apartmentId}-${input.esercizio}-${input.kind}`;
  const docs = (
    await loadAll(store, 'condoDocument', CondoDocumentSchema, { includeDeleted: true })
  ).records;
  const before = docs.find((d) => d.id === id);
  const otherForm = docs
    .filter(
      (d) =>
        d.deleted !== true &&
        d.apartmentId === input.apartmentId &&
        esercizioForm(d.esercizio) !== esercizioForm(input.esercizio),
    )
    .map((d) => d.id)
    .sort(compareText);
  if (otherForm.length > 0) {
    return { status: 'refused', reason: 'esercizio-format', documentIds: otherForm };
  }
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

export type SaveCondoInstalmentInput = Pick<
  Instalment,
  | 'id'
  | 'apartmentId'
  | 'esercizio'
  | 'rateIndex'
  | 'rateCount'
  | 'dueDate'
  | 'rata'
  | 'quotaProprieta'
  | 'conguaglioPrec'
  | 'straordinaria'
>;

export type SaveCondoInstalmentResult =
  | {
      status: 'saved';
      operationId: string;
      instalmentId: string;
      /**
       * I5: the live ordinary instalments of the esercizio do not share one owner share and one
       * number of rates (the settlement refuses them until they are corrected); ids only.
       */
      warnings?: { code: 'owner-share-differs'; instalmentIds: string[] }[];
    }
  | { status: 'unchanged'; instalmentId: string }
  | {
      status: 'refused';
      reason:
        | 'inconsistent-store'
        | 'unknown-apartment'
        | 'missing-condominio-start'
        | 'invalid-instalment'
        | 'id-collision';
    }
  | { status: 'refused'; reason: 'esercizio-format'; documentIds: string[] }
  /** The live records (matches, recoveries) that lean on the instalment as it is. */
  | { status: 'refused'; reason: 'instalment-in-use'; recordIds: string[] };

/**
 * Creates or replaces the condominium instalment `input.id` (review of 18 Nov 2026, I3, E4) in one
 * `condo.instalment` operation, undone with the reconciliation undo. The months it covers come
 * from the apartment's `condominioStart` (whole months: day 1, else `missing-condominio-start`)
 * and rate `rateIndex` of `rateCount` (R3: 12/n months in order); the esercizio is `YYYY-YY`
 * (`annualitaRange`) and of the same form as the apartment's other live condominium documents
 * and instalments (R310, `esercizio-format`). Refused: an id that is not a safe file name part or
 * a schema refusal (`invalid-instalment`), an id of a TARI or of another apartment
 * (`id-collision`), a change to an instalment with live matches or recoveries
 * (`instalment-in-use`: undo them first). The same request again is `unchanged`. A different
 * owner share or number of rates in the same esercizio is saved with a warning (I5): the
 * settlement refuses it (`owner-share-inconsistent`) until one of them is corrected.
 */
export async function saveCondoInstalment(
  store: Store,
  input: SaveCondoInstalmentInput,
  profileId: string,
  clock: () => string,
  newId: () => string,
): Promise<SaveCondoInstalmentResult> {
  type Plain = Extract<SaveCondoInstalmentResult, { status: 'refused'; reason: string }>['reason'];
  const refuse = (
    reason: Exclude<Plain, 'esercizio-format' | 'instalment-in-use'>,
  ): SaveCondoInstalmentResult => ({ status: 'refused', reason });
  if (await writesBlocked(store)) return refuse('inconsistent-store');
  const apartment = (await loadAll(store, 'apartment', ApartmentSchema)).records.find(
    (a) => a.id === input.apartmentId,
  );
  if (apartment === undefined) return refuse('unknown-apartment');
  const start = apartment.condominioStart;
  if (start === undefined || start.day !== 1) return refuse('missing-condominio-start');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(input.id)) return refuse('invalid-instalment');
  // The settlement splits only a `2026-27` fiscal year (`annualitaRange`): `2026` is another form.
  if (!/^[0-9]{4}-[0-9]{2}$/.test(input.esercizio)) {
    return { status: 'refused', reason: 'esercizio-format', documentIds: [] };
  }
  let covers: { from: YearMonth; to: YearMonth };
  try {
    const first = annualitaRange(input.esercizio, start).from.slice(0, 7) as YearMonth;
    covers = rateCoverage(first, input.rateCount, input.rateIndex);
  } catch {
    return refuse('invalid-instalment');
  }
  const all = (await loadAll(store, 'instalment', InstalmentSchema, { includeDeleted: true }))
    .records;
  const before = all.find((i) => i.id === input.id);
  if (
    before !== undefined &&
    (before.kind !== 'condominio' || before.apartmentId !== input.apartmentId)
  ) {
    return refuse('id-collision');
  }
  const docs = (await loadAll(store, 'condoDocument', CondoDocumentSchema)).records;
  const otherForm = [
    ...docs.filter((d) => d.apartmentId === input.apartmentId),
    ...all.filter(
      (i) =>
        i.deleted !== true &&
        i.id !== input.id &&
        i.kind === 'condominio' &&
        i.apartmentId === input.apartmentId,
    ),
  ]
    .filter((r) => esercizioForm(r.esercizio) !== esercizioForm(input.esercizio))
    .map((r) => r.id)
    .sort(compareText);
  if (otherForm.length > 0) {
    return { status: 'refused', reason: 'esercizio-format', documentIds: otherForm };
  }
  const record = (rev: number) =>
    InstalmentSchema.safeParse({
      ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)),
      kind: 'condominio',
      coversFrom: covers.from,
      coversTo: covers.to,
      v: 1,
      rev,
    });
  const parsed = record((before?.rev ?? 0) + 1);
  if (!parsed.success) return refuse('invalid-instalment');
  const live = before !== undefined && before.deleted !== true;
  if (live && JSON.stringify(record(before.rev).data) === JSON.stringify(before)) {
    return { status: 'unchanged', instalmentId: input.id };
  }
  if (live) {
    const users = await recordDependents(store, [{ type: 'instalment', id: input.id }]);
    if (users.length > 0) {
      return {
        status: 'refused',
        reason: 'instalment-in-use',
        recordIds: users.map((r) => r.id).sort(compareText),
      };
    }
  }
  const after = parsed.data;
  const ordinary = [
    after,
    ...all.filter(
      (i) =>
        i.deleted !== true &&
        i.id !== after.id &&
        i.kind === 'condominio' &&
        i.apartmentId === after.apartmentId &&
        i.esercizio === after.esercizio,
    ),
  ].filter((i) => i.straordinaria !== true && i.rata !== 0);
  const differs = new Set(ordinary.map((i) => `${i.quotaProprieta}/${i.rateCount}`)).size > 1;
  const operation = await commitChange(
    store,
    {
      profileId,
      kind: 'condo.instalment',
      apartmentId: input.apartmentId,
      summary: 'Rata del condominio salvata.',
      changes: [{ path: recordPath('instalment', input.id), before, after }],
    },
    clock,
    newId,
  );
  return {
    status: 'saved',
    operationId: operation.id,
    instalmentId: input.id,
    ...(differs
      ? {
          warnings: [
            {
              code: 'owner-share-differs' as const,
              instalmentIds: ordinary.map((i) => i.id).sort(compareText),
            },
          ],
        }
      : {}),
  };
}

export type LoadCondoResult =
  | {
      status: 'computed';
      rates: CondoCheckRow[];
      differences: CondoDifference[];
      /**
       * The live recoveries on the instalments read, and (without `esercizio`) those of the
       * apartment on a movement or on no expense; sorted by id.
       */
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
 * fiscal year when given; the matches are the saved ones (B1: never one taken as paid without
 * a statement, as the Excel). Writes nothing; refused while `checkConsistency` reports a problem.
 */
export async function loadCondo(
  store: Store,
  query: { asOf: ISODate; apartmentId?: string; esercizio?: string },
): Promise<LoadCondoResult> {
  if (await writesBlocked(store)) {
    return { status: 'refused', reason: 'inconsistent-store' };
  }
  const wanted = (r: { apartmentId: string; esercizio: string }) =>
    (query.apartmentId === undefined || r.apartmentId === query.apartmentId) &&
    (query.esercizio === undefined || r.esercizio === query.esercizio);
  const instalments = (await loadAll(store, 'instalment', InstalmentSchema)).records.filter(wanted);
  const ids = new Set(instalments.map((i) => i.id));
  const recoveries = (await loadAll(store, 'tenantRecovery', TenantRecoverySchema)).records
    // Plan 17: also those without an instalment (a movement, or none) of the apartment asked.
    .filter((r) =>
      r.instalmentId !== undefined
        ? ids.has(r.instalmentId)
        : query.esercizio === undefined &&
          (query.apartmentId === undefined || r.apartmentId === query.apartmentId),
    )
    .sort((a, b) => compareText(a.id, b.id));
  const matches = (await loadAll(store, 'match', BillMatchSchema)).records;
  const documents = (await loadAll(store, 'condoDocument', CondoDocumentSchema)).records.filter(
    wanted,
  );
  const apartments = (await loadAll(store, 'apartment', ApartmentSchema)).records;
  const warnings = instalments
    .filter(
      (i) =>
        recoveries
          .filter((r) => r.instalmentId === i.id && r.amount > 0)
          .reduce((sum, r) => sum + r.amount, 0) > expectedDebit(i),
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
      unverified: new Set((await planMatch(store)).run.unverified.map((r) => r.itemId)),
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
  if (await writesBlocked(store)) {
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

/** `freeDebits` on the live records of the store, with the saved `matches`. */
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
        | 'unknown-expense'
        | 'missing-date'
        | 'amount-too-high'
        | 'bad-shares'
        | 'invalid-recovery';
    };

/**
 * Creates or replaces a recovery (plan 8, group B, R196; plan 17, R300) in one `recovery.save`
 * operation. Refused without writing, in this order: `inconsistent-store`; `invalid-recovery` (an id
 * that is not a safe file name part, both an instalment and a movement, a positive amount without
 * either, a status the schema refuses); `unknown-apartment`; `not-extraordinary` (the instalment is
 * not a live extraordinary condominium instalment of the apartment); `unknown-expense` (the movement
 * is not a live booked outgoing movement classified to the apartment); `missing-date` (no expense, no
 * date and no period: it would never count); `bad-shares` (a tenant twice or without a live
 * tenancy in the apartment, a share zero or of the other sign, shares that do not add up);
 * `amount-too-high` (a positive recovery that, with the other live positive recoveries of the same
 * expense, goes above it). The date of a linked expense is written from it (due date, day of the
 * movement), whatever the input says.
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
  if (await writesBlocked(store)) return refuse('inconsistent-store');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(input.id)) return refuse('invalid-recovery');
  if (
    (input.instalmentId !== undefined && input.transactionId !== undefined) ||
    (input.amount > 0 && input.instalmentId === undefined && input.transactionId === undefined)
  ) {
    return refuse('invalid-recovery');
  }
  const apartments = (await loadAll(store, 'apartment', ApartmentSchema)).records;
  if (!apartments.some((a) => a.id === input.apartmentId)) return refuse('unknown-apartment');
  let expense: { amount: number; date: ISODate } | undefined;
  if (input.instalmentId !== undefined) {
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
    expense = { amount: expectedDebit(instalment), date: instalment.dueDate };
  } else if (input.transactionId !== undefined) {
    const transaction = (await loadAll(store, 'transaction', BankTransactionSchema)).records.find(
      (t) => t.id === input.transactionId,
    );
    const classified = (await loadAll(store, 'movementClass', MovementClassSchema)).records.some(
      (c) =>
        c.transactionId === input.transactionId &&
        c.kind !== 'escluso' &&
        c.apartmentId === input.apartmentId,
    );
    // A pending row is not paid yet (R2): never an expense to recover.
    if (
      transaction === undefined ||
      transaction.booked === false ||
      transaction.amount >= 0 ||
      !classified
    ) {
      return refuse('unknown-expense');
    }
    expense = { amount: -transaction.amount, date: transaction.date };
  } else if (input.date === undefined && input.periodLabel === undefined) {
    return refuse('missing-date');
  }
  const written = expense === undefined ? input : { ...input, date: expense.date };
  const tenants = new Set(
    (await loadAll(store, 'tenancy', TenancySchema)).records
      .filter((t) => t.apartmentId === input.apartmentId)
      .map((t) => t.tenantId),
  );
  const all = (
    await loadAll(store, 'tenantRecovery', TenantRecoverySchema, { includeDeleted: true })
  ).records;
  const before = all.find((r) => r.id === input.id);
  const record = (rev: number) => TenantRecoverySchema.safeParse({ ...written, v: 1, rev });
  const parsed = record((before?.rev ?? 0) + 1);
  if (!parsed.success) {
    const shapeOk = TenantRecoverySchema.safeParse({
      ...written,
      v: 1,
      rev: 1,
      shares: [{ tenantId: 'x', amount: input.amount }],
    }).success;
    return refuse(shapeOk ? 'bad-shares' : 'invalid-recovery');
  }
  if (input.shares.some((s) => !tenants.has(s.tenantId))) return refuse('bad-shares');
  const sameExpense = (r: TenantRecovery) =>
    input.instalmentId !== undefined
      ? r.instalmentId === input.instalmentId
      : r.transactionId === input.transactionId;
  const others = all
    .filter((r) => r.id !== input.id && r.deleted !== true && r.amount > 0 && sameExpense(r))
    .reduce((sum, r) => sum + r.amount, 0);
  if (expense !== undefined && input.amount > 0 && others + input.amount > expense.amount) {
    return refuse('amount-too-high');
  }
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

/** The live recoveries on these movements, sorted ids (plan 17, R300: they block an undo). */
export async function recoveriesUsing(
  store: Store,
  transactionIds: readonly string[],
): Promise<string[]> {
  return (await loadAll(store, 'tenantRecovery', TenantRecoverySchema)).records
    .filter((r) => r.transactionId !== undefined && transactionIds.includes(r.transactionId))
    .map((r) => r.id)
    .sort(compareText);
}
