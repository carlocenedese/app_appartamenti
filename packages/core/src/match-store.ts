/**
 * Writing the matches of bills and instalments (plan 3c, task 3): the automatic run and the
 * confirmation by hand, each one operation of the journal. Only confirmed matches are saved;
 * proposals, ambiguous and assumed items are computed again at every run («Mie scelte» 6).
 * A new confirmed match on a movement classified by a rule takes its place in the same
 * operation (question 6); a class confirmed by hand stays and the match is a proposal.
 * Nothing is written while `checkConsistency` reports a problem (R113).
 */
import { checkConsistency, commitChange } from './journal';
import {
  MATCH_WINDOW,
  expectedDebit,
  matchToTransactions,
  sharedGroupProblem,
  statementPeriodsOf,
  validateMatches,
  matchId,
} from './match';
import type { MatchCheckError, MatchItemRef, MatchItemType, MatchResult } from './match';
import {
  AccountSchema,
  BankTransactionSchema,
  BillMatchSchema,
  BillSchema,
  InstalmentSchema,
  MovementClassSchema,
  PaymentSchema,
  StatementSchema,
  TransferSchema,
} from './model';
import type { BankTransaction, Bill, BillMatch, Instalment, MovementClass } from './model';
import { cents } from './money';
import type { Cents } from './money';
import { excludedIds, legsOf } from './movements';
import { parseOrThrow } from './parse';
import { splitSharedDebit } from './split';
import { loadAll } from './store/load';
import { recordPath } from './store/records';
import type { Store } from './store/store';
import { compareText } from './text';

export interface MatchProposal {
  /** `p-abb-<itemId>`. */
  id: string;
  itemType: MatchItemType;
  itemId: string;
  transactionId: string;
  reason: 'no-supplier' | 'amount-differs' | 'classified';
}

export type MatchRunResult =
  | {
      status: 'matched';
      /** The confirmed matches written (amounts and commissions); with `dryRun`, to be written. */
      written: number;
      /** The automatic classes the new matches take the place of. */
      yielded: number;
      proposals: MatchProposal[];
      pending: MatchItemRef[];
      ambiguous: MatchResult['ambiguous'];
      assumed: MatchItemRef[];
      operationId?: string;
    }
  | { status: 'refused'; reason: 'inconsistent-store' };

const refKey = ({ itemType, itemId }: MatchItemRef): string => `${itemType}\u0000${itemId}`;
const ref = ({ itemType, itemId }: MatchItemRef): MatchItemRef => ({ itemType, itemId });
const live = <T extends { deleted?: boolean }>(records: T[]): T[] =>
  records.filter((r) => r.deleted !== true);
const plural = (n: number, one: string, many: string): string =>
  `${String(n)} ${n === 1 ? one : many}`;

/** Every record the matching reads, deleted ones included (for the `before` of a write). */
async function loadMatchState(store: Store) {
  const all = { includeDeleted: true };
  const classes = (await loadAll(store, 'movementClass', MovementClassSchema, all)).records;
  const payments = live((await loadAll(store, 'payment', PaymentSchema, all)).records);
  const transfers = live((await loadAll(store, 'transfer', TransferSchema, all)).records);
  return {
    accounts: (await loadAll(store, 'account', AccountSchema, all)).records,
    statements: (await loadAll(store, 'statement', StatementSchema, all)).records,
    bills: (await loadAll(store, 'bill', BillSchema, all)).records,
    instalments: (await loadAll(store, 'instalment', InstalmentSchema, all)).records,
    transactions: (await loadAll(store, 'transaction', BankTransactionSchema, all)).records,
    matches: (await loadAll(store, 'match', BillMatchSchema, all)).records,
    classes,
    /** The live class of each movement. */
    classOf: new Map(live(classes).map((c) => [c.transactionId, c])),
    /** Excluded, paid by a tenant or a leg of a transfer: never matched to a bill. */
    used: new Set([
      ...excludedIds(classes),
      ...payments.flatMap((p) => (p.transactionId === undefined ? [] : [p.transactionId])),
      ...transfers.flatMap(legsOf),
    ]),
  };
}
type MatchState = Awaited<ReturnType<typeof loadMatchState>>;

/** A class confirmed by hand (no rule): it stays, a match on its movement is a proposal. */
const byHand = (c: MovementClass | undefined): boolean => c !== undefined && c.ruleId === undefined;

/** The writes of the new matches, plus the deletion of the automatic classes they replace. */
function changesOf(state: MatchState, written: BillMatch[]) {
  const stored = new Map(state.matches.map((m) => [m.id, m]));
  const yielded = [...new Set(written.map((m) => m.transactionId))]
    .flatMap((id) => {
      const c = state.classOf.get(id);
      return c?.ruleId === undefined ? [] : [c];
    })
    .sort((a, b) => compareText(a.id, b.id));
  const apartments = new Set(
    written.map((m) => state.transactions.find((t) => t.id === m.transactionId)?.apartmentId),
  );
  const [apartmentId] = apartments;
  return {
    yielded: yielded.length,
    where: apartments.size === 1 && apartmentId !== undefined ? { apartmentId } : {},
    changes: [
      ...written.map((m) => ({
        path: recordPath('match', m.id),
        before: stored.get(m.id),
        after: m,
      })),
      ...yielded.map((c) => ({
        path: recordPath('movementClass', c.id),
        before: c,
        after: undefined,
      })),
    ],
  };
}

/**
 * Matches the live bills and instalments with the live movements that are not excluded, carry
 * no live payment and are no leg of a live transfer, over the periods of the statements (`statementPeriodsOf`) and the window of
 * R30, keeping the matches already saved. Writes the new confirmed automatic matches in one
 * `match.reconcile` operation; none when there are none or with `dryRun`. Running it again on
 * the same state writes nothing.
 */
export async function runMatch(
  store: Store,
  profileId: string,
  clock: () => string,
  newId: () => string,
  options: { dryRun?: boolean } = {},
): Promise<MatchRunResult> {
  if ((await checkConsistency(store)).length > 0) {
    return { status: 'refused', reason: 'inconsistent-store' };
  }
  const { run, written, changes, where } = await planMatch(store);
  if (options.dryRun === true || written.length === 0) return run;

  const operation = await commitChange(
    store,
    {
      profileId,
      kind: 'match.reconcile',
      ...where,
      summary: `Abbinate le voci: ${plural(written.length, 'automatica', 'automatiche')}, ${String(run.proposals.length)} da rivedere.`,
      changes,
    },
    clock,
    newId,
  );
  return { ...run, operationId: operation.id };
}

/**
 * What `runMatch` would write on the current state, without checking it or writing: its result,
 * the new confirmed matches and their changes. `runReconciliation` reads it for a dry run.
 */
export async function planMatch(store: Store) {
  const state = await loadMatchState(store);
  const result = matchToTransactions({
    bills: state.bills,
    instalments: state.instalments,
    transactions: state.transactions.filter((t) => !state.used.has(t.id)),
    window: MATCH_WINDOW,
    statementPeriods: statementPeriodsOf(state.accounts, state.statements),
    existing: state.matches,
  });
  const saved = new Set(live(state.matches).map((m) => m.id));
  const fresh = result.matches.filter((m) => !saved.has(m.id));
  const automatic = fresh.filter((m) => m.confirmed && m.by === 'auto');
  // An item with a part on a movement classified by hand is not written at all.
  const blocked = new Set(
    automatic.filter((m) => byHand(state.classOf.get(m.transactionId))).map(refKey),
  );
  const written = automatic.filter((m) => !blocked.has(refKey(m)));
  const billAmount = new Map(state.bills.map((b) => [b.id, expectedDebit(b)]));
  const proposal = (m: BillMatch, reason: MatchProposal['reason']): MatchProposal => ({
    id: `p-abb-${m.itemId}`,
    ...ref(m),
    transactionId: m.transactionId,
    reason,
  });
  const proposals = [
    ...fresh
      .filter((m) => !m.confirmed)
      .map((m) =>
        proposal(m, m.amount === billAmount.get(m.itemId) ? 'no-supplier' : 'amount-differs'),
      ),
    ...automatic
      .filter((m) => m.part === 'amount' && blocked.has(refKey(m)))
      .map((m) => proposal(m, 'classified')),
  ].sort((a, b) => compareText(a.id, b.id));
  const { yielded, changes, where } = changesOf(state, written);
  const run = {
    status: 'matched' as const,
    written: written.length,
    yielded,
    proposals,
    pending: result.pending,
    ambiguous: result.ambiguous,
    assumed: fresh.filter((m) => m.by === 'assumed').map(ref),
  };
  return { run, written, changes, where };
}

export interface ConfirmMatchInput {
  parts: {
    itemType: MatchItemType;
    itemId: string;
    transactionId: string;
    amount: Cents;
    part: 'amount' | 'commission';
  }[];
}

export type ConfirmMatchResult =
  | { status: 'confirmed'; operationId: string; matchIds: string[] }
  | {
      status: 'refused';
      reason:
        | 'inconsistent-store'
        | 'empty-parts'
        | 'unknown-item'
        | 'unknown-transaction'
        | 'transaction-used'
        | 'duplicate-part'
        | 'invalid-group';
    }
  | { status: 'refused'; reason: 'invalid-matches'; errors: MatchCheckError[] };

/** The expected amount of an item; for an instalment of a shared notice, its share of the total. */
function expectedOf(item: Bill | Instalment, instalments: Instalment[]): Cents | undefined {
  const shared = 'rata' in item ? item.shared : undefined;
  if (shared === undefined) return expectedDebit(item);
  const { groupId, groupTotal } = shared;
  const group = instalments
    .filter((i) => i.shared?.groupId === groupId)
    .sort((a, b) => compareText(a.id, b.id));
  // The same check as the automatic matching: an invalid notice has no share to confirm.
  if (sharedGroupProblem(group) !== undefined) return undefined;
  const shares = splitSharedDebit(
    cents(-groupTotal),
    group.map((i) => ({
      itemId: i.id,
      weight: (i.shared as NonNullable<Instalment['shared']>).weight,
    })),
  );
  return shares.find((s) => s.itemId === item.id)?.amount as Cents;
}

/**
 * Confirms by hand the matches of `parts` (several items, several movements), `by: 'manual'`, in
 * one `match.confirm` operation. The parts together with the confirmed matches already saved must
 * pass `validateMatches` on their items and movements (R2: the sums must add up). A movement that
 * is excluded, carries a live payment, is a leg of a live transfer or has a class confirmed by
 * hand is `transaction-used`; two
 * parts with the same match id are `duplicate-part`; an instalment of a shared notice that
 * `sharedGroupProblem` rejects is `invalid-group`; an automatic class yields as in `runMatch`.
 * Refusals write nothing.
 */
export async function confirmMatch(
  store: Store,
  input: ConfirmMatchInput,
  profileId: string,
  clock: () => string,
  newId: () => string,
): Promise<ConfirmMatchResult> {
  const refuse = (
    reason: Exclude<
      Extract<ConfirmMatchResult, { status: 'refused' }>['reason'],
      'invalid-matches'
    >,
  ) => ({ status: 'refused', reason }) as const;
  if ((await checkConsistency(store)).length > 0) return refuse('inconsistent-store');
  if (input.parts.length === 0) return refuse('empty-parts');
  const state = await loadMatchState(store);
  const bills = live(state.bills);
  const instalments = live(state.instalments);
  const transactions = live(state.transactions);
  const itemOf = (p: MatchItemRef) =>
    p.itemType === 'bill'
      ? bills.find((b) => b.id === p.itemId)
      : instalments.find((i) => i.id === p.itemId);
  if (input.parts.some((p) => itemOf(p) === undefined)) return refuse('unknown-item');
  const txOf = (id: string) => transactions.find((t) => t.id === id);
  if (input.parts.some((p) => txOf(p.transactionId) === undefined)) {
    return refuse('unknown-transaction');
  }
  const used = (id: string) => state.used.has(id) || byHand(state.classOf.get(id));
  if (input.parts.some((p) => used(p.transactionId))) return refuse('transaction-used');
  const ids = input.parts.map((p) => matchId(p, p.part, p.transactionId));
  if (new Set(ids).size !== ids.length) return refuse('duplicate-part');
  const expected = new Map(
    input.parts.map((p) => [refKey(p), expectedOf(itemOf(p) as Bill | Instalment, instalments)]),
  );
  if ([...expected.values()].includes(undefined)) return refuse('invalid-group');

  const matches = input.parts.map((p, i) =>
    parseOrThrow(
      BillMatchSchema,
      {
        id: ids[i],
        v: 1,
        rev: 1,
        ...ref(p),
        transactionId: p.transactionId,
        transactionDate: txOf(p.transactionId)?.date,
        amount: p.amount,
        part: p.part,
        confirmed: true,
        by: 'manual',
      },
      'match',
    ),
  );
  const items = new Map(
    input.parts.map((p) => [refKey(p), { ...ref(p), expected: expected.get(refKey(p)) as Cents }]),
  );
  const { errors } = validateMatches({
    items: [...items.values()],
    transactions: input.parts.map((p) => txOf(p.transactionId) as BankTransaction),
    matches: [...live(state.matches), ...matches],
  });
  if (errors.length > 0) return { status: 'refused', reason: 'invalid-matches', errors };

  const { changes, where } = changesOf(state, matches);
  const operation = await commitChange(
    store,
    {
      profileId,
      kind: 'match.confirm',
      ...where,
      summary: `Confermato un abbinamento: ${plural(items.size, 'voce', 'voci')}.`,
      changes,
    },
    clock,
    newId,
  );
  return { status: 'confirmed', operationId: operation.id, matchIds: matches.map((m) => m.id) };
}
