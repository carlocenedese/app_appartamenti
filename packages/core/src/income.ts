/**
 * Income from tenants: who paid a bank credit (phase «chi») and what for (phase «che cosa»).
 * Proposals are recomputed, never stored.
 */
import { checkTenantOverlaps, isPresent } from './conguaglio';
import { normaliseIban } from './iban';
import { latestOperationByPath } from './journal';
import { cents } from './money';
import type { Cents } from './money';
import type { Operation } from './journal';
import { DEFAULT_RENT_LATE_DAYS } from './model';
import type {
  Account,
  Apartment,
  BankTransaction,
  Payer,
  PayerKey,
  Payment,
  Statement,
  Tenancy,
  Tenant,
} from './model';
import { nameInText, nameKeyOf, payerKeyOf, validPayers } from './payers';
import { addDays, addMonths, daysBetween, lastDayOfMonth, monthsInPeriod } from './period';
import type { ISODate, YearMonth } from './period';
import { chooseRentMonth } from './rent-month';
import { recordPath } from './store/records';
import { compareText } from './text';

/** Live and deleted records alike: the functions filter. */
export interface IncomeContext {
  accounts: Account[];
  apartments: Apartment[];
  tenancies: Tenancy[];
  tenants: Tenant[];
  payers: Payer[];
  payments: Payment[];
}

export type WhoResult =
  | { kind: 'skip'; reason: 'no-account' | 'own-account' }
  | { kind: 'known'; tenantId: string; key: PayerKey }
  | {
      kind: 'ask';
      reason: 'new-payer' | 'multi-tenant' | 'name-only-payer' | 'invalid-iban';
      tenantIds: string[];
      key?: PayerKey;
    };

export function whoPaid(tx: BankTransaction, ctx: IncomeContext): WhoResult {
  const liveAccounts = ctx.accounts.filter((a) => a.deleted !== true);
  const account = liveAccounts.find((a) => a.id === tx.accountId);
  if (tx.accountId === undefined || account === undefined) {
    return { kind: 'skip', reason: 'no-account' };
  }
  const iban =
    tx.counterparty?.iban === undefined ? undefined : normaliseIban(tx.counterparty.iban);
  if (iban !== undefined && liveAccounts.some((a) => a.iban === iban)) {
    return { kind: 'skip', reason: 'own-account' };
  }

  const order = candidateOrder(tx, account.apartmentId, ctx);
  const present = new Set(
    ctx.tenancies
      .filter((t) => t.deleted !== true && t.apartmentId === account.apartmentId)
      .map((t) => t.tenantId),
  );
  // An IBAN that is there but not valid is never automatic and never falls back on the name key:
  // a «chi» without key, so no payer is saved for it (user1, 15 Nov 2026, R120). Blank is no IBAN.
  if (iban === undefined && (tx.counterparty?.iban ?? '').trim() !== '') {
    return { kind: 'ask', reason: 'invalid-iban', tenantIds: order([...present]) };
  }

  const key = payerKeyOf(tx.counterparty);
  const keyField = key === undefined ? {} : { key };
  const valid = key === undefined ? [] : validPayers(ctx.payers, key, tx.date, ctx.tenants);
  // A live payer of a deleted tenant is no candidate, but keeps the key from being automatic
  // while it is valid (user1, 15 Nov 2026, R119).
  const blocked =
    key !== undefined && validPayers(ctx.payers, key, tx.date, []).length > valid.length;
  const [only] = valid;
  if (valid.length === 1 && !blocked && only !== undefined && key !== undefined) {
    return { kind: 'known', tenantId: only.tenantId, key };
  }
  if (valid.length > 1 || (blocked && valid.length > 0)) {
    return {
      kind: 'ask',
      reason: 'multi-tenant',
      tenantIds: order(valid.map((p) => p.tenantId)),
      ...keyField,
    };
  }

  // Decision B: a name payer does not hold for a row with an IBAN, but puts its tenants on top.
  const nameKey = iban === undefined ? undefined : nameKeyOf(tx.counterparty);
  const byName =
    nameKey === undefined ? [] : validPayers(ctx.payers, nameKey, tx.date, ctx.tenants);
  if (byName.length > 0) {
    const top = new Set(byName.map((p) => p.tenantId));
    return {
      kind: 'ask',
      reason: 'name-only-payer',
      tenantIds: [...order([...top]), ...order([...present].filter((id) => !top.has(id)))],
      ...keyField,
    };
  }
  return { kind: 'ask', reason: 'new-payer', tenantIds: order([...present]), ...keyField };
}

/**
 * The `<tenantId>\u0000<month>` keys whose live `canone` payments of `apartmentId` add up to more
 * than zero (`forMonth`, else the month of the date): a month refunded in full (B5 c, a negative
 * `canone`) is unpaid again.
 */
function paidKeys(payments: readonly Payment[], apartmentId: string): Set<string> {
  const net = new Map<string, number>();
  for (const p of payments) {
    if (p.deleted === true || p.kind !== 'canone' || p.apartmentId !== apartmentId) continue;
    const key = `${p.tenantId}\u0000${p.forMonth ?? p.date.slice(0, 7)}`;
    net.set(key, (net.get(key) ?? 0) + p.amount);
  }
  return new Set([...net].filter(([, amount]) => amount > 0).map(([key]) => key));
}

/**
 * Sorts tenant ids: name in the text; then rent plus flat charge of a presence in the apartment in
 * the month equal to the amount; then present in that month without a live rent payment for it there;
 * then name (the id without a live tenant), then id.
 */
function candidateOrder(
  tx: BankTransaction,
  apartmentId: string,
  ctx: IncomeContext,
): (ids: string[]) => string[] {
  const month = tx.date.slice(0, 7) as YearMonth;
  const texts = [tx.description, tx.counterparty?.name ?? ''];
  const names = new Map(ctx.tenants.filter((t) => t.deleted !== true).map((t) => [t.id, t.name]));
  const inMonth = ctx.tenancies.filter(
    (t) =>
      t.deleted !== true &&
      t.apartmentId === apartmentId &&
      t.from <= month &&
      (t.to === undefined || month <= t.to),
  );
  const keys = paidKeys(ctx.payments, apartmentId);
  const paid = new Set(
    [...keys].filter((k) => k.endsWith(`\u0000${month}`)).map((k) => k.split('\u0000')[0]),
  );
  const flags = (id: string): number[] => {
    const name = names.get(id);
    const mine = inMonth.filter((t) => t.tenantId === id);
    return [
      name !== undefined && nameInText(name, texts) ? 0 : 1,
      mine.some((t) => t.monthlyRent + t.monthlyForfait === tx.amount) ? 0 : 1,
      mine.length > 0 && !paid.has(id) ? 0 : 1,
    ];
  };
  return (ids) => {
    const keyed = ids.map((id) => ({ id, flags: flags(id), label: names.get(id) ?? id }));
    keyed.sort((a, b) => {
      for (let i = 0; i < a.flags.length; i++) {
        const diff = (a.flags[i] ?? 0) - (b.flags[i] ?? 0);
        if (diff !== 0) return diff;
      }
      return compareText(a.label, b.label) || compareText(a.id, b.id);
    });
    return keyed.map((k) => k.id);
  };
}

export type IncomeReason =
  | 'new-payer'
  | 'multi-tenant'
  | 'name-only-payer'
  | 'invalid-iban'
  | 'amount-differs'
  | 'late'
  | 'month-paid'
  | 'not-present'
  | 'earlier-open'
  | 'not-covered'
  | 'undone';

/** Only ids, a constant reason and the month: never names, descriptions or IBANs. */
export interface IncomeProposal {
  id: string;
  transactionId: string;
  step: 'chi' | 'cosa';
  reason: IncomeReason;
  tenantIds: string[];
  key?: PayerKey;
  month?: YearMonth;
}

export type PaymentDraft = Omit<Payment, 'v' | 'rev'>;

export interface IncomeResult {
  payments: PaymentDraft[];
  proposals: IncomeProposal[];
  skipped: { transactionId: string; reason: 'no-account' | 'own-account' }[];
}

/**
 * The months covered from the first to the last day by the live statements of the live accounts
 * of the apartment, together (R112, user1 14 Nov 2026): only these can be «to pay».
 */
export function coveredMonths(
  ctx: { accounts: Account[]; statements: Statement[] },
  apartmentId: string,
): Set<YearMonth> {
  const accounts = new Set(
    ctx.accounts
      .filter((a) => a.deleted !== true && a.apartmentId === apartmentId)
      .map((a) => a.id),
  );
  const live = ctx.statements.filter((s) => s.deleted !== true && accounts.has(s.accountId));
  const inside = (day: string): boolean => live.some((s) => s.from <= day && day <= s.to);
  const months = new Set<YearMonth>();
  for (const s of live) {
    for (const m of monthsInPeriod(s.from as ISODate, s.to as ISODate)) {
      const last = lastDayOfMonth(m);
      let day = `${m}-01` as ISODate;
      while (day <= last && inside(day)) day = addDays(day, 1);
      if (day > last) months.add(m);
    }
  }
  return months;
}

export interface RentArrear {
  apartmentId: string;
  tenantId: string;
  month: YearMonth;
}

/**
 * The arrears (user1, 15 Nov 2026, R117): each month covered in full by the live statements of an
 * account of the apartment (`coveredMonths`) in which the tenant (not deleted) has a live presence there and no
 * live `canone` payment for it there (`forMonth`, else the month of the date). Only a list: it
 * changes no calculation and no proposal. Sorted by apartment, tenant, month.
 */
export function rentArrears(
  input: Pick<IncomeContext, 'accounts' | 'tenancies' | 'tenants' | 'payments'> & {
    statements: Statement[];
  },
): RentArrear[] {
  const out = new Map<string, RentArrear>();
  const gone = new Set(input.tenants.filter((t) => t.deleted === true).map((t) => t.id));
  const apartmentIds = new Set(
    input.accounts.filter((a) => a.deleted !== true).map((a) => a.apartmentId),
  );
  for (const apartmentId of apartmentIds) {
    const covered = coveredMonths(input, apartmentId);
    const paid = paidKeys(input.payments, apartmentId);
    for (const t of input.tenancies) {
      if (t.deleted === true || t.apartmentId !== apartmentId || gone.has(t.tenantId)) continue;
      for (const month of covered) {
        const key = `${t.tenantId}\u0000${month}`;
        if (isPresent(t, month) && !paid.has(key)) {
          out.set(`${apartmentId}\u0000${key}`, { apartmentId, tenantId: t.tenantId, month });
        }
      }
    }
  }
  return [...out.values()].sort(
    (a, b) =>
      compareText(a.apartmentId, b.apartmentId) ||
      compareText(a.tenantId, b.tenantId) ||
      compareText(a.month, b.month),
  );
}

/**
 * Turns the live credits without a live payment into automatic rent payments (R4 strict: one
 * payer, the oldest month to pay, exact rent plus flat charge) or proposals, in order of date
 * then id. Earlier automatic payments of the run count as paid; an earlier «che cosa» proposal
 * of the same tenant, or an earlier «chi» proposal listing the tenant in the same apartment,
 * blocks the later ones (`earlier-open`, decision C). A transaction with a deleted `csv` payment
 * is never automatic again (`undone`), unless the operation of `operations` that deleted it is the
 * undo of a whole `income.reconcile`: then it is handled as any other (R118). Everything sorted
 * by id.
 */
export function reconcileIncome(
  input: IncomeContext & {
    transactions: BankTransaction[];
    statements: Statement[];
    /** The journal: it tells who deleted a payment. */
    operations: Operation[];
    /** Movements already used elsewhere (excluded, plan 3c): no payment, no proposal, no block. */
    usedTransactionIds?: ReadonlySet<string>;
  },
): IncomeResult {
  const handled = new Set<string>();
  const undone = new Set<string>();
  const latest = latestOperationByPath(input.operations);
  const operationById = new Map(input.operations.map((o) => [o.id, o]));
  for (const p of input.payments) {
    if (p.transactionId === undefined) continue;
    if (p.deleted !== true) handled.add(p.transactionId);
    else if (p.source === 'csv') {
      // The latest operation on the record deleted it (R118, user1, 15 Nov 2026): only the undo of
      // a whole reconciliation puts the movement back to normal; an undone confirmation, a
      // payment cancelled by itself or a deletion no operation explains make it `undone`.
      const by = latest.get(recordPath('payment', p.id));
      const whole =
        by?.kind === 'undo' && operationById.get(by.undoes ?? '')?.kind === 'income.reconcile';
      if (!whole) undone.add(p.transactionId);
    }
  }
  const credits = input.transactions
    .filter(
      (t) =>
        t.deleted !== true &&
        t.amount > 0 &&
        !handled.has(t.id) &&
        input.usedTransactionIds?.has(t.id) !== true,
    )
    .sort((a, b) => compareText(a.date, b.date) || compareText(a.id, b.id));
  const payments: PaymentDraft[] = [];
  const proposals: IncomeProposal[] = [];
  const skipped: IncomeResult['skipped'] = [];
  const open = new Set<string>();
  const openChi = new Set<string>();
  const covered = new Map<string, Set<YearMonth>>();

  for (const tx of credits) {
    const ctx = {
      ...input,
      payments: [...input.payments, ...payments.map((p) => ({ ...p, v: 1 as const, rev: 1 }))],
    };
    const account = input.accounts.find((a) => a.deleted !== true && a.id === tx.accountId);
    if (account === undefined) {
      skipped.push({ transactionId: tx.id, reason: 'no-account' });
      continue;
    }
    const { apartmentId } = account;
    const who = whoPaid(tx, ctx);
    if (who.kind === 'skip') {
      skipped.push({ transactionId: tx.id, reason: who.reason });
      continue;
    }
    if (who.kind === 'ask') {
      for (const id of who.tenantIds) openChi.add(`${apartmentId}\u0000${id}`);
      proposals.push({
        id: `p-chi-${tx.id}`,
        transactionId: tx.id,
        step: 'chi',
        reason: who.reason,
        tenantIds: who.tenantIds,
        ...(who.key === undefined ? {} : { key: who.key }),
      });
      continue;
    }
    const { tenantId, key } = who;
    const ask = (reason: IncomeReason, month?: YearMonth): void => {
      open.add(tenantId);
      proposals.push({
        id: `p-cosa-${tx.id}`,
        transactionId: tx.id,
        step: 'cosa',
        reason,
        tenantIds: [tenantId],
        key,
        ...(month === undefined ? {} : { month }),
      });
    };
    if (undone.has(tx.id)) {
      ask('undone');
      continue;
    }
    if (open.has(tenantId) || openChi.has(`${apartmentId}\u0000${tenantId}`)) {
      ask('earlier-open');
      continue;
    }

    const dateMonth = tx.date.slice(0, 7) as YearMonth;
    const mine = input.tenancies.filter(
      (t) => t.deleted !== true && t.tenantId === tenantId && t.apartmentId === apartmentId,
    );
    const presentMonths = [
      ...new Set(
        mine.flatMap((t) =>
          t.from > dateMonth
            ? []
            : monthsInPeriod(
                `${t.from}-01` as ISODate,
                `${t.to !== undefined && t.to < dateMonth ? t.to : dateMonth}-01` as ISODate,
              ),
        ),
      ),
    ].sort(compareText);
    checkTenantOverlaps(mine, presentMonths);
    if (!presentMonths.includes(dateMonth) && !presentMonths.includes(addMonths(dateMonth, -1))) {
      ask('not-present');
      continue;
    }

    let cov = covered.get(apartmentId);
    if (cov === undefined) {
      cov = coveredMonths(input, apartmentId);
      covered.set(apartmentId, cov);
    }
    const paid = new Set(
      [...paidKeys(ctx.payments, apartmentId)]
        .filter((k) => k.startsWith(`${tenantId}\u0000`))
        .map((k) => k.slice(tenantId.length + 1)),
    );
    const unpaid = presentMonths.filter((m) => cov.has(m) && !paid.has(m));
    const apartment = input.apartments.find((a) => a.deleted !== true && a.id === apartmentId);
    const lateDays = apartment?.rentLateDays ?? DEFAULT_RENT_LATE_DAYS;
    const choice = chooseRentMonth({ date: tx.date as ISODate, unpaid, lateDays });
    if (choice.status === 'review') {
      // A month the transfer may pay but not covered in full goes to review, never assumed (R112).
      const partial = (m: YearMonth): boolean =>
        presentMonths.includes(m) && !paid.has(m) && !cov.has(m);
      const before = addMonths(dateMonth, -1);
      const inLate = daysBetween(tx.date as ISODate, lastDayOfMonth(before)) <= lateDays;
      const month = inLate && partial(before) ? before : partial(dateMonth) ? dateMonth : undefined;
      if (month === undefined) ask(choice.reason);
      else ask('not-covered', month);
      continue;
    }
    const presence = mine.find((t) => isPresent(t, choice.month));
    if (presence === undefined || presence.monthlyRent + presence.monthlyForfait !== tx.amount) {
      ask('amount-differs', choice.month);
      continue;
    }
    payments.push({
      id: `pay-${tx.id}`,
      apartmentId,
      tenantId,
      date: tx.date,
      amount: tx.amount,
      confirmed: true,
      kind: 'canone',
      forMonth: choice.month,
      source: 'csv',
      transactionId: tx.id,
    });
  }

  const byId = (a: { id: string }, b: { id: string }): number => compareText(a.id, b.id);
  return {
    payments: payments.sort(byId),
    proposals: proposals.sort(byId),
    skipped: skipped.sort((a, b) => compareText(a.transactionId, b.transactionId)),
  };
}

/**
 * B5 (decided by user1 on 18 and 19 Nov 2026): rent paid in excess. For each tenant and apartment,
 * a month whose confirmed `canone` payments (`forMonth`, else the month of the date) add up to
 * more than the rent plus flat charge of the stay present that month is flagged, on its latest
 * payment of a positive amount (by date, then id). It proposes the months it would cover
 * (`targets`), as long as the excess and that payment last: first the earlier months of a stay of
 * the tenant there that are short (paid less than due, and either paid in part or covered in full
 * by the statements, `covered`), oldest first; then the later months (an advance) that are short,
 * from the next one, up to 12 months after. What no month takes is a credit of the tenant to give
 * back (`credit`, «da rimborsare»). Months are taken in order of the excess months, so two
 * excesses never propose the same shortfall. Nothing moves until a person confirms it
 * (`confirmRentExcess`). Sorted by id; `tenancies` with their contract ends (F9 a).
 */
export interface RentExcess {
  /** `p-eccedenza-<paymentId>`. */
  id: string;
  apartmentId: string;
  tenantId: string;
  paymentId: string;
  month: YearMonth;
  excess: Cents;
  /** The months it would cover, in order, with the amount each one takes. */
  targets: { month: YearMonth; amount: Cents }[];
  /** What no month takes: a credit of the tenant, to give back. */
  credit: Cents;
}

/** shortcut: an advance looks 12 months ahead at most; a longer advance is a credit until then. */
const ADVANCE_MONTHS = 12;

export function rentExcesses(input: {
  tenancies: Tenancy[];
  payments: Payment[];
  covered: (apartmentId: string) => ReadonlySet<YearMonth>;
}): RentExcess[] {
  const out: RentExcess[] = [];
  const groups = new Map<string, Payment[]>();
  for (const p of input.payments) {
    if (p.deleted === true || !p.confirmed || p.kind !== 'canone') continue;
    const key = `${p.apartmentId}\u0000${p.tenantId}`;
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  for (const payments of groups.values()) {
    const [{ apartmentId, tenantId }] = payments as [Payment];
    const stays = input.tenancies.filter(
      (t) => t.deleted !== true && t.apartmentId === apartmentId && t.tenantId === tenantId,
    );
    const due = (month: YearMonth): number | undefined => {
      const stay = stays.find((t) => isPresent(t, month));
      return stay === undefined ? undefined : stay.monthlyRent + stay.monthlyForfait;
    };
    const monthOf = (p: Payment) => (p.forMonth ?? p.date.slice(0, 7)) as YearMonth;
    const paid = new Map<YearMonth, number>();
    for (const p of payments) paid.set(monthOf(p), (paid.get(monthOf(p)) ?? 0) + p.amount);
    const covered = input.covered(apartmentId);
    const earliest = stays.map((t) => t.from).sort(compareText)[0];
    if (earliest === undefined) continue;
    for (const month of [...paid.keys()].sort(compareText)) {
      const owed = due(month);
      if (owed === undefined) continue;
      const excess = (paid.get(month) ?? 0) - owed;
      if (excess <= 0) continue;
      const [latest] = payments
        .filter((p) => monthOf(p) === month && p.amount > 0)
        .sort((a, b) => compareText(b.date, a.date) || compareText(b.id, a.id));
      if (latest === undefined) continue;
      let left = Math.min(excess, latest.amount);
      const targets: RentExcess['targets'] = [];
      const take = (m: YearMonth, short: number) => {
        const amount = Math.min(short, left);
        if (amount <= 0) return;
        targets.push({ month: m, amount: cents(amount) });
        paid.set(m, (paid.get(m) ?? 0) + amount);
        left -= amount;
      };
      for (let m = earliest; m < month && left > 0; m = addMonths(m, 1)) {
        const short = (due(m) ?? 0) - (paid.get(m) ?? 0);
        if ((paid.get(m) ?? 0) > 0 || covered.has(m)) take(m, short);
      }
      for (let i = 1; i <= ADVANCE_MONTHS && left > 0; i++) {
        const m = addMonths(month, i);
        const owedThen = due(m);
        if (owedThen !== undefined) take(m, owedThen - (paid.get(m) ?? 0));
      }
      const moved = targets.reduce((sum, t) => sum + t.amount, 0);
      out.push({
        id: `p-eccedenza-${latest.id}`,
        apartmentId,
        tenantId,
        paymentId: latest.id,
        month,
        excess: cents(excess),
        targets,
        credit: cents(excess - moved),
      });
    }
  }
  return out.sort((a, b) => compareText(a.id, b.id));
}

/**
 * B5 (c): the credit to give back of each tenant of `apartmentId` for the excesses of the months
 * `from..to` (`RentExcess.credit` by the month of the excess).
 */
export function rentCredits(
  excesses: readonly RentExcess[],
  apartmentId: string,
  from: string,
  to: string,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of excesses) {
    if (e.apartmentId !== apartmentId || e.credit <= 0 || e.month < from || e.month > to) continue;
    out.set(e.tenantId, (out.get(e.tenantId) ?? 0) + e.credit);
  }
  return out;
}
