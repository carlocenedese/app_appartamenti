/**
 * Deposits (plan 11, plan 17): the check of the deposit paid against the one expected, the legal
 * rates typed by user1 (`saveLegalRate`) and the return statement (`caparraReturn` with
 * `legalInterest`). The expected deposit, the rates and the extra charges are data typed by user1,
 * never in the code; the interest dates come from the stay, the conguaglio from the settlement.
 */
import { caparraReturn } from './caparra';
import type { CaparraReturn } from './caparra';
import { SettlementInputError, calcConguaglio, isPresent } from './conguaglio';
import { inSettlement } from './excel';
import { loadExcelInput } from './excel-store';
import { legalInterest } from './interest';
import { planMatch } from './match-store';
import { checkConsistency, commitChange } from './journal';
import {
  ApartmentSchema,
  BillMatchSchema,
  ContractSchema,
  LegalRateSchema,
  PaymentSchema,
  TenancySchema,
  TenantRecoverySchema,
} from './model';
import type { Payment, Tenancy, TenantRecovery } from './model';
import { cents } from './money';
import type { Cents } from './money';
import { addMonths, isoDate, lastDayOfMonth, monthsInPeriod, settlementPeriods } from './period';
import type { ISODate, YearMonth } from './period';
import { loadAll } from './store/load';
import { recordPath } from './store/records';
import type { Store } from './store/store';
import { compareText } from './text';

export type DepositStatus = 'non-impostata' | 'mancante' | 'diversa' | 'versata';

export interface DepositCheck {
  apartmentId: string;
  tenantId: string;
  /** The expected deposit of the latest live tenancy (by `from`) that has one. */
  expected?: Cents;
  /** Live confirmed `caparra` payments with a positive amount. */
  paid: Cents;
  /** The returns: live confirmed `caparra` payments with a negative amount, as a positive sum. */
  returned: Cents;
  status: DepositStatus;
}

/**
 * The deposit of each tenant with a live tenancy, per apartment (a renewal does not ask for a
 * second deposit), sorted by apartment and tenant. A warning only: never a correction.
 */
export function depositChecks(input: {
  tenancies: readonly Tenancy[];
  payments: readonly Payment[];
}): DepositCheck[] {
  const tenancies = input.tenancies
    .filter((t) => t.deleted !== true)
    .sort((a, b) => compareText(a.from, b.from));
  const pairs = new Map(tenancies.map((t) => [`${t.apartmentId}\u0000${t.tenantId}`, t]));
  return [...pairs.values()]
    .map(({ apartmentId, tenantId }): DepositCheck => {
      const expected = tenancies
        .filter((t) => t.apartmentId === apartmentId && t.tenantId === tenantId)
        .map((t) => t.expectedDeposit)
        .filter((d) => d !== undefined)
        .at(-1);
      const amounts = input.payments
        .filter(
          (p) =>
            p.deleted !== true &&
            p.confirmed &&
            p.kind === 'caparra' &&
            p.apartmentId === apartmentId &&
            p.tenantId === tenantId,
        )
        .map((p) => p.amount);
      const paid = cents(amounts.filter((a) => a > 0).reduce((s, a) => s + a, 0));
      const returned = cents(-amounts.filter((a) => a < 0).reduce((s, a) => s + a, 0));
      const status: DepositStatus =
        expected === undefined
          ? 'non-impostata'
          : paid === 0
            ? 'mancante'
            : paid === expected
              ? 'versata'
              : 'diversa';
      return {
        apartmentId,
        tenantId,
        ...(expected === undefined ? {} : { expected }),
        paid,
        returned,
        status,
      };
    })
    .sort(
      (a, b) => compareText(a.apartmentId, b.apartmentId) || compareText(a.tenantId, b.tenantId),
    );
}

export type SaveLegalRateResult =
  | { status: 'saved'; operationId: string; rateId: string }
  | { status: 'unchanged'; rateId: string }
  | { status: 'refused'; reason: 'inconsistent-store' | 'invalid-rate' };

/**
 * Creates or replaces the legal rate of `input.year` (plan 17, R301) in one `legal-rate.save`
 * operation. Refused without writing: `inconsistent-store`; `invalid-rate` (fields the schema
 * refuses).
 */
export async function saveLegalRate(
  store: Store,
  input: { year: string; rateBp: number },
  profileId: string,
  clock: () => string,
  newId: () => string,
): Promise<SaveLegalRateResult> {
  if ((await checkConsistency(store)).length > 0) {
    return { status: 'refused', reason: 'inconsistent-store' };
  }
  const id = `tasso-${input.year}`;
  const before = (
    await loadAll(store, 'legalRate', LegalRateSchema, { includeDeleted: true })
  ).records.find((r) => r.id === id);
  const record = (rev: number) =>
    LegalRateSchema.safeParse({ id, v: 1, rev, year: input.year, rateBp: input.rateBp });
  const parsed = record((before?.rev ?? 0) + 1);
  if (!parsed.success) return { status: 'refused', reason: 'invalid-rate' };
  if (
    before !== undefined &&
    before.deleted !== true &&
    JSON.stringify(record(before.rev).data) === JSON.stringify(before)
  ) {
    return { status: 'unchanged', rateId: id };
  }
  const operation = await commitChange(
    store,
    {
      profileId,
      kind: 'legal-rate.save',
      summary: 'Tasso legale salvato.',
      changes: [{ path: recordPath('legalRate', id), before, after: parsed.data }],
    },
    clock,
    newId,
  );
  return { status: 'saved', operationId: operation.id, rateId: id };
}

/**
 * The continuous stays of one tenant in one apartment (plan 17, R302): the live tenancies sorted by
 * `from`, joined when one starts the month after the other ends. The deposit follows the stay, not
 * the contract.
 */
export function continuousStays(
  tenancies: readonly Tenancy[],
): { from: YearMonth; to?: YearMonth }[] {
  const stays: { from: YearMonth; to?: YearMonth }[] = [];
  for (const t of [...tenancies]
    .filter((t) => t.deleted !== true)
    .sort((a, b) => compareText(a.from, b.from))) {
    const last = stays.at(-1);
    if (last !== undefined && (last.to === undefined || addMonths(last.to, 1) >= t.from)) {
      if (last.to !== undefined && (t.to === undefined || t.to > last.to)) {
        if (t.to === undefined) delete last.to;
        else last.to = t.to;
      }
      continue;
    }
    stays.push({ from: t.from, ...(t.to === undefined ? {} : { to: t.to }) });
  }
  return stays;
}

export interface DepositReturnInput {
  apartmentId: string;
  tenantId: string;
  /** The tenant's conguaglio typed by user1 (positive is a debt), instead of the computed one. */
  conguaglio?: Cents;
  extraCharges: readonly { label: string; amount: Cents }[];
}

export type DepositReturnResult =
  | { status: 'computed'; statement: CaparraReturn }
  | {
      status: 'refused';
      reason:
        | 'inconsistent-store'
        | 'no-deposit'
        | 'already-returned'
        | 'no-exit'
        | 'missing-rate'
        | 'no-period'
        | 'ambiguous-period'
        | 'settlement-error';
    };

/**
 * The return statement of the deposit of `tenantId` in `apartmentId` (plan 11; plan 17, R302).
 * Capital: the deposit held, confirmed `caparra` payments less the returns. Interest
 * (`legalInterest`, whole months, R7) on all of it from the first day of the latest continuous stay
 * to the last day of its last month, with the rates of the `legalRate` records. Conguaglio: the
 * tenant's `due` in the settlement period of the last month (items still pending do not count),
 * less the settlement payments already made for it; `input.conguaglio` replaces it. Then a line
 * «Recupero» for each share of a live recovery without a period whose tenant is not in the period
 * of the expense (R300), once the expense is paid, and the extra charges. Read only. Refused:
 * `inconsistent-store`; `no-deposit` (nothing paid); `already-returned` (nothing left in hand);
 * `no-exit` (no stay, or the latest has no end); `missing-rate`; `no-period` and `ambiguous-period`
 * (no settlement period, or two, for the last month); `settlement-error` (the settlement throws).
 */
export async function loadDepositReturn(
  store: Store,
  input: DepositReturnInput,
): Promise<DepositReturnResult> {
  const refuse = (reason: Extract<DepositReturnResult, { status: 'refused' }>['reason']) =>
    ({ status: 'refused', reason }) as const;
  if ((await checkConsistency(store)).length > 0) return refuse('inconsistent-store');
  const tenancies = (await loadAll(store, 'tenancy', TenancySchema)).records.filter(
    (t) => t.apartmentId === input.apartmentId,
  );
  const check = depositChecks({
    tenancies,
    payments: (await loadAll(store, 'payment', PaymentSchema)).records,
  }).find((c) => c.tenantId === input.tenantId);
  if (check === undefined || check.paid === 0) return refuse('no-deposit');
  const held = cents(check.paid - check.returned);
  if (held <= 0) return refuse('already-returned');
  const stay = continuousStays(tenancies.filter((t) => t.tenantId === input.tenantId)).at(-1);
  if (stay?.to === undefined) return refuse('no-exit');
  const exit = stay.to;
  const rates = (await loadAll(store, 'legalRate', LegalRateSchema)).records.map((r) => ({
    year: Number(r.year),
    rateBp: r.rateBp,
  }));
  let interest: Cents;
  try {
    interest = legalInterest(held, rates, isoDate(`${stay.from}-01`), lastDayOfMonth(exit));
  } catch (error) {
    if (error instanceof RangeError) return refuse('missing-rate');
    throw error;
  }

  const apartment = (await loadAll(store, 'apartment', ApartmentSchema)).records.find(
    (a) => a.id === input.apartmentId,
  );
  const periods = (await loadAll(store, 'contract', ContractSchema)).records
    .filter((c) => c.apartmentId === input.apartmentId)
    .flatMap((c) => {
      if (apartment === undefined) return [];
      try {
        return settlementPeriods(c, apartment.annualitaStart);
      } catch {
        return []; // a contract without settlement periods (its checks say so)
      }
    });
  const spans = [...new Map(periods.map((p) => [`${p.from}/${p.to}`, p])).values()];

  // The conguaglio of the exit period, unless user1 typed it.
  let conguaglio = input.conguaglio;
  if (conguaglio === undefined) {
    const holding = spans.filter((p) => p.from <= exit && exit <= p.to);
    if (holding.length === 0) return refuse('no-period');
    if (holding.length > 1) return refuse('ambiguous-period');
    const period = holding[0] as (typeof holding)[number];
    const loaded = await loadExcelInput(store, {
      apartmentId: input.apartmentId,
      periodLabel: period.label,
    });
    if (loaded.status !== 'ok') return refuse('ambiguous-period');
    let settlement;
    try {
      settlement = calcConguaglio(loaded.input);
    } catch (error) {
      if (error instanceof SettlementInputError) return refuse('settlement-error');
      throw error;
    }
    const due = settlement.tenants.find((t) => t.tenantId === input.tenantId)?.due ?? 0;
    const paid = loaded.input.payments
      .filter(
        (p) =>
          p.deleted !== true &&
          p.confirmed &&
          p.kind === 'conguaglio' &&
          p.tenantId === input.tenantId &&
          inSettlement(p, period, loaded.input.periods ?? [period]),
      )
      .reduce((sum, p) => sum + p.amount, 0);
    conguaglio = cents(due - paid);
  }

  const matches = [
    ...(await loadAll(store, 'match', BillMatchSchema)).records,
    ...(await planMatch(store)).assumedMatches,
  ];
  const recoveries = withheldRecoveries({
    recoveries: (await loadAll(store, 'tenantRecovery', TenantRecoverySchema)).records.filter(
      (r) => r.apartmentId === input.apartmentId,
    ),
    tenantId: input.tenantId,
    tenancies,
    periods: spans,
    paidInstalments: new Set(
      matches
        .filter((m) => m.deleted !== true && m.confirmed && m.part === 'amount')
        .map((m) => m.itemId),
    ),
  });
  return {
    status: 'computed',
    statement: caparraReturn({
      caparra: held,
      interest,
      conguaglio,
      extraCharges: [...recoveries, ...input.extraCharges],
    }),
  };
}

/**
 * The shares of `tenantId` kept from the deposit (plan 17, R300): live recoveries `da-recuperare`
 * without a period, with a date, whose tenant has no month in the settlement period of that date
 * (or there is none), once the expense is paid (an instalment with a confirmed amount match; a
 * movement or no expense always). Sorted by id; label «Recupero <id>».
 */
export function withheldRecoveries(input: {
  recoveries: readonly TenantRecovery[];
  tenantId: string;
  tenancies: readonly Tenancy[];
  periods: readonly { from: YearMonth; to: YearMonth }[];
  paidInstalments: ReadonlySet<string>;
}): { label: string; amount: Cents }[] {
  const own = input.tenancies.filter((t) => t.deleted !== true && t.tenantId === input.tenantId);
  return [...input.recoveries]
    .filter((r) => r.deleted !== true && r.status === 'da-recuperare')
    .filter((r) => r.periodLabel === undefined && r.date !== undefined)
    .filter((r) => r.instalmentId === undefined || input.paidInstalments.has(r.instalmentId))
    .filter((r) => {
      const month = (r.date as ISODate).slice(0, 7) as YearMonth;
      return !input.periods
        .filter((p) => p.from <= month && month <= p.to)
        .some((p) =>
          monthsInPeriod(isoDate(`${p.from}-01`), isoDate(`${p.to}-01`)).some((m) =>
            own.some((t) => isPresent(t, m)),
          ),
        );
    })
    .sort((a, b) => compareText(a.id, b.id))
    .flatMap((r) =>
      r.shares
        .filter((s) => s.tenantId === input.tenantId)
        .map((s) => ({ label: `Recupero ${r.id}`, amount: s.amount })),
    );
}
