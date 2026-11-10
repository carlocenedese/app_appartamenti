/**
 * Matching of bills and instalments (condominium, TARI) with the debits of the bank statements
 * (section 42, R2, R3 and R7). A cost counts only once its debit is in the CSV, so every item
 * ends up matched, proposed for a person to confirm, ambiguous, assumed or pending.
 *
 * - Exact match: the paying account (`paidFromApartmentId`, else `apartmentId`), the amount to
 *   the cent with the opposite sign, the debit date inside the window around the due date (for a
 *   bill without one, the end of its period). Only one-to-one is assigned automatically: the
 *   candidates form a graph and only its connected components with one item and one debit are
 *   matched; every other component is reported as `ambiguous` and left to a person (R15).
 * - A shared notice (the TARI of Berchet and Lovarini) is one item: its instalments are matched
 *   together to one debit of `groupTotal` and the debit is split by their `weight`.
 * - Proposal: a bill whose debit has another amount but the supplier in the description gets an
 *   unconfirmed match, one-to-one only; with several possible debits it stays pending.
 * - A period no statement covers: its items are taken as paid (`by: 'assumed'`, R2).
 * - Commission (R7): the debit row with the same disposition code as a matched debit follows the
 *   item of that debit.
 *
 * The result never depends on the order of the input: everything is sorted by id.
 */
import { BillMatchSchema } from './model';
import type { BankTransaction, Bill, BillMatch, Instalment } from './model';
import { cents, splitCents } from './money';
import type { Cents } from './money';
import { daysBetween } from './period';
import type { ISODate } from './period';
import { foldText } from './text';

export type MatchItemType = BillMatch['itemType'];

export interface MatchItemRef {
  itemType: MatchItemType;
  itemId: string;
}

export interface MatchInput {
  bills: Bill[];
  instalments: Instalment[];
  transactions: BankTransaction[];
  /** Days the debit may come before and after the reference date, both ends included. */
  window: { daysBefore: number; daysAfter: number };
  /** Periods covered by a bank statement; an item due outside all of them is assumed paid. */
  statementPeriods: { from: ISODate; to: ISODate }[];
  existing: BillMatch[];
}

export interface MatchResult {
  /** Confirmed existing matches unchanged, plus the new ones; sorted by id. */
  matches: BillMatch[];
  /** Items without any match, ambiguous ones included: they stay out of the settlement. */
  pending: MatchItemRef[];
  /** One entry per item of a component that is not one-to-one; a shared notice by its group id. */
  ambiguous: { itemId: string; transactionIds: string[] }[];
  /** Transactions no match uses. */
  unmatchedTransactions: string[];
}

/** One node of the candidate graph: a bill, an instalment or all instalments of one notice. */
interface ItemNode {
  /** Unique among nodes and the sort order. */
  key: string;
  /** What `ambiguous` reports: the item id, or the group id for a shared notice. */
  reportId: string;
  account: string;
  ref: ISODate;
  expected: Cents;
  /** Each item with its expected part, sorted by id. */
  members: (MatchItemRef & { amount: Cents })[];
  /** Bills only: instalments have no supplier to look for. */
  supplier?: string;
}

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const refKey = ({ itemType, itemId }: MatchItemRef): string => `${itemType}\u0000${itemId}`;

function assertWeight(weight: number, itemId: string): void {
  if (!Number.isSafeInteger(weight) || weight <= 0) {
    throw new RangeError(`Weight of ${itemId} must be a positive amount in cents`);
  }
}

/**
 * Splits one debit shared by several items in proportion to their weights (for the TARI notice of
 * Berchet and Lovarini, the totals of each supply). The shares have the items' sign, opposite to
 * the debit's: a debit of -186,00 € gives positive shares. They always sum to the debit; the
 * leftover cents go to the largest remainders, on equal remainders to the first items.
 * Throws a `RangeError` if there is no weight or a weight is not a positive amount.
 */
export function splitSharedDebit(
  debit: Cents,
  weights: { itemId: string; weight: Cents }[],
): { itemId: string; amount: Cents }[] {
  if (weights.length === 0) throw new RangeError('Cannot split a debit without weights');
  for (const { itemId, weight } of weights) assertWeight(weight, itemId);
  const shares = splitCents(
    cents(-debit),
    weights.map(({ weight }) => weight),
  );
  return weights.map(({ itemId }, index) => ({ itemId, amount: shares[index] as Cents }));
}

function instalmentExpected(instalment: Instalment): Cents {
  // Condominium: the whole instalment plus last year's settlement; the owner's share is a split
  // of the cost, not a smaller debit.
  if (instalment.kind === 'condominio') return cents(instalment.rata + instalment.conguaglioPrec);
  return instalment.rata;
}

const payingAccount = (instalment: Instalment): string =>
  instalment.paidFromApartmentId ?? instalment.apartmentId;

function groupNode(groupId: string, group: Instalment[]): ItemNode {
  const members = [...group].sort((a, b) => byText(a.id, b.id));
  const first = members[0] as Instalment;
  const shared = (instalment: Instalment) => instalment.shared as NonNullable<Instalment['shared']>;
  for (const member of members) {
    if (payingAccount(member) !== payingAccount(first)) {
      throw new Error(`Shared notice ${groupId}: its instalments are paid from different accounts`);
    }
    if (member.dueDate !== first.dueDate) {
      throw new Error(`Shared notice ${groupId}: its instalments have different due dates`);
    }
    if (shared(member).groupTotal !== shared(first).groupTotal) {
      throw new Error(`Shared notice ${groupId}: its instalments have different totals`);
    }
  }
  const total = shared(first).groupTotal;
  const parts = splitSharedDebit(
    cents(-total),
    members.map((member) => ({ itemId: member.id, weight: shared(member).weight })),
  );
  return {
    key: `group\u0000${groupId}`,
    reportId: groupId,
    account: payingAccount(first),
    ref: first.dueDate,
    expected: total,
    members: parts.map(({ itemId, amount }) => ({ itemType: 'instalment', itemId, amount })),
  };
}

function buildNodes(bills: Bill[], instalments: Instalment[]): ItemNode[] {
  const nodes: ItemNode[] = bills.map((bill) => ({
    key: `bill\u0000${bill.id}`,
    reportId: bill.id,
    account: bill.apartmentId,
    ref: bill.dueDate ?? bill.periodEnd,
    expected: bill.amount,
    members: [{ itemType: 'bill', itemId: bill.id, amount: bill.amount }],
    supplier: bill.supplier,
  }));
  const groups = new Map<string, Instalment[]>();
  for (const instalment of instalments) {
    if (instalment.shared === undefined) {
      const expected = instalmentExpected(instalment);
      nodes.push({
        key: `instalment\u0000${instalment.id}`,
        reportId: instalment.id,
        account: payingAccount(instalment),
        ref: instalment.dueDate,
        expected,
        members: [{ itemType: 'instalment', itemId: instalment.id, amount: expected }],
      });
    } else {
      const group = groups.get(instalment.shared.groupId) ?? [];
      group.push(instalment);
      groups.set(instalment.shared.groupId, group);
    }
  }
  for (const [groupId, group] of groups) nodes.push(groupNode(groupId, group));
  return nodes.sort((a, b) => byText(a.key, b.key));
}

/** One record per id (overlapping statements repeat a movement), sorted by id. */
function uniqueTransactions(transactions: BankTransaction[]): BankTransaction[] {
  const byId = new Map<string, BankTransaction>();
  for (const transaction of transactions) {
    if (transaction.deleted === true) continue;
    const known = byId.get(transaction.id);
    // The same movement read twice: keep one of them, whatever the order they came in.
    if (known === undefined || transaction.statementHash < known.statementHash) {
      byId.set(transaction.id, transaction);
    }
  }
  return [...byId.values()].sort((a, b) => byText(a.id, b.id));
}

/**
 * Commission rows: a movement that shares its disposition code with a larger movement of the same
 * account. They are never the amount of an item, only its commission.
 */
function commissionRows(transactions: BankTransaction[]): Set<string> {
  const largest = new Map<string, number>();
  const codeKey = (t: BankTransaction) => `${t.apartmentId}\u0000${t.dispCode ?? ''}`;
  for (const t of transactions) {
    if (t.dispCode === undefined) continue;
    largest.set(codeKey(t), Math.max(largest.get(codeKey(t)) ?? 0, Math.abs(t.amount)));
  }
  const rows = new Set<string>();
  for (const t of transactions) {
    if (t.dispCode !== undefined && Math.abs(t.amount) < (largest.get(codeKey(t)) ?? 0)) {
      rows.add(t.id);
    }
  }
  return rows;
}

interface Solution {
  pairs: [ItemNode, BankTransaction][];
  ambiguous: { itemId: string; transactionIds: string[] }[];
  touchedNodes: Set<string>;
  touchedTransactions: Set<string>;
}

/**
 * The connected components of the candidate graph: a component with one item and one transaction
 * is a pair, every other one is ambiguous (even when only one pairing would fit: that is a choice).
 */
function solve(
  nodes: ItemNode[],
  transactions: BankTransaction[],
  isCandidate: (node: ItemNode, transaction: BankTransaction) => boolean,
): Solution {
  const candidates = new Map<string, BankTransaction[]>();
  const nodesOf = new Map<string, ItemNode[]>();
  for (const node of nodes) {
    const found = transactions.filter((transaction) => isCandidate(node, transaction));
    candidates.set(node.key, found);
    for (const transaction of found) {
      nodesOf.set(transaction.id, [...(nodesOf.get(transaction.id) ?? []), node]);
    }
  }
  const solution: Solution = {
    pairs: [],
    ambiguous: [],
    touchedNodes: new Set(),
    touchedTransactions: new Set(),
  };
  for (const start of nodes) {
    if (solution.touchedNodes.has(start.key) || candidates.get(start.key)?.length === 0) continue;
    const componentNodes: ItemNode[] = [];
    const componentTransactions = new Map<string, BankTransaction>();
    const queue = [start];
    solution.touchedNodes.add(start.key);
    for (let node = queue.shift(); node !== undefined; node = queue.shift()) {
      componentNodes.push(node);
      for (const transaction of candidates.get(node.key) ?? []) {
        if (componentTransactions.has(transaction.id)) continue;
        componentTransactions.set(transaction.id, transaction);
        solution.touchedTransactions.add(transaction.id);
        for (const next of nodesOf.get(transaction.id) ?? []) {
          if (solution.touchedNodes.has(next.key)) continue;
          solution.touchedNodes.add(next.key);
          queue.push(next);
        }
      }
    }
    const [onlyTransaction] = componentTransactions.values();
    if (componentNodes.length === 1 && componentTransactions.size === 1 && onlyTransaction) {
      solution.pairs.push([start, onlyTransaction]);
      continue;
    }
    for (const node of componentNodes) {
      const ids = (candidates.get(node.key) ?? []).map(({ id }) => id);
      solution.ambiguous.push({ itemId: node.reportId, transactionIds: ids });
    }
  }
  return solution;
}

function makeMatch(
  item: MatchItemRef,
  part: BillMatch['part'],
  transaction: { id: string; date: ISODate },
  amount: Cents,
  confirmed: boolean,
  by: BillMatch['by'],
): BillMatch {
  return BillMatchSchema.parse({
    id: `m-${item.itemType}-${item.itemId}-${part}-${transaction.id}`,
    v: 1,
    rev: 1,
    itemType: item.itemType,
    itemId: item.itemId,
    transactionId: transaction.id,
    transactionDate: transaction.date,
    amount,
    part,
    confirmed,
    by,
  });
}

function assertWindow({ daysBefore, daysAfter }: MatchInput['window']): void {
  if (!Number.isSafeInteger(daysBefore) || !Number.isSafeInteger(daysAfter)) {
    throw new RangeError('The date window must be a whole number of days');
  }
  if (daysBefore < 0 || daysAfter < 0) throw new RangeError('The date window cannot be negative');
}

/** Commission matches for the debit rows tied by disposition code to a matched debit. */
function commissionMatches(matches: BillMatch[], transactions: BankTransaction[]): BillMatch[] {
  const byId = new Map(transactions.map((t) => [t.id, t]));
  const used = new Set(matches.map((m) => m.transactionId));
  // For each account and disposition code, the matched debits and the first item each one pays.
  const payers = new Map<string, Map<string, MatchItemRef>>();
  const ordered = [...matches].sort((a, b) => byText(refKey(a), refKey(b)));
  for (const match of ordered) {
    const debit = byId.get(match.transactionId);
    if (!match.confirmed || match.part !== 'amount' || debit?.dispCode === undefined) continue;
    const code = `${debit.apartmentId}\u0000${debit.dispCode}`;
    const debits = payers.get(code) ?? new Map<string, MatchItemRef>();
    if (!debits.has(debit.id)) debits.set(debit.id, match);
    payers.set(code, debits);
  }
  const found: BillMatch[] = [];
  for (const t of transactions) {
    if (t.amount >= 0 || t.dispCode === undefined || used.has(t.id)) continue;
    const debits = payers.get(`${t.apartmentId}\u0000${t.dispCode}`);
    // Two matched debits with the same code: which one the row belongs to is not known.
    const [item, ...others] = debits?.values() ?? [];
    if (item === undefined || others.length > 0) continue;
    found.push(makeMatch(item, 'commission', t, cents(-t.amount), true, 'auto'));
  }
  return found;
}

/**
 * Matches bills and instalments with the movements of the bank statements (see the module
 * comment for the rules). Confirmed existing matches are kept unchanged and their movements and
 * items are not matched again; unconfirmed existing matches are dropped and computed again.
 * Throws if the instalments of a shared notice disagree on paying account, due date or total.
 */
export function matchToTransactions(input: MatchInput): MatchResult {
  assertWindow(input.window);
  const { daysBefore, daysAfter } = input.window;
  const bills = input.bills.filter((bill) => bill.deleted !== true);
  const instalments = input.instalments.filter((instalment) => instalment.deleted !== true);
  const transactions = uniqueTransactions(input.transactions);
  const kept = input.existing.filter((match) => match.confirmed && match.deleted !== true);
  const consumed = new Set(kept.map((match) => match.transactionId));
  // An item with a confirmed part is settled by hand or already matched: a whole debit on top of
  // a partial cover would pay it twice.
  const covered = new Set(kept.filter((m) => m.part === 'amount').map(refKey));

  const created: BillMatch[] = [];
  const open: ItemNode[] = [];
  for (const node of buildNodes(bills, instalments)) {
    if (node.members.some((member) => covered.has(refKey(member)))) continue;
    const inStatement = input.statementPeriods.some((p) => p.from <= node.ref && node.ref <= p.to);
    if (inStatement) {
      open.push(node);
      continue;
    }
    for (const member of node.members) {
      const assumed = { id: `assumed-${member.itemId}`, date: node.ref };
      created.push(makeMatch(member, 'amount', assumed, member.amount, true, 'assumed'));
    }
  }

  const commissions = commissionRows(transactions);
  const free = transactions.filter((t) => !consumed.has(t.id) && !commissions.has(t.id));
  const inWindow = (node: ItemNode, t: BankTransaction): boolean => {
    const days = daysBetween(t.date, node.ref);
    return t.apartmentId === node.account && -daysBefore <= days && days <= daysAfter;
  };

  const exact = solve(
    open,
    free,
    (node, t) => node.expected !== 0 && t.amount === -node.expected && inWindow(node, t),
  );
  for (const [node, t] of exact.pairs) {
    for (const member of node.members) {
      created.push(makeMatch(member, 'amount', t, member.amount, true, 'auto'));
    }
  }

  // Proposals: bills only, among the items and movements the exact pass did not touch.
  const proposals = solve(
    open.filter((node) => node.supplier !== undefined && !exact.touchedNodes.has(node.key)),
    free.filter((t) => !exact.touchedTransactions.has(t.id)),
    (node, t) =>
      Math.sign(t.amount) === -Math.sign(node.expected) &&
      t.amount !== -node.expected &&
      foldText(t.description).includes(foldText(node.supplier ?? '')) &&
      inWindow(node, t),
  );
  for (const [node, t] of proposals.pairs) {
    const member = node.members[0] as MatchItemRef;
    created.push(makeMatch(member, 'amount', t, cents(-t.amount), false, 'auto'));
  }

  created.push(...commissionMatches([...kept, ...created], transactions));
  const matches = [...kept, ...created].sort((a, b) => byText(a.id, b.id));

  const withMatch = new Set(matches.filter((m) => m.part === 'amount').map(refKey));
  const items: MatchItemRef[] = [
    ...bills.map((bill) => ({ itemType: 'bill' as const, itemId: bill.id })),
    ...instalments.map((instalment) => ({
      itemType: 'instalment' as const,
      itemId: instalment.id,
    })),
  ];
  const pending = items
    .filter((item) => !withMatch.has(refKey(item)))
    .sort((a, b) => byText(refKey(a), refKey(b)));
  const used = new Set(matches.map((m) => m.transactionId));
  return {
    matches,
    pending,
    ambiguous: exact.ambiguous.sort((a, b) => byText(a.itemId, b.itemId)),
    unmatchedTransactions: transactions.filter((t) => !used.has(t.id)).map((t) => t.id),
  };
}

export interface MatchCheckError {
  code: 'item-over' | 'item-under' | 'transaction-over';
  id: string;
}

const ERROR_ORDER: MatchCheckError['code'][] = ['item-over', 'item-under', 'transaction-over'];

/**
 * Checks matches made by hand, which may split a debit over several items or cover an item with
 * several debits: only confirmed matches count. The `amount` parts of an item must sum to its
 * expected amount (for an instalment of a shared notice, its share from `splitSharedDebit`); the
 * parts of a movement, commissions included, must not exceed its absolute value.
 */
export function validateMatches(input: {
  items: (MatchItemRef & { expected: Cents })[];
  transactions: BankTransaction[];
  matches: BillMatch[];
}): { errors: MatchCheckError[] } {
  const confirmed = input.matches.filter((m) => m.confirmed && m.deleted !== true);
  const errors: MatchCheckError[] = [];
  for (const item of input.items) {
    const sum = confirmed
      .filter((m) => m.part === 'amount' && refKey(m) === refKey(item))
      .reduce((total, m) => total + m.amount, 0);
    // Compare in the item's direction, so that a credit note is checked by its magnitude.
    const direction = item.expected < 0 ? -1 : 1;
    const got = sum * direction;
    const wanted = Math.abs(item.expected);
    if (got > wanted) errors.push({ code: 'item-over', id: item.itemId });
    if (got < wanted) errors.push({ code: 'item-under', id: item.itemId });
  }
  for (const t of uniqueTransactions(input.transactions)) {
    // Match amounts have the items' sign, opposite to the movement's.
    const direction = t.amount < 0 ? 1 : -1;
    const sum = confirmed
      .filter((m) => m.transactionId === t.id)
      .reduce((total, m) => total + m.amount * direction, 0);
    if (sum > Math.abs(t.amount)) errors.push({ code: 'transaction-over', id: t.id });
  }
  errors.sort(
    (a, b) => ERROR_ORDER.indexOf(a.code) - ERROR_ORDER.indexOf(b.code) || byText(a.id, b.id),
  );
  return { errors };
}
