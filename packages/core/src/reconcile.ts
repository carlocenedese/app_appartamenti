/**
 * The reconciliation in phases (plan 3c, task 4; order D2 of plan 3): exclusions (proposals only,
 * never written), matching of bills and instalments, income. Each phase writes its own operation,
 * undone by itself, and skips the movements the phases before used (`movementUses`): a movement
 * has one use at most, across runs too. Then the transfers (task 5) and the outgoings (task 6).
 */
import type { ReconcileRunResult } from './income-store';
import { planIncome, runReconcile } from './income-store';
import { checkConsistency } from './journal';
import type { MatchRunResult } from './match-store';
import { planMatch, runMatch } from './match-store';
import type { ExclusionProposal } from './movements';
import { legsOf, listExclusionProposals } from './movements';
import type { OutgoingRunResult } from './outgoing-store';
import { planOutgoing, runOutgoing } from './outgoing-store';
import type { Store } from './store/store';
import type { TransferRunResult } from './transfer-store';
import { planTransfers, runTransfers } from './transfer-store';

type Matched = Extract<MatchRunResult, { status: 'matched' }>;

export type ReconciliationResult =
  | {
      status: 'reconciled';
      exclusions: ExclusionProposal[];
      match: Matched;
      income: Extract<ReconcileRunResult, { status: 'reconciled' }>;
      transfers: Extract<TransferRunResult, { status: 'reconciled' }>;
      outgoing: Extract<OutgoingRunResult, { status: 'reconciled' }>;
    }
  | { status: 'refused'; reason: 'inconsistent-store' };

/**
 * Runs the phases in order on the store; a refusal stops the phases after it. With `dryRun`
 * nothing is written and each phase skips the movements the phases before would take.
 */
export async function runReconciliation(
  store: Store,
  profileId: string,
  clock: () => string,
  newId: () => string,
  options: { dryRun?: boolean } = {},
): Promise<ReconciliationResult> {
  const refused = { status: 'refused', reason: 'inconsistent-store' } as const;
  if ((await checkConsistency(store)).length > 0) return refused;
  const exclusions = await listExclusionProposals(store);
  const dryRun = options.dryRun === true;
  let match: Matched;
  let alsoUsed = new Set<string>();
  if (dryRun) {
    const plan = await planMatch(store);
    match = plan.run;
    alsoUsed = new Set(plan.written.map((m) => m.transactionId));
  } else {
    const written = await runMatch(store, profileId, clock, newId);
    if (written.status === 'refused') return refused;
    match = written;
  }
  let income: Extract<ReconcileRunResult, { status: 'reconciled' }>;
  // An incoming movement an «in» rule will classify is no «chi» of the income: it would block the
  // later rents of the apartment (earlier-open) until the next run. Only the income skips it.
  const beforeIncome = new Set([...alsoUsed, ...(await planOutgoing(store, alsoUsed)).incoming]);
  // Nor is a movement of a transfer (automatic, completed or proposed, I3 of the final review);
  // the transfers skip the payments the income would write, so this goes on until it settles.
  const paidBy = async (skip: ReadonlySet<string>) =>
    (await planIncome(store, skip)).payments.flatMap((p) => p.transactionId ?? []);
  let transferIds = new Set<string>();
  // shortcut: at most 5 rounds (one or two in practice); upgrade if a case ever needs more.
  for (let round = 0; round < 5; round++) {
    const skip = new Set([...beforeIncome, ...transferIds]);
    const plan = await planTransfers(store, new Set([...alsoUsed, ...(await paidBy(skip))]));
    const next = new Set([
      ...[...plan.transfers, ...plan.completed].flatMap(legsOf),
      ...plan.proposals.flatMap((p) => [p.transactionId, ...p.legIds]),
    ]);
    const same = next.size === transferIds.size && [...next].every((id) => transferIds.has(id));
    transferIds = next;
    if (same) break;
  }
  const incomeUsed = new Set([...beforeIncome, ...transferIds]);
  if (dryRun) {
    // The transfers then skip the movements of the payments the income would write as well.
    const plan = await planIncome(store, incomeUsed);
    income = plan.result;
    alsoUsed = new Set([...alsoUsed, ...plan.payments.flatMap((p) => p.transactionId ?? [])]);
  } else {
    const written = await runReconcile(store, profileId, clock, newId, { alsoUsed: incomeUsed });
    if (written.status === 'refused') return refused;
    income = written;
  }
  // In a dry run the transfers count their own candidates first (I1 of the final review), then
  // the outgoings skip their legs as well.
  const transfers = await runTransfers(store, profileId, clock, newId, { dryRun, alsoUsed });
  if (transfers.status === 'refused') return refused;
  if (dryRun) {
    const plan = await planTransfers(store, alsoUsed);
    alsoUsed = new Set([...alsoUsed, ...[...plan.transfers, ...plan.completed].flatMap(legsOf)]);
  }
  // A movement of a transfer proposal (or one of its legs) is no outgoing proposal as well.
  const outgoingUsed = new Set([
    ...alsoUsed,
    ...transfers.proposals.flatMap((p) => [p.transactionId, ...p.legIds]),
  ]);
  const outgoing = await runOutgoing(store, profileId, clock, newId, {
    dryRun,
    alsoUsed: outgoingUsed,
  });
  if (outgoing.status === 'refused') return refused;
  // An incoming movement the outgoings classified is no «chi» of the income any more.
  const classified = new Set(outgoing.classified);
  income = {
    ...income,
    proposals: income.proposals.filter((p) => !classified.has(p.transactionId)),
  };
  return { status: 'reconciled', exclusions, match, income, transfers, outgoing };
}
