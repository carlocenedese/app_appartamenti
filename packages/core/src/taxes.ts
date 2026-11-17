/**
 * «Tasse e stime» (plans 10 and 13, section 34): one table per taxpayer (the `locatore` of the
 * apartments, data, also for a co-ownership: R240) with, for each voce, the estimate typed by user1, what the CSV shows as paid, what is still
 * expected, the difference and a state; the January warning on a year without estimates. Pure: no
 * tax is computed here (no rate in the code); the cedolare estimate of R182 is only shown beside.
 */
import { cedolareExpected, cedolareRateForYear } from './contract';
import { ownerShareOf } from './excel-owners';
import { imuRates } from './imu';
import { expectedDebit } from './match';
import { TAX_VOICES, YearSchema } from './model';
import type {
  Apartment,
  BankTransaction,
  BillMatch,
  Contract,
  ImuYear,
  Instalment,
  MovementClass,
  RentYear,
  TaxConfirmation,
  TaxEstimate,
  TaxPayment,
  TaxVoice,
  TenantRecovery,
} from './model';
import { cents } from './money';
import type { Cents } from './money';
import type { ISODate } from './period';
import { compareText } from './text';
import type { XlsxCell, XlsxWorkbook } from './xlsx-write';

/** Answer 7 of user1 (14 November 2026): confirm discrepancies above 0,10 €. A threshold, not a rate. */
export const TAX_DISCREPANCY_TOLERANCE: Cents = cents(10);

/** `confermata`: a discrepancy user1 confirmed with a note (plan 17, R304), no longer a warning. */
export type TaxRowState = 'in-linea' | 'discrepanza' | 'confermata' | 'da-verificare';

/** Why a row is `da-verificare`: an input is missing or ambiguous, or a rule is not decided. */
export type TaxReason =
  | 'missing-estimate'
  | 'imu-mixed-taxpayers'
  | 'imu-expected-missing'
  | 'imu-to-check'
  | 'imu-year-open'
  | 'assumed-payment'
  | 'stale-assignment'
  | 'unassigned-tax-movement'
  | 'no-expected-source'
  | 'expected-amount-missing'
  | 'payable-paid-outside'
  | 'payable-and-payment'
  | 'rule-undecided';

/**
 * A payable of Scadenze e pagamenti (plan 9, `payableExpectedItems`), for the voci without own
 * records. Without `year` (no reference year chosen) it flags the voce in every year; without
 * `amount` it flags the voce of its year; `paid` is out of the expected and must be in the paid
 * (R243, R246).
 */
export interface TaxExpectedItem {
  apartmentId: string;
  voce: 'cedolare' | 'registro';
  year?: string;
  amount?: Cents;
  paid?: { transactionId?: string };
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
  /**
   * IMU only, groups with only the annual total (R244): their F24s − their annual totals, once
   * every rate has an F24 and only without reasons.
   */
  annualDifference?: Cents;
  /** The cedolare estimates of R182, to be confirmed: never in the other amounts. */
  cedolareProposals?: { apartmentId: string; amount: Cents }[];
  /** The `taxConfirmation` that confirms a discrepancy (plan 17, R304). */
  confirmationId?: string;
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
  /** From `payableExpectedItems` (plan 13); absent: cedolare and registro `no-expected-source`. */
  expectedItems?: TaxExpectedItem[];
  /** Discrepancies confirmed by user1 (plan 17, R304). */
  confirmations?: TaxConfirmation[];
  /** For the owners' part of an extraordinary condominium instalment (plan 17, R300, R305). */
  recoveries?: TenantRecovery[];
}

const live = <T extends { deleted?: boolean }>(records: readonly T[]): T[] =>
  records.filter((r) => r.deleted !== true);

/** A booked debit: the only movements that pay a tax (R2). */
const isDebit = (tx: BankTransaction | undefined): tx is BankTransaction =>
  tx !== undefined && tx.booked !== false && tx.amount < 0;

/** The tables of `input.year`, by taxpayer (the `locatore`, confirmed by user1: R240); R212. */
export function taxTable(input: TaxTableInput): TaxpayerTable[] {
  const { year, tolerance } = input;
  if (!Number.isSafeInteger(tolerance) || tolerance < 0) {
    throw new RangeError('The threshold must be whole cents, not negative');
  }
  const apartments = live(input.apartments);
  // The same taxpayer typed with other spaces or another Unicode form is one taxpayer.
  const taxpayerOf = (a: Apartment) => a.locatore.trim().normalize('NFC');
  const owner = new Map(apartments.map((a) => [a.id, taxpayerOf(a)]));
  const transactions = new Map(live(input.transactions).map((t) => [t.id, t]));
  const classes = live(input.classes);
  const classOf = new Map(classes.map((c) => [c.transactionId, c]));
  const taxPayments = live(input.taxPayments);
  const assigned = new Set(taxPayments.map((p) => p.transactionId));
  const instalmentMatches = live(input.matches).filter(
    (m) => m.itemType === 'instalment' && m.confirmed,
  );
  const matches = instalmentMatches.filter((m) => m.part === 'amount');
  const rates = imuRates({
    years: input.imuYears,
    classes: input.classes,
    transactions: input.transactions,
    taxPayments,
  }).filter((r) => r.year === year);
  const taxpayers = [...new Set(apartments.map(taxpayerOf))].sort(compareText);

  return taxpayers.map((taxpayer) => {
    const apartmentIds = apartments
      .filter((a) => taxpayerOf(a) === taxpayer)
      .map((a) => a.id)
      .sort(compareText);
    const mine = new Set(apartmentIds);
    const acc = new Map(
      TAX_VOICES.map((voce) => [voce, { paid: 0, expected: 0, reasons: new Set<TaxReason>() }]),
    );
    const at = (voce: TaxVoice) => acc.get(voce) ?? { paid: 0, expected: 0, reasons: new Set() };
    const flag = (voce: TaxVoice, reason: TaxReason) => at(voce).reasons.add(reason);

    // IMU: the rates of the groups of this taxpayer only (the F24 does not separate apartments).
    // With only the annual total (answer of user1, R244): each F24 counts as it is, a rate without
    // one is neither expected nor missing, and the year is checked once every rate has an F24.
    const annualGroups = new Map<string, { expected: number; paid?: number }>();
    for (const rate of rates.filter((r) => r.apartmentIds.some((id) => mine.has(id)))) {
      if (!rate.apartmentIds.every((id) => owner.get(id) === taxpayer)) {
        flag('imu', 'imu-mixed-taxpayers');
        continue;
      }
      if (rate.annual !== undefined) annualGroups.set(rate.f24Group, rate.annual);
      if (rate.paid !== undefined && !isDebit(transactions.get(rate.transactionId ?? ''))) {
        // A pending (not booked) F24: not paid yet from the CSV (R2), to be checked.
        flag('imu', 'imu-to-check');
      } else if (rate.paid !== undefined) {
        at('imu').paid += rate.paid;
        if (rate.annual === undefined && rate.status !== 'pagata') flag('imu', 'imu-to-check');
      } else if (rate.annual !== undefined) {
        continue;
      } else if (rate.expected !== undefined) {
        at('imu').expected += rate.expected;
      } else {
        flag('imu', 'imu-expected-missing');
      }
    }

    // TARI: the tax year is the esercizio of the instalment (answer of user1, plan 13); the
    // paid is not checked against the instalment (R241) and the bank commission is in it (answer
    // of user1, 17 November 2026, R306).
    for (const instalment of live(input.instalments)) {
      if (instalment.kind !== 'tari' || instalment.esercizio !== year) continue;
      if (!mine.has(instalment.apartmentId)) continue;
      const own = matches.filter((m) => m.itemId === instalment.id);
      const real = own.filter((m) => m.by !== 'assumed');
      if (own.length > real.length) flag('tari', 'assumed-payment');
      if (real.length > 0) {
        at('tari').paid += instalmentMatches
          .filter((m) => m.itemId === instalment.id && m.by !== 'assumed')
          .reduce((sum, m) => sum + m.amount, 0);
      } else if (own.length === 0) at('tari').expected += expectedDebit(instalment);
    }

    // Condominio, the owners' part (R305): the tax year is the year of the debit (answer of
    // user1, 17 November 2026), the latest when in parts; not debited yet, the year of the due date.
    // The amount (the «Quota proprietà» of the owners' file) is not decided: `rule-undecided`.
    const apartmentOf = new Map(apartments.map((a) => [a.id, a]));
    for (const instalment of live(input.instalments)) {
      const apartment = apartmentOf.get(instalment.apartmentId);
      if (instalment.kind !== 'condominio' || apartment === undefined) continue;
      if (!mine.has(instalment.apartmentId)) continue;
      const own = matches.filter((m) => m.itemId === instalment.id);
      const real = own.filter((m) => m.by !== 'assumed');
      const share = ownerShareOf(instalment, apartment, input.recoveries ?? []);
      if (real.length > 0) {
        const [debited] = real.map((m) => m.transactionDate).sort((a, b) => compareText(b, a));
        if (debited?.startsWith(`${year}-`) === true) at('condominio').paid += share;
        continue;
      }
      if (!instalment.dueDate.startsWith(`${year}-`)) continue;
      if (own.length > 0) flag('condominio', 'assumed-payment');
      else at('condominio').expected += share;
    }

    // Cedolare and registro: the parts of the year of the assigned «tasse» debits.
    const counted = new Set<string>(); // `<apartment or movement>\0<voce>` of a counted part
    const key = (id: string, voce: TaxVoice) => `${id}\u0000${voce}`;
    for (const payment of taxPayments) {
      const tx = transactions.get(payment.transactionId);
      const cls = classOf.get(payment.transactionId);
      const apartmentId = cls?.apartmentId ?? tx?.apartmentId;
      if (apartmentId === undefined || !mine.has(apartmentId)) continue;
      // An F24 that also pays an IMU rate is split (plan 17, R307): its parts count here; parts
      // that no longer make the whole debit without an IMU rate are stale.
      const parts = payment.parts.reduce((sum, p) => sum + p.amount, 0);
      const valid =
        isDebit(tx) &&
        cls?.kind === 'tasse' &&
        (cls.imu !== undefined ? parts < -tx.amount : parts === -tx.amount);
      for (const part of payment.parts.filter((p) => p.year === year)) {
        if (valid) {
          at(part.voce).paid += part.amount;
          counted.add(key(apartmentId, part.voce)).add(key(payment.transactionId, part.voce));
        } else flag(part.voce, 'stale-assignment');
      }
    }

    // A «tasse» debit of the year with no assignment could belong to any of these, unless a
    // payable marked paid with it says what it is (R303).
    const payableDebits = new Set(
      (input.expectedItems ?? []).flatMap((i) =>
        i.paid?.transactionId !== undefined && mine.has(i.apartmentId)
          ? [i.paid.transactionId]
          : [],
      ),
    );
    const unassigned = classes.some(
      (c) =>
        c.kind === 'tasse' &&
        c.imu === undefined &&
        c.apartmentId !== undefined &&
        mine.has(c.apartmentId) &&
        !assigned.has(c.transactionId) &&
        !payableDebits.has(c.transactionId) &&
        isDebit(transactions.get(c.transactionId)) &&
        transactions.get(c.transactionId)?.date.startsWith(`${year}-`) === true,
    );
    if (unassigned) {
      for (const voce of ['cedolare', 'imu', 'registro'] as const) {
        flag(voce, 'unassigned-tax-movement');
      }
    }

    // The payables of plan 9 (R243): without one of the taxpayer for the voce and year the
    // expected is not known (never zero). A paid one is in the paid (answer of user1, 17 November
    // 2026, R303): by its assigned movement, else by its amount; a movement assigned elsewhere is
    // to be checked.
    for (const voce of ['cedolare', 'registro'] as const) {
      const own = (input.expectedItems ?? []).filter(
        (i) => i.voce === voce && mine.has(i.apartmentId),
      );
      const ofYear = own.filter((i) => i.year === year);
      if (ofYear.length === 0 || own.some((i) => i.year === undefined)) {
        flag(voce, 'no-expected-source');
      }
      for (const item of ofYear) {
        if (item.paid !== undefined) {
          const tx = item.paid.transactionId;
          if (tx !== undefined && counted.has(key(tx, voce))) continue;
          if (tx !== undefined && assigned.has(tx)) flag(voce, 'payable-paid-outside');
          else if (item.amount === undefined) flag(voce, 'expected-amount-missing');
          else at(voce).paid += item.amount;
          continue;
        }
        if (counted.has(key(item.apartmentId, voce))) flag(voce, 'payable-and-payment');
        if (item.amount === undefined) flag(voce, 'expected-amount-missing');
        else at(voce).expected += item.amount;
      }
    }
    flag('condominio', 'rule-undecided');
    const annual = [...annualGroups.values()];
    if (annual.some((g) => g.paid === undefined)) flag('imu', 'imu-year-open');
    const annualDifference =
      annual.length === 0
        ? undefined
        : cents(annual.reduce((sum, g) => sum + (g.paid ?? 0) - g.expected, 0));

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
      const amounts = {
        paid: cents(paid),
        ...(reasons.has('no-expected-source') ? {} : { expected: cents(expected) }),
      };
      const sorted = [...reasons].sort(compareText);
      const difference =
        sorted.length === 0 && estimate !== undefined
          ? cents(paid + expected - estimate)
          : undefined;
      const annualCheck = voce === 'imu' && difference !== undefined ? annualDifference : undefined;
      const measured: TaxRowState =
        difference === undefined
          ? 'da-verificare'
          : Math.abs(difference) > tolerance || Math.abs(annualCheck ?? 0) > tolerance
            ? 'discrepanza'
            : 'in-linea';
      // Confirmed only for the same figures: a new difference warns again (R304).
      const confirmation =
        measured === 'discrepanza'
          ? live(input.confirmations ?? []).find(
              (c) =>
                mine.has(c.apartmentId) &&
                c.year === year &&
                c.voce === voce &&
                c.difference === difference &&
                c.annualDifference === annualCheck,
            )
          : undefined;
      const state: TaxRowState = confirmation === undefined ? measured : 'confermata';
      return {
        voce,
        state,
        reasons: sorted,
        ...(estimate === undefined ? {} : { estimate }),
        ...amounts,
        ...(difference === undefined ? {} : { difference }),
        ...(annualCheck === undefined ? {} : { annualDifference: annualCheck }),
        ...(voce === 'cedolare' && proposals.length > 0 ? { cedolareProposals: proposals } : {}),
        ...(confirmation === undefined ? {} : { confirmationId: confirmation.id }),
      };
    });
    return { taxpayer, apartmentIds, rows };
  });
}

export interface TaxYearWarning {
  /** The live apartments of one taxpayer, sorted (the taxpayer is a name: never here). */
  apartmentIds: string[];
  year: string;
  /** One of them has live estimates in the year before (`copyPreviousTaxYear`). */
  canCopy: boolean;
}

/**
 * The start-of-year warning (section 34; answer of user1, 17 November 2026, R308): for each
 * taxpayer with no live estimate in the year of `today` on any of its apartments, whatever the
 * month, until one is typed. A warning: the copy is a separate, explicit command.
 */
export function taxYearWarnings(input: {
  today: ISODate;
  apartments: Apartment[];
  estimates: TaxEstimate[];
}): TaxYearWarning[] {
  const year = input.today.slice(0, 4);
  const previous = String(Number(year) - 1).padStart(4, '0');
  const estimates = live(input.estimates);
  const has = (ids: string[], y: string) =>
    estimates.some((e) => ids.includes(e.apartmentId) && e.year === y);
  const byTaxpayer = new Map<string, string[]>();
  for (const a of live(input.apartments)) {
    const taxpayer = a.locatore.trim().normalize('NFC');
    byTaxpayer.set(taxpayer, [...(byTaxpayer.get(taxpayer) ?? []), a.id]);
  }
  return [...byTaxpayer.values()]
    .map((ids) => [...ids].sort(compareText))
    .filter((ids) => !has(ids, year))
    .sort((a, b) => compareText(a[0] ?? '', b[0] ?? ''))
    .map((apartmentIds) => ({ apartmentIds, year, canCopy: has(apartmentIds, previous) }));
}

const TAX_EXPORT_HEADERS = {
  Immobili: ['Appartamento', 'Nome', 'Locatore', 'Indirizzo', 'Dati catastali'],
  Contratti: [
    'Appartamento',
    'Contratto',
    'Tipo',
    'Inizio',
    'Fine',
    'Durata (mesi)',
    'Firmato il',
    'Codice di registrazione',
    'Registrato il',
    'Canone concordato',
    'Per studenti',
    'Regime',
    'Aliquota cedolare (%)',
  ],
  Canoni: ['Contratto', 'Dal', 'Canone mensile', 'Acconto mensile'],
} as const;

const text = (value: string | undefined): XlsxCell | null =>
  value === undefined ? null : { kind: 'text', value };
const date = (value: ISODate | undefined): XlsxCell | null =>
  value === undefined ? null : { kind: 'date', value };
/** `2025-10` → `10/2025`. */
const monthText = (month: string): XlsxCell => ({
  kind: 'text',
  value: `${month.slice(5, 7)}/${month.slice(0, 4)}`,
});
const yesNo = (flag: true | undefined): XlsxCell => ({ kind: 'text', value: flag ? 'sì' : 'no' });
/** Basis points as written by user1: `1050` → `10,50`. */
const percent = (bp: number | undefined): XlsxCell | null =>
  bp === undefined
    ? null
    : {
        kind: 'text',
        value: `${String(Math.floor(bp / 100))},${String(bp % 100).padStart(2, '0')}`,
      };

/**
 * The file for the commercialista (section 34, R215): every live apartment (`Immobili`), every live
 * contract (`Contratti`) and its rent entries (`Canoni`), as data; by apartment and id. No amount is
 * computed. The registration code and the cadastre are personal data: the file goes only to
 * `Riservato_proprietari`.
 */
export function buildTaxWorkbook(input: {
  apartments: Apartment[];
  contracts: Contract[];
}): XlsxWorkbook {
  const header = (names: readonly string[]) => names.map((n) => text(n));
  const apartments = live(input.apartments).sort((a, b) => compareText(a.id, b.id));
  const contracts = live(input.contracts).sort(
    (a, b) => compareText(a.apartmentId, b.apartmentId) || compareText(a.id, b.id),
  );
  return {
    sheets: [
      {
        name: 'Immobili',
        rows: [
          header(TAX_EXPORT_HEADERS.Immobili),
          ...apartments.map((a) => [
            text(a.id),
            text(a.name),
            text(a.locatore),
            text(a.address),
            text(
              a.cadastre
                ?.map((c) => `foglio ${c.sheet}, particella ${c.parcel}, sub ${c.sub}`)
                .join('; '),
            ),
          ]),
        ],
      },
      {
        name: 'Contratti',
        rows: [
          header(TAX_EXPORT_HEADERS.Contratti),
          ...contracts.map((c) => [
            text(c.apartmentId),
            text(c.id),
            text(c.type),
            monthText(c.start),
            monthText(c.end),
            c.durationMonths === undefined
              ? null
              : ({ kind: 'int', value: c.durationMonths } as const),
            date(c.signedOn),
            text(c.registration?.code),
            date(c.registration?.date),
            yesNo(c.agreedRent),
            yesNo(c.forStudents),
            text(c.taxRegime),
            percent(c.cedolareRateBp),
          ]),
        ],
      },
      {
        name: 'Canoni',
        rows: [
          header(TAX_EXPORT_HEADERS.Canoni),
          ...contracts.flatMap((c) =>
            (c.rent ?? []).map((r) => [
              text(c.id),
              monthText(r.from),
              { kind: 'euro', value: r.monthlyRent } as const,
              { kind: 'euro', value: r.monthlyAdvance } as const,
            ]),
          ),
        ],
      },
    ],
  };
}

/** `Riservato_proprietari/Tasse/<anno>/Tasse_<anno>.xlsx` (section 34); `year` must be `AAAA`. */
export function taxFilePath(year: string): string {
  if (!YearSchema.safeParse(year).success) throw new RangeError('The year must be AAAA');
  return `Riservato_proprietari/Tasse/${year}/Tasse_${year}.xlsx`;
}
