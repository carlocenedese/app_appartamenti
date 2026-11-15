/**
 * The reconciliation in phases (plan 3c, task 4; order D2 of plan 3): exclusions (proposals only,
 * never written), matching of bills and instalments, income. Each phase writes its own operation,
 * undone by itself, and skips the movements the phases before used (`movementUses`): a movement
 * has one use at most, across runs too. Tasks 5 and 6 add the transfers and the outgoings.
 */
import type { ReconcileRunResult } from './income-store';
import { runReconcile } from './income-store';
import { checkConsistency } from './journal';
import type { MatchRunResult } from './match-store';
import { planMatch, runMatch } from './match-store';
import type { ExclusionProposal } from './movements';
import { listExclusionProposals } from './movements';
import type { Store } from './store/store';

type Matched = Extract<MatchRunResult, { status: 'matched' }>;

export type ReconciliationResult =
  | {
      status: 'reconciled';
      exclusions: ExclusionProposal[];
      match: Matched;
      income: Extract<ReconcileRunResult, { status: 'reconciled' }>;
    }
  | { status: 'refused'; reason: 'inconsistent-store' };

/**
 * Runs the phases in order on the store; a refusal stops the phases after it. With `dryRun`
 * nothing is written and the income phase skips the movements the matching would take.
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
  const income = await runReconcile(store, profileId, clock, newId, { dryRun, alsoUsed });
  if (income.status === 'refused') return refused;
  return { status: 'reconciled', exclusions, match, income };
}
