/**
 * Writing «Tasse e stime» (plan 10): the start-of-year estimate typed by user1 (`setTaxEstimate`),
 * the copy of the year before on an explicit command (`copyPreviousTaxYear`), and a «tasse» debit
 * assigned to cedolare or registro (`assignTaxPayment`). Each write is one operation of the
 * journal, nothing written while `checkConsistency` reports a problem (R113), nothing for the
 * same request on the same state, no amount or name in a summary.
 */
import { checkConsistency, commitChange } from './journal';
import {
  ApartmentSchema,
  BankTransactionSchema,
  MovementClassSchema,
  TaxEstimateSchema,
  TaxPaymentSchema,
  TaxVoiceSchema,
  YearSchema,
} from './model';
import type { TaxPayment, TaxVoice } from './model';
import type { Cents } from './money';
import { parseOrThrow } from './parse';
import { loadAll } from './store/load';
import { recordPath } from './store/records';
import type { Store } from './store/store';

export interface SetTaxEstimateInput {
  apartmentId: string;
  year: string;
  voce: TaxVoice;
  amount: Cents;
}

export type SetTaxEstimateResult =
  | { status: 'saved'; operationId: string; estimateId: string }
  | { status: 'unchanged'; estimateId: string }
  | {
      status: 'refused';
      reason: 'inconsistent-store' | 'unknown-apartment' | 'bad-year' | 'bad-voce' | 'bad-amount';
    };

const liveApartment = async (store: Store, id: string): Promise<boolean> =>
  (await loadAll(store, 'apartment', ApartmentSchema)).records.some((a) => a.id === id);

const withDeleted = { includeDeleted: true };

/**
 * Creates or updates `tax-<apartmentId>-<year>-<voce>` (a new `rev`; a deleted one comes back) in
 * one `tax.estimate` operation (R211). Refused without writing, in this order:
 * `inconsistent-store`; `unknown-apartment` (absent or deleted); `bad-year` (not `AAAA`);
 * `bad-voce`; `bad-amount` (not a whole number of cents ≥ 0). The same amount is `unchanged`.
 */
export async function setTaxEstimate(
  store: Store,
  input: SetTaxEstimateInput,
  profileId: string,
  clock: () => string,
  newId: () => string,
): Promise<SetTaxEstimateResult> {
  const refuse = (reason: Extract<SetTaxEstimateResult, { status: 'refused' }>['reason']) =>
    ({ status: 'refused', reason }) as const;
  if ((await checkConsistency(store)).length > 0) return refuse('inconsistent-store');
  if (!(await liveApartment(store, input.apartmentId))) return refuse('unknown-apartment');
  if (!YearSchema.safeParse(input.year).success) return refuse('bad-year');
  if (!TaxVoiceSchema.safeParse(input.voce).success) return refuse('bad-voce');
  if (!Number.isSafeInteger(input.amount) || input.amount < 0) return refuse('bad-amount');
  const id = `tax-${input.apartmentId}-${input.year}-${input.voce}`;
  const before = (await loadAll(store, 'taxEstimate', TaxEstimateSchema, withDeleted)).records.find(
    (e) => e.id === id,
  );
  const record = (rev: number) =>
    parseOrThrow(TaxEstimateSchema, { id, v: 1, rev, ...input }, 'taxEstimate');
  if (
    before !== undefined &&
    before.deleted !== true &&
    JSON.stringify(record(before.rev)) === JSON.stringify(before)
  ) {
    return { status: 'unchanged', estimateId: id };
  }
  const operation = await commitChange(
    store,
    {
      profileId,
      kind: 'tax.estimate',
      apartmentId: input.apartmentId,
      summary: 'Aggiornata una stima delle tasse.',
      changes: [
        {
          path: recordPath('taxEstimate', id),
          before,
          after: record((before?.rev ?? 0) + 1),
        },
      ],
    },
    clock,
    newId,
  );
  return { status: 'saved', operationId: operation.id, estimateId: id };
}

export type CopyPreviousTaxYearResult =
  | { status: 'copied'; operationId: string; estimateIds: string[] }
  | {
      status: 'refused';
      reason:
        | 'inconsistent-store'
        | 'bad-year'
        | 'unknown-apartment'
        | 'year-not-empty'
        | 'nothing-to-copy';
    };

/**
 * Copies into `year` the live estimates of `year − 1` of `apartmentId`, or of every live apartment,
 * in one `tax.copy` operation (section 34: proposed, never automatic; R211). Refused without
 * writing: `inconsistent-store`; `bad-year` (not `AAAA`, or `0000`); `unknown-apartment`;
 * `year-not-empty` (one of those apartments already has a live estimate in `year`: nothing is
 * ever overwritten); `nothing-to-copy`. A copied record deleted by an undo comes back with a new
 * `rev`.
 */
export async function copyPreviousTaxYear(
  store: Store,
  input: { year: string; apartmentId?: string },
  profileId: string,
  clock: () => string,
  newId: () => string,
): Promise<CopyPreviousTaxYearResult> {
  const refuse = (reason: Extract<CopyPreviousTaxYearResult, { status: 'refused' }>['reason']) =>
    ({ status: 'refused', reason }) as const;
  if ((await checkConsistency(store)).length > 0) return refuse('inconsistent-store');
  if (!YearSchema.safeParse(input.year).success || input.year === '0000') {
    return refuse('bad-year');
  }
  const apartments = (await loadAll(store, 'apartment', ApartmentSchema)).records.map((a) => a.id);
  if (input.apartmentId !== undefined && !apartments.includes(input.apartmentId)) {
    return refuse('unknown-apartment');
  }
  const targets = new Set(input.apartmentId === undefined ? apartments : [input.apartmentId]);
  const previous = String(Number(input.year) - 1).padStart(4, '0');
  const all = (await loadAll(store, 'taxEstimate', TaxEstimateSchema, withDeleted)).records;
  const live = all.filter((e) => e.deleted !== true && targets.has(e.apartmentId));
  if (live.some((e) => e.year === input.year)) return refuse('year-not-empty');
  const sources = live.filter((e) => e.year === previous).sort((a, b) => (a.id < b.id ? -1 : 1));
  if (sources.length === 0) return refuse('nothing-to-copy');
  const changes = sources.map((source) => {
    const id = `tax-${source.apartmentId}-${input.year}-${source.voce}`;
    const before = all.find((e) => e.id === id);
    const after = parseOrThrow(
      TaxEstimateSchema,
      { ...source, id, year: input.year, rev: (before?.rev ?? 0) + 1 },
      'taxEstimate',
    );
    return { path: recordPath('taxEstimate', id), before, after };
  });
  const operation = await commitChange(
    store,
    {
      profileId,
      kind: 'tax.copy',
      ...(input.apartmentId === undefined ? {} : { apartmentId: input.apartmentId }),
      summary: 'Copiate le stime dell’anno prima.',
      changes,
    },
    clock,
    newId,
  );
  return {
    status: 'copied',
    operationId: operation.id,
    estimateIds: changes.map((c) => c.after.id),
  };
}

export interface AssignTaxPaymentInput {
  transactionId: string;
  parts: TaxPayment['parts'];
}

export type AssignTaxPaymentResult =
  | { status: 'assigned'; operationId: string; taxPaymentId: string }
  | { status: 'unchanged'; taxPaymentId: string }
  | {
      status: 'refused';
      reason:
        | 'inconsistent-store'
        | 'bad-parts'
        | 'unknown-transaction'
        | 'not-tax-debit'
        | 'imu-assigned'
        | 'sum-mismatch';
    };

/**
 * Writes `taxp-<transactionId>` (a new `rev` over a live or deleted one) in one `tax.assign`
 * operation (R211). Refused without writing, in this order: `inconsistent-store`; `bad-parts`
 * (the schema refuses them: none, a voce other than cedolare or registro, a year not `AAAA`, an
 * amount not positive, a voce and year twice); `unknown-transaction` (absent or deleted);
 * `not-tax-debit` (not booked, not a debit, or its live class is not `tasse` for an apartment);
 * `imu-assigned` (the class pays an IMU rate, R134: question 8); `sum-mismatch` (the parts do not
 * add up to the debit, R2). The same parts are `unchanged`.
 */
export async function assignTaxPayment(
  store: Store,
  input: AssignTaxPaymentInput,
  profileId: string,
  clock: () => string,
  newId: () => string,
): Promise<AssignTaxPaymentResult> {
  const refuse = (reason: Extract<AssignTaxPaymentResult, { status: 'refused' }>['reason']) =>
    ({ status: 'refused', reason }) as const;
  if ((await checkConsistency(store)).length > 0) return refuse('inconsistent-store');
  const id = `taxp-${input.transactionId}`;
  const parsed = TaxPaymentSchema.safeParse({ id, v: 1, rev: 1, ...input });
  if (!parsed.success) return refuse('bad-parts');
  const tx = (await loadAll(store, 'transaction', BankTransactionSchema)).records.find(
    (t) => t.id === input.transactionId,
  );
  if (tx === undefined) return refuse('unknown-transaction');
  const cls = (await loadAll(store, 'movementClass', MovementClassSchema)).records.find(
    (c) => c.transactionId === tx.id,
  );
  if (tx.booked === false || tx.amount >= 0 || cls?.kind !== 'tasse') {
    return refuse('not-tax-debit');
  }
  if (cls.imu !== undefined) return refuse('imu-assigned');
  if (parsed.data.parts.reduce((sum, p) => sum + p.amount, 0) !== -tx.amount) {
    return refuse('sum-mismatch');
  }
  const before = (await loadAll(store, 'taxPayment', TaxPaymentSchema, withDeleted)).records.find(
    (p) => p.id === id,
  );
  const after = { ...parsed.data, rev: (before?.rev ?? 0) + 1 };
  if (
    before !== undefined &&
    before.deleted !== true &&
    JSON.stringify({ ...after, rev: before.rev }) === JSON.stringify(before)
  ) {
    return { status: 'unchanged', taxPaymentId: id };
  }
  const operation = await commitChange(
    store,
    {
      profileId,
      kind: 'tax.assign',
      ...(cls.apartmentId === undefined ? {} : { apartmentId: cls.apartmentId }),
      summary: 'Assegnato un movimento a una tassa.',
      changes: [{ path: recordPath('taxPayment', id), before, after }],
    },
    clock,
    newId,
  );
  return { status: 'assigned', operationId: operation.id, taxPaymentId: id };
}
