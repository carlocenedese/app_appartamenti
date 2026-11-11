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
 *   Section 42, R2 also asks for the supplier in the description of the debit: a bill whose
 *   one-to-one debit does not name its supplier (compared with `foldText`) is still paired, but
 *   as an unconfirmed proposal (`confirmed: false`, `by: 'auto'`) for a person to confirm by
 *   hand. It is not pending, as with every other proposal. Instalments and shared notices have no
 *   supplier and keep being confirmed.
 * - A shared notice (the TARI of Berchet and Lovarini) is one item: its instalments are matched
 *   together to one debit of `groupTotal` and the debit is split by their `weight`. A notice with
 *   one instalment only (the others not entered yet) or whose instalments disagree on paying
 *   account, due date or total, or carry a weight that is not positive, is reported in
 *   `invalidGroups`: its instalments stay pending, never matched nor assumed.
 * - Proposal: besides the exact pairs without the supplier, a bill whose debit has another amount
 *   but the supplier in the description gets an unconfirmed match, one-to-one only; with several
 *   possible debits it stays pending.
 * - A period no statement covers: its items are taken as paid (`by: 'assumed'`, R2).
 * - Commission (R7): the debit row tied to a matched debit by the disposition code follows the
 *   items of that debit with the same split (see `commission.ts`).
 *
 * The result never depends on the order of the input: everything is sorted by id.
 */
import { BillMatchSchema } from './model';
import type { BankTransaction, Bill, BillMatch, Instalment } from './model';
import { commissionLinks, commissionParts } from './commission';
import { cents } from './money';
import type { Cents } from './money';
import { daysBetween } from './period';
import type { ISODate } from './period';
import { splitSharedDebit } from './split';
import { compareText as byText, foldText } from './text';

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
  /**
   * Matches already recorded. Confirmed ones (manual or automatic) are kept unchanged and their
   * movements and items are not matched again; unconfirmed and `assumed` ones are dropped and
   * computed again, so a statement read later can verify an item taken as paid (R2).
   */
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
  /**
   * Shared notices that cannot be matched, sorted by group id: `incomplete` with a single
   * instalment present, `inconsistent` when the instalments disagree on paying account, due date
   * or total, or a weight is not positive. All their instalments are in `pending`.
   */
  invalidGroups: InvalidGroup[];
}

export interface InvalidGroup {
  groupId: string;
  reason: 'incomplete' | 'inconsistent';
}

/** True when the description of the movement names the supplier, both folded by `foldText`. */
const namesSupplier = (supplier: string, transaction: BankTransaction): boolean =>
  foldText(transaction.description).includes(foldText(supplier));

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
  /** Bills only: instalments have no supplier to look for in the description. */
  supplier?: string;
}

const refKey = ({ itemType, itemId }: MatchItemRef): string => `${itemType}\u0000${itemId}`;

/**
 * The debit a bill or an instalment is expected to cause on the bank statement, as a positive
 * cost (negative for a credit note): a bill's `amount`; for a condominium instalment the whole
 * `rata` plus last year's settlement `conguaglioPrec` (the owner's share is a split of the cost,
 * not a smaller debit); for a TARI instalment its `rata`. A shared notice is matched on its
 * `groupTotal` instead, one debit for all its instalments.
 */
export function expectedDebit(item: Bill | Instalment): Cents {
  if (!('rata' in item)) return item.amount;
  if (item.kind === 'condominio') return cents(item.rata + item.conguaglioPrec);
  return item.rata;
}

const payingAccount = (instalment: Instalment): string =>
  instalment.paidFromApartmentId ?? instalment.apartmentId;

function groupNode(groupId: string, group: Instalment[]): ItemNode | InvalidGroup {
  const members = [...group].sort((a, b) => byText(a.id, b.id));
  const first = members[0] as Instalment;
  if (members.length < 2) return { groupId, reason: 'incomplete' };
  const shared = (instalment: Instalment) => instalment.shared as NonNullable<Instalment['shared']>;
  const consistent = members.every(
    (member) =>
      payingAccount(member) === payingAccount(first) &&
      member.dueDate === first.dueDate &&
      shared(member).groupTotal === shared(first).groupTotal &&
      shared(member).weight > 0,
  );
  if (!consistent) return { groupId, reason: 'inconsistent' };
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

function buildNodes(
  bills: Bill[],
  instalments: Instalment[],
): { nodes: ItemNode[]; invalidGroups: InvalidGroup[] } {
  const nodes: ItemNode[] = bills.map((bill) => ({
    key: `bill\u0000${bill.id}`,
    reportId: bill.id,
    account: bill.apartmentId,
    ref: bill.dueDate ?? bill.periodEnd,
    expected: expectedDebit(bill),
    members: [{ itemType: 'bill', itemId: bill.id, amount: expectedDebit(bill) }],
    supplier: bill.supplier,
  }));
  const groups = new Map<string, Instalment[]>();
  for (const instalment of instalments) {
    if (instalment.shared === undefined) {
      const expected = expectedDebit(instalment);
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
  const invalidGroups: InvalidGroup[] = [];
  for (const [groupId, group] of groups) {
    const node = groupNode(groupId, group);
    if ('reason' in node) invalidGroups.push(node);
    else nodes.push(node);
  }
  return {
    nodes: nodes.sort((a, b) => byText(a.key, b.key)),
    invalidGroups: invalidGroups.sort((a, b) => byText(a.groupId, b.groupId)),
  };
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

/**
 * Matches bills and instalments with the movements of the bank statements (see the module
 * comment for the rules and `MatchInput.existing` for the matches already recorded).
 * A shared notice that is incomplete or inconsistent never throws: it is reported in
 * `invalidGroups` and its instalments stay pending.
 */
export function matchToTransactions(input: MatchInput): MatchResult {
  assertWindow(input.window);
  const { daysBefore, daysAfter } = input.window;
  const bills = input.bills.filter((bill) => bill.deleted !== true);
  const instalments = input.instalments.filter((instalment) => instalment.deleted !== true);
  const transactions = uniqueTransactions(input.transactions);
  // Assumed matches are recomputed too: once a statement covers the period, R2 applies.
  const kept = input.existing.filter(
    (match) => match.confirmed && match.by !== 'assumed' && match.deleted !== true,
  );
  const consumed = new Set(kept.map((match) => match.transactionId));
  // An item with a confirmed part is settled by hand or already matched: a whole debit on top of
  // a partial cover would pay it twice.
  const covered = new Set(kept.filter((m) => m.part === 'amount').map(refKey));

  const created: BillMatch[] = [];
  const open: ItemNode[] = [];
  const { nodes, invalidGroups } = buildNodes(bills, instalments);
  for (const node of nodes) {
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

  const commissions = commissionLinks(transactions);
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
    // R2: the supplier must be in the description. Without it (a bill only) the pair is a
    // proposal for a person to confirm, not an automatic match.
    const confirmed = node.supplier === undefined || namesSupplier(node.supplier, t);
    for (const member of node.members) {
      created.push(makeMatch(member, 'amount', t, member.amount, confirmed, 'auto'));
    }
  }

  // Proposals of another amount: bills only, among the items and movements the exact pass did not
  // touch.
  const proposals = solve(
    open.filter((node) => node.supplier !== undefined && !exact.touchedNodes.has(node.key)),
    free.filter((t) => !exact.touchedTransactions.has(t.id)),
    (node, t) =>
      Math.sign(t.amount) === -Math.sign(node.expected) &&
      t.amount !== -node.expected &&
      namesSupplier(node.supplier ?? '', t) &&
      inWindow(node, t),
  );
  for (const [node, t] of proposals.pairs) {
    const member = node.members[0] as MatchItemRef;
    created.push(makeMatch(member, 'amount', t, cents(-t.amount), false, 'auto'));
  }

  const sharedById = new Map(instalments.map((i) => [i.id, i.shared]));
  const sharedOf = (item: MatchItemRef) =>
    item.itemType === 'instalment' ? sharedById.get(item.itemId) : undefined;
  for (const { item, row, amount } of commissionParts(
    [...kept, ...created],
    transactions,
    sharedOf,
  )) {
    created.push(makeMatch(item, 'commission', row, amount, true, 'auto'));
  }
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
    invalidGroups,
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
  const items = new Map<string, MatchItemRef & { expected: Cents }>();
  for (const item of input.items) {
    const known = items.get(refKey(item));
    if (known !== undefined && known.expected !== item.expected) {
      throw new RangeError(`Item ${item.itemId} is listed twice with different amounts`);
    }
    items.set(refKey(item), item);
  }
  for (const item of items.values()) {
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
    // By absolute value: a part with the wrong sign must not make room on the movement.
    const sum = confirmed
      .filter((m) => m.transactionId === t.id)
      .reduce((total, m) => total + Math.abs(m.amount), 0);
    if (sum > Math.abs(t.amount)) errors.push({ code: 'transaction-over', id: t.id });
  }
  errors.sort(
    (a, b) => ERROR_ORDER.indexOf(a.code) - ERROR_ORDER.indexOf(b.code) || byText(a.id, b.id),
  );
  return { errors };
}
