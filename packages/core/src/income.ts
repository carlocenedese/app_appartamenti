/** Income from tenants: who paid a bank credit (phase «chi»). Proposals are recomputed, never stored. */
import { normaliseIban } from './iban';
import type {
  Account,
  Apartment,
  BankTransaction,
  Payer,
  PayerKey,
  Payment,
  Tenancy,
  Tenant,
} from './model';
import { nameInText, nameKeyOf, payerKeyOf, validPayers } from './payers';
import type { YearMonth } from './period';
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
 * the month equal to the amount; then present in that month without a live rent payment for it;
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
          p.deleted !== true && p.kind === 'canone' && (p.forMonth ?? p.date.slice(0, 7)) === month,
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
