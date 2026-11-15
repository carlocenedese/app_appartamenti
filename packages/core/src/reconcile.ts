/**
 * The reconciliation in phases (plan 3c, task 4; order D2 of plan 3): exclusions (proposals only,
 * never written), matching of bills and instalments, income. Each phase writes its own operation,
 * undone by itself, and skips the movements the phases before used (`movementUses`): a movement
 * has one use at most, across runs too. Then the transfers (task 5); task 6 adds the outgoings.
 */
import type { ReconcileRunResult } from './income-store';
import { planIncome, runReconcile } from './income-store';
import { checkConsistency } from './journal';
import type { MatchRunResult } from './match-store';
import { planMatch, runMatch } from './match-store';
import type { ExclusionProposal } from './movements';
import { listExclusionProposals } from './movements';
import type { Store } from './store/store';
import type { TransferRunResult } from './transfer-store';
import { runTransfers } from './transfer-store';

type Matched = Extract<MatchRunResult, { status: 'matched' }>;

export type ReconciliationResult =
  | {
      status: 'reconciled';
      exclusions: ExclusionProposal[];
      match: Matched;
      income: Extract<ReconcileRunResult, { status: 'reconciled' }>;
      transfers: Extract<TransferRunResult, { status: 'reconciled' }>;
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
  if (dryRun) {
    // The transfers then skip the movements of the payments the income would write as well.
    const plan = await planIncome(store, alsoUsed);
    income = plan.result;
    alsoUsed = new Set([...alsoUsed, ...plan.payments.flatMap((p) => p.transactionId ?? [])]);
  } else {
    const written = await runReconcile(store, profileId, clock, newId, { alsoUsed });
    if (written.status === 'refused') return refused;
    income = written;
  }
  const transfers = await runTransfers(store, profileId, clock, newId, { dryRun, alsoUsed });
  if (transfers.status === 'refused') return refused;
  return { status: 'reconciled', exclusions, match, income, transfers };
}
