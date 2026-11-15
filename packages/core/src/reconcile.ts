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
  const incomeUsed = new Set([...alsoUsed, ...(await planOutgoing(store, alsoUsed)).incoming]);
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
  if (dryRun) {
    const plan = await planTransfers(store, alsoUsed);
    alsoUsed = new Set([...alsoUsed, ...[...plan.transfers, ...plan.completed].flatMap(legsOf)]);
  }
  const transfers = await runTransfers(store, profileId, clock, newId, { dryRun, alsoUsed });
  if (transfers.status === 'refused') return refused;
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
