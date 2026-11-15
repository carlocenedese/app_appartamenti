/**
 * Writing transfers (plan 3c, task 5): the automatic run, the confirmation of a proposal and a
 * repayment recorded by hand, each one operation of the journal. Proposals are computed again at
 * every run. Nothing is written while `checkConsistency` reports a problem (R113).
 */
import { checkConsistency, commitChange } from './journal';
import {
  AccountSchema,
  BankTransactionSchema,
  BillMatchSchema,
  MovementClassSchema,
  PaymentSchema,
  TransferSchema,
} from './model';
import type { BankTransaction, TransferPurpose } from './model';
import type { Cents } from './money';
import { movementUses } from './movements';
import { parseOrThrow } from './parse';
import type { ISODate } from './period';
import { loadAll } from './store/load';
import { recordPath } from './store/records';
import type { Store } from './store/store';
import { compareText } from './text';
import { draftOf, reconcileTransfers } from './transfers';
import type { TransferDraft, TransferProposal } from './transfers';

const plural = (n: number, one: string, many: string): string =>
  `${String(n)} ${n === 1 ? one : many}`;

/**
 * Every record the transfers read, deleted ones included; `used` are the movements with a use
 * (`movementUses`), plus `alsoUsed` (what a phase before would take in a dry run).
 */
async function loadTransferState(store: Store, alsoUsed: ReadonlySet<string> = new Set()) {
  const all = { includeDeleted: true };
  const transfers = (await loadAll(store, 'transfer', TransferSchema, all)).records;
  const uses = movementUses({
    classes: (await loadAll(store, 'movementClass', MovementClassSchema, all)).records,
    payments: (await loadAll(store, 'payment', PaymentSchema, all)).records,
    matches: (await loadAll(store, 'match', BillMatchSchema, all)).records,
    transfers,
  });
  const state = {
    accounts: (await loadAll(store, 'account', AccountSchema, all)).records,
    transactions: (await loadAll(store, 'transaction', BankTransactionSchema, all)).records,
    transfers,
    used: new Set([...alsoUsed, ...uses.keys()]),
  };
  return { ...state, result: reconcileTransfers(state) };
}

const changeOf = (stored: { id: string }[], draft: TransferDraft) => {
  const after = parseOrThrow(TransferSchema, { ...draft, v: 1, rev: 1 }, 'transfer');
  return {
    path: recordPath('transfer', after.id),
    before: stored.find((t) => t.id === after.id),
    after,
  };
};

export type TransferRunResult =
  | {
      status: 'reconciled';
      /** The automatic transfers written; with `dryRun`, the ones that would be written. */
      written: number;
      /** The transfers with one leg that got their other leg (a new `rev`, never a new record). */
      completed: number;
      proposals: TransferProposal[];
      operationId?: string;
    }
  | { status: 'refused'; reason: 'inconsistent-store' };

/**
 * Writes the automatic transfers of `reconcileTransfers`, and the other leg of the transfers it
 * completes, in one `transfer.reconcile` operation (both count as automatic in the summary); none
 * when there is nothing to write or with `dryRun`. Running it again on the same state writes
 * nothing.
 */
export async function runTransfers(
  store: Store,
  profileId: string,
  clock: () => string,
  newId: () => string,
  options: { dryRun?: boolean; alsoUsed?: ReadonlySet<string> } = {},
): Promise<TransferRunResult> {
  if ((await checkConsistency(store)).length > 0) {
    return { status: 'refused', reason: 'inconsistent-store' };
  }
  const state = await loadTransferState(store, options.alsoUsed);
  const { transfers, completed, proposals } = state.result;
  const writes = [...transfers, ...completed];
  const result = {
    status: 'reconciled' as const,
    written: transfers.length,
    completed: completed.length,
    proposals,
  };
  if (options.dryRun === true || writes.length === 0) return result;
  const operation = await commitChange(
    store,
    {
      profileId,
      kind: 'transfer.reconcile',
      summary: `Riconciliati i giroconti: ${plural(writes.length, 'automatico', 'automatici')}, ${String(proposals.length)} da rivedere.`,
      changes: writes.map((t) => changeOf(state.transfers, t)),
    },
    clock,
    newId,
  );
  return { ...result, operationId: operation.id };
}

export interface ConfirmTransferInput {
  proposalId: string;
  purpose: TransferPurpose;
  /** One of the `legIds` of the proposal; absent with one leg, that one. */
  otherLegId?: string;
  /** False for «solo questa volta» («Mie scelte» 8): the transfer is `oneOff`. */
  rememberPair: boolean;
  /** The legs of the proposal as shown: when they differ now, `unknown-proposal`. */
  legIds?: string[];
}

export type ConfirmTransferResult =
  | { status: 'confirmed'; operationId: string; transferId: string }
  | { status: 'refused'; reason: 'inconsistent-store' | 'unknown-proposal' | 'leg-not-allowed' };

/**
 * Confirms the proposal `proposalId` as recomputed on the current state with its purpose, in one
 * `transfer.confirm` operation. The state changed is `unknown-proposal`: the proposal is gone, its
 * legs differ from `legIds` (when given), or `otherLegId` is a movement that is no leg any more
 * (used since, or deleted). `otherLegId` must be one of its legs (`leg-not-allowed` for any other
 * id); absent, the only leg, or no other leg when there are none or several.
 */
export async function confirmTransfer(
  store: Store,
  input: ConfirmTransferInput,
  profileId: string,
  clock: () => string,
  newId: () => string,
): Promise<ConfirmTransferResult> {
  const refuse = (reason: Extract<ConfirmTransferResult, { status: 'refused' }>['reason']) =>
    ({ status: 'refused', reason }) as const;
  if ((await checkConsistency(store)).length > 0) return refuse('inconsistent-store');
  const state = await loadTransferState(store);
  const proposal = state.result.proposals.find((p) => p.id === input.proposalId);
  if (proposal === undefined) return refuse('unknown-proposal');
  const shown = input.legIds === undefined ? undefined : [...input.legIds].sort(compareText);
  if (shown !== undefined && shown.join('\u0000') !== proposal.legIds.join('\u0000')) {
    return refuse('unknown-proposal');
  }
  const { otherLegId } = input;
  if (otherLegId !== undefined && !proposal.legIds.includes(otherLegId)) {
    const known = state.transactions.find((t) => t.id === otherLegId);
    const gone = known !== undefined && (known.deleted === true || state.used.has(otherLegId));
    return refuse(gone ? 'unknown-proposal' : 'leg-not-allowed');
  }
  const legId = input.otherLegId ?? (proposal.legIds.length === 1 ? proposal.legIds[0] : undefined);
  const tx = state.transactions.find((t) => t.id === proposal.transactionId) as BankTransaction;
  const { fromAccountId, toAccountId } = proposal;
  const draft = draftOf(
    tx,
    legId,
    state.transactions,
    { fromAccountId, toAccountId },
    {
      purpose: input.purpose,
      source: 'confirmed',
      ...(input.rememberPair ? {} : { oneOff: true as const }),
    },
  );
  const operation = await commitChange(
    store,
    {
      profileId,
      kind: 'transfer.confirm',
      summary: 'Confermato un giroconto.',
      changes: [changeOf(state.transfers, draft)],
    },
    clock,
    newId,
  );
  return { status: 'confirmed', operationId: operation.id, transferId: draft.id };
}

export type ManualTransferResult =
  | { status: 'recorded'; operationId: string; transferId: string }
  | {
      status: 'refused';
      reason: 'inconsistent-store' | 'unknown-account' | 'same-account' | 'invalid-amount';
    };

/**
 * Records by hand a repayment between two live accounts without movements (section 24):
 * `tr-<newId()>`, `source: 'manual'`, in one `transfer.manual` operation.
 */
export async function recordManualTransfer(
  store: Store,
  input: {
    fromAccountId: string;
    toAccountId: string;
    amount: Cents;
    date: ISODate;
    purpose: TransferPurpose;
  },
  profileId: string,
  clock: () => string,
  newId: () => string,
): Promise<ManualTransferResult> {
  const refuse = (reason: Extract<ManualTransferResult, { status: 'refused' }>['reason']) =>
    ({ status: 'refused', reason }) as const;
  if ((await checkConsistency(store)).length > 0) return refuse('inconsistent-store');
  const accounts = new Set(
    (await loadAll(store, 'account', AccountSchema)).records.map((a) => a.id),
  );
  if (!accounts.has(input.fromAccountId) || !accounts.has(input.toAccountId)) {
    return refuse('unknown-account');
  }
  if (input.fromAccountId === input.toAccountId) return refuse('same-account');
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) return refuse('invalid-amount');
  const change = changeOf([], {
    id: `tr-${newId()}`,
    ...input,
    source: 'manual',
  });
  const operation = await commitChange(
    store,
    {
      profileId,
      kind: 'transfer.manual',
      summary: 'Registrata una restituzione a mano.',
      changes: [change],
    },
    clock,
    newId,
  );
  return { status: 'recorded', operationId: operation.id, transferId: change.after.id };
}
