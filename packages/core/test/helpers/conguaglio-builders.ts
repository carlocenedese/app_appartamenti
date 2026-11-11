// Record builders shared by the settlement tests (conguaglio*.test.ts). Every builder fills a
// valid record for the apartment `apt` and takes the fields under test as overrides.
import { cents, isoDate, yearMonth } from '../../src/index';
import type {
  Apartment,
  Bill,
  BillMatch,
  Cents,
  Instalment,
  Payment,
  Tenancy,
  YearMonth,
} from '../../src/index';

export const APT = 'apt';

export function apartment(extra: Partial<Apartment> = {}): Apartment {
  return {
    id: APT,
    v: 1,
    rev: 1,
    name: 'Appartamento di prova',
    locatore: 'Locatore fittizio',
    posti: 4,
    annualitaStart: { month: 10, day: 1 },
    ...extra,
  };
}

export function bill(
  id: string,
  start: string,
  end: string,
  amount: number,
  extra: Partial<Bill> = {},
): Bill {
  return {
    id,
    v: 1,
    rev: 1,
    apartmentId: APT,
    category: 'elettricita',
    supplier: 'Fornitore luce',
    periodStart: isoDate(start),
    periodEnd: isoDate(end),
    amount: cents(amount),
    includedInConguaglio: true,
    sharedWithTenants: true,
    fileHash: `hash-${id}`,
    filePath: `bollette/${id}.pdf`,
    ...extra,
  };
}

export function instalment(id: string, extra: Partial<Instalment> = {}): Instalment {
  return {
    id,
    v: 1,
    rev: 1,
    apartmentId: APT,
    kind: 'condominio',
    esercizio: '2026-27',
    rateIndex: 1,
    rateCount: 4,
    dueDate: isoDate('2026-05-10'),
    rata: cents(0),
    quotaProprieta: cents(0),
    conguaglioPrec: cents(0),
    coversFrom: yearMonth('2026-05'),
    coversTo: yearMonth('2026-07'),
    ...extra,
  };
}

/** A confirmed match of the whole `amount` (or of a commission row) with a debit. */
export function match(
  item: Bill | Instalment,
  amount: number,
  extra: Partial<BillMatch> = {},
): BillMatch {
  const part = extra.part ?? 'amount';
  return {
    id: `m-${item.id}-${part}-${extra.transactionId ?? 'tx'}`,
    v: 1,
    rev: 1,
    itemType: 'rata' in item ? 'instalment' : 'bill',
    itemId: item.id,
    transactionId: `tx-${item.id}`,
    transactionDate: isoDate('2026-11-12'),
    amount: cents(amount),
    part,
    confirmed: true,
    by: 'manual',
    ...extra,
  };
}

export function tenancy(
  tenantId: string,
  from: string,
  to: string | undefined,
  extra: Partial<Tenancy> = {},
): Tenancy {
  return {
    id: `tcy-${tenantId}-${from}`,
    v: 1,
    rev: 1,
    apartmentId: APT,
    tenantId,
    from: yearMonth(from),
    ...(to === undefined ? {} : { to: yearMonth(to) }),
    monthlyRent: cents(45000),
    monthlyForfait: cents(3000),
    ...extra,
  };
}

let paymentSeq = 0;

/** A confirmed `canone` payment for `month`. */
export function payment(
  tenantId: string,
  month: string,
  amount: number,
  extra: Partial<Payment> = {},
): Payment {
  paymentSeq += 1;
  return {
    id: `pay-${tenantId}-${month}-${paymentSeq}`,
    v: 1,
    rev: 1,
    apartmentId: APT,
    tenantId,
    date: isoDate(`${month}-05`),
    amount: cents(amount),
    confirmed: true,
    kind: 'canone',
    forMonth: yearMonth(month),
    source: 'csv',
    ...extra,
  };
}

/** A settlement period of whole months. */
export function period(
  from: string,
  to: string,
  label = 'test',
): {
  label: string;
  from: YearMonth;
  to: YearMonth;
} {
  return { label, from: yearMonth(from), to: yearMonth(to) };
}

export const sum = (values: readonly number[]): Cents =>
  cents(values.reduce((total, value) => total + value, 0));

/** mulberry32: a tiny seeded generator, so the random cases are the same on every run. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffled<T>(items: readonly T[], next: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
  }
  return copy;
}
