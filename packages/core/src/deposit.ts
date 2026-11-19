/**
 * Deposits (plan 11, plan 17): the check of the deposit paid against the one expected, the legal
 * rates typed by user1 (`saveLegalRate`) and the return statement (`caparraReturn` with
 * `legalInterest`). The expected deposit, the rates and the extra charges are data typed by user1,
 * never in the code; the interest dates come from the stay, the conguaglio from the settlement.
 */
import { caparraReturn } from './caparra';
import type { CaparraReturn } from './caparra';
import { SettlementInputError, calcConguaglio, isPresent, settlementPeriodOf } from './conguaglio';
import { flatPaymentsOf, rentOf, tenantBalance } from './closing';
import { recoverableMovements } from './condominio';
import { inSettlement } from './excel';
import { loadExcelInput } from './excel-store';
import { legalInterest } from './interest';
import { commitChange, writesBlocked } from './journal';
import {
  ApartmentSchema,
  BankTransactionSchema,
  BillMatchSchema,
  MovementClassSchema,
  ContractSchema,
  PeriodCloseSchema,
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
  if (await writesBlocked(store)) {
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
  | {
      status: 'computed';
      statement: CaparraReturn;
      /** Recoveries kept from the deposit once their expense is paid: not in yet (RECOVERY_WAITING). */
      recoveriesWaiting: number;
      /**
       * Flat charge collected beyond what was due in a closed period (answer F): «da verificare»,
       * shown apart and never in the total.
       */
      toCheck: { label: string; amount: Cents }[];
    }
  /**
   * B4, F10, I: the deposit is already returned, so its statement does not change: the lines of
   * the closed periods are «da richiedere», with the signs of a statement (a debt of the tenant is
   * negative, a credit positive); the exit period's due and payments are «da verificare».
   */
  | { status: 'refused'; reason: 'already-returned'; toRequest: { label: string; amount: Cents }[] }
  | {
      status: 'refused';
      reason:
        | 'inconsistent-store'
        | 'no-deposit'
        /** A period of the tenant was reopened (F3): its settlement is being changed. */
        | 'period-reopened'
        | 'partial-return'
        | 'several-stays'
        | 'no-exit'
        | 'missing-rate'
        | 'no-period'
        | 'ambiguous-period'
        | 'settlement-error';
    };

/**
 * The return statement of the deposit of `tenantId` in `apartmentId` (plan 11; plan 17, R302).
 * Capital: the deposit paid. Refused, prudently until user1 answers, when a return already exists
 * (`already-returned` if nothing is left, else `partial-return`) or the tenant had several separate
 * stays in the apartment (`several-stays`). Interest (`legalInterest`, whole months, R7: user1 said
 * days, question open) on all of it from the first month of the stay to its last, with the rates of
 * the `legalRate` records. Conguaglio: the tenant's `due` in the settlement period of the last month
 * (pending items do not count) and, on a line of its own, what is already paid on it;
 * `input.conguaglio` replaces both and then no period is needed. Then a line «Recupero» for each
 * share of a live recovery without a period whose tenant is not in the period of the expense
 * (R300), once the expense is paid (`recoveriesWaiting` counts the others), and the extra charges.
 * Read only. Other refusals: `inconsistent-store`, `no-deposit`, `no-exit`, `missing-rate`,
 * `no-period`, `ambiguous-period`, `settlement-error`.
 */
export async function loadDepositReturn(
  store: Store,
  input: DepositReturnInput,
): Promise<DepositReturnResult> {
  const refuse = (
    reason: Exclude<
      Extract<DepositReturnResult, { status: 'refused' }>['reason'],
      'already-returned'
    >,
  ) => ({ status: 'refused', reason }) as const;
  if (await writesBlocked(store)) return refuse('inconsistent-store');
  // F9 a (R390): the exit of the deposit is the one written; the periods read the contract end.
  const tenancies = (await loadAll(store, 'tenancy', TenancySchema)).records.filter(
    (t) => t.apartmentId === input.apartmentId,
  );
  const check = depositChecks({
    tenancies,
    payments: (await loadAll(store, 'payment', PaymentSchema)).records,
  }).find((c) => c.tenantId === input.tenantId);
  if (check === undefined || check.paid === 0) return refuse('no-deposit');
  const held = cents(check.paid - check.returned);
  const stays = continuousStays(tenancies.filter((t) => t.tenantId === input.tenantId));
  const stay = stays.at(-1);

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
  const holding = (month: YearMonth) => spans.filter((p) => p.from <= month && month <= p.to);
  const exitHome = stay?.to === undefined ? [] : holding(stay.to);
  const closed = await closedPeriodLines(store, {
    apartmentId: input.apartmentId,
    tenantId: input.tenantId,
    exitLabel: exitHome.length === 1 ? exitHome[0]?.label : undefined,
    spans,
  });
  if (typeof closed === 'string') return refuse(closed);
  if (held <= 0) {
    // The statement is already made: what the closed periods add is asked apart (F10).
    // I: the past statement is not stored, so the exit period's due at the closing and what is
    // paid on it are listed «da verificare» for user1 to compare. Signs as in a statement (8):
    // a debt of the tenant is negative.
    const exit = closed.exit;
    const toCheck: Line[] =
      exit === undefined
        ? []
        : [
            ...(exit.due === 0
              ? []
              : [
                  {
                    label: `Conguaglio ${exit.label} alla chiusura (da verificare)`,
                    amount: exit.due,
                  },
                ]),
            ...(exit.paid === 0
              ? []
              : [
                  {
                    label: `Conguaglio ${exit.label} già versato (da verificare)`,
                    amount: cents(-exit.paid),
                  },
                ]),
          ];
    return {
      status: 'refused',
      reason: 'already-returned',
      toRequest: [...toCheck, ...(exit?.lines ?? []), ...closed.lines].map((l) => ({
        label: l.label,
        amount: cents(-l.amount),
      })),
    };
  }
  // Prudent until user1 answers (R302): which deposit belongs to which stay, and what a partial
  // return leaves, are not decided.
  if (check.returned > 0) return refuse('partial-return');
  if (stays.length > 1) return refuse('several-stays');
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

  // The conguaglio of the exit period, unless user1 typed it.
  let conguaglio = input.conguaglio;
  const settled: { label: string; amount: Cents }[] = [];
  if (conguaglio === undefined && closed.exit !== undefined) {
    // B4, F10: the exit period is closed: what was due at the closing (nothing when user1 marked
    // it settled), what is already paid on it, then the supplementary on lines of their own.
    conguaglio = closed.exit.due;
    if (closed.exit.paid !== 0) {
      settled.push({ label: 'Conguaglio già versato', amount: cents(-closed.exit.paid) });
    }
    settled.push(...closed.exit.lines);
  } else if (conguaglio === undefined) {
    if (exitHome.length === 0) return refuse('no-period');
    if (exitHome.length > 1) return refuse('ambiguous-period');
    const period = exitHome[0] as (typeof exitHome)[number];
    const loaded = await loadExcelInput(store, {
      apartmentId: input.apartmentId,
      periodLabel: period.label,
    });
    if (loaded.status !== 'ok') {
      return refuse(loaded.reason === 'ambiguous-period' ? 'ambiguous-period' : 'no-period');
    }
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
    // The amount due and what is already paid on it as two lines (R302): nothing subtracted unseen.
    conguaglio = cents(due);
    if (paid !== 0) settled.push({ label: 'Conguaglio già versato', amount: cents(-paid) });
  } else if (closed.exit !== undefined) {
    // The conguaglio typed by user1 replaces the exit period; its supplementary stays apart.
    settled.push(...closed.exit.lines);
  }

  const matches = (await loadAll(store, 'match', BillMatchSchema)).records;
  const transactions = (await loadAll(store, 'transaction', BankTransactionSchema)).records;
  const classes = (await loadAll(store, 'movementClass', MovementClassSchema)).records;
  const recoveries = withheldRecoveries({
    recoveries: (await loadAll(store, 'tenantRecovery', TenantRecoverySchema)).records.filter(
      (r) => r.apartmentId === input.apartmentId,
    ),
    tenantId: input.tenantId,
    tenancies,
    periods: spans,
    recoverableMovements: recoverableMovements({
      apartmentId: input.apartmentId,
      transactions,
      classes,
    }),
    paidInstalments: new Set(
      matches
        // An `assumed` match stored before B1 is no debit seen.
        .filter(
          (m) => m.deleted !== true && m.confirmed && m.by !== 'assumed' && m.part === 'amount',
        )
        .map((m) => m.itemId),
    ),
  });
  return {
    status: 'computed',
    statement: caparraReturn({
      caparra: held,
      interest,
      conguaglio,
      extraCharges: [...settled, ...closed.lines, ...recoveries.withheld, ...input.extraCharges],
    }),
    recoveriesWaiting: recoveries.waiting,
    toCheck: closed.toCheck,
  };
}

type Line = { label: string; amount: Cents };

/**
 * B4, F10 and the answers C, D, G, H of user1 (18 Nov 2026): what the closed periods of the
 * apartment add to the deposit statement of `tenantId`, one labelled line each (positive is a
 * debt of the tenant, as `extraCharges`).
 * - Every amount comes from `tenantBalance` (fifth round, R359), so the lines add up to what is
 *   left. What is left of the closing (the whole due, or only the difference after a
 *   closing settled before, G; nothing once marked settled): «Conguaglio <periodo> non saldato»
 *   for a period other than the exit one, never offset by payments (C); for the exit period it is
 *   the «Conguaglio bollette» line (`exit.due`, with what is already paid on it apart, R302).
 * - The flat charge missing at the closing (H) and since (F11): «Forfait non incassato <periodo>».
 * - The rent not collected of a period closed again after a reopening (plan 22): «Canone non
 *   incassato <periodo>», outside the settlement.
 * - The supplementary (costs since the snapshot, K included): «Conguaglio supplementare
 *   <periodo>», or, once marked settled (D), only a later difference «… da saldare».
 * A reopened period of the tenant refuses (`period-reopened`, prudent: it can be closed again,
 * H), one that cannot be computed too.
 */
async function closedPeriodLines(
  store: Store,
  input: {
    apartmentId: string;
    tenantId: string;
    exitLabel: string | undefined;
    spans: readonly { label: string; from: YearMonth; to: YearMonth }[];
  },
): Promise<
  | {
      lines: Line[];
      /** Flat charge collected beyond what was due, per period: «da verificare», no effect. */
      toCheck: Line[];
      exit?: { label: string; due: Cents; paid: Cents; lines: Line[] };
    }
  | 'period-reopened'
  | 'settlement-error'
> {
  const closes = (await loadAll(store, 'periodClose', PeriodCloseSchema)).records
    .filter((c) => c.apartmentId === input.apartmentId)
    .filter((c) => c.snapshot.tenants.some((t) => t.tenantId === input.tenantId))
    .sort((a, b) => compareText(a.from, b.from));
  const lines: Line[] = [];
  const toCheck: Line[] = [];
  let exit: { label: string; due: Cents; paid: Cents; lines: Line[] } | undefined;
  for (const close of closes) {
    if (close.reopened !== undefined) return 'period-reopened';
    const loaded = await loadExcelInput(store, {
      apartmentId: input.apartmentId,
      periodLabel: close.periodLabel,
    });
    if (loaded.status !== 'ok') return 'settlement-error';
    let today;
    try {
      today = calcConguaglio(loaded.input).tenants.find((t) => t.tenantId === input.tenantId);
    } catch (error) {
      if (error instanceof SettlementInputError) return 'settlement-error';
      throw error;
    }
    const label = close.periodLabel;
    // The one computation of the settlement (fifth round, `tenantBalance`): the lines are its
    // parts, so they add up to `remaining`; `toCheck` is apart and never a credit (answer F).
    const balance = tenantBalance(close, input.tenantId, {
      due: today?.due ?? 0,
      forfaitIncassato: today?.forfaitIncassato ?? 0,
      payments: flatPaymentsOf(loaded.input.payments, input.tenantId, close.from, close.to),
    });
    if (balance.toCheck > 0) {
      toCheck.push({
        label: `Forfait incassato in più ${label} (da verificare)`,
        amount: balance.toCheck,
      });
    }
    const marked =
      balance.supplementarySettled !== 0 ||
      (close.supplementarySettled ?? []).some((s) => s.tenantId === input.tenantId);
    const supLeft = balance.supplementary - balance.supplementarySettled;
    const lost = marked ? 0 : Math.min(balance.lostFlat, Math.max(0, supLeft));
    const forfait = balance.fniLeft + lost;
    // Plan 22, decision 1: the rent not collected of a period closed again (outside the
    // settlement), less what user1 marked `saldato` or `non-recuperabile` (answer 2).
    const rent = rentOf(close, loaded.input).get(input.tenantId)?.open ?? 0;
    const later: Line[] = [
      ...(forfait > 0 ? [{ label: `Forfait non incassato ${label}`, amount: cents(forfait) }] : []),
      ...(rent > 0 ? [{ label: `Canone non incassato ${label}`, amount: cents(rent) }] : []),
      ...(supLeft - lost !== 0
        ? [
            {
              label: marked
                ? `Conguaglio supplementare ${label} da saldare`
                : `Conguaglio supplementare ${label}`,
              amount: cents(supLeft - lost),
            },
          ]
        : []),
    ];
    const left = cents(balance.mainRemaining - balance.fniLeft);
    if (label === input.exitLabel) {
      const paid =
        balance.status !== 'da-saldare' || marked
          ? 0
          : loaded.input.payments
              .filter(
                (p) =>
                  p.deleted !== true &&
                  p.confirmed &&
                  p.kind === 'conguaglio' &&
                  p.tenantId === input.tenantId &&
                  inSettlement(p, close, loaded.input.periods ?? input.spans),
              )
              .reduce((sum, p) => sum + p.amount, 0);
      exit = { label, due: left, paid: cents(paid), lines: later };
      continue;
    }
    // C: the whole due until user1 marks it settled; payments do not offset it.
    if (left !== 0) lines.push({ label: `Conguaglio ${label} non saldato`, amount: left });
    lines.push(...later);
  }
  return exit === undefined ? { lines, toCheck } : { lines, toCheck, exit };
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
  recoverableMovements: ReadonlySet<string>;
}): { withheld: { label: string; amount: Cents }[]; waiting: number } {
  const own = input.tenancies.filter((t) => t.deleted !== true && t.tenantId === input.tenantId);
  const candidates = [...input.recoveries]
    .filter((r) => r.deleted !== true && r.status === 'da-recuperare')
    .filter((r) => r.periodLabel === undefined && r.date !== undefined)
    .filter((r) => r.shares.some((s) => s.tenantId === input.tenantId))
    .filter((r) => r.transactionId === undefined || input.recoverableMovements.has(r.transactionId))
    .filter((r) => {
      // The one period of the date, as the settlement (`settlementPeriodOf`, R177).
      const home = settlementPeriodOf((r.date as ISODate).slice(0, 7) as YearMonth, input.periods);
      return (
        home === undefined ||
        !monthsInPeriod(isoDate(`${home.from}-01`), isoDate(`${home.to}-01`)).some((m) =>
          own.some((t) => isPresent(t, m)),
        )
      );
    })
    .sort((a, b) => compareText(a.id, b.id));
  const paid = (r: TenantRecovery) =>
    r.instalmentId === undefined || input.paidInstalments.has(r.instalmentId);
  return {
    withheld: candidates
      .filter(paid)
      .flatMap((r) =>
        r.shares
          .filter((s) => s.tenantId === input.tenantId)
          .map((s) => ({ label: `Recupero ${r.id}`, amount: s.amount })),
      ),
    waiting: candidates.filter((r) => !paid(r)).length,
  };
}
