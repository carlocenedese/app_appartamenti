/**
 * Scadenze e pagamenti (plan 9): one list of the owner's payables, derived from the IMU rates
 * (plan 3d), the condominium and TARI instalments with their matches (plan 3c) and the items typed
 * by hand (`payable`). Pure: `today` is an argument; due dates are only entered data, never
 * computed; an item is late from the day after its due date (decision 1 of user1).
 */
import { imuRates } from './imu';
import type { ImuRateStatus } from './imu';
import { checkConsistency } from './journal';
import { expectedDebit, statementPeriodsOf } from './match';
import {
  AccountSchema,
  ApartmentSchema,
  BankTransactionSchema,
  BillMatchSchema,
  ContractSchema,
  ImuYearSchema,
  InstalmentSchema,
  MovementClassSchema,
  PayableSchema,
  StatementSchema,
  TaxPaymentSchema,
} from './model';
import type {
  Apartment,
  BankTransaction,
  BillMatch,
  Contract,
  ImuYear,
  Instalment,
  MovementClass,
  Payable,
  PayableKind,
  TaxPayment,
} from './model';
import { cents } from './money';
import type { Cents } from './money';
import { daysBetween } from './period';
import type { ISODate, YearMonth } from './period';
import { loadAll } from './store/load';
import type { Store } from './store/store';
import type { TaxExpectedItem } from './taxes';
import { compareText } from './text';

export type PayableState = 'da-pagare' | 'in-scadenza' | 'pagata' | 'in-ritardo';
export type PayableItemKind = 'imu' | 'condominio' | 'tari' | PayableKind;

export interface PayableItem {
  source: 'imu' | 'instalment' | 'payable';
  /** `<f24Group>/<year>/<rateIndex>` for an IMU rate; the record id otherwise. */
  id: string;
  kind: PayableItemKind;
  apartmentIds: string[];
  /** The distinct `locatore` of the apartments, sorted (personal data). */
  taxpayers: string[];
  dueDate?: ISODate;
  expected?: Cents;
  state: PayableState;
  paidOn?: ISODate;
  transactionId?: string;
  /** A debit is there but its amount does not check: the item stays unpaid (section 42). */
  check?:
    | Exclude<ImuRateStatus, 'attesa' | 'pagata'>
    | 'importo-diverso'
    /** Unpaid, and no statement of the paying account covers the due date (question 7: open). */
    | 'periodo-senza-estratto';
  repeatYearly?: true;
  /** The reference year chosen by user1 (plan 13, R242). */
  taxYear?: number;
  /** A live item was repeated from this one. */
  repeated?: true;
}

export interface ContractEnd {
  contractId: string;
  apartmentId: string;
  end: YearMonth;
}

export interface ScadenzarioInput {
  today: ISODate;
  /** Days of the «in scadenza» window; `DEFAULT_SOON_DAYS` when absent (plan 17, R309). */
  soonDays?: number;
  apartments: Apartment[];
  imuYears: ImuYear[];
  /** The other voci of a mixed F24, for the IMU part (plan 17, R307). */
  taxPayments?: TaxPayment[];
  classes: MovementClass[];
  transactions: BankTransaction[];
  instalments: Instalment[];
  matches: BillMatch[];
  payables: Payable[];
  contracts: Contract[];
  /** The periods covered by the statements, by apartment (`statementPeriodsOf`). */
  statementPeriods: { apartmentId: string; from: ISODate; to: ISODate }[];
}

/** The «in scadenza» window, 15 days (answer of user1, 17 November 2026): a default, not a rule. */
export const DEFAULT_SOON_DAYS = 15;

/**
 * `pagata` when paid; `in-ritardo` from the day after `dueDate`; `in-scadenza` when `soonDays` is
 * given and `dueDate − today ≤ soonDays`; `da-pagare` otherwise, and always without a due date.
 */
export function payableState(
  dueDate: ISODate | undefined,
  paid: boolean,
  today: ISODate,
  soonDays?: number,
): PayableState {
  if (soonDays !== undefined && !(Number.isSafeInteger(soonDays) && soonDays >= 0)) {
    throw new RangeError('The window must be a whole number of days, not negative');
  }
  if (paid) return 'pagata';
  if (dueDate === undefined) return 'da-pagare';
  const left = daysBetween(dueDate, today);
  if (left < 0) return 'in-ritardo';
  return soonDays !== undefined && left <= soonDays ? 'in-scadenza' : 'da-pagare';
}

const live = <T extends { deleted?: boolean }>(records: T[]): T[] =>
  records.filter((r) => r.deleted !== true);

/** Paid by hand, or by a movement while it and its class are live (un movimento, un uso). */
function isPayablePaid(
  p: Payable,
  transactions: ReadonlyMap<string, BankTransaction>,
  classOf: ReadonlyMap<string, MovementClass>,
): boolean {
  const txId = p.paid?.transactionId;
  const kind = txId === undefined ? undefined : classOf.get(txId)?.kind;
  return (
    p.paid !== undefined &&
    (txId === undefined || (transactions.has(txId) && kind !== undefined && kind !== 'escluso'))
  );
}

/**
 * The payables of cedolare and registro for the tax table (plan 13, R243, R246): each live one,
 * with `year` = its `taxYear` as `AAAA`, `amount` = `expected` when present (the table never takes
 * a missing one as zero) and `paid` (its movement, if any) when paid. By record id.
 */
export function payableExpectedItems(input: {
  payables: Payable[];
  transactions: BankTransaction[];
  classes: MovementClass[];
}): TaxExpectedItem[] {
  const transactions = new Map(live(input.transactions).map((t) => [t.id, t]));
  const classOf = new Map(live(input.classes).map((c) => [c.transactionId, c]));
  return live(input.payables)
    .sort((a, b) => compareText(a.id, b.id))
    .flatMap((p) => {
      // A bollo, f24 or altro goes where user1 put it when creating it (plan 17, R303).
      const voce = p.kind === 'cedolare' || p.kind === 'registro' ? p.kind : p.taxVoice;
      return voce !== undefined
        ? [
            {
              apartmentId: p.apartmentId,
              voce,
              ...(p.taxYear === undefined ? {} : { year: String(p.taxYear).padStart(4, '0') }),
              ...(p.expected === undefined ? {} : { amount: p.expected }),
              ...(p.paid !== undefined && isPayablePaid(p, transactions, classOf)
                ? {
                    paid:
                      p.paid.transactionId === undefined
                        ? {}
                        : { transactionId: p.paid.transactionId },
                  }
                : {}),
            },
          ]
        : [];
    });
}

/** The items and the ends of the live contracts from the month of `today`; see the file comment. */
export function scadenzario(input: ScadenzarioInput): {
  items: PayableItem[];
  contractEnds: ContractEnd[];
} {
  const { today } = input;
  const soonDays = input.soonDays ?? DEFAULT_SOON_DAYS;
  const locatore = new Map(live(input.apartments).map((a) => [a.id, a.locatore]));
  const taxpayers = (ids: string[]) =>
    [...new Set(ids.flatMap((id) => locatore.get(id) ?? []))].sort(compareText);
  const transactions = new Map(live(input.transactions).map((t) => [t.id, t]));
  const classOf = new Map(live(input.classes).map((c) => [c.transactionId, c]));
  const item = (fields: Omit<PayableItem, 'taxpayers' | 'state'>, paid: boolean): PayableItem => ({
    ...fields,
    taxpayers: taxpayers(fields.apartmentIds),
    state: payableState(fields.dueDate, paid, today, soonDays),
  });

  const imu = imuRates({
    years: input.imuYears,
    classes: input.classes,
    transactions: input.transactions,
    ...(input.taxPayments === undefined ? {} : { taxPayments: input.taxPayments }),
  }).map((r) => {
    const paidOn =
      r.transactionId === undefined ? undefined : transactions.get(r.transactionId)?.date;
    const paid = r.status === 'pagata';
    return item(
      {
        source: 'imu',
        id: `${r.f24Group}/${r.year}/${String(r.rateIndex)}`,
        kind: 'imu',
        apartmentIds: r.apartmentIds,
        ...(r.dueDate === undefined ? {} : { dueDate: r.dueDate }),
        ...(r.expected === undefined ? {} : { expected: r.expected }),
        ...(paid && paidOn !== undefined ? { paidOn } : {}),
        ...(r.transactionId === undefined ? {} : { transactionId: r.transactionId }),
        ...(r.status === 'da-riconciliare' || r.status === 'importo-mancante'
          ? { check: r.status }
          : {}),
      },
      paid,
    );
  });

  // Real debits only: an assumed match is no proof (question 7 of the design).
  const debits = live(input.matches).filter(
    (m) => m.confirmed && m.by !== 'assumed' && m.itemType === 'instalment' && m.part === 'amount',
  );
  const instalments = live(input.instalments).map((i) => {
    const own = debits.filter((m) => m.itemId === i.id);
    const expected = expectedDebit(i);
    const debited = own.reduce((sum, m) => sum + m.amount, 0);
    // A shared notice: its share was checked by `validateMatches` when confirmed (R125).
    const paid = own.length > 0 && (i.shared !== undefined || debited === expected);
    const [paidOn] = own.map((m) => m.transactionDate).sort((a, b) => compareText(b, a));
    const payer = i.paidFromApartmentId ?? i.apartmentId;
    // Question 7, answered by user1 (17 November 2026): not paid, so late after its due date.
    const uncovered =
      own.length === 0 &&
      !input.statementPeriods.some(
        (p) => p.apartmentId === payer && p.from <= i.dueDate && i.dueDate <= p.to,
      );
    return item(
      {
        source: 'instalment',
        id: i.id,
        kind: i.kind,
        apartmentIds: [i.apartmentId],
        dueDate: i.dueDate,
        expected: cents(expected),
        ...(paid && paidOn !== undefined ? { paidOn } : {}),
        ...(own.length > 0 && !paid ? { check: 'importo-diverso' as const } : {}),
        ...(uncovered ? { check: 'periodo-senza-estratto' as const } : {}),
      },
      paid,
    );
  });

  const payables = live(input.payables);
  const repeated = new Set(payables.flatMap((p) => p.previousId ?? []));
  const manual = payables.map((p) => {
    const txId = p.paid?.transactionId;
    const paid = isPayablePaid(p, transactions, classOf);
    return item(
      {
        source: 'payable',
        id: p.id,
        kind: p.kind,
        apartmentIds: [p.apartmentId],
        dueDate: p.dueDate,
        ...(p.expected === undefined ? {} : { expected: p.expected }),
        ...(paid && p.paid !== undefined ? { paidOn: p.paid.date } : {}),
        ...(paid && txId !== undefined ? { transactionId: txId } : {}),
        ...(p.repeatYearly === true ? { repeatYearly: true as const } : {}),
        ...(p.taxYear === undefined ? {} : { taxYear: p.taxYear }),
        ...(repeated.has(p.id) ? { repeated: true as const } : {}),
      },
      paid,
    );
  });

  const order = ['imu', 'instalment', 'payable'];
  const items = [...imu, ...instalments, ...manual].sort(
    (a, b) =>
      (a.dueDate === undefined ? 1 : 0) - (b.dueDate === undefined ? 1 : 0) ||
      compareText(a.dueDate ?? '', b.dueDate ?? '') ||
      order.indexOf(a.source) - order.indexOf(b.source) ||
      compareText(a.id, b.id),
  );
  const month = today.slice(0, 7);
  const contractEnds = live(input.contracts)
    .filter((c) => c.end >= month)
    .sort((a, b) => compareText(a.end, b.end) || compareText(a.id, b.id))
    .map((c) => ({ contractId: c.id, apartmentId: c.apartmentId, end: c.end }));
  return { items, contractEnds };
}

export type LoadScadenzarioResult =
  | { status: 'computed'; items: PayableItem[]; contractEnds: ContractEnd[] }
  | { status: 'refused'; reason: 'inconsistent-store' };

/** The list on the records of the store. Writes nothing. */
export async function loadScadenzario(
  store: Store,
  options: { today: ISODate; soonDays?: number },
): Promise<LoadScadenzarioResult> {
  if ((await checkConsistency(store)).length > 0) {
    return { status: 'refused', reason: 'inconsistent-store' };
  }
  const all = { includeDeleted: true };
  return {
    status: 'computed',
    ...scadenzario({
      ...options,
      apartments: (await loadAll(store, 'apartment', ApartmentSchema)).records,
      imuYears: (await loadAll(store, 'imuYear', ImuYearSchema, all)).records,
      classes: (await loadAll(store, 'movementClass', MovementClassSchema, all)).records,
      transactions: (await loadAll(store, 'transaction', BankTransactionSchema, all)).records,
      taxPayments: (await loadAll(store, 'taxPayment', TaxPaymentSchema)).records,
      instalments: (await loadAll(store, 'instalment', InstalmentSchema)).records,
      matches: (await loadAll(store, 'match', BillMatchSchema)).records,
      payables: (await loadAll(store, 'payable', PayableSchema)).records,
      contracts: (await loadAll(store, 'contract', ContractSchema)).records,
      statementPeriods: statementPeriodsOf(
        (await loadAll(store, 'account', AccountSchema)).records,
        (await loadAll(store, 'statement', StatementSchema)).records,
      ),
    }),
  };
}
