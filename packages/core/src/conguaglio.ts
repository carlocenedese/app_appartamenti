/**
 * The settlement (conguaglio) of a period: what each tenant owes once the costs are shared out
 * and the flat charge collected is taken off (section 42, R1-R5, R7; docs/rules/conguaglio-rules.md).
 *
 * - Only items with a confirmed `amount` match count, for the amount debited (R2). The others are
 *   `pending` and change nothing. A condominium instalment must be debited exactly `rata +
 *   conguaglioPrec`, otherwise it stays pending with the reason `importo diverso`.
 * - Every item is split over its months (a bill over its period, an instalment over the months it
 *   covers, last year's condominium settlement over the 12 months of the current fiscal year),
 *   leftover cents to the first months. Each month's share is then split over the tenants present
 *   that month, not over the beds (plan 21, decided by user1 on 19 Nov 2026), leftover cents to
 *   the first of them in the order of `apartment.rooms` (without `rooms`, sorted by id). A month
 *   with nobody present goes to the owner (`unassigned`).
 * - Only the months inside the period count: the others belong to another period's settlement.
 * - The owner's yearly condominium share (`quotaProprieta`) comes off the instalments in equal
 *   parts, only from records with a non-zero `rata` (a record that only carries last year's
 *   settlement has no owner share). An instalment whose owner share exceeds its `rata` stays
 *   pending (`parte della proprietà maggiore della rata`) rather than giving the tenants a credit.
 *   An extraordinary instalment is the owner's alone and never reaches the tenants.
 * - A commission row matched to an item follows the item: same months, same tenants (R7).
 * - The amount due is the tenant's share of the costs minus the flat charge actually collected
 *   (R4), with each month's rent payments going to the rent first.
 *
 * - Deleted records (`deleted: true`) are ignored.
 * - Input that cannot be settled (a tenant with two tenancies in one month, two tenants in one
 *   room, a room that is not a bed, more tenants than beds, last year's condominium settlement
 *   without `apartment.condominioStart`) throws a `SettlementInputError` before any amount is
 *   computed (R-C9).
 *
 * The result never depends on the order of the input.
 */
import { rentForMonth } from './contract';
import { expectedDebit } from './match';
import type {
  Apartment,
  Bill,
  BillMatch,
  Contract,
  Instalment,
  Payment,
  Tenancy,
  TenantRecovery,
} from './model';
import { cents, splitCents } from './money';
import type { Cents } from './money';
import { annualitaRange, daysBetween, isoDate, lastDayOfMonth, monthsInPeriod } from './period';
import type { ISODate, YearMonth } from './period';
import { compareText } from './text';
import { bedsAt } from './valid-from';
import { CALC_VERSION, PER_BED_CALC_VERSION } from './version';

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
  /** Only for the R34 check: the rent of the month from the contract covering it, if any. */
  contracts?: Contract[];
  /** Recoveries from tenants chosen by user1 (plan 8, R197); none when absent. */
  recoveries?: TenantRecovery[];
  /**
   * Every settlement period of the apartment (this one included), to give a settlement payment
   * (R177) or a recovery without period (R300) to one period only; without it, only `period`.
   */
  periods?: { from: YearMonth; to: YearMonth }[];
  /**
   * The movements a recovery may recover (plan 17, R300): live, booked, outgoing, with a live class
   * of the apartment that is not an exclusion (`recoverableMovements`). Absent: none.
   */
  recoverableMovements?: ReadonlySet<string>;
  /**
   * The items the matching leaves «da verificare» (B1, `planMatch`): pending with that reason.
   * An `assumed` match stored before B1 is never paid either and gives the same reason.
   */
  unverified?: readonly { itemType: BillMatch['itemType']; itemId: string }[];
  /**
   * How a month's costs are split (plan 21, R363): `present` (default) among the tenants present;
   * `beds` over the beds, empty ones to the owner, only to recompute a period closed before plan
   * 21 (`splitOfClosing`).
   */
  split?: 'present' | 'beds';
}

/**
 * The split of a period with this live closing (R363, decided by user1 on 19 Nov 2026): a snapshot
 * of the calculation before plan 21 keeps the split over the beds; an open or reopened period
 * (no live closing) and a later snapshot use the split among the tenants present.
 */
export const splitOfClosing = (
  closing: { engineVersion: string } | undefined,
): 'present' | 'beds' => (closing?.engineVersion === PER_BED_CALC_VERSION ? 'beds' : 'present');

type Span = { from: YearMonth; to: YearMonth };

/**
 * The settlement period a payment of `month` without `forMonth` belongs to (R177, user1's D11 and
 * D13): a period takes the months from its start to the end of the next one (the first that starts
 * after it; none: no end). Among the periods that take `month`, one already ended gets it (the
 * latest starting); otherwise the one that starts last. So a date inside a later period still open
 * goes to the earlier one, and the later one shows nothing paid until it ends (D11).
 */
export function settlementPeriodOf(month: YearMonth, periods: readonly Span[]): Span | undefined {
  const sorted = [...periods].sort(
    (a, b) => compareText(a.from, b.from) || compareText(a.to, b.to),
  );
  const takes = sorted.filter((p) => {
    const next = sorted.find((q) => q.from > p.from);
    return p.from <= month && (next === undefined || month <= next.to);
  });
  const ended = takes.filter((p) => p.to < month);
  return (ended.length > 0 ? ended : takes).at(-1);
}

export interface TenantSettlement {
  tenantId: string;
  /** Bills and TARI. */
  spese: Cents;
  condominio: { rata: Cents; conguaglioPrec: Cents };
  commissione: Cents;
  forfaitIncassato: Cents;
  /** What this tenant owes for an intervention they caused (plan 8, R197); only when not 0. */
  recupero?: Cents;
  /** `spese + condominio.rata + condominio.conguaglioPrec + commissione + recupero - forfaitIncassato`. */
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
  /**
   * The rents and flat charges of a month do not add up to the contract (R4, R34): a check only.
   * `expected` is the rent plus advance of the live contract with the latest start covering the
   * month and with a rent entry for it, else `apartment.contrattoMensile`.
   */
  code: 'contratto-mensile';
  expected: Cents;
  actual: Cents;
}

export interface ConguaglioResult {
  /** `CALC_VERSION` (`PER_BED_CALC_VERSION` with `split: 'beds'`), so a snapshot can be reproduced. */
  engineVersion: string;
  /** Every tenant present in the period, sorted by id. */
  tenants: TenantSettlement[];
  /** The months with no tenant present, left to the owner (plan 21: empty beds have no share). */
  unassigned: Cents;
  /** `unassigned` by kind of cost, like the tenant rows (bills and TARI are `spese`). */
  unassignedByBucket: { spese: Cents; rata: Cents; conguaglioPrec: Cents; commissione: Cents };
  /** Items in the period that do not count yet, sorted by type and id. */
  pending: PendingItem[];
  warnings: ConguaglioWarning[];
}

/** The reason of a pending extraordinary expense with a recovery not yet debited (R197). */
export const RECOVERY_WAITING = 'recupero in attesa del pagamento';

/** The reason of an item no statement covers, with no debit seen (B1). */
export const UNVERIFIED = 'da verificare';

export const CATEGORY_ORDER: readonly CostCategory[] = [
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

export const isPresent = (tenancy: Tenancy, month: YearMonth): boolean =>
  tenancy.from <= month && (tenancy.to === undefined || month <= tenancy.to);

const byTenancy = (a: Tenancy, b: Tenancy): number =>
  compareText(a.tenantId, b.tenantId) || compareText(a.from, b.from) || compareText(a.id, b.id);

/** What is wrong with the input of a settlement (R-C9). */
export type SettlementInputErrorCode =
  | 'tenant-overlap'
  | 'room-overlap'
  | 'unknown-room'
  | 'too-many-tenants'
  | 'missing-condominio-start'
  | 'recovery-tenant-absent'
  | 'owner-share-inconsistent';

/**
 * Input that cannot be settled: tenancies that do not fit the beds, or a condominium instalment
 * that cannot be placed in its fiscal year. Thrown before any amount is computed. The message is
 * in Italian (it reaches the interface); the fix is to correct the records (for an overlap, the
 * tenancy dates: rule (c) of conguaglio-rules.md).
 */
export class SettlementInputError extends Error {
  readonly code: SettlementInputErrorCode;
  readonly month?: YearMonth;
  readonly room?: string;
  readonly tenancyIds?: string[];
  readonly tenantId?: string;
  readonly instalmentId?: string;
  /** `owner-share-inconsistent`: the rates whose share differs from most of the esercizio. */
  readonly instalmentIds?: string[];

  constructor(
    code: SettlementInputErrorCode,
    message: string,
    details: {
      month?: YearMonth;
      room?: string;
      tenancyIds?: string[];
      tenantId?: string;
      instalmentId?: string;
      instalmentIds?: string[];
    } = {},
  ) {
    super(message);
    this.name = 'SettlementInputError';
    this.code = code;
    Object.assign(this, details);
  }
}

const live = <T extends { deleted?: boolean }>(records: readonly T[]): T[] =>
  records.filter((record) => record.deleted !== true);

/**
 * Throws `tenant-overlap` when a tenant has two tenancies present in the same month of `months`
 * (a room change must end one month and start the next: months are whole and inclusive).
 */
export function checkTenantOverlaps(
  tenancies: readonly Tenancy[],
  months: readonly YearMonth[],
): void {
  for (const month of months) {
    const byTenant = new Map<string, Tenancy[]>();
    for (const tenancy of tenancies) {
      if (!isPresent(tenancy, month)) continue;
      byTenant.set(tenancy.tenantId, [...(byTenant.get(tenancy.tenantId) ?? []), tenancy]);
    }
    for (const [tenantId, overlapping] of byTenant) {
      if (overlapping.length < 2) continue;
      const tenancyIds = overlapping.map((tenancy) => tenancy.id).sort(compareText);
      throw new SettlementInputError(
        'tenant-overlap',
        `L'inquilino ${tenantId} ha due periodi di presenza nel mese ${month} ` +
          `(${tenancyIds.join(', ')}): correggi le date.`,
        { month, tenantId, tenancyIds },
      );
    }
  }
}

/**
 * A bill's amount (or `amount`) split over the months of its period in proportion to the days of
 * the period in each month (B2, decided by user1 on 18 Nov 2026). Each month gets the floor of its
 * share and the cents left over go one each to the first months (R1), on the absolute value, so
 * that a credit note is the mirror image. So a shorter month may get one cent more than a longer
 * one: the owner's example (1,48 / 45,74 / 42,78 €) requires it.
 */
export function allocateBillToMonths(bill: Bill, amount: Cents = bill.amount): MonthShare[] {
  const { periodStart: start, periodEnd: end } = bill;
  const months = monthsInPeriod(start, end);
  const days = months.map((month) => {
    const first = isoDate(`${month}-01`);
    const last = lastDayOfMonth(month);
    return daysBetween(last < end ? last : end, first > start ? first : start) + 1;
  });
  const totalDays = days.reduce((sum, d) => sum + d, 0);
  const magnitude = Math.abs(amount);
  const parts = days.map((d) => Math.floor((magnitude * d) / totalDays));
  // Fewer cents are left than there are months.
  let left = magnitude - parts.reduce((sum, p) => sum + p, 0);
  for (let i = 0; left > 0; i += 1, left -= 1) parts[i] = (parts[i] as number) + 1;
  const sign = amount < 0 ? -1 : 1;
  return months.map((month, index) => ({ month, amount: cents(sign * (parts[index] as number)) }));
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
 * Whether last year's condominium settlement (`conguaglioPrec`, the difference consuntivo −
 * preventivo) goes to the tenants (R3): yes unless the apartment says `owner` (plan 8, R193).
 */
export const previousToTenants = (apartment: Apartment): boolean =>
  apartment.condoDifferenceTo !== 'owner';

/**
 * This instalment's part of the owner's yearly condominium share, split equally among the rates.
 * A record with `rata` 0 (last year's settlement paid on its own) carries no owner share, whatever
 * its `quotaProprieta` says (R-C8): the yearly share comes off the ordinary instalments only.
 */
export function instalmentOwnerShare(instalment: Instalment): Cents {
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
 * With `previousToTenants` false (`condoDifferenceTo: 'owner'`, R193) last year's settlement stays
 * with the owner: it comes off the debit and is shared with nobody.
 */
export function allocateInstalment(
  instalment: Instalment,
  paid: Cents,
  esercizioRange?: { from: ISODate; to: ISODate },
  previousToTenants = true,
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
  const net = cents(paid - previous - instalmentOwnerShare(instalment));
  equalSplit(net, covered.length).forEach((amount, index) => {
    row(covered[index] as YearMonth).rata += amount;
  });
  if (previous !== 0 && previousToTenants) {
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
 * and month. Deleted records are ignored; a tenant with two tenancies in one month throws a
 * `SettlementInputError` (`tenant-overlap`). Only confirmed `canone` payments count, for their `forMonth` (else the month of their
 * date); they go to the rent first, then to the flat charge, and any excess is ignored (R4).
 */
export function collectedForfait(input: {
  tenancies: Tenancy[];
  payments: Payment[];
  months: YearMonth[];
}): ForfaitMonth[] {
  const tenancies = live(input.tenancies);
  checkTenantOverlaps(tenancies, input.months);
  const paidBy = new Map<string, number>();
  for (const payment of live(input.payments)) {
    if (!payment.confirmed || payment.kind !== 'canone') continue;
    const key = `${payment.tenantId}\u0000${payment.forMonth ?? payment.date.slice(0, 7)}`;
    paidBy.set(key, (paidBy.get(key) ?? 0) + payment.amount);
  }
  const rows: ForfaitMonth[] = [];
  for (const tenancy of [...tenancies].sort(byTenancy)) {
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
 * `SettlementInputError` when the tenancies do not fit the beds: a room that is not a bed of the
 * apartment (`unknown-room`), two tenancies in one room (`room-overlap`), more tenants than beds
 * (`too-many-tenants`).
 */
function bedsIn(
  apartment: Apartment,
  present: Tenancy[],
  month: YearMonth,
): (string | undefined)[] {
  // Plan 22: the beds in force in the month («valido dal»).
  const { rooms, posti } = bedsAt(apartment, month);
  if (rooms !== undefined) {
    for (const tenancy of present) {
      if (tenancy.room === undefined || !rooms.includes(tenancy.room)) {
        throw new SettlementInputError(
          'unknown-room',
          tenancy.room === undefined
            ? `Il periodo di presenza ${tenancy.id} non indica il posto.`
            : `Il periodo di presenza ${tenancy.id} indica il posto «${tenancy.room}», che non è ` +
                `un posto dell'appartamento ${apartment.name}.`,
          {
            month,
            tenantId: tenancy.tenantId,
            tenancyIds: [tenancy.id],
            ...(tenancy.room === undefined ? {} : { room: tenancy.room }),
          },
        );
      }
    }
    return rooms.map((room) => {
      const inRoom = present.filter((tenancy) => tenancy.room === room);
      if (inRoom.length > 1) {
        const tenancyIds = inRoom.map((tenancy) => tenancy.id).sort(compareText);
        throw new SettlementInputError(
          'room-overlap',
          `Il posto «${room}» ha due inquilini nel mese ${month} (${tenancyIds.join(', ')}): ` +
            'correggi le date.',
          { month, room, tenancyIds },
        );
      }
      return inRoom[0]?.tenantId;
    });
  }
  if (present.length > posti) {
    throw new SettlementInputError(
      'too-many-tenants',
      `Nel mese ${month} ci sono ${present.length} inquilini per ${posti} posti.`,
      { month, tenancyIds: present.map((tenancy) => tenancy.id).sort(compareText) },
    );
  }
  return [
    ...present.map((tenancy) => tenancy.tenantId),
    ...Array.from({ length: posti - present.length }, () => undefined),
  ];
}

/**
 * The checks `calcConguaglio` makes on the tenancies, for the live tenancies of `apartment` in
 * `months` (plan 11: a write refuses what would make the conguaglio throw). Throws the same
 * `SettlementInputError` (`tenant-overlap`, `unknown-room`, `room-overlap`, `too-many-tenants`).
 */
export function checkBeds(
  apartment: Apartment,
  tenancies: readonly Tenancy[],
  months: readonly YearMonth[],
): void {
  const own = live(tenancies).filter((t) => t.apartmentId === apartment.id);
  checkTenantOverlaps(own, months);
  for (const month of months) {
    bedsIn(
      apartment,
      own.filter((t) => isPresent(t, month)),
      month,
    );
  }
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
 * The settlement of `input.period` for `input.apartment`. Records of other apartments and deleted
 * records are ignored. Before computing anything it throws a `SettlementInputError` when the
 * tenancies do not fit the beds or overlap for one tenant, or when a condominium instalment
 * carries last year's settlement and the apartment has no `condominioStart` to place its fiscal
 * year (whatever its months: without the fiscal year they cannot be known), unless that settlement
 * stays with the owner (`condoDifferenceTo: 'owner'`, R193).
 */
export function calcConguaglio(input: ConguaglioInput): ConguaglioResult {
  const { apartment, period } = input;
  const own = <T extends { apartmentId: string; deleted?: boolean }>(records: T[]): T[] =>
    live(records).filter((record) => record.apartmentId === apartment.id);
  const periodMonths = monthRange(period.from, period.to);
  const inPeriod = new Set(periodMonths);
  const touchesPeriod = (months: YearMonth[]): boolean => months.some((m) => inPeriod.has(m));

  const tenancies = own(input.tenancies)
    .filter((tenancy) => periodMonths.some((month) => isPresent(tenancy, month)))
    .sort(byTenancy);
  checkTenantOverlaps(tenancies, periodMonths);
  const instalments = own(input.instalments)
    .filter((instalment) => instalment.straordinaria !== true)
    .sort((a, b) => compareText(a.id, b.id));
  const toTenants = previousToTenants(apartment);
  // R3, I5: per esercizio, the ordinary condominium rates whose (owner share, rate count) is not
  // the one most of them have (all of them on a tie); a record with `rata` 0 carries no owner
  // share (R-C8) and is left out.
  const ownerShareOdd = new Map<string, string[]>();
  {
    const byEsercizio = new Map<string, Instalment[]>();
    for (const i of instalments) {
      if (i.kind !== 'condominio' || i.rata === 0) continue;
      byEsercizio.set(i.esercizio, [...(byEsercizio.get(i.esercizio) ?? []), i]);
    }
    const kindOf = (i: Instalment) => `${String(i.quotaProprieta)}/${String(i.rateCount)}`;
    for (const [esercizio, rates] of byEsercizio) {
      const counts = new Map<string, number>();
      for (const i of rates) counts.set(kindOf(i), (counts.get(kindOf(i)) ?? 0) + 1);
      if (counts.size === 1) continue;
      const top = Math.max(...counts.values());
      const winners = [...counts].filter(([, n]) => n === top);
      const odd = rates.filter((i) => winners.length > 1 || kindOf(i) !== winners[0]?.[0]);
      ownerShareOdd.set(esercizio, odd.map((i) => i.id).sort(compareText));
    }
  }
  for (const instalment of instalments) {
    if (
      toTenants &&
      instalment.kind === 'condominio' &&
      instalment.conguaglioPrec !== 0 &&
      apartment.condominioStart === undefined
    ) {
      throw new SettlementInputError(
        'missing-condominio-start',
        `La rata ${instalment.id} contiene il conguaglio dell'anno prima, ma per l'appartamento ` +
          `${apartment.name} manca l'inizio dell'esercizio condominiale.`,
        { instalmentId: instalment.id },
      );
    }
  }
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
  const unassigned: Record<Bucket, number> = {
    spese: 0,
    rata: 0,
    conguaglioPrec: 0,
    commissione: 0,
  };
  // A month's amount over the tenants present, in the order of the beds (plan 21); a month with
  // nobody present stays with the owner. Months outside the period belong to another settlement.
  const perBed = input.split === 'beds';
  const share = (month: YearMonth, amount: number, bucket: Bucket, category?: CostCategory) => {
    const occupants = beds.get(month);
    if (occupants === undefined || amount === 0) return;
    // Per bed (before plan 21): every bed has a part, an empty one goes to the owner.
    const parts = perBed ? occupants : occupants.filter((tenantId) => tenantId !== undefined);
    if (parts.length === 0) {
      unassigned[bucket] += amount;
      return;
    }
    equalSplit(cents(amount), parts.length).forEach((part, i) => {
      const tenantId = parts[i];
      if (tenantId === undefined) {
        unassigned[bucket] += part;
        return;
      }
      // Every tenant present has a tally: `tallies` holds all the tenancies of the period.
      const tally = tallies.get(tenantId) as Tally;
      tally[bucket] += part;
      if (category !== undefined) {
        tally.byCategory.set(category, (tally.byCategory.get(category) ?? 0) + part);
      }
    });
  };

  // Confirmed matches by item and part; an `assumed` one stored before B1 is no debit seen.
  const toVerify = new Set(
    (input.unverified ?? []).map((item) => `${item.itemType}\u0000${item.itemId}`),
  );
  const matched = new Map<string, { amount: number; commission: number; hasAmount: boolean }>();
  for (const match of live(input.matches)) {
    if (!match.confirmed) continue;
    const key = `${match.itemType}\u0000${match.itemId}`;
    if (match.by === 'assumed') {
      toVerify.add(key);
      continue;
    }
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
  /** An item without a debit: «da verificare» when no statement covers it (B1). */
  const waitingFor = (itemType: PendingItem['itemType'], itemId: string): PendingItem =>
    toVerify.has(`${itemType}\u0000${itemId}`)
      ? { itemType, itemId, reason: UNVERIFIED }
      : { itemType, itemId };

  // Plan 8, R197: the recoveries user1 put in this period, on a live extraordinary expense. Plan
  // 17, R300: without a period, the period of the day of the expense; an expense paid to a
  // supplier (a movement) or none (a negative recovery) counts too.
  const extraordinary = new Set(
    own(input.instalments)
      .filter((i) => i.kind === 'condominio' && i.straordinaria === true)
      .map((i) => i.id),
  );
  // One period only: the one `settlementPeriodOf` gives (R177), as the settlement payments.
  const homeIsThis = (month: YearMonth) => {
    const home = settlementPeriodOf(month, input.periods ?? [period]);
    return home?.from === period.from && home.to === period.to;
  };
  const recoveries = own(input.recoveries ?? [])
    .filter(
      (r) =>
        (r.periodLabel === undefined
          ? r.date !== undefined && homeIsThis(r.date.slice(0, 7) as YearMonth)
          : r.periodLabel === period.label) &&
        r.status !== 'non-recuperabile' &&
        (r.instalmentId === undefined || extraordinary.has(r.instalmentId)) &&
        (r.transactionId === undefined ||
          input.recoverableMovements?.has(r.transactionId) === true),
    )
    .sort((a, b) => compareText(a.id, b.id));
  for (const recovery of recoveries) {
    // A tenant already gone from the period of the expense: kept from the deposit (R300).
    if (recovery.periodLabel === undefined) continue;
    const absent = recovery.shares.find((share) => !tallies.has(share.tenantId));
    if (absent !== undefined) {
      throw new SettlementInputError(
        'recovery-tenant-absent',
        `Il recupero ${recovery.id} è a carico di un inquilino che non c'è nel periodo ` +
          `${period.label}: scegli un altro periodo o un altro inquilino.`,
        { tenantId: absent.tenantId },
      );
    }
  }

  for (const bill of [...own(input.bills)].sort((a, b) => compareText(a.id, b.id))) {
    if (!bill.includedInConguaglio || !bill.sharedWithTenants) continue;
    if (!touchesPeriod(monthsInPeriod(bill.periodStart, bill.periodEnd))) continue;
    const paid = matched.get(`bill\u0000${bill.id}`);
    if (paid === undefined || !paid.hasAmount) {
      pending.push(waitingFor('bill', bill.id));
      continue;
    }
    for (const { month, amount } of allocateBillToMonths(bill, cents(paid.amount))) {
      share(month, amount, 'spese', bill.category);
    }
    for (const { month, amount } of allocateBillToMonths(bill, cents(paid.commission))) {
      share(month, amount, 'commissione');
    }
  }

  for (const instalment of instalments) {
    const covered = monthRange(instalment.coversFrom, instalment.coversTo);
    const esercizio =
      instalment.kind === 'condominio' && apartment.condominioStart !== undefined
        ? annualitaRange(instalment.esercizio, apartment.condominioStart)
        : undefined;
    const previousYear =
      toTenants && esercizio !== undefined && instalment.conguaglioPrec !== 0
        ? monthsInPeriod(esercizio.from, esercizio.to)
        : [];
    if (!touchesPeriod([...covered, ...previousYear])) continue;
    const odd =
      instalment.kind === 'condominio' ? ownerShareOdd.get(instalment.esercizio) : undefined;
    if (odd !== undefined) {
      // One yearly owner share per apartment and esercizio, split over `rateCount` rates: records
      // that disagree cannot be settled without guessing which one is right.
      throw new SettlementInputError(
        'owner-share-inconsistent',
        `Le rate del condominio ${instalment.esercizio} di ${apartment.name} non hanno la stessa ` +
          `quota della proprietà o lo stesso numero di rate (diverse: ${odd.join(', ')}): ` +
          `correggi le rate, poi rifai il conguaglio.`,
        { instalmentIds: odd },
      );
    }
    const paid = matched.get(`instalment\u0000${instalment.id}`);
    if (paid === undefined || !paid.hasAmount) {
      pending.push(waitingFor('instalment', instalment.id));
      continue;
    }
    if (instalment.kind === 'condominio' && paid.amount !== expectedDebit(instalment)) {
      pending.push({ itemType: 'instalment', itemId: instalment.id, reason: 'importo diverso' });
      continue;
    }
    if (instalment.rata > 0 && instalmentOwnerShare(instalment) > instalment.rata) {
      pending.push({
        itemType: 'instalment',
        itemId: instalment.id,
        reason: 'parte della proprietà maggiore della rata',
      });
      continue;
    }
    for (const part of allocateInstalment(instalment, cents(paid.amount), esercizio, toTenants)) {
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

  // R2: a recovery counts once the expense it recovers is debited, never on an assumed match
  // (lotto 10: only after it is paid).
  const recovered = new Map<string, number>();
  const waiting = new Set<string>();
  for (const recovery of recoveries) {
    const { instalmentId } = recovery;
    if (
      instalmentId !== undefined &&
      matched.get(`instalment\u0000${instalmentId}`)?.hasAmount !== true
    ) {
      waiting.add(instalmentId);
      continue;
    }
    for (const share of recovery.shares) {
      if (!tallies.has(share.tenantId)) continue;
      recovered.set(share.tenantId, (recovered.get(share.tenantId) ?? 0) + share.amount);
    }
  }
  for (const itemId of waiting) {
    pending.push({ itemType: 'instalment', itemId, reason: RECOVERY_WAITING });
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
    const recupero = recovered.get(tenantId) ?? 0;
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
      ...(recupero === 0 ? {} : { recupero: cents(recupero) }),
      due: cents(
        tally.spese +
          tally.rata +
          tally.conguaglioPrec +
          tally.commissione +
          recupero -
          forfaitIncassato,
      ),
      byCategory,
    };
  });

  return {
    engineVersion: perBed ? PER_BED_CALC_VERSION : CALC_VERSION,
    tenants,
    unassigned: cents(
      unassigned.spese + unassigned.rata + unassigned.conguaglioPrec + unassigned.commissione,
    ),
    unassignedByBucket: {
      spese: cents(unassigned.spese),
      rata: cents(unassigned.rata),
      conguaglioPrec: cents(unassigned.conguaglioPrec),
      commissione: cents(unassigned.commissione),
    },
    pending: pending.sort(
      (a, b) => compareText(a.itemType, b.itemType) || compareText(a.itemId, b.itemId),
    ),
    warnings: contractWarnings(apartment, own(input.contracts ?? []), tenancies, periodMonths),
  };
}

/** One warning for each pair of contract rent and monthly total of rents and flat charges. */
function contractWarnings(
  apartment: Apartment,
  contracts: Contract[],
  tenancies: Tenancy[],
  months: YearMonth[],
): ConguaglioWarning[] {
  // Latest start first, then id: two live contracts on one month are a `contract-overlap`.
  const byStart = [...contracts].sort(
    (a, b) => compareText(b.start, a.start) || compareText(a.id, b.id),
  );
  const seen = new Set<string>();
  const warnings: ConguaglioWarning[] = [];
  for (const month of months) {
    const rent = byStart
      .filter((c) => c.start <= month && month <= c.end)
      .map((c) => rentForMonth(c, month))
      .find((r) => r !== undefined);
    const expected =
      rent === undefined
        ? apartment.contrattoMensile
        : cents(rent.monthlyRent + rent.monthlyAdvance);
    if (expected === undefined) continue;
    const actual = total(
      tenancies
        .filter((tenancy) => isPresent(tenancy, month))
        .map((tenancy) => tenancy.monthlyRent + tenancy.monthlyForfait),
    );
    const key = `${expected}/${actual}`;
    if (actual === expected || seen.has(key)) continue;
    seen.add(key);
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
   * `nessuna` for no difference, `da-rimborsare` for a credit; for a debt `da-pagare`, or `da-trattenere-o-richiedere` when the
   * tenant has left (from the deposit, else asked for, else the owner's loss; never shared out).
   */
  action: 'nessuna' | 'da-pagare' | 'da-rimborsare' | 'da-trattenere-o-richiedere';
}

/** What the supplementary settlement reads of a calculation (a `ConguaglioResult` is one). */
export interface SettlementCosts {
  tenants: readonly {
    tenantId: string;
    spese: Cents;
    condominio: { rata: Cents };
    commissione: Cents;
    /** What the tenant owes for an intervention (R197); absent is 0. */
    recupero?: Cents;
  }[];
  unassigned: Cents;
  unassignedByBucket: { conguaglioPrec: Cents };
}

/**
 * The supplementary settlement of a closed period (R5): for each tenant of either calculation, the
 * difference in costs (`spese + condominio.rata + commissione + recupero`) between `current` and the
 * `snapshot` taken at closing. The flat charge is left out (a period closes only when all of it
 * is collected) and so is last year's condominium settlement (it belongs to the next fiscal year).
 * `unassignedDelta` is the same difference for the owner (the months with no tenant present, plan
 * 21), so the deltas and `unassignedDelta`
 * add up to the net cost of the late items. A tenant with no tenancy in `tenancies` counts as
 * departed (R-C10).
 */
export function calcConguaglioSupplementare(input: {
  current: SettlementCosts;
  snapshot: SettlementCosts;
  tenancies: Tenancy[];
  asOf: ISODate;
}): { tenants: SupplementaryRow[]; unassignedDelta: Cents } {
  const emptyBeds = (result: SettlementCosts): number =>
    result.unassigned - result.unassignedByBucket.conguaglioPrec;
  const costs = (result: SettlementCosts): Map<string, number> =>
    new Map(
      result.tenants.map((t) => [
        t.tenantId,
        t.spese + t.condominio.rata + t.commissione + (t.recupero ?? 0),
      ]),
    );
  const now = costs(input.current);
  const before = costs(input.snapshot);
  const asOfMonth = input.asOf.slice(0, 7);
  const ids = [...new Set([...now.keys(), ...before.keys()])].sort(compareText);
  const tenants = ids.map((tenantId): SupplementaryRow => {
    const delta = cents((now.get(tenantId) ?? 0) - (before.get(tenantId) ?? 0));
    const own = input.tenancies.filter((tenancy) => tenancy.tenantId === tenantId);
    // A tenant without tenancies is no longer here either (R-C10).
    const departed = live(own).every(
      (tenancy) => tenancy.to !== undefined && tenancy.to < asOfMonth,
    );
    const action =
      delta === 0
        ? 'nessuna'
        : delta < 0
          ? 'da-rimborsare'
          : departed
            ? 'da-trattenere-o-richiedere'
            : 'da-pagare';
    return { tenantId, delta, departed, action };
  });
  return {
    tenants,
    unassignedDelta: cents(emptyBeds(input.current) - emptyBeds(input.snapshot)),
  };
}

/**
 * Plan 22: the rent not collected per tenant over `months` (the `rent` part of `canClosePeriod`):
 * the row «Canone non incassato» of a period closed again after a reopening. Read from today's
 * payments, which a closed period keeps still: a new payment for the month takes it away.
 */
export function rentNotCollected(input: {
  tenancies: Tenancy[];
  payments: Payment[];
  months: YearMonth[];
}): Map<string, Cents> {
  const owed = new Map<string, Cents>();
  for (const m of canClosePeriod({ ...input, pending: [] }).missing) {
    if (m.kind === 'rent') owed.set(m.tenantId, cents((owed.get(m.tenantId) ?? 0) + m.amount));
  }
  return owed;
}

export type CloseMissing =
  | { tenantId: string; month: YearMonth; kind: 'rent' | 'forfait'; amount: Cents }
  | { kind: 'item'; itemType: BillMatch['itemType']; itemId: string };

/**
 * Whether the period can be closed (R5): every rent and flat charge of `months` collected in full
 * with confirmed payments, and no item with months in the period still waiting for its debit
 * (for Appartamento A, the December TARI notice that covers September). `missing` lists what is not.
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
