/**
 * Transfers between own accounts (plan 3c, task 5): a movement whose counterparty has the IBAN of
 * another live account, with the movement of opposite sign on that account as its other leg.
 * A pair confirmed once, same accounts and direction, is automatic afterwards (question 4).
 */
import { normaliseIban } from './iban';
import type { Account, BankTransaction, Transfer, TransferPurpose } from './model';
import { cents } from './money';
import { daysBetween } from './period';
import { compareText } from './text';

/** The two legs of a transfer are at most this many days apart, either way. */
export const TRANSFER_LEG_DAYS = 5;

/** A transfer to confirm (`p-giro-<transactionId>`): never written by itself. */
export interface TransferProposal {
  id: string;
  transactionId: string;
  fromAccountId: string;
  toAccountId: string;
  /** The candidate other legs, sorted. */
  legIds: string[];
  reason: 'new-pair' | 'several-legs' | 'purpose-conflict';
  /** The purpose of the pair, when it has only one (several legs on a known pair). */
  purpose?: TransferPurpose;
}

export type TransferDraft = Omit<Transfer, 'v' | 'rev'>;

/**
 * The automatic transfers and the proposals on the live movements of live accounts that no use
 * has taken (`used`). A candidate names another live account by a valid IBAN (never by its
 * text); outgoings first, then by `date` and `id`. Its legs are the live unused movements of the
 * other account with the opposite amount within `TRANSFER_LEG_DAYS`; a movement taken as a leg
 * (or by a proposal) is no candidate any more. Automatic when the pair (from, to) has live
 * confirmed transfers that are not one-off, all with one purpose, and at most one leg.
 */
export function reconcileTransfers(input: {
  accounts: Account[];
  transactions: BankTransaction[];
  transfers: Transfer[];
  used: ReadonlySet<string>;
}): { transfers: TransferDraft[]; proposals: TransferProposal[] } {
  const accounts = input.accounts.filter((a) => a.deleted !== true);
  const ids = new Set(accounts.map((a) => a.id));
  const taken = new Set(input.used);
  const free = (t: BankTransaction) =>
    t.deleted !== true && !taken.has(t.id) && t.accountId !== undefined && ids.has(t.accountId);
  const otherOf = (t: BankTransaction): Account | undefined => {
    const iban =
      t.counterparty?.iban === undefined ? undefined : normaliseIban(t.counterparty.iban);
    return iban === undefined
      ? undefined
      : accounts.find((a) => a.iban === iban && a.id !== t.accountId);
  };
  const confirmed = input.transfers.filter(
    (t) => t.deleted !== true && t.source === 'confirmed' && t.oneOff === undefined,
  );
  const candidates = input.transactions
    .filter((t) => t.amount !== 0 && free(t) && otherOf(t) !== undefined)
    .sort(
      (a, b) =>
        Number(a.amount > 0) - Number(b.amount > 0) ||
        compareText(a.date, b.date) ||
        compareText(a.id, b.id),
    );

  const transfers: TransferDraft[] = [];
  const proposals: TransferProposal[] = [];
  for (const tx of candidates) {
    if (!free(tx)) continue;
    const other = otherOf(tx) as Account;
    const legIds = input.transactions
      .filter(
        (l) =>
          free(l) &&
          l.accountId === other.id &&
          l.amount === -tx.amount &&
          Math.abs(daysBetween(l.date, tx.date)) <= TRANSFER_LEG_DAYS,
      )
      .map((l) => l.id)
      .sort(compareText);
    taken.add(tx.id);
    for (const id of legIds) taken.add(id);
    const outgoing = tx.amount < 0;
    const fromAccountId = outgoing ? (tx.accountId as string) : other.id;
    const toAccountId = outgoing ? other.id : (tx.accountId as string);
    const purposes = [
      ...new Set(
        confirmed
          .filter((t) => t.fromAccountId === fromAccountId && t.toAccountId === toAccountId)
          .map((t) => t.purpose),
      ),
    ];
    const [purpose] = purposes;
    if (purposes.length === 1 && purpose !== undefined && legIds.length <= 1) {
      transfers.push(
        draftOf(
          tx,
          legIds[0],
          input.transactions,
          { fromAccountId, toAccountId },
          {
            purpose,
            source: 'auto',
          },
        ),
      );
      continue;
    }
    proposals.push({
      id: `p-giro-${tx.id}`,
      transactionId: tx.id,
      fromAccountId,
      toAccountId,
      legIds,
      reason:
        purposes.length > 1 ? 'purpose-conflict' : legIds.length > 1 ? 'several-legs' : 'new-pair',
      ...(purposes.length === 1 && purpose !== undefined ? { purpose } : {}),
    });
  }
  return { transfers, proposals };
}

/**
 * The transfer of the movement `tx` and its other leg `legId` (if any): `tr-<outgoing ?? incoming>`,
 * dated on the outgoing when there is one.
 */
export function draftOf(
  tx: BankTransaction,
  legId: string | undefined,
  transactions: BankTransaction[],
  accounts: { fromAccountId: string; toAccountId: string },
  what: { purpose: TransferPurpose; source: 'confirmed' | 'auto'; oneOff?: true },
): TransferDraft {
  const leg = transactions.find((t) => t.id === legId);
  const [out, inn] = tx.amount < 0 ? [tx, leg] : [leg, tx];
  return {
    id: `tr-${(out ?? tx).id}`,
    ...accounts,
    amount: cents(Math.abs(tx.amount)),
    date: (out ?? tx).date,
    ...(out === undefined ? {} : { outTransactionId: out.id }),
    ...(inn === undefined ? {} : { inTransactionId: inn.id }),
    purpose: what.purpose,
    source: what.source,
    ...(what.oneOff === undefined ? {} : { oneOff: what.oneOff }),
  };
}
