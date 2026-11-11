/**
 * The settlement (conguaglio) of a period: what each tenant owes once the costs are shared out
 * and the flat charge collected is taken off (section 42, R1-R5, R7; docs/rules/conguaglio-rules.md).
 *
 * - Only items with a confirmed `amount` match count, for the amount debited (R2). The others are
 *   `pending` and change nothing. A condominium instalment must be debited exactly `rata +
 *   conguaglioPrec`, otherwise it stays pending with the reason `importo diverso`.
 * - Every item is split over its months (a bill over its period, an instalment over the months it
 *   covers, last year's condominium settlement over the 12 months of the current fiscal year),
 *   leftover cents to the first months. Each month's share is then split over the beds of the
 *   apartment, leftover cents to the first beds in the order of `apartment.rooms`; a bed goes to
 *   the tenant in that room that month, an empty bed to the owner (`unassigned`). Without `rooms`
 *   the beds are the tenants present that month sorted by id, then the empty beds.
 * - Only the months inside the period count: the others belong to another period's settlement.
 * - The owner's yearly condominium share (`quotaProprieta`) comes off the instalments in equal
 *   parts, only from records with a non-zero `rata` (a record that only carries last year's
 *   settlement has no owner share). An instalment whose owner share exceeds its `rata` stays
 *   pending (`parte della proprietà maggiore della rata`) rather than giving the tenants a credit.
 *   An extraordinary instalment is the owner's alone and never reaches the tenants.
 * - A commission row matched to an item follows the item: same months, same beds (R7).
 * - The amount due is the tenant's share of the costs minus the flat charge actually collected
 *   (R4), with each month's rent payments going to the rent first.
 *
 * The result never depends on the order of the input.
 */
import { expectedDebit } from './match';
import type { Apartment, Bill, BillMatch, Instalment, Payment, Tenancy } from './model';
import { cents, splitCents } from './money';
import type { Cents } from './money';
import { annualitaRange, isoDate, monthsInPeriod } from './period';
import type { ISODate, YearMonth } from './period';
import { compareText } from './text';
import { CORE_VERSION } from './version';

/** The cost categories of a settlement row: the bill categories, the TARI and the condominium. */
export type CostCategory = Bill['category'] | Instalment['kind'];

export interface MonthShare {
  month: YearMonth;
  amount: Cents;
}

export interface InstalmentMonth {
  month: YearMonth;
  /** The instalment net of the owner's share. */
  rata: Cents;
  /** Last year's condominium settlement. */
  conguaglioPrec: Cents;
}

export interface ForfaitMonth {
  tenantId: string;
  month: YearMonth;
  rentDue: Cents;
  forfaitDue: Cents;
  /** Confirmed rent payments for the month. */
  paid: Cents;
  /** What is left of `paid` after the rent, up to the flat charge due. */
  forfaitCollected: Cents;
}

export interface ConguaglioInput {
  apartment: Apartment;
  period: { label: string; from: YearMonth; to: YearMonth };
  bills: Bill[];
  instalments: Instalment[];
  matches: BillMatch[];
  tenancies: Tenancy[];
  payments: Payment[];
}

export interface TenantSettlement {
  tenantId: string;
  /** Bills and TARI. */
  spese: Cents;
  condominio: { rata: Cents; conguaglioPrec: Cents };
  commissione: Cents;
  forfaitIncassato: Cents;
  /** `spese + condominio.rata + condominio.conguaglioPrec + commissione - forfaitIncassato`. */
  due: Cents;
  /** Costs by category, commission excluded; only the categories with an amount. */
  byCategory: Partial<Record<CostCategory, Cents>>;
}

export interface PendingItem {
  itemType: BillMatch['itemType'];
  itemId: string;
  reason?: string;
}

export interface ConguaglioWarning {
  /** The rents and flat charges of a month do not add up to the contract (R4): a check only. */
  code: 'contratto-mensile';
  expected: Cents;
  actual: Cents;
}

export interface ConguaglioResult {
  /** `CORE_VERSION`, so that a snapshot taken at closing can be reproduced later. */
  engineVersion: string;
  /** Every tenant present in the period, sorted by id. */
  tenants: TenantSettlement[];
  /** The shares of empty beds, left to the owner. */
  unassigned: Cents;
  /** Items in the period that do not count yet, sorted by type and id. */
  pending: PendingItem[];
  warnings: ConguaglioWarning[];
}

const CATEGORY_ORDER: readonly CostCategory[] = [
  'elettricita',
  'gas',
  'acqua',
  'internet',
  'altro',
  'tari',
  'condominio',
];

const equalSplit = (amount: Cents, parts: number): Cents[] =>
  splitCents(
    amount,
    Array.from({ length: parts }, () => 1),
  );

const total = (values: readonly number[]): Cents =>
  cents(values.reduce((sum, value) => sum + value, 0));

/** The months from `from` to `to`, both included. */
const monthRange = (from: YearMonth, to: YearMonth): YearMonth[] =>
  monthsInPeriod(isoDate(`${from}-01`), isoDate(`${to}-01`));

const isPresent = (tenancy: Tenancy, month: YearMonth): boolean =>
  tenancy.from <= month && (tenancy.to === undefined || month <= tenancy.to);

const byTenancy = (a: Tenancy, b: Tenancy): number =>
  compareText(a.tenantId, b.tenantId) || compareText(a.from, b.from) || compareText(a.id, b.id);

/** A bill's amount (or `amount`) split equally over the months of its period. */
export function allocateBillToMonths(bill: Bill, amount: Cents = bill.amount): MonthShare[] {
  const months = monthsInPeriod(bill.periodStart, bill.periodEnd);
  const parts = equalSplit(amount, months.length);
  return months.map((month, index) => ({ month, amount: parts[index] as Cents }));
}

/** The monthly shares of the bills that fall inside `range` (a lease year), in input order. */
export function billsForAnnualita(
  bills: Bill[],
  range: { from: ISODate; to: ISODate },
): { month: YearMonth; amount: Cents; bill: Bill }[] {
  const months = new Set(monthsInPeriod(range.from, range.to));
  return bills.flatMap((bill) =>
    allocateBillToMonths(bill)
      .filter(({ month }) => months.has(month))
      .map(({ month, amount }) => ({ month, amount, bill })),
  );
}

/**
 * This instalment's part of the owner's yearly condominium share, split equally among the rates.
 * A record with `rata` 0 (last year's settlement paid on its own) carries no owner share, whatever
 * its `quotaProprieta` says (R-C8): the yearly share comes off the ordinary instalments only.
 */
function ownerShare(instalment: Instalment): Cents {
  if (instalment.kind !== 'condominio' || instalment.rata === 0) return cents(0);
  return equalSplit(instalment.quotaProprieta, instalment.rateCount)[
    instalment.rateIndex - 1
  ] as Cents;
}

/**
 * The monthly shares of an instalment debited for `paid`, sorted by month. The instalment, net of
 * the owner's share (none on a record with `rata` 0), goes over the months it covers; a condominium's `conguaglioPrec` over the
 * months of `esercizioRange`, the current fiscal year (required when it is not 0). An
 * extraordinary instalment gives nothing to the tenants. An owner's share larger than the rata
 * would give the tenants a credit: `calcConguaglio` keeps such an instalment pending instead.
 */
export function allocateInstalment(
  instalment: Instalment,
  paid: Cents,
  esercizioRange?: { from: ISODate; to: ISODate },
): InstalmentMonth[] {
  if (instalment.straordinaria === true) return [];
  const rows = new Map<YearMonth, { rata: number; conguaglioPrec: number }>();
  const row = (month: YearMonth) => {
    const existing = rows.get(month);
    if (existing !== undefined) return existing;
    const created = { rata: 0, conguaglioPrec: 0 };
    rows.set(month, created);
    return created;
  };

  const previous = instalment.kind === 'condominio' ? instalment.conguaglioPrec : cents(0);
  const covered = monthRange(instalment.coversFrom, instalment.coversTo);
  const net = cents(paid - previous - ownerShare(instalment));
  equalSplit(net, covered.length).forEach((amount, index) => {
    row(covered[index] as YearMonth).rata += amount;
  });
  if (previous !== 0) {
    if (esercizioRange === undefined) {
      throw new RangeError(
        `Instalment ${instalment.id} carries last year's settlement: the fiscal year is needed to split it`,
      );
    }
    const year = monthsInPeriod(esercizioRange.from, esercizioRange.to);
    equalSplit(previous, year.length).forEach((amount, index) => {
      row(year[index] as YearMonth).conguaglioPrec += amount;
    });
  }
  return [...rows.entries()]
    .sort(([a], [b]) => compareText(a, b))
    .map(([month, { rata, conguaglioPrec }]) => ({
      month,
      rata: cents(rata),
      conguaglioPrec: cents(conguaglioPrec),
    }));
}

/**
 * Rent and flat charge of every month of `months` in which a tenancy is present, sorted by tenant
 * and month. Only confirmed `canone` payments count, for their `forMonth` (else the month of their
 * date); they go to the rent first, then to the flat charge, and any excess is ignored (R4).
 */
export function collectedForfait(input: {
  tenancies: Tenancy[];
  payments: Payment[];
  months: YearMonth[];
}): ForfaitMonth[] {
  const paidBy = new Map<string, number>();
  for (const payment of input.payments) {
    if (!payment.confirmed || payment.kind !== 'canone') continue;
    const key = `${payment.tenantId}\u0000${payment.forMonth ?? payment.date.slice(0, 7)}`;
    paidBy.set(key, (paidBy.get(key) ?? 0) + payment.amount);
  }
  const rows: ForfaitMonth[] = [];
  for (const tenancy of [...input.tenancies].sort(byTenancy)) {
    for (const month of input.months) {
      if (!isPresent(tenancy, month)) continue;
      const paid = paidBy.get(`${tenancy.tenantId}\u0000${month}`) ?? 0;
      const forfaitCollected = Math.min(
        Math.max(paid - tenancy.monthlyRent, 0),
        tenancy.monthlyForfait,
      );
      rows.push({
        tenantId: tenancy.tenantId,
        month,
        rentDue: tenancy.monthlyRent,
        forfaitDue: tenancy.monthlyForfait,
        paid: cents(paid),
        forfaitCollected: cents(forfaitCollected),
      });
    }
  }
  return rows.sort((a, b) => compareText(a.tenantId, b.tenantId) || compareText(a.month, b.month));
}

/**
 * Who sleeps in each bed in `month`: a tenant id, or `undefined` for an empty bed. Throws a
 * `RangeError` when the tenancies do not fit the beds: a room that is not a bed of the apartment,
 * two tenancies in one room in the same month, more tenants than beds.
 */
function bedsIn(
  apartment: Apartment,
  present: Tenancy[],
  month: YearMonth,
): (string | undefined)[] {
  const { rooms, posti } = apartment;
  if (rooms !== undefined) {
    for (const tenancy of present) {
      if (tenancy.room === undefined || !rooms.includes(tenancy.room)) {
        throw new RangeError(
          `Tenancy ${tenancy.id} is in room ${String(tenancy.room)}, not one of the beds of ${apartment.id}`,
        );
      }
    }
    return rooms.map((room) => {
      const inRoom = present.filter((tenancy) => tenancy.room === room);
      if (inRoom.length > 1) {
        const ids = inRoom.map((tenancy) => tenancy.id).join(', ');
        throw new RangeError(`Room ${room} has two tenancies in ${month}: ${ids}`);
      }
      return inRoom[0]?.tenantId;
    });
  }
  if (present.length > posti) {
    throw new RangeError(`${present.length} tenancies in ${month} for ${posti} beds`);
  }
  return [
    ...present.map((tenancy) => tenancy.tenantId),
    ...Array.from({ length: posti - present.length }, () => undefined),
  ];
}

type Bucket = 'spese' | 'rata' | 'conguaglioPrec' | 'commissione';

interface Tally {
  spese: number;
  rata: number;
  conguaglioPrec: number;
  commissione: number;
  byCategory: Map<CostCategory, number>;
}

/**
 * The settlement of `input.period` for `input.apartment` (records of other apartments are
 * ignored). Throws a `RangeError` when the tenancies do not fit the beds, or when a matched
 * condominium instalment carries last year's settlement and the apartment has no
 * `condominioStart` to place its fiscal year.
 */
export function calcConguaglio(input: ConguaglioInput): ConguaglioResult {
  const { apartment, period } = input;
  const own = <T extends { apartmentId: string }>(records: T[]): T[] =>
    records.filter((record) => record.apartmentId === apartment.id);
  const periodMonths = monthRange(period.from, period.to);
  const inPeriod = new Set(periodMonths);
  const touchesPeriod = (months: YearMonth[]): boolean => months.some((m) => inPeriod.has(m));

  const tenancies = own(input.tenancies)
    .filter((tenancy) => periodMonths.some((month) => isPresent(tenancy, month)))
    .sort(byTenancy);
  const beds = new Map(
    periodMonths.map((month) => {
      const present = tenancies.filter((tenancy) => isPresent(tenancy, month));
      return [month, bedsIn(apartment, present, month)] as const;
    }),
  );

  const tallies = new Map<string, Tally>();
  for (const { tenantId } of tenancies) {
    if (!tallies.has(tenantId)) {
      tallies.set(tenantId, {
        spese: 0,
        rata: 0,
        conguaglioPrec: 0,
        commissione: 0,
        byCategory: new Map(),
      });
    }
  }
  let unassigned = 0;
  // A month's amount over the beds; months outside the period belong to another settlement.
  const share = (month: YearMonth, amount: number, bucket: Bucket, category?: CostCategory) => {
    const occupants = beds.get(month);
    if (occupants === undefined || amount === 0) return;
    equalSplit(cents(amount), occupants.length).forEach((part, bed) => {
      const tenantId = occupants[bed];
      const tally = tenantId === undefined ? undefined : tallies.get(tenantId);
      if (tally === undefined) {
        unassigned += part;
        return;
      }
      tally[bucket] += part;
      if (category !== undefined) {
        tally.byCategory.set(category, (tally.byCategory.get(category) ?? 0) + part);
      }
    });
  };

  // Confirmed matches by item and part.
  const matched = new Map<string, { amount: number; commission: number; hasAmount: boolean }>();
  for (const match of input.matches) {
    if (!match.confirmed) continue;
    const key = `${match.itemType}\u0000${match.itemId}`;
    const entry = matched.get(key) ?? { amount: 0, commission: 0, hasAmount: false };
    if (match.part === 'amount') {
      entry.amount += match.amount;
      entry.hasAmount = true;
    } else {
      entry.commission += match.amount;
    }
    matched.set(key, entry);
  }
  const pending: PendingItem[] = [];

  for (const bill of [...own(input.bills)].sort((a, b) => compareText(a.id, b.id))) {
    if (!bill.includedInConguaglio || !bill.sharedWithTenants) continue;
    if (!touchesPeriod(monthsInPeriod(bill.periodStart, bill.periodEnd))) continue;
    const paid = matched.get(`bill\u0000${bill.id}`);
    if (paid === undefined || !paid.hasAmount) {
      pending.push({ itemType: 'bill', itemId: bill.id });
      continue;
    }
    for (const { month, amount } of allocateBillToMonths(bill, cents(paid.amount))) {
      share(month, amount, 'spese', bill.category);
    }
    for (const { month, amount } of allocateBillToMonths(bill, cents(paid.commission))) {
      share(month, amount, 'commissione');
    }
  }

  for (const instalment of [...own(input.instalments)].sort((a, b) => compareText(a.id, b.id))) {
    if (instalment.straordinaria === true) continue;
    const covered = monthRange(instalment.coversFrom, instalment.coversTo);
    const esercizio =
      instalment.kind === 'condominio' && apartment.condominioStart !== undefined
        ? annualitaRange(instalment.esercizio, apartment.condominioStart)
        : undefined;
    const previousYear =
      esercizio !== undefined && instalment.conguaglioPrec !== 0
        ? monthsInPeriod(esercizio.from, esercizio.to)
        : [];
    if (!touchesPeriod([...covered, ...previousYear])) continue;
    const paid = matched.get(`instalment\u0000${instalment.id}`);
    if (paid === undefined || !paid.hasAmount) {
      pending.push({ itemType: 'instalment', itemId: instalment.id });
      continue;
    }
    if (instalment.kind === 'condominio' && paid.amount !== expectedDebit(instalment)) {
      pending.push({ itemType: 'instalment', itemId: instalment.id, reason: 'importo diverso' });
      continue;
    }
    if (instalment.rata > 0 && ownerShare(instalment) > instalment.rata) {
      pending.push({
        itemType: 'instalment',
        itemId: instalment.id,
        reason: 'parte della proprietà maggiore della rata',
      });
      continue;
    }
    for (const part of allocateInstalment(instalment, cents(paid.amount), esercizio)) {
      if (instalment.kind === 'tari') {
        share(part.month, part.rata, 'spese', 'tari');
      } else {
        share(part.month, part.rata, 'rata', 'condominio');
        share(part.month, part.conguaglioPrec, 'conguaglioPrec', 'condominio');
      }
    }
    equalSplit(cents(paid.commission), covered.length).forEach((amount, index) => {
      share(covered[index] as YearMonth, amount, 'commissione');
    });
  }

  const forfait = new Map<string, number>();
  for (const row of collectedForfait({
    tenancies,
    payments: own(input.payments),
    months: periodMonths,
  })) {
    forfait.set(row.tenantId, (forfait.get(row.tenantId) ?? 0) + row.forfaitCollected);
  }

  const tenants = [...tallies.entries()].map(([tenantId, tally]): TenantSettlement => {
    const forfaitIncassato = cents(forfait.get(tenantId) ?? 0);
    const byCategory: Partial<Record<CostCategory, Cents>> = {};
    for (const category of CATEGORY_ORDER) {
      const amount = tally.byCategory.get(category) ?? 0;
      if (amount !== 0) byCategory[category] = cents(amount);
    }
    return {
      tenantId,
      spese: cents(tally.spese),
      condominio: { rata: cents(tally.rata), conguaglioPrec: cents(tally.conguaglioPrec) },
      commissione: cents(tally.commissione),
      forfaitIncassato,
      due: cents(
        tally.spese + tally.rata + tally.conguaglioPrec + tally.commissione - forfaitIncassato,
      ),
      byCategory,
    };
  });

  return {
    engineVersion: CORE_VERSION,
    tenants,
    unassigned: cents(unassigned),
    pending: pending.sort(
      (a, b) => compareText(a.itemType, b.itemType) || compareText(a.itemId, b.itemId),
    ),
    warnings: contractWarnings(apartment, tenancies, periodMonths),
  };
}

/** One warning for each monthly total of rents and flat charges that differs from the contract. */
function contractWarnings(
  apartment: Apartment,
  tenancies: Tenancy[],
  months: YearMonth[],
): ConguaglioWarning[] {
  const expected = apartment.contrattoMensile;
  if (expected === undefined) return [];
  const seen = new Set<number>();
  const warnings: ConguaglioWarning[] = [];
  for (const month of months) {
    const actual = total(
      tenancies
        .filter((tenancy) => isPresent(tenancy, month))
        .map((tenancy) => tenancy.monthlyRent + tenancy.monthlyForfait),
    );
    if (actual === expected || seen.has(actual)) continue;
    seen.add(actual);
    warnings.push({ code: 'contratto-mensile', expected, actual });
  }
  return warnings;
}

export interface SupplementaryRow {
  tenantId: string;
  delta: Cents;
  /** The tenant's last tenancy ended before the month of `asOf`. */
  departed: boolean;
  /**
   * `da-rimborsare` for a credit; for a debt `da-pagare`, or `da-trattenere-o-richiedere` when the
   * tenant has left (from the deposit, else asked for, else the owner's loss; never shared out).
   */
  action: 'da-pagare' | 'da-rimborsare' | 'da-trattenere-o-richiedere';
}

/**
 * The supplementary settlement of a closed period (R5): for each tenant of either calculation, the
 * difference in costs (`spese + condominio.rata + commissione`) between `current` and the
 * `snapshot` taken at closing. The flat charge is left out (a period closes only when all of it
 * is collected) and so is last year's condominium settlement (it belongs to the next fiscal year).
 */
export function calcConguaglioSupplementare(input: {
  current: ConguaglioResult;
  snapshot: ConguaglioResult;
  tenancies: Tenancy[];
  asOf: ISODate;
}): { tenants: SupplementaryRow[]; unassignedDelta: Cents } {
  const costs = (result: ConguaglioResult): Map<string, number> =>
    new Map(result.tenants.map((t) => [t.tenantId, t.spese + t.condominio.rata + t.commissione]));
  const now = costs(input.current);
  const before = costs(input.snapshot);
  const asOfMonth = input.asOf.slice(0, 7);
  const ids = [...new Set([...now.keys(), ...before.keys()])].sort(compareText);
  const tenants = ids.map((tenantId): SupplementaryRow => {
    const delta = cents((now.get(tenantId) ?? 0) - (before.get(tenantId) ?? 0));
    const own = input.tenancies.filter((tenancy) => tenancy.tenantId === tenantId);
    const departed =
      own.length > 0 && own.every((tenancy) => tenancy.to !== undefined && tenancy.to < asOfMonth);
    const action =
      delta < 0
        ? 'da-rimborsare'
        : departed && delta > 0
          ? 'da-trattenere-o-richiedere'
          : 'da-pagare';
    return { tenantId, delta, departed, action };
  });
  return {
    tenants,
    unassignedDelta: cents(input.current.unassigned - input.snapshot.unassigned),
  };
}

export type CloseMissing =
  | { tenantId: string; month: YearMonth; kind: 'rent' | 'forfait'; amount: Cents }
  | { kind: 'item'; itemType: BillMatch['itemType']; itemId: string };

/**
 * Whether the period can be closed (R5): every rent and flat charge of `months` collected in full
 * with confirmed payments, and no item with months in the period still waiting for its debit
 * (for Berchet, the December TARI notice that covers September). `missing` lists what is not.
 */
export function canClosePeriod(input: {
  tenancies: Tenancy[];
  payments: Payment[];
  months: YearMonth[];
  pending: { itemType: BillMatch['itemType']; itemId: string; months: YearMonth[] }[];
}): { ok: boolean; missing: CloseMissing[] } {
  const missing: CloseMissing[] = [];
  for (const row of collectedForfait(input)) {
    const rentPaid = Math.min(Math.max(row.paid, 0), row.rentDue);
    if (rentPaid < row.rentDue) {
      missing.push({
        tenantId: row.tenantId,
        month: row.month,
        kind: 'rent',
        amount: cents(row.rentDue - rentPaid),
      });
    }
    if (row.forfaitCollected < row.forfaitDue) {
      missing.push({
        tenantId: row.tenantId,
        month: row.month,
        kind: 'forfait',
        amount: cents(row.forfaitDue - row.forfaitCollected),
      });
    }
  }
  const months = new Set(input.months);
  const waiting = input.pending
    .filter((item) => item.months.some((month) => months.has(month)))
    .sort((a, b) => compareText(a.itemType, b.itemType) || compareText(a.itemId, b.itemId));
  for (const { itemType, itemId } of waiting) missing.push({ kind: 'item', itemType, itemId });
  return { ok: missing.length === 0, missing };
}
