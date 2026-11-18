/**
 * Writing the payables typed by hand (plan 9): save, repeat by an explicit command, mark paid.
 * Each write is one operation of the journal (undone with `undoOperation`), nothing written while
 * `checkConsistency` reports a problem (R113); no amount, date or name in a summary.
 */
import { checkConsistency, commitChange } from './journal';
import {
  ApartmentSchema,
  BankTransactionSchema,
  MovementClassSchema,
  PayableSchema,
} from './model';
import type { Payable, PayableKind } from './model';
import type { Cents } from './money';
import { parseOrThrow } from './parse';
import type { ISODate } from './period';
import { loadAll } from './store/load';
import { recordPath } from './store/records';
import type { Store } from './store/store';
import { compareText } from './text';

export interface SavePayableInput {
  /** Absent: a new `scad-<newId()>`. */
  id?: string;
  apartmentId: string;
  kind: PayableKind;
  dueDate: ISODate;
  expected?: Cents;
  repeatYearly?: true;
  /** The tax year chosen by user1 (R242); absent removes it, as `expected`. */
  taxYear?: number;
  /** The voce of the tax table of a bollo, f24 or altro (plan 17, R303); absent removes it. */
  taxVoice?: 'cedolare' | 'registro';
}

type Refused<R extends string> = { status: 'refused'; reason: R };
type Saved = { status: 'saved'; operationId: string; payableId: string };

export type SavePayableResult =
  /** `action`: a new payable or a change of a live one (E3: a typo in `id` is visible). */
  | (Saved & { action: 'created' | 'updated' })
  | { status: 'unchanged'; payableId: string }
  | Refused<
      | 'inconsistent-store'
      | 'unknown-apartment'
      | 'unknown-payable'
      | 'bad-amount'
      | 'bad-year'
      | 'bad-voice'
    >;

export type RepeatPayableResult =
  | Saved
  | Refused<
      | 'inconsistent-store'
      | 'unknown-payable'
      | 'not-repeating'
      | 'already-repeated'
      | 'bad-amount'
      | 'bad-year'
    >;

export type SetPayablePaidResult =
  | Saved
  | Refused<
      | 'inconsistent-store'
      | 'unknown-payable'
      | 'already-paid'
      | 'unknown-transaction'
      | 'transaction-not-classified'
      | 'transaction-used'
      | 'bad-date'
      | 'date-and-transaction'
    >;

const badAmount = (expected: number | undefined): boolean =>
  expected !== undefined && !(Number.isSafeInteger(expected) && expected > 0);
const badYear = (year: number | undefined): boolean =>
  year !== undefined && !(Number.isSafeInteger(year) && year >= 1 && year <= 9999);

async function livePayables(store: Store): Promise<Payable[]> {
  return (await loadAll(store, 'payable', PayableSchema)).records;
}

const toRecord = (fields: Omit<Payable, 'v' | 'rev'>, rev: number): Payable =>
  parseOrThrow(PayableSchema, { ...fields, v: 1, rev }, 'payable');

async function write(
  store: Store,
  kind: string,
  summary: string,
  before: Payable | undefined,
  after: Omit<Payable, 'v' | 'rev'>,
  profileId: string,
  clock: () => string,
  newId: () => string,
): Promise<Saved> {
  const record = toRecord(after, (before?.rev ?? 0) + 1);
  const operation = await commitChange(
    store,
    {
      profileId,
      kind,
      apartmentId: record.apartmentId,
      summary,
      changes: [{ path: recordPath('payable', record.id), before, after: record }],
    },
    clock,
    newId,
  );
  return { status: 'saved', operationId: operation.id, payableId: record.id };
}

/**
 * Creates (`id` absent) or updates a live payable in one `payable.save` operation; an update keeps
 * `paid` and `previousId`. Refused without writing: `inconsistent-store`, `unknown-apartment` (not
 * live), `unknown-payable` (`id` of a deleted payable; a new `id` creates it, E3), `bad-amount` (not a positive integer),
 * `bad-year` (`taxYear` not a whole number 1-9999), `bad-voice` (a `taxVoice` on a cedolare or
 * registro payable, which is its own voce: R303). The same content is `unchanged`.
 */
export async function savePayable(
  store: Store,
  input: SavePayableInput,
  profileId: string,
  clock: () => string,
  newId: () => string,
): Promise<SavePayableResult> {
  const refuse = <R extends Extract<SavePayableResult, { status: 'refused' }>['reason']>(
    reason: R,
  ) => ({ status: 'refused', reason }) as const;
  if ((await checkConsistency(store)).length > 0) return refuse('inconsistent-store');
  const apartments = (await loadAll(store, 'apartment', ApartmentSchema)).records;
  if (!apartments.some((a) => a.id === input.apartmentId)) return refuse('unknown-apartment');
  const live = await livePayables(store);
  const before = input.id === undefined ? undefined : live.find((p) => p.id === input.id);
  // E3: a new `id` creates the payable (as `contratto` and `presenza`); one of a deleted payable
  // stays refused, it is not brought back.
  const deletedId =
    input.id !== undefined &&
    before === undefined &&
    (await loadAll(store, 'payable', PayableSchema, { includeDeleted: true })).records.some(
      (p) => p.id === input.id,
    );
  if (deletedId) return refuse('unknown-payable');
  if (badAmount(input.expected)) return refuse('bad-amount');
  if (badYear(input.taxYear)) return refuse('bad-year');
  if (input.taxVoice !== undefined && (input.kind === 'cedolare' || input.kind === 'registro')) {
    return refuse('bad-voice');
  }
  const after = {
    id: input.id ?? `scad-${newId()}`,
    apartmentId: input.apartmentId,
    kind: input.kind,
    dueDate: input.dueDate,
    ...(input.expected === undefined ? {} : { expected: input.expected }),
    ...(input.repeatYearly === true ? { repeatYearly: true as const } : {}),
    ...(input.taxYear === undefined ? {} : { taxYear: input.taxYear }),
    ...(input.taxVoice === undefined ? {} : { taxVoice: input.taxVoice }),
    ...(before?.previousId === undefined ? {} : { previousId: before.previousId }),
    ...(before?.paid === undefined ? {} : { paid: before.paid }),
  };
  if (
    before !== undefined &&
    JSON.stringify(toRecord(after, before.rev)) === JSON.stringify(before)
  ) {
    return { status: 'unchanged', payableId: before.id };
  }
  // E3: without `id`, a live payable created with the same fields (paid since or not) is a
  // rerun: unchanged.
  if (input.id === undefined) {
    const created = (p: Omit<Payable, 'v' | 'rev'>) =>
      JSON.stringify([
        p.apartmentId,
        p.kind,
        p.dueDate,
        p.expected,
        p.repeatYearly,
        p.taxYear,
        p.taxVoice,
      ]);
    const same = live.find((p) => p.previousId === undefined && created(p) === created(after));
    if (same !== undefined) return { status: 'unchanged', payableId: same.id };
  }
  const saved = await write(
    store,
    'payable.save',
    'Salvata una scadenza.',
    before,
    after,
    profileId,
    clock,
    newId,
  );
  return { ...saved, action: before === undefined ? 'created' : 'updated' };
}

/**
 * The next item of a live payable marked `repeatYearly`, with the due date (and amount, if any)
 * given by the user: no date or amount is computed (question 2 of the design). Copies apartment,
 * kind and mark; `previousId` is the item; `taxYear` only if given. One `payable.repeat`
 * operation. Refused without writing: `inconsistent-store`, `unknown-payable`, `not-repeating`,
 * `already-repeated` (a live item already has that `previousId`), `bad-amount`, `bad-year`.
 */
export async function repeatPayable(
  store: Store,
  input: { payableId: string; dueDate: ISODate; expected?: Cents; taxYear?: number },
  profileId: string,
  clock: () => string,
  newId: () => string,
): Promise<RepeatPayableResult> {
  const refuse = <R extends Extract<RepeatPayableResult, { status: 'refused' }>['reason']>(
    reason: R,
  ) => ({ status: 'refused', reason }) as const;
  if ((await checkConsistency(store)).length > 0) return refuse('inconsistent-store');
  const payables = await livePayables(store);
  const previous = payables.find((p) => p.id === input.payableId);
  if (previous === undefined) return refuse('unknown-payable');
  if (previous.repeatYearly !== true) return refuse('not-repeating');
  if (payables.some((p) => p.previousId === previous.id)) return refuse('already-repeated');
  if (badAmount(input.expected)) return refuse('bad-amount');
  if (badYear(input.taxYear)) return refuse('bad-year');
  const after = {
    id: `scad-${newId()}`,
    apartmentId: previous.apartmentId,
    kind: previous.kind,
    dueDate: input.dueDate,
    ...(input.expected === undefined ? {} : { expected: input.expected }),
    repeatYearly: true as const,
    previousId: previous.id,
    // Never copied nor computed from the previous item (R242).
    ...(input.taxYear === undefined ? {} : { taxYear: input.taxYear }),
    // The voce goes with the kind, chosen when the first one was created (R303).
    ...(previous.taxVoice === undefined ? {} : { taxVoice: previous.taxVoice }),
  };
  return write(
    store,
    'payable.repeat',
    'Ripetuta una scadenza.',
    undefined,
    after,
    profileId,
    clock,
    newId,
  );
}

/**
 * Marks a live payable paid in one `payable.paid` operation: by hand on `date`, or by the live
 * debit `transactionId` (its date) whose live class was confirmed by hand (not `escluso`, no
 * `ruleId`, no `imu`) and that no other live payable uses: its one use stays the class (un
 * movimento, un uso). Refused without writing, in this order: `inconsistent-store`,
 * `unknown-payable`, `already-paid` (undo first), `date-and-transaction` (both given), `unknown-transaction` (absent, deleted or not a
 * debit), `transaction-not-classified`, `transaction-used`, `bad-date` (neither date nor movement).
 */
export async function setPayablePaid(
  store: Store,
  input: { payableId: string; date?: ISODate; transactionId?: string },
  profileId: string,
  clock: () => string,
  newId: () => string,
): Promise<SetPayablePaidResult> {
  const refuse = <R extends Extract<SetPayablePaidResult, { status: 'refused' }>['reason']>(
    reason: R,
  ) => ({ status: 'refused', reason }) as const;
  if ((await checkConsistency(store)).length > 0) return refuse('inconsistent-store');
  const payables = await livePayables(store);
  const before = payables.find((p) => p.id === input.payableId);
  if (before === undefined) return refuse('unknown-payable');
  if (before.paid !== undefined) return refuse('already-paid');
  if (input.date !== undefined && input.transactionId !== undefined) {
    return refuse('date-and-transaction');
  }
  let date = input.date;
  if (input.transactionId !== undefined) {
    const tx = (await loadAll(store, 'transaction', BankTransactionSchema)).records.find(
      (t) => t.id === input.transactionId,
    );
    if (tx === undefined || tx.amount >= 0) return refuse('unknown-transaction');
    const cls = (await loadAll(store, 'movementClass', MovementClassSchema)).records.find(
      (c) => c.transactionId === tx.id,
    );
    if (cls === undefined || cls.kind === 'escluso' || cls.ruleId !== undefined) {
      return refuse('transaction-not-classified');
    }
    if (cls.imu !== undefined || payables.some((p) => p.paid?.transactionId === tx.id)) {
      return refuse('transaction-used');
    }
    date = tx.date;
  }
  if (date === undefined) return refuse('bad-date');
  const paid = {
    date,
    ...(input.transactionId === undefined ? {} : { transactionId: input.transactionId }),
  };
  return write(
    store,
    'payable.paid',
    'Segnata pagata una scadenza.',
    before,
    { ...before, paid },
    profileId,
    clock,
    newId,
  );
}

/** The live payables repeated from one of `payableIds`, ids sorted (undo of their creation). */
export async function payablesRepeatedFrom(
  store: Store,
  payableIds: readonly string[],
): Promise<string[]> {
  return (await livePayables(store))
    .filter((p) => p.previousId !== undefined && payableIds.includes(p.previousId))
    .map((p) => p.id)
    .sort(compareText);
}

/** The live payables paid by one of `transactionIds`, ids sorted (for the guards of other writes). */
export async function payablesUsing(
  store: Store,
  transactionIds: readonly string[],
): Promise<string[]> {
  return (await livePayables(store))
    .filter(
      (p) => p.paid?.transactionId !== undefined && transactionIds.includes(p.paid.transactionId),
    )
    .map((p) => p.id)
    .sort(compareText);
}
