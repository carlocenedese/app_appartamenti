/**
 * Bank commissions (section 42, R7): the "Commissioni e spese" row of the CSV is tied to its debit
 * by the disposition code and follows the item that debit pays, with the same split.
 */
import type { MatchItemRef } from './match';
import type { BankTransaction, BillMatch } from './model';
import type { Cents } from './money';
import { daysBetween } from './period';
import { splitSharedDebit } from './split';
import { compareText } from './text';

/** Days a commission row may be away from its debit. */
const COMMISSION_MAX_DAYS = 2;

const codeKey = (t: BankTransaction): string => `${t.apartmentId}\u0000${t.dispCode ?? ''}`;

/**
 * Commission rows and the debit each belongs to. A row is a commission only if it is a debit and,
 * on the same account, exactly one other debit with the same disposition code is larger in
 * absolute value and at most two days away. Anything else is an ordinary movement: two unrelated
 * debits that share a code, a refund, a row on another day.
 */
export function commissionLinks(transactions: BankTransaction[]): Map<string, BankTransaction> {
  const debitsByCode = new Map<string, BankTransaction[]>();
  for (const t of transactions) {
    if (t.amount >= 0 || t.dispCode === undefined) continue;
    debitsByCode.set(codeKey(t), [...(debitsByCode.get(codeKey(t)) ?? []), t]);
  }
  const links = new Map<string, BankTransaction>();
  for (const debits of debitsByCode.values()) {
    for (const row of debits) {
      const owners = debits.filter(
        (other) =>
          other.id !== row.id &&
          Math.abs(other.amount) > Math.abs(row.amount) &&
          Math.abs(daysBetween(other.date, row.date)) <= COMMISSION_MAX_DAYS,
      );
      const [owner] = owners;
      if (owners.length === 1 && owner !== undefined) links.set(row.id, owner);
    }
  }
  return links;
}

export interface CommissionPart {
  item: MatchItemRef;
  row: BankTransaction;
  amount: Cents;
}

/**
 * The commission parts of the rows tied to a debit with confirmed `amount` matches. The row is
 * split like the debit: by `weight` over the instalments of one shared notice, otherwise in
 * proportion to the parts of the debit (all of it when the debit pays one item).
 */
export function commissionParts(
  matches: BillMatch[],
  transactions: BankTransaction[],
  sharedOf: (item: MatchItemRef) => { groupId: string; weight: Cents } | undefined,
): CommissionPart[] {
  const links = commissionLinks(transactions);
  const used = new Set(matches.map((m) => m.transactionId));
  const parts: CommissionPart[] = [];
  for (const row of transactions) {
    const debit = links.get(row.id);
    if (debit === undefined || used.has(row.id)) continue;
    const paid = matches
      .filter((m) => m.confirmed && m.part === 'amount' && m.transactionId === debit.id)
      .filter((m) => m.amount !== 0)
      .sort((a, b) => compareText(a.itemType, b.itemType) || compareText(a.itemId, b.itemId));
    if (paid.length === 0) continue;
    const groups = new Set(paid.map((m) => sharedOf(m)?.groupId));
    const oneNotice = groups.size === 1 && !groups.has(undefined);
    const weights = paid.map((m) => ({
      itemId: m.itemId,
      weight: oneNotice ? (sharedOf(m)?.weight as Cents) : (Math.abs(m.amount) as Cents),
    }));
    splitSharedDebit(row.amount, weights).forEach(({ amount }, index) => {
      const item = paid[index] as BillMatch;
      parts.push({ item: { itemType: item.itemType, itemId: item.itemId }, row, amount });
    });
  }
  return parts;
}
