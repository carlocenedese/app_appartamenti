/**
 * «Tasse e stime» (plan 10, section 34): one table per taxpayer (the `locatore` of the apartments,
 * data) with, for each voce, the estimate typed by user1, what the CSV shows as paid, what is still
 * expected, the difference and a state; the January warning on a year without estimates. Pure: no
 * tax is computed here (no rate in the code); the cedolare estimate of R182 is only shown beside.
 */
import { cedolareExpected, cedolareRateForYear } from './contract';
import { imuRates } from './imu';
import { expectedDebit } from './match';
import { TAX_VOICES } from './model';
import type {
  Apartment,
  BankTransaction,
  BillMatch,
  Contract,
  ImuYear,
  Instalment,
  MovementClass,
  RentYear,
  TaxEstimate,
  TaxPayment,
  TaxVoice,
} from './model';
import { cents } from './money';
import type { Cents } from './money';
import type { ISODate } from './period';
import { compareText } from './text';

/** Answer 7 of user1 (14 November 2026): confirm discrepancies above 0,10 €. A threshold, not a rate. */
export const TAX_DISCREPANCY_TOLERANCE: Cents = cents(10);

export type TaxRowState = 'in-linea' | 'discrepanza' | 'da-verificare';

/** Why a row is `da-verificare`: an input is missing or ambiguous, or a rule is not decided. */
export type TaxReason =
  | 'missing-estimate'
  | 'imu-mixed-taxpayers'
  | 'imu-expected-missing'
  | 'imu-to-check'
  | 'assumed-payment'
  | 'stale-assignment'
  | 'unassigned-tax-movement'
  | 'no-expected-source'
  | 'rule-undecided';

/** An amount still expected from Scadenze e pagamenti (plan 9), for the voci without own records. */
export interface TaxExpectedItem {
  apartmentId: string;
  voce: 'cedolare' | 'registro';
  year: string;
  amount: Cents;
}

export interface TaxRow {
  voce: TaxVoice;
  state: TaxRowState;
  /** Sorted; empty unless `da-verificare`. */
  reasons: TaxReason[];
  /** Only when every apartment of the taxpayer has an estimate for the voce and year. */
  estimate?: Cents;
  paid?: Cents;
  expected?: Cents;
  /** paid + expected − estimate, only without reasons. */
  difference?: Cents;
  /** The cedolare estimates of R182, to be confirmed: never in the other amounts. */
  cedolareProposals?: { apartmentId: string; amount: Cents }[];
}

export interface TaxpayerTable {
  /** The `locatore` (personal data). */
  taxpayer: string;
  apartmentIds: string[];
  rows: TaxRow[];
}

export interface TaxTableInput {
  year: string;
  /** Whole cents ≥ 0; a difference above it is a `discrepanza`. */
  tolerance: Cents;
  apartments: Apartment[];
  estimates: TaxEstimate[];
  imuYears: ImuYear[];
  classes: MovementClass[];
  transactions: BankTransaction[];
  instalments: Instalment[];
  matches: BillMatch[];
  taxPayments: TaxPayment[];
  contracts: Contract[];
  rentYears: RentYear[];
  /** Absent while plan 9 is not there: cedolare and registro are then `no-expected-source`. */
  expectedItems?: TaxExpectedItem[];
}

const live = <T extends { deleted?: boolean }>(records: readonly T[]): T[] =>
  records.filter((r) => r.deleted !== true);

/** A booked debit: the only movements that pay a tax (R2). */
const isDebit = (tx: BankTransaction | undefined): tx is BankTransaction =>
  tx !== undefined && tx.booked !== false && tx.amount < 0;

/** The tables of `input.year`, by taxpayer; see the file comment and R212. */
export function taxTable(input: TaxTableInput): TaxpayerTable[] {
  const { year, tolerance } = input;
  if (!Number.isSafeInteger(tolerance) || tolerance < 0) {
    throw new RangeError('The threshold must be whole cents, not negative');
  }
  const apartments = live(input.apartments);
  const owner = new Map(apartments.map((a) => [a.id, a.locatore]));
  const transactions = new Map(live(input.transactions).map((t) => [t.id, t]));
  const classes = live(input.classes);
  const classOf = new Map(classes.map((c) => [c.transactionId, c]));
  const taxPayments = live(input.taxPayments);
  const assigned = new Set(taxPayments.map((p) => p.transactionId));
  const matches = live(input.matches).filter(
    (m) => m.itemType === 'instalment' && m.confirmed && m.part === 'amount',
  );
  const rates = imuRates({
    years: input.imuYears,
    classes: input.classes,
    transactions: input.transactions,
  }).filter((r) => r.year === year);
  const taxpayers = [...new Set(apartments.map((a) => a.locatore))].sort(compareText);

  return taxpayers.map((taxpayer) => {
    const apartmentIds = apartments
      .filter((a) => a.locatore === taxpayer)
      .map((a) => a.id)
      .sort(compareText);
    const mine = new Set(apartmentIds);
    const acc = new Map(
      TAX_VOICES.map((voce) => [voce, { paid: 0, expected: 0, reasons: new Set<TaxReason>() }]),
    );
    const at = (voce: TaxVoice) => acc.get(voce) ?? { paid: 0, expected: 0, reasons: new Set() };
    const flag = (voce: TaxVoice, reason: TaxReason) => at(voce).reasons.add(reason);

    // IMU: the rates of the groups of this taxpayer only (the F24 does not separate apartments).
    for (const rate of rates.filter((r) => r.apartmentIds.some((id) => mine.has(id)))) {
      if (!rate.apartmentIds.every((id) => owner.get(id) === taxpayer)) {
        flag('imu', 'imu-mixed-taxpayers');
      } else if (rate.paid !== undefined) {
        at('imu').paid += rate.paid;
        if (rate.status !== 'pagata') flag('imu', 'imu-to-check');
      } else if (rate.expected !== undefined) {
        at('imu').expected += rate.expected;
      } else {
        flag('imu', 'imu-expected-missing');
      }
    }

    // TARI: the esercizio of a TARI instalment is its year.
    for (const instalment of live(input.instalments)) {
      if (instalment.kind !== 'tari' || instalment.esercizio !== year) continue;
      if (!mine.has(instalment.apartmentId)) continue;
      const own = matches.filter((m) => m.itemId === instalment.id);
      const real = own.filter((m) => m.by !== 'assumed');
      if (own.length > real.length) flag('tari', 'assumed-payment');
      if (real.length > 0) at('tari').paid += real.reduce((sum, m) => sum + m.amount, 0);
      else if (own.length === 0) at('tari').expected += expectedDebit(instalment);
    }

    // Cedolare and registro: the parts of the year of the assigned «tasse» debits.
    for (const payment of taxPayments) {
      const tx = transactions.get(payment.transactionId);
      const cls = classOf.get(payment.transactionId);
      const apartmentId = cls?.apartmentId ?? tx?.apartmentId;
      if (apartmentId === undefined || !mine.has(apartmentId)) continue;
      const valid = isDebit(tx) && cls?.kind === 'tasse' && cls.imu === undefined;
      for (const part of payment.parts.filter((p) => p.year === year)) {
        if (valid) at(part.voce).paid += part.amount;
        else flag(part.voce, 'stale-assignment');
      }
    }

    // A «tasse» debit of the year with no assignment could belong to any of these.
    const unassigned = classes.some(
      (c) =>
        c.kind === 'tasse' &&
        c.imu === undefined &&
        c.apartmentId !== undefined &&
        mine.has(c.apartmentId) &&
        !assigned.has(c.transactionId) &&
        isDebit(transactions.get(c.transactionId)) &&
        transactions.get(c.transactionId)?.date.startsWith(`${year}-`) === true,
    );
    if (unassigned) {
      for (const voce of ['cedolare', 'imu', 'registro'] as const) {
        flag(voce, 'unassigned-tax-movement');
      }
    }

    for (const voce of ['cedolare', 'registro'] as const) {
      if (input.expectedItems === undefined) flag(voce, 'no-expected-source');
      for (const item of input.expectedItems ?? []) {
        if (item.voce === voce && item.year === year && mine.has(item.apartmentId)) {
          at(voce).expected += item.amount;
        }
      }
    }
    flag('condominio', 'rule-undecided'); // question 1 of the design

    const proposals = live(input.rentYears)
      .filter((r) => r.year === year && mine.has(r.apartmentId))
      .sort((a, b) => compareText(a.apartmentId, b.apartmentId))
      .flatMap((r) => {
        const rate = cedolareRateForYear(input.contracts, r.apartmentId, year);
        return rate === undefined
          ? []
          : [{ apartmentId: r.apartmentId, amount: cedolareExpected(r.totalRent, rate) }];
      });

    const rows = TAX_VOICES.map((voce): TaxRow => {
      const own = live(input.estimates).filter(
        (e) => e.year === year && e.voce === voce && mine.has(e.apartmentId),
      );
      const complete = apartmentIds.every((id) => own.some((e) => e.apartmentId === id));
      if (!complete) flag(voce, 'missing-estimate');
      const estimate = complete ? cents(own.reduce((sum, e) => sum + e.amount, 0)) : undefined;
      const { paid, expected, reasons } = at(voce);
      const amounts =
        voce === 'condominio'
          ? {}
          : {
              paid: cents(paid),
              ...(reasons.has('no-expected-source') ? {} : { expected: cents(expected) }),
            };
      const sorted = [...reasons].sort(compareText);
      const difference =
        sorted.length === 0 && estimate !== undefined
          ? cents(paid + expected - estimate)
          : undefined;
      const state: TaxRowState =
        difference === undefined
          ? 'da-verificare'
          : Math.abs(difference) > tolerance
            ? 'discrepanza'
            : 'in-linea';
      return {
        voce,
        state,
        reasons: sorted,
        ...(estimate === undefined ? {} : { estimate }),
        ...amounts,
        ...(difference === undefined ? {} : { difference }),
        ...(voce === 'cedolare' && proposals.length > 0 ? { cedolareProposals: proposals } : {}),
      };
    });
    return { taxpayer, apartmentIds, rows };
  });
}

export interface TaxYearWarning {
  apartmentId: string;
  year: string;
  /** The apartment has live estimates in the year before (`copyPreviousTaxYear`). */
  canCopy: boolean;
}

/**
 * In January only (section 34), the live apartments without a live estimate in the year of
 * `today`, by id (R213). A warning: the copy is a separate, explicit command.
 */
export function taxYearWarnings(input: {
  today: ISODate;
  apartments: Apartment[];
  estimates: TaxEstimate[];
}): TaxYearWarning[] {
  if (input.today.slice(5, 7) !== '01') return [];
  const year = input.today.slice(0, 4);
  const previous = String(Number(year) - 1).padStart(4, '0');
  const estimates = live(input.estimates);
  const has = (apartmentId: string, y: string) =>
    estimates.some((e) => e.apartmentId === apartmentId && e.year === y);
  return live(input.apartments)
    .map((a) => a.id)
    .sort(compareText)
    .filter((id) => !has(id, year))
    .map((apartmentId) => ({ apartmentId, year, canCopy: has(apartmentId, previous) }));
}
