/**
 * Writing income (plan 3b, task 6): tenants, the automatic payments of a reconciliation and the
 * confirmation of a proposal, each one operation of the journal. Nothing is written while
 * `checkConsistency` reports a problem (R106, R107). Summaries carry counts only.
 */
import { reconcileIncome, rentArrears } from './income';
import type { IncomeProposal, RentArrear } from './income';
import { checkConsistency, commitChange, latestOperationByPath, readJournal } from './journal';
import type { Operation } from './journal';
import {
  AccountSchema,
  ApartmentSchema,
  BankTransactionSchema,
  MovementClassSchema,
  PayerSchema,
  PaymentSchema,
  StatementSchema,
  TenancySchema,
  TenantSchema,
} from './model';
import type { Payment } from './model';
import type { Cents } from './money';
import { excludedIds } from './movements';
import { parseOrThrow } from './parse';
import { firstPresenceDay } from './payers';
import type { YearMonth } from './period';
import { loadAll } from './store/load';
import { recordPath } from './store/records';
import type { Store } from './store/store';

/** Creates the tenant `draft.id`, or writes a new `rev` of it (a deleted one comes back). */
export async function saveTenant(
  store: Store,
  draft: { id: string; name: string; language?: 'it' | 'en' },
  profileId: string,
  clock: () => string,
  newId: () => string,
): Promise<Operation> {
  const before = (
    await loadAll(store, 'tenant', TenantSchema, { includeDeleted: true })
  ).records.find((t) => t.id === draft.id);
  const after = parseOrThrow(TenantSchema, { ...draft, v: 1, rev: 1 }, 'tenant');
  return commitChange(
    store,
    {
      profileId,
      kind: 'tenant.save',
      summary: 'Inquilino salvato',
      changes: [{ path: recordPath('tenant', after.id), before, after }],
    },
    clock,
    newId,
  );
}

/** Every record the reconciliation reads, deleted ones included (it filters them itself), and the journal. */
async function loadIncomeState(store: Store) {
  const all = { includeDeleted: true };
  return {
    accounts: (await loadAll(store, 'account', AccountSchema, all)).records,
    apartments: (await loadAll(store, 'apartment', ApartmentSchema, all)).records,
    tenancies: (await loadAll(store, 'tenancy', TenancySchema, all)).records,
    tenants: (await loadAll(store, 'tenant', TenantSchema, all)).records,
    payers: (await loadAll(store, 'payer', PayerSchema, all)).records,
    payments: (await loadAll(store, 'payment', PaymentSchema, all)).records,
    transactions: (await loadAll(store, 'transaction', BankTransactionSchema, all)).records,
    statements: (await loadAll(store, 'statement', StatementSchema, all)).records,
    operations: (await readJournal(store)).operations,
    // The excluded movements are left out of the income (plan 3c).
    usedTransactionIds: excludedIds(
      (await loadAll(store, 'movementClass', MovementClassSchema, all)).records,
    ),
  };
}

const plural = (n: number, one: string, many: string): string =>
  `${String(n)} ${n === 1 ? one : many}`;

export type ReconcileRunResult =
  | {
      status: 'reconciled';
      /** The automatic payments written; with `dryRun`, the ones that would be written. */
      written: number;
      proposals: IncomeProposal[];
      skipped: number;
      /** The arrears (`rentArrears`) with the automatic payments of the run counted as paid. */
      arrears: RentArrear[];
      operationId?: string;
    }
  | { status: 'refused'; reason: 'inconsistent-store' };

/**
 * Writes the automatic payments of `reconcileIncome` in one `income.reconcile` operation; none
 * when there are none or with `dryRun`. Running it again on the same state writes nothing.
 */
export async function runReconcile(
  store: Store,
  profileId: string,
  clock: () => string,
  newId: () => string,
  options: { dryRun?: boolean } = {},
): Promise<ReconcileRunResult> {
  if ((await checkConsistency(store)).length > 0) {
    return { status: 'refused', reason: 'inconsistent-store' };
  }
  const state = await loadIncomeState(store);
  const { payments, proposals, skipped } = reconcileIncome(state);
  const result = {
    status: 'reconciled' as const,
    written: payments.length,
    proposals,
    skipped: skipped.length,
    arrears: rentArrears({
      ...state,
      payments: [...state.payments, ...payments.map((p) => ({ ...p, v: 1 as const, rev: 1 }))],
    }),
  };
  if (options.dryRun === true || payments.length === 0) return result;

  const stored = new Map(state.payments.map((p) => [p.id, p]));
  const apartments = new Set(payments.map((p) => p.apartmentId));
  const [apartmentId] = apartments;
  const operation = await commitChange(
    store,
    {
      profileId,
      kind: 'income.reconcile',
      ...(apartments.size === 1 && apartmentId !== undefined ? { apartmentId } : {}),
      summary: `Riconciliati gli incassi: ${plural(payments.length, 'automatico', 'automatici')}, ${String(proposals.length)} da rivedere.`,
      changes: payments.map((p) => ({
        path: recordPath('payment', p.id),
        before: stored.get(p.id),
        after: parseOrThrow(PaymentSchema, { ...p, v: 1, rev: 1 }, 'payment'),
      })),
    },
    clock,
    newId,
  );
  return { ...result, operationId: operation.id };
}

export interface ConfirmIncomeInput {
  proposalId: string;
  tenantId: string;
  parts: { kind: Payment['kind']; forMonth: YearMonth; amount: Cents }[];
  /** False for «solo questa volta» (decision D): the payer is not saved. */
  rememberPayer: boolean;
}

export type ConfirmIncomeResult =
  | { status: 'confirmed'; operationId: string; paymentIds: string[]; payerId?: string }
  | {
      status: 'refused';
      reason:
        | 'inconsistent-store'
        | 'unknown-proposal'
        | 'tenant-not-allowed'
        | 'empty-parts'
        | 'sum-mismatch'
        | 'no-presence';
    };

/**
 * Confirms the proposal `proposalId` as recomputed on the current state (a proposal that no longer
 * exists is `unknown-proposal`): the payments `pay-<transactionId>-<n>` of the parts and, for a
 * «chi» proposal with a key and `rememberPayer`, the payer of the tenant from the first day of its
 * first presence in the apartment (decision A), in one `income.confirm` operation. The tenant
 * must have a presence in the apartment of the account. For a «cosa» or a payer of several
 * tenants it is one of the candidates, which already have a payer with that key; or, with a key,
 * another tenant, who then gets the payer too (`rememberPayer`).
 */
export async function confirmIncome(
  store: Store,
  input: ConfirmIncomeInput,
  profileId: string,
  clock: () => string,
  newId: () => string,
): Promise<ConfirmIncomeResult> {
  const refuse = (reason: Extract<ConfirmIncomeResult, { status: 'refused' }>['reason']) =>
    ({ status: 'refused', reason }) as const;
  if ((await checkConsistency(store)).length > 0) return refuse('inconsistent-store');
  const state = await loadIncomeState(store);
  const proposal = reconcileIncome(state).proposals.find((p) => p.id === input.proposalId);
  const tx = state.transactions.find((t) => t.id === proposal?.transactionId);
  const account = state.accounts.find((a) => a.id === tx?.accountId);
  if (proposal === undefined || tx === undefined || account === undefined) {
    return refuse('unknown-proposal');
  }
  const { apartmentId } = account;
  const open = proposal.step === 'cosa' || proposal.reason === 'multi-tenant';
  const validFrom = firstPresenceDay(state.tenancies, input.tenantId, apartmentId);
  // Outside the candidates only with a presence in the apartment (user1, 14 Nov 2026): the key
  // (a «cosa» or a payer of several tenants always has one) then gets a payer for this tenant
  // too, and is never automatic (decision 5). A deleted tenant is never allowed.
  const outside = open && !proposal.tenantIds.includes(input.tenantId);
  const deleted = state.tenants.some((t) => t.id === input.tenantId && t.deleted === true);
  if (deleted || (outside && validFrom === undefined)) return refuse('tenant-not-allowed');
  if (validFrom === undefined) return refuse('no-presence');
  // A part of zero or less is no part at all.
  if (input.parts.length === 0 || input.parts.some((p) => p.amount <= 0)) {
    return refuse('empty-parts');
  }
  if (input.parts.reduce((sum, p) => sum + p.amount, 0) !== tx.amount) {
    return refuse('sum-mismatch');
  }

  const stored = new Map(state.payments.map((p) => [p.id, p]));
  const payments = input.parts.map((part, i) =>
    parseOrThrow(
      PaymentSchema,
      {
        id: `pay-${tx.id}-${String(i + 1)}`,
        v: 1,
        rev: 1,
        apartmentId,
        tenantId: input.tenantId,
        date: tx.date,
        amount: part.amount,
        confirmed: true,
        kind: part.kind,
        forMonth: part.forMonth,
        source: 'csv',
        transactionId: tx.id,
      },
      'payment',
    ),
  );
  const payer =
    (outside || !open) && proposal.key !== undefined && input.rememberPayer
      ? parseOrThrow(
          PayerSchema,
          {
            id: `payer-${tx.id}`,
            v: 1,
            rev: 1,
            key: proposal.key,
            tenantId: input.tenantId,
            validFrom,
            source: 'confirmed',
          },
          'payer',
        )
      : undefined;
  const oldPayer = state.payers.find((p) => p.id === payer?.id);

  const operation = await commitChange(
    store,
    {
      profileId,
      kind: 'income.confirm',
      apartmentId,
      summary: `Confermato un incasso: ${plural(payments.length, 'pagamento', 'pagamenti')}.`,
      changes: [
        ...payments.map((p) => ({
          path: recordPath('payment', p.id),
          before: stored.get(p.id),
          after: p,
        })),
        // The payer last: an interrupted confirmation never leaves a payer without its payments.
        ...(payer === undefined
          ? []
          : [{ path: recordPath('payer', payer.id), before: oldPayer, after: payer }]),
      ],
    },
    clock,
    newId,
  );
  return {
    status: 'confirmed',
    operationId: operation.id,
    paymentIds: payments.map((p) => p.id),
    ...(payer === undefined ? {} : { payerId: payer.id }),
  };
}

export type CancelPaymentResult =
  | { status: 'cancelled'; operationId: string }
  | { status: 'refused'; reason: 'inconsistent-store' | 'unknown-payment' | 'not-automatic' };

/**
 * Cancels one automatic payment by itself (user1, 15 Nov 2026, R121): an `income.cancel-payment`
 * operation that deletes it, which `undoOperation` takes back. Its movement is then `undone` and
 * never automatic again (R118). Only a live `csv` payment whose latest change is an
 * `income.reconcile` is automatic (`not-automatic` otherwise); an unknown or deleted one is
 * `unknown-payment`.
 */
export async function cancelAutomaticPayment(
  store: Store,
  paymentId: string,
  profileId: string,
  clock: () => string,
  newId: () => string,
): Promise<CancelPaymentResult> {
  const refuse = (reason: Extract<CancelPaymentResult, { status: 'refused' }>['reason']) =>
    ({ status: 'refused', reason }) as const;
  if ((await checkConsistency(store)).length > 0) return refuse('inconsistent-store');
  const payment = (await loadAll(store, 'payment', PaymentSchema)).records.find(
    (p) => p.id === paymentId,
  );
  if (payment === undefined) return refuse('unknown-payment');
  const path = recordPath('payment', payment.id);
  const by = latestOperationByPath((await readJournal(store)).operations).get(path);
  if (payment.source !== 'csv' || by?.kind !== 'income.reconcile') return refuse('not-automatic');
  const operation = await commitChange(
    store,
    {
      profileId,
      kind: 'income.cancel-payment',
      apartmentId: payment.apartmentId,
      summary: 'Annullato un pagamento automatico.',
      changes: [{ path, before: payment, after: undefined }],
    },
    clock,
    newId,
  );
  return { status: 'cancelled', operationId: operation.id };
}
