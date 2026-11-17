/**
 * Writing «Tasse e stime» (plan 10): the start-of-year estimate typed by user1 (`setTaxEstimate`),
 * the copy of the year before on an explicit command (`copyPreviousTaxYear`), and a «tasse» debit
 * assigned to cedolare or registro (`assignTaxPayment`). Each write is one operation of the
 * journal, nothing written while `checkConsistency` reports a problem (R113), nothing for the
 * same request on the same state, no amount or name in a summary.
 */
import { checkConsistency, commitChange } from './journal';
import { payableExpectedItems } from './payables';
import { TAX_DISCREPANCY_TOLERANCE, taxTable, taxYearWarnings } from './taxes';
import type { TaxYearWarning, TaxpayerTable } from './taxes';
import {
  ApartmentSchema,
  BankTransactionSchema,
  BillMatchSchema,
  ContractSchema,
  ImuYearSchema,
  InstalmentSchema,
  MovementClassSchema,
  PayableSchema,
  RentYearSchema,
  TaxConfirmationSchema,
  TaxEstimateSchema,
  TaxPaymentSchema,
  TaxVoiceSchema,
  TenantRecoverySchema,
  YearSchema,
} from './model';
import type { Apartment, Contract, TaxPayment, TaxVoice } from './model';
import type { Cents } from './money';
import { parseOrThrow } from './parse';
import type { ISODate } from './period';
import { loadAll } from './store/load';
import { recordPath } from './store/records';
import type { Store } from './store/store';

/** The live `taxPayment`s on these movements, sorted ids (as `payablesUsing`, plan 9). */
export async function taxPaymentsUsing(
  store: Store,
  transactionIds: readonly string[],
): Promise<string[]> {
  return (await loadAll(store, 'taxPayment', TaxPaymentSchema)).records
    .filter((p) => transactionIds.includes(p.transactionId))
    .map((p) => p.id)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

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
  | { status: 'unchanged'; estimateIds: string[] }
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
 * ever overwritten); `nothing-to-copy`. Run again on the same state (the live estimates of `year`
 * of those apartments are exactly the copies) it is `unchanged`. A copied record deleted by an undo comes back with a new
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
  const sources = live.filter((e) => e.year === previous).sort((a, b) => (a.id < b.id ? -1 : 1));
  const present = live.filter((e) => e.year === input.year).sort((a, b) => (a.id < b.id ? -1 : 1));
  if (present.length > 0) {
    const key = (e: { apartmentId: string; voce: string; amount: number }) =>
      `${e.apartmentId}\u0000${e.voce}\u0000${String(e.amount)}`;
    const same =
      present.length === sources.length &&
      present.every((e, i) => sources[i] !== undefined && key(e) === key(sources[i]));
    return same
      ? { status: 'unchanged', estimateIds: present.map((e) => e.id) }
      : refuse('year-not-empty');
  }
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
        | 'sum-mismatch';
    };

/**
 * Writes `taxp-<transactionId>` (a new `rev` over a live or deleted one) in one `tax.assign`
 * operation (R211). Refused without writing, in this order: `inconsistent-store`; `bad-parts`
 * (the schema refuses them: none, a voce other than cedolare or registro, a year not `AAAA`, an
 * amount not positive, a voce and year twice); `unknown-transaction` (absent or deleted);
 * `not-tax-debit` (not booked, not a debit, or its live class is not `tasse` for an apartment);
 * `sum-mismatch` (the parts do not add up to the debit, R2; on an F24 that also pays an IMU rate,
 * R134, they must leave a positive IMU part: the F24 is split, answer of user1 of 17 November
 * 2026, R307). The same parts are `unchanged`.
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
  // By voce and year: the same parts in another order are the same assignment.
  const parts = [...input.parts].sort((a, b) =>
    a.voce !== b.voce ? (a.voce < b.voce ? -1 : 1) : a.year < b.year ? -1 : a.year > b.year ? 1 : 0,
  );
  const parsed = TaxPaymentSchema.safeParse({ id, v: 1, rev: 1, ...input, parts });
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
  const sum = parsed.data.parts.reduce((total, p) => total + p.amount, 0);
  if (cls.imu === undefined ? sum !== -tx.amount : sum >= -tx.amount) {
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

export type ConfirmTaxDiscrepancyResult =
  | { status: 'confirmed'; operationId: string; confirmationId: string }
  | { status: 'unchanged'; confirmationId: string }
  | {
      status: 'refused';
      reason: 'inconsistent-store' | 'bad-year' | 'bad-voce' | 'bad-note' | 'no-discrepancy';
    };

/**
 * Confirms with a note the discrepancy of the row `voce` of `year` of the taxpayer of
 * `apartmentId` (plan 17, R304): `taxc-<first apartment of the table>-<year>-<voce>` keeps the
 * difference of today, so a new difference warns again. One `tax.confirm` operation, undone with
 * the journal. Refused without writing: `inconsistent-store`; `bad-year`; `bad-voce`; `bad-note`
 * (empty); `no-discrepancy` (the row is not a discrepancy now, or the apartment is in no table).
 */
export async function confirmTaxDiscrepancy(
  store: Store,
  input: { apartmentId: string; year: string; voce: string; note: string },
  profileId: string,
  clock: () => string,
  newId: () => string,
): Promise<ConfirmTaxDiscrepancyResult> {
  const refuse = (reason: Extract<ConfirmTaxDiscrepancyResult, { status: 'refused' }>['reason']) =>
    ({ status: 'refused', reason }) as const;
  const table = await loadTaxTable(store, {
    year: input.year,
    today: `${input.year}-01-01` as ISODate,
  });
  if (table.status === 'refused') return refuse(table.reason);
  const voce = TaxVoiceSchema.safeParse(input.voce);
  if (!voce.success) return refuse('bad-voce');
  if (input.note.trim() === '') return refuse('bad-note');
  const own = table.tables.find((t) => t.apartmentIds.includes(input.apartmentId));
  const row = own?.rows.find((r) => r.voce === voce.data);
  const first = own?.apartmentIds[0];
  if (row === undefined || first === undefined || row.difference === undefined) {
    return refuse('no-discrepancy');
  }
  const id = `taxc-${first}-${input.year}-${voce.data}`;
  if (row.state === 'confermata' && row.confirmationId === id) {
    return { status: 'unchanged', confirmationId: id };
  }
  if (row.state !== 'discrepanza') return refuse('no-discrepancy');
  const before = (
    await loadAll(store, 'taxConfirmation', TaxConfirmationSchema, withDeleted)
  ).records.find((c) => c.id === id);
  const after = parseOrThrow(
    TaxConfirmationSchema,
    {
      id,
      v: 1,
      rev: (before?.rev ?? 0) + 1,
      apartmentId: first,
      year: input.year,
      voce: voce.data,
      difference: row.difference,
      ...(row.annualDifference === undefined ? {} : { annualDifference: row.annualDifference }),
      note: input.note.trim(),
    },
    'taxConfirmation',
  );
  const operation = await commitChange(
    store,
    {
      profileId,
      kind: 'tax.confirm',
      apartmentId: first,
      summary: 'Confermata una differenza delle tasse.',
      changes: [{ path: recordPath('taxConfirmation', id), before, after }],
    },
    clock,
    newId,
  );
  return { status: 'confirmed', operationId: operation.id, confirmationId: id };
}

export type LoadTaxTableResult =
  | { status: 'computed'; tables: TaxpayerTable[]; warnings: TaxYearWarning[] }
  | { status: 'refused'; reason: 'inconsistent-store' | 'bad-year' };

/**
 * The tables of `year` (`taxTable` with `TAX_DISCREPANCY_TOLERANCE` and the payables as
 * `expectedItems`, R243) and the January warnings of `today` (R213). Read only.
 */
export async function loadTaxTable(
  store: Store,
  options: { year: string; today: ISODate },
): Promise<LoadTaxTableResult> {
  if ((await checkConsistency(store)).length > 0) {
    return { status: 'refused', reason: 'inconsistent-store' };
  }
  if (!YearSchema.safeParse(options.year).success) return { status: 'refused', reason: 'bad-year' };
  const apartments = (await loadAll(store, 'apartment', ApartmentSchema)).records;
  const estimates = (await loadAll(store, 'taxEstimate', TaxEstimateSchema)).records;
  const transactions = (await loadAll(store, 'transaction', BankTransactionSchema)).records;
  const classes = (await loadAll(store, 'movementClass', MovementClassSchema)).records;
  const tables = taxTable({
    year: options.year,
    tolerance: TAX_DISCREPANCY_TOLERANCE,
    apartments,
    estimates,
    imuYears: (await loadAll(store, 'imuYear', ImuYearSchema)).records,
    classes,
    transactions,
    instalments: (await loadAll(store, 'instalment', InstalmentSchema)).records,
    matches: (await loadAll(store, 'match', BillMatchSchema)).records,
    taxPayments: (await loadAll(store, 'taxPayment', TaxPaymentSchema)).records,
    contracts: (await loadAll(store, 'contract', ContractSchema)).records,
    rentYears: (await loadAll(store, 'rentYear', RentYearSchema)).records,
    expectedItems: payableExpectedItems({
      payables: (await loadAll(store, 'payable', PayableSchema)).records,
      transactions,
      classes,
    }),
    confirmations: (await loadAll(store, 'taxConfirmation', TaxConfirmationSchema)).records,
    recoveries: (await loadAll(store, 'tenantRecovery', TenantRecoverySchema)).records,
  });
  const warnings = taxYearWarnings({ today: options.today, apartments, estimates });
  return { status: 'computed', tables, warnings };
}

export type LoadTaxExportResult =
  | { status: 'ok'; apartments: Apartment[]; contracts: Contract[] }
  | { status: 'refused'; reason: 'inconsistent-store' };

/** The live apartments and contracts of `buildTaxWorkbook` (R215). Read only. */
export async function loadTaxExport(store: Store): Promise<LoadTaxExportResult> {
  if ((await checkConsistency(store)).length > 0) {
    return { status: 'refused', reason: 'inconsistent-store' };
  }
  return {
    status: 'ok',
    apartments: (await loadAll(store, 'apartment', ApartmentSchema)).records,
    contracts: (await loadAll(store, 'contract', ContractSchema)).records,
  };
}
