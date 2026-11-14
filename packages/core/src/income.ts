/**
 * Income from tenants: who paid a bank credit (phase «chi») and what for (phase «che cosa»).
 * Proposals are recomputed, never stored.
 */
import { checkTenantOverlaps, isPresent } from './conguaglio';
import { normaliseIban } from './iban';
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
import { addMonths, monthsInPeriod } from './period';
import type { ISODate, YearMonth } from './period';
import { chooseRentMonth } from './rent-month';
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
      reason: 'new-payer' | 'multi-tenant' | 'name-only-payer';
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

  const key = payerKeyOf(tx.counterparty);
  const keyField = key === undefined ? {} : { key };
  const order = candidateOrder(tx, account.apartmentId, ctx);
  const valid = key === undefined ? [] : validPayers(ctx.payers, key, tx.date);
  const [only] = valid;
  if (valid.length === 1 && only !== undefined && key !== undefined) {
    return { kind: 'known', tenantId: only.tenantId, key };
  }
  if (valid.length > 1) {
    return {
      kind: 'ask',
      reason: 'multi-tenant',
      tenantIds: order(valid.map((p) => p.tenantId)),
      ...keyField,
    };
  }

  const present = new Set(
    ctx.tenancies
      .filter((t) => t.deleted !== true && t.apartmentId === account.apartmentId)
      .map((t) => t.tenantId),
  );
  // Decision B: a name payer does not hold for a row with an IBAN, but puts its tenants on top.
  const nameKey = iban === undefined ? undefined : nameKeyOf(tx.counterparty);
  const byName = nameKey === undefined ? [] : validPayers(ctx.payers, nameKey, tx.date);
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
  const paid = new Set(
    ctx.payments
      .filter(
        (p) =>
          p.deleted !== true &&
          p.kind === 'canone' &&
          p.apartmentId === apartmentId &&
          (p.forMonth ?? p.date.slice(0, 7)) === month,
      )
      .map((p) => p.tenantId),
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
  | 'amount-differs'
  | 'late'
  | 'month-paid'
  | 'not-present'
  | 'earlier-open';

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
 * The months with at least one day inside a live statement of a live account of the apartment
 * (R112): only these can be «to pay». Before the first statement imported, rent counts as paid.
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
  const months = new Set<YearMonth>();
  for (const s of ctx.statements) {
    if (s.deleted === true || !accounts.has(s.accountId)) continue;
    for (const m of monthsInPeriod(s.from as ISODate, s.to as ISODate)) months.add(m);
  }
  return months;
}

/**
 * Turns the live credits without a live payment into automatic rent payments (R4 strict: one
 * payer, the oldest month to pay, exact rent plus flat charge) or proposals, in order of date
 * then id. Earlier automatic payments of the run count as paid; an earlier «che cosa» proposal
 * of the same tenant blocks the later ones (`earlier-open`, decision C). Everything sorted by id.
 */
export function reconcileIncome(
  input: IncomeContext & { transactions: BankTransaction[]; statements: Statement[] },
): IncomeResult {
  const handled = new Set(
    input.payments.flatMap((p) =>
      p.deleted !== true && p.transactionId !== undefined ? [p.transactionId] : [],
    ),
  );
  const credits = input.transactions
    .filter((t) => t.deleted !== true && t.amount > 0 && !handled.has(t.id))
    .sort((a, b) => compareText(a.date, b.date) || compareText(a.id, b.id));
  const payments: PaymentDraft[] = [];
  const proposals: IncomeProposal[] = [];
  const skipped: IncomeResult['skipped'] = [];
  const open = new Set<string>();
  const covered = new Map<string, Set<YearMonth>>();

  for (const tx of credits) {
    const ctx = {
      ...input,
      payments: [...input.payments, ...payments.map((p) => ({ ...p, v: 1 as const, rev: 1 }))],
    };
    const who = whoPaid(tx, ctx);
    const account = input.accounts.find((a) => a.deleted !== true && a.id === tx.accountId);
    if (who.kind === 'skip' || account === undefined) {
      skipped.push({
        transactionId: tx.id,
        reason: who.kind === 'skip' ? who.reason : 'no-account',
      });
      continue;
    }
    if (who.kind === 'ask') {
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
    const { apartmentId } = account;
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
    if (open.has(tenantId)) {
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
      ctx.payments
        .filter(
          (p) =>
            p.deleted !== true &&
            p.kind === 'canone' &&
            p.tenantId === tenantId &&
            p.apartmentId === apartmentId,
        )
        .map((p) => p.forMonth ?? p.date.slice(0, 7)),
    );
    const unpaid = presentMonths.filter((m) => cov.has(m) && !paid.has(m));
    const apartment = input.apartments.find((a) => a.deleted !== true && a.id === apartmentId);
    const choice = chooseRentMonth({
      date: tx.date as ISODate,
      unpaid,
      lateDays: apartment?.rentLateDays ?? DEFAULT_RENT_LATE_DAYS,
    });
    if (choice.status === 'review') {
      ask(choice.reason);
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
