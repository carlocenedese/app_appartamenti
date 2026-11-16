/**
 * Scadenze e pagamenti (plan 9): one list of the owner's payables, derived from the IMU rates
 * (plan 3d), the condominium and TARI instalments with their matches (plan 3c) and the items typed
 * by hand (`payable`). Pure: `today` is an argument; due dates are only entered data, never
 * computed; an item is late from the day after its due date (decision 1 of user1).
 */
import { imuRates } from './imu';
import type { ImuRateStatus } from './imu';
import { checkConsistency } from './journal';
import { expectedDebit } from './match';
import {
  ApartmentSchema,
  BankTransactionSchema,
  BillMatchSchema,
  ContractSchema,
  ImuYearSchema,
  InstalmentSchema,
  MovementClassSchema,
  PayableSchema,
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
} from './model';
import { cents } from './money';
import type { Cents } from './money';
import { daysBetween } from './period';
import type { ISODate, YearMonth } from './period';
import { loadAll } from './store/load';
import type { Store } from './store/store';
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
  check?: Exclude<ImuRateStatus, 'attesa' | 'pagata'> | 'importo-diverso';
  repeatYearly?: true;
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
  /** Days of the «in scadenza» window: not decided by user1, so only when the caller gives it. */
  soonDays?: number;
  apartments: Apartment[];
  imuYears: ImuYear[];
  classes: MovementClass[];
  transactions: BankTransaction[];
  instalments: Instalment[];
  matches: BillMatch[];
  payables: Payable[];
  contracts: Contract[];
}

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

/** The items and the ends of the live contracts from the month of `today`; see the file comment. */
export function scadenzario(input: ScadenzarioInput): {
  items: PayableItem[];
  contractEnds: ContractEnd[];
} {
  const { today, soonDays } = input;
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
      },
      paid,
    );
  });

  const payables = live(input.payables);
  const repeated = new Set(payables.flatMap((p) => p.previousId ?? []));
  const manual = payables.map((p) => {
    const txId = p.paid?.transactionId;
    // A movement proves the payment only while it and its class are live (un movimento, un uso).
    const kind = txId === undefined ? undefined : classOf.get(txId)?.kind;
    const paid =
      p.paid !== undefined &&
      (txId === undefined || (transactions.has(txId) && kind !== undefined && kind !== 'escluso'));
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
      instalments: (await loadAll(store, 'instalment', InstalmentSchema)).records,
      matches: (await loadAll(store, 'match', BillMatchSchema)).records,
      payables: (await loadAll(store, 'payable', PayableSchema)).records,
      contracts: (await loadAll(store, 'contract', ContractSchema)).records,
    }),
  };
}
