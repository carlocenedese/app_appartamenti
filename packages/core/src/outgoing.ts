/**
 * Outgoings and the other movements left (plan 3c, task 6): a movement of a live account that no
 * phase before used gets a class from the rules learnt from earlier confirmations, or a proposal.
 * Proposals are recomputed, never stored, and carry ids, constant reasons and categories only.
 */
import { normaliseIban } from './iban';
import { latestOperationByPath } from './journal';
import type { Operation } from './journal';
import type {
  Account,
  BankTransaction,
  Bill,
  BillMatch,
  MovementClass,
  MovementRule,
  OutgoingKind,
  Payer,
  PayerKey,
  SupplierProfile,
  Tenant,
} from './model';
import { payerKeyOf, validPayers } from './payers';
import type { ISODate } from './period';
import { recordPath } from './store/records';
import { compareText, foldText } from './text';

export type OutgoingReason = 'new-counterparty' | 'no-counterparty' | 'rule-conflict' | 'undone';

/** `p-uscita-<transactionId>`: never written by itself. */
export interface OutgoingProposal {
  id: string;
  transactionId: string;
  step: 'uscita' | 'f24';
  reason: OutgoingReason;
  /** Only an order for the choice (question 7), never a class. */
  suggestedKind?: OutgoingKind;
}

export type MovementClassDraft = Omit<MovementClass, 'v' | 'rev'>;

export interface OutgoingInput {
  accounts: Account[];
  transactions: BankTransaction[];
  classes: MovementClass[];
  rules: MovementRule[];
  payers: Payer[];
  /** For the payers of deleted tenants, which are not valid (R119). */
  tenants: Tenant[];
  bills: Bill[];
  supplierProfiles: SupplierProfile[];
  /** For `missingDocument`. */
  matches: BillMatch[];
  used: ReadonlySet<string>;
  /** The journal: it tells who deleted a class. */
  operations: Operation[];
}

/**
 * Whether `tx` is a candidate of the outgoings, with its direction and counterparty key: live,
 * unused, of a live account, not zero, its counterparty no own account; an incoming one only with
 * an `iban:` key that no valid payer has on its date (question 2).
 */
export function outgoingCandidate(
  tx: BankTransaction,
  ctx: Pick<OutgoingInput, 'accounts' | 'payers' | 'tenants' | 'used'>,
): { direction: 'in' | 'out'; key?: PayerKey } | undefined {
  const accounts = ctx.accounts.filter((a) => a.deleted !== true);
  if (tx.deleted === true || ctx.used.has(tx.id) || tx.amount === 0) return undefined;
  if (!accounts.some((a) => a.id === tx.accountId)) return undefined;
  const iban =
    tx.counterparty?.iban === undefined ? undefined : normaliseIban(tx.counterparty.iban);
  if (iban !== undefined && accounts.some((a) => a.iban === iban)) return undefined;
  const key = payerKeyOf(tx.counterparty);
  if (tx.amount < 0) return { direction: 'out', ...(key === undefined ? {} : { key }) };
  if (key === undefined || !key.startsWith('iban:')) return undefined;
  if (validPayers(ctx.payers, key, tx.date as ISODate, ctx.tenants).length > 0) return undefined;
  return { direction: 'in', key };
}

/**
 * The valid rules of `tx` (question 1), by `id`: live, same account, same direction, same key,
 * `validTo` absent or not before its date; none without a key. The amount does not count.
 */
export function validRules(
  rules: MovementRule[],
  tx: BankTransaction,
  direction: 'in' | 'out',
  key: PayerKey | undefined,
): MovementRule[] {
  if (key === undefined) return [];
  return rules
    .filter(
      (r) =>
        r.deleted !== true &&
        r.accountId === tx.accountId &&
        r.direction === direction &&
        r.key === key &&
        (r.validTo === undefined || r.validTo >= tx.date),
    )
    .sort((a, b) => compareText(a.id, b.id));
}

/**
 * The automatic classes and the proposals of the candidates (`outgoingCandidate`), by `id`. The
 * valid rules of a movement: live, same account, same direction, same key, `validTo` absent or
 * not before its date (question 1); one pair (kind, apartment) is a class with the rule (the
 * first by `id`), several pairs a `rule-conflict`, none `new-counterparty` (`no-counterparty`
 * without a key). A movement whose class the latest operation deleted is `outgoing.cancel-auto`
 * is `undone`, never automatic again. An incoming candidate gets a class or nothing (its «chi»
 * of the income stays). `missingDocument`: the movements of the live `utenze` and `condominio`
 * classes, these included, without a live confirmed match (question 8).
 */
export function reconcileOutgoing(input: OutgoingInput): {
  classes: MovementClassDraft[];
  proposals: OutgoingProposal[];
  missingDocument: string[];
} {
  const latest = latestOperationByPath(input.operations);
  const undone = new Set(
    input.classes
      .filter(
        (c) =>
          c.deleted === true &&
          latest.get(recordPath('movementClass', c.id))?.kind === 'outgoing.cancel-auto',
      )
      .map((c) => c.transactionId),
  );
  const suppliers = [...input.bills, ...input.supplierProfiles]
    .filter((r) => r.deleted !== true)
    .map((r) => foldText(r.supplier))
    .filter((s) => s !== '');
  const classes: MovementClassDraft[] = [];
  const proposals: OutgoingProposal[] = [];
  for (const tx of input.transactions) {
    const candidate = outgoingCandidate(tx, input);
    if (candidate === undefined) continue;
    const { direction, key } = candidate;
    const valid = undone.has(tx.id) ? [] : validRules(input.rules, tx, direction, key);
    const pairs = new Set(valid.map((r) => `${r.kind}\u0000${r.apartmentId}`));
    const [rule] = valid;
    if (pairs.size === 1 && rule !== undefined) {
      classes.push({
        id: `mc-${tx.id}`,
        transactionId: tx.id,
        kind: rule.kind,
        apartmentId: rule.apartmentId,
        ruleId: rule.id,
      });
      continue;
    }
    if (direction === 'in') continue;
    const reason: OutgoingReason = undone.has(tx.id)
      ? 'undone'
      : pairs.size > 1
        ? 'rule-conflict'
        : key === undefined
          ? 'no-counterparty'
          : 'new-counterparty';
    const text = foldText(tx.description);
    const known = suppliers.some((s) => text.includes(s));
    proposals.push({
      id: `p-uscita-${tx.id}`,
      transactionId: tx.id,
      step: 'uscita',
      reason,
      ...(known ? { suggestedKind: 'utenze' as const } : {}),
    });
  }

  const matched = new Set(
    input.matches
      .filter((m) => m.deleted !== true && m.confirmed && m.by !== 'assumed')
      .map((m) => m.transactionId),
  );
  const missingDocument = [...input.classes.filter((c) => c.deleted !== true), ...classes]
    .filter(
      (c) => (c.kind === 'utenze' || c.kind === 'condominio') && !matched.has(c.transactionId),
    )
    .map((c) => c.transactionId)
    .sort(compareText);
  const byId = (a: { id: string }, b: { id: string }): number => compareText(a.id, b.id);
  return { classes: classes.sort(byId), proposals: proposals.sort(byId), missingDocument };
}
