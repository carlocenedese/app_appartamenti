/**
 * Outgoings and the other movements left (plan 3c, task 6): a movement of a live account that no
 * phase before used gets a class from the rules learnt from earlier confirmations, or a proposal.
 * Proposals are recomputed, never stored, and carry ids, constant reasons and categories only.
 */
import { normaliseIban } from './iban';
import { imuRates } from './imu';
import { latestOperationByPath, undoTargetOf } from './journal';
import type { Operation } from './journal';
import type {
  Account,
  BankProfile,
  BankTransaction,
  Bill,
  BillMatch,
  ImuRule,
  ImuYear,
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
import { MAX_PATTERN_INPUT } from './safe-pattern';
import { recordPath } from './store/records';
import { compareText, foldText } from './text';

export type OutgoingReason =
  'new-counterparty' | 'no-counterparty' | 'rule-conflict' | 'undone' | 'f24';

/** `p-uscita-<transactionId>` or `p-f24-<transactionId>`: never written by itself. */
export interface OutgoingProposal {
  id: string;
  transactionId: string;
  step: 'uscita' | 'f24';
  reason: OutgoingReason;
  /** Only an order for the choice (question 7), never a class. */
  suggestedKind?: OutgoingKind;
  /**
   * On a `p-f24-` covered by a learnt IMU rule (plan 3d, task 5): its group and, when the group
   * has an open rate in the year of the movement, that year and the lowest open rate. Always to
   * confirm with `assignImuF24`, never written.
   */
  imuSuggestion?: { f24Group: string; year?: string; rateIndex?: number };
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
  /** For `f24Pattern`: the live one of the account of a movement. */
  bankProfiles: BankProfile[];
  /** For `imuSuggestion` (plan 3d, task 5); none without. */
  imuRules?: ImuRule[];
  imuYears?: ImuYear[];
}

/**
 * The suggestion of a learnt IMU rule for the F24 `tx` (question 8): the live rules of its
 * account with its counterparty key (or none for both), `validFrom` absent or not after its
 * date, `validTo` absent or not before it, all of one group; then the year of its date and the
 * open (`attesa`) rate with the lowest index of that group and year (question 7).
 */
export function imuSuggestionOf(
  tx: BankTransaction,
  key: PayerKey | undefined,
  input: Pick<OutgoingInput, 'imuRules' | 'imuYears' | 'classes' | 'transactions'>,
): OutgoingProposal['imuSuggestion'] {
  const groups = new Set(
    (input.imuRules ?? [])
      .filter(
        (r) =>
          r.deleted !== true &&
          r.accountId === tx.accountId &&
          r.key === key &&
          (r.validFrom === undefined || r.validFrom <= tx.date) &&
          (r.validTo === undefined || r.validTo >= tx.date),
      )
      .map((r) => r.f24Group),
  );
  const [f24Group] = groups;
  if (groups.size !== 1 || f24Group === undefined) return undefined;
  const year = tx.date.slice(0, 4);
  const open = imuRates({
    years: (input.imuYears ?? []).filter((y) => y.f24Group === f24Group && y.year === year),
    classes: input.classes,
    transactions: input.transactions,
  }).find((r) => r.status === 'attesa');
  return open === undefined ? { f24Group } : { f24Group, year, rateIndex: open.rateIndex };
}

/**
 * Whether the description of `tx` matches the `f24Pattern` of `profile` (none without one). The
 * real text of an F24 at the bank is not verified (R129): it is configuration, not code.
 */
export function isF24(tx: BankTransaction, profile: BankProfile | undefined): boolean {
  if (profile?.f24Pattern === undefined) return false;
  // The safe subset is measured on this length (R102): a longer description is cut, not skipped.
  return new RegExp(profile.f24Pattern).test(tx.description.slice(0, MAX_PATTERN_INPUT));
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
 * Whether `key` is the IBAN of a payer valid on the date of `tx` (R130, user1, 15 Nov 2026): no
 * `out` rule on it is ever applied or saved, such an outgoing is always confirmed by hand.
 */
export function isPayerIban(
  tx: BankTransaction,
  key: PayerKey | undefined,
  ctx: Pick<OutgoingInput, 'payers' | 'tenants'>,
): boolean {
  return (
    key?.startsWith('iban:') === true &&
    validPayers(ctx.payers, key, tx.date as ISODate, ctx.tenants).length > 0
  );
}

/**
 * The valid rules of `tx` (question 1), by `id`: live, same account, same direction, same key,
 * `validFrom` absent or not after its date, `validTo` absent or not before it; none without a
 * key. The amount does not count.
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
        (r.validFrom === undefined || r.validFrom <= tx.date) &&
        (r.validTo === undefined || r.validTo >= tx.date),
    )
    .sort((a, b) => compareText(a.id, b.id));
}

/**
 * The automatic classes and the proposals of the candidates (`outgoingCandidate`), by `id`. The
 * valid rules of a movement (`validRules`): live, same account, same direction, same key,
 * `validFrom` absent or not after its date, `validTo` absent or not before it (question 1); one
 * pair (kind, apartment) is a class with the rule (the first by `id`), several pairs a `rule-conflict`, none `new-counterparty` (`no-counterparty`
 * without a key). A movement whose deleted class has an `outgoing.cancel-auto` in force in its
 * history is `undone`, never automatic again, unless the undo of a whole `outgoing.reconcile`
 * deleted it last (as R118). An incoming candidate gets a class or nothing (its «chi»
 * of the income stays). An outgoing F24 (`isF24` with the live profile of its account) is always
 * a `p-f24-` proposal suggesting `tasse`, never automatic, whatever the rules (decision 5). An
 * outgoing to the IBAN of a valid payer is never automatic either (`isPayerIban`, R130).
 * `missingDocument`: the movements of the live `utenze` and `condominio`
 * classes, these included, without a live confirmed match (question 8).
 */
export function reconcileOutgoing(input: OutgoingInput): {
  classes: MovementClassDraft[];
  proposals: OutgoingProposal[];
  missingDocument: string[];
} {
  const latest = latestOperationByPath(input.operations);
  const operationById = new Map(input.operations.map((o) => [o.id, o]));
  // As R118 for the payments (I5 of the final review): only the undo of a whole reconciliation
  // puts a deleted class back to normal; a cancel-auto in force in its history makes it `undone`.
  const isUndone = (c: MovementClass): boolean => {
    const path = recordPath('movementClass', c.id);
    const by = latest.get(path);
    if (by?.kind === 'undo' && operationById.get(by.undoes ?? '')?.kind === 'outgoing.reconcile') {
      return false;
    }
    return input.operations.some(
      (o) =>
        o.kind === 'outgoing.cancel-auto' &&
        o.changes.some((change) => change.path === path) &&
        undoTargetOf(input.operations, o) !== undefined,
    );
  };
  const undone = new Set(
    input.classes.filter((c) => c.deleted === true && isUndone(c)).map((c) => c.transactionId),
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
    if (direction === 'out') {
      const account = input.accounts.find((a) => a.id === tx.accountId);
      const profile = input.bankProfiles.find(
        (p) => p.deleted !== true && p.id === account?.bankProfileId,
      );
      // Always a proposal, even with a valid rule (decision 5).
      if (isF24(tx, profile)) {
        const imuSuggestion = imuSuggestionOf(tx, key, input);
        proposals.push({
          id: `p-f24-${tx.id}`,
          transactionId: tx.id,
          step: 'f24',
          reason: 'f24',
          suggestedKind: 'tasse',
          ...(imuSuggestion === undefined ? {} : { imuSuggestion }),
        });
        continue;
      }
    }
    const valid =
      undone.has(tx.id) || isPayerIban(tx, key, input)
        ? []
        : validRules(input.rules, tx, direction, key);
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
