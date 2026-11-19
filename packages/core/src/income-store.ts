/**
 * Writing income (plan 3b, task 6): tenants, the automatic payments of a reconciliation and the
 * confirmation of a proposal, each one operation of the journal. Nothing is written while
 * `checkConsistency` reports a problem (R106, R107). Summaries carry counts only.
 */
import { isPresent } from './conguaglio';
import { withContractEnds } from './contract';
import { coveredMonths, reconcileIncome, rentArrears, rentExcesses } from './income';
import type { IncomeProposal, RentArrear, RentExcess } from './income';
import { commitChange, latestOperationByPath, readJournal, writesBlocked } from './journal';
import type { Operation } from './journal';
import {
  AccountSchema,
  ApartmentSchema,
  BankTransactionSchema,
  BillMatchSchema,
  ContractSchema,
  MovementClassSchema,
  PayerSchema,
  PaymentSchema,
  StatementSchema,
  TenancySchema,
  TenantCardSchema,
  TenantSchema,
  TransferSchema,
} from './model';
import type { Payment, TenantCard } from './model';
import { cents } from './money';
import type { Cents } from './money';
import { movementUses } from './movements';
import { parseOrThrow } from './parse';
import { firstPresenceDay } from './payers';
import type { YearMonth } from './period';
import { loadAll } from './store/load';
import { recordPath } from './store/records';
import type { Store } from './store/store';
import { compareText } from './text';

/**
 * Creates the tenant `draft.id`, or writes a new `rev` of it (a deleted one comes back). The same
 * name and language on a live tenant write nothing: `undefined` (E8, a rerun is unchanged).
 */
export async function saveTenant(
  store: Store,
  draft: { id: string; name: string; language?: 'it' | 'en' },
  profileId: string,
  clock: () => string,
  newId: () => string,
): Promise<Operation | undefined> {
  const before = (
    await loadAll(store, 'tenant', TenantSchema, { includeDeleted: true })
  ).records.find((t) => t.id === draft.id);
  const after = parseOrThrow(TenantSchema, { ...draft, v: 1, rev: 1 }, 'tenant');
  if (
    before !== undefined &&
    before.deleted !== true &&
    before.name === after.name &&
    before.language === after.language
  ) {
    return undefined;
  }
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

export type SaveTenantCardResult =
  | { status: 'saved'; operationId: string }
  | { status: 'unchanged' }
  | { status: 'refused'; reason: 'inconsistent-store' | 'unknown-tenant' | 'invalid-card' };

/**
 * Replaces the whole reserved card of the live tenant `tenantId` (plan 17, R311): a field left out
 * is removed. One `tenant.card` operation, no value in the summary. Refused without writing:
 * `inconsistent-store`, `unknown-tenant`, `invalid-card` (empty, or fields the schema refuses).
 */
export async function saveTenantCard(
  store: Store,
  input: { tenantId: string; card: Omit<TenantCard, 'id' | 'v' | 'rev' | 'deleted'> },
  profileId: string,
  clock: () => string,
  newId: () => string,
): Promise<SaveTenantCardResult> {
  if (await writesBlocked(store)) {
    return { status: 'refused', reason: 'inconsistent-store' };
  }
  if (
    !(await loadAll(store, 'tenant', TenantSchema)).records.some((t) => t.id === input.tenantId)
  ) {
    return { status: 'refused', reason: 'unknown-tenant' };
  }
  if (Object.values(input.card).every((v) => v === undefined)) {
    return { status: 'refused', reason: 'invalid-card' };
  }
  const before = (
    await loadAll(store, 'tenantCard', TenantCardSchema, { includeDeleted: true })
  ).records.find((c) => c.id === input.tenantId);
  const record = (rev: number) =>
    TenantCardSchema.safeParse({ ...input.card, id: input.tenantId, v: 1, rev });
  const parsed = record((before?.rev ?? 0) + 1);
  if (!parsed.success) return { status: 'refused', reason: 'invalid-card' };
  if (
    before !== undefined &&
    before.deleted !== true &&
    JSON.stringify(record(before.rev).data) === JSON.stringify(before)
  ) {
    return { status: 'unchanged' };
  }
  const operation = await commitChange(
    store,
    {
      profileId,
      kind: 'tenant.card',
      summary: 'Scheda riservata dell’inquilino salvata.',
      changes: [{ path: recordPath('tenantCard', input.tenantId), before, after: parsed.data }],
    },
    clock,
    newId,
  );
  return { status: 'saved', operationId: operation.id };
}

/**
 * Every record the reconciliation reads, deleted ones included (it filters them itself), and the
 * journal; `alsoUsed` are movements a phase before would use (a dry run writes nothing).
 */
async function loadIncomeState(store: Store, alsoUsed: ReadonlySet<string> = new Set()) {
  const all = { includeDeleted: true };
  const payments = (await loadAll(store, 'payment', PaymentSchema, all)).records;
  const uses = movementUses({
    classes: (await loadAll(store, 'movementClass', MovementClassSchema, all)).records,
    payments,
    matches: (await loadAll(store, 'match', BillMatchSchema, all)).records,
    transfers: (await loadAll(store, 'transfer', TransferSchema, all)).records,
  });
  return {
    accounts: (await loadAll(store, 'account', AccountSchema, all)).records,
    apartments: (await loadAll(store, 'apartment', ApartmentSchema, all)).records,
    // F9 a: a stay without end lasts until the end of its contract (arrears, months to pay).
    tenancies: withContractEnds(
      (await loadAll(store, 'tenancy', TenancySchema, all)).records,
      (await loadAll(store, 'contract', ContractSchema)).records,
    ),
    tenants: (await loadAll(store, 'tenant', TenantSchema, all)).records,
    payers: (await loadAll(store, 'payer', PayerSchema, all)).records,
    payments,
    transactions: (await loadAll(store, 'transaction', BankTransactionSchema, all)).records,
    statements: (await loadAll(store, 'statement', StatementSchema, all)).records,
    operations: (await readJournal(store)).operations,
    // Excluded, matched, classified movements and transfer legs are left out of the income (plan 3c, D2); a
    // payment is reconcileIncome's own business.
    usedTransactionIds: new Set([
      ...alsoUsed,
      ...[...uses].filter(([, list]) => list.some((u) => u !== 'pagamento')).map(([id]) => id),
    ]),
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
      /** B5: rent paid in excess, with the month it would cover (`rentExcesses`). */
      excesses: RentExcess[];
      operationId?: string;
    }
  | { status: 'refused'; reason: 'inconsistent-store' };

/**
 * Writes the automatic payments of `reconcileIncome` in one `income.reconcile` operation; none
 * when there are none or with `dryRun`. Running it again on the same state writes nothing.
 * `alsoUsed`: movements to skip as well (the matches a dry run of `runReconciliation` would write).
 */
export async function runReconcile(
  store: Store,
  profileId: string,
  clock: () => string,
  newId: () => string,
  options: { dryRun?: boolean; alsoUsed?: ReadonlySet<string> } = {},
): Promise<ReconcileRunResult> {
  if (await writesBlocked(store)) {
    return { status: 'refused', reason: 'inconsistent-store' };
  }
  const { state, payments, result } = await planIncome(store, options.alsoUsed);
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
      summary: `Riconciliati gli incassi: ${plural(payments.length, 'automatico', 'automatici')}, ${String(result.proposals.length)} da rivedere.`,
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

/**
 * What `runReconcile` would write on the current state, without checking it or writing: its
 * result and the automatic payments. `runReconciliation` reads it for a dry run (as `planMatch`).
 */
export async function planIncome(store: Store, alsoUsed?: ReadonlySet<string>) {
  const state = await loadIncomeState(store, alsoUsed);
  const { payments, proposals, skipped } = reconcileIncome(state);
  const withRun = [...state.payments, ...payments.map((p) => ({ ...p, v: 1 as const, rev: 1 }))];
  const result = {
    status: 'reconciled' as const,
    written: payments.length,
    proposals,
    skipped: skipped.length,
    arrears: rentArrears({ ...state, payments: withRun }),
    excesses: excessesOf({ ...state, payments: withRun }),
  };
  return { state, payments, result };
}

/**
 * `rentExcesses` on the state, with (B5 c, decided by user1 on 19 Nov 2026) the credits less what
 * was given back: the tenant's live outgoing payments of kind `altro` in the apartment
 * (`uscita-inquilino`, a refund), taken from the credits oldest month first.
 */
const excessesOf = (state: Awaited<ReturnType<typeof loadIncomeState>>) => {
  const found = rentExcesses({
    tenancies: state.tenancies,
    payments: state.payments,
    covered: (apartmentId) => coveredMonths(state, apartmentId),
  });
  const refunded = new Map<string, number>();
  for (const p of state.payments) {
    if (p.deleted === true || !p.confirmed || p.kind !== 'altro' || p.amount >= 0) continue;
    const key = `${p.apartmentId}\u0000${p.tenantId}`;
    refunded.set(key, (refunded.get(key) ?? 0) - p.amount);
  }
  return [...found]
    .sort((a, b) => compareText(a.month, b.month) || compareText(a.id, b.id))
    .map((e) => {
      const key = `${e.apartmentId}\u0000${e.tenantId}`;
      const back = Math.min(e.credit, refunded.get(key) ?? 0);
      refunded.set(key, (refunded.get(key) ?? 0) - back);
      return back === 0 ? e : { ...e, credit: cents(e.credit - back) };
    })
    .sort((a, b) => compareText(a.id, b.id));
};

export type ConfirmRentExcessResult =
  | { status: 'confirmed'; operationId: string; paymentIds: string[] }
  | {
      status: 'refused';
      reason: 'inconsistent-store' | 'unknown-proposal' | 'no-month-to-cover';
    };

/**
 * B5 (decided by user1 on 18 and 19 Nov 2026): the excesses of the live records (`rentExcesses`),
 * with the stays ending with the tenant's contract and the months the statements cover.
 */
export async function loadRentExcesses(store: Store): Promise<RentExcess[]> {
  return excessesOf(await loadIncomeState(store));
}

/**
 * B5: confirms the excess `proposalId` (`p-eccedenza-<paymentId>`) as recomputed now, in one
 * `income.excess` operation that `annulla-riconciliazione` undoes. The payment gives each target
 * month its amount: a payment `<paymentId>-<month>` of the same tenant, date, source and movement
 * per month, or, when one is already live (a second confirmation, C1 of the review), that payment
 * grows by the amount. The payment keeps what is left; when the targets take all of it, the
 * payment itself goes to the first month. The movement's total never changes. Refused, writing
 * nothing: `inconsistent-store`, `unknown-proposal` (no such excess now), `no-month-to-cover` (no
 * month to cover: the excess is a credit to give back). A target month of a closed period is
 * accepted (F5: a new payment after the closing); a change to a payment of a closed period is not.
 */
export async function confirmRentExcess(
  store: Store,
  proposalId: string,
  profileId: string,
  clock: () => string,
  newId: () => string,
): Promise<ConfirmRentExcessResult> {
  const refuse = (reason: Extract<ConfirmRentExcessResult, { status: 'refused' }>['reason']) =>
    ({ status: 'refused', reason }) as const;
  if (await writesBlocked(store)) return refuse('inconsistent-store');
  const state = await loadIncomeState(store);
  const excess = excessesOf(state).find((e) => e.id === proposalId);
  const payment = state.payments.find((p) => p.id === excess?.paymentId);
  if (excess === undefined || payment === undefined) return refuse('unknown-proposal');
  const [first, ...rest] = excess.targets;
  if (first === undefined) return refuse('no-month-to-cover');
  const moved = excess.targets.reduce((sum, t) => sum + t.amount, 0);
  const whole = moved === payment.amount;
  const kept = parseOrThrow(
    PaymentSchema,
    whole
      ? { ...payment, forMonth: first.month, amount: first.amount }
      : { ...payment, amount: payment.amount - moved },
    'payment',
  );
  const splits = (whole ? rest : excess.targets).map((t) => {
    const id = `${payment.id}-${t.month}`;
    const before = state.payments.find((p) => p.id === id);
    const after = parseOrThrow(
      PaymentSchema,
      before !== undefined && before.deleted !== true
        ? { ...before, amount: before.amount + t.amount }
        : { ...payment, id, rev: 1, amount: t.amount, forMonth: t.month },
      'payment',
    );
    return { path: recordPath('payment', id), before, after };
  });
  const operation = await commitChange(
    store,
    {
      profileId,
      kind: 'income.excess',
      apartmentId: payment.apartmentId,
      summary: 'Assegnato un canone versato in più ai mesi che mancavano.',
      changes: [
        { path: recordPath('payment', payment.id), before: payment, after: kept },
        ...splits,
      ],
    },
    clock,
    newId,
  );
  return {
    status: 'confirmed',
    operationId: operation.id,
    paymentIds: [payment.id, ...splits.map((c) => c.after.id)],
  };
}

export interface ConfirmIncomeInput {
  proposalId: string;
  tenantId: string;
  parts: { kind: Payment['kind']; forMonth: YearMonth; amount: Cents }[];
  /** False for «solo questa volta» (decision D): the payer is not saved. */
  rememberPayer: boolean;
}

/**
 * A rent month to look at, never a refusal (B17, lotto 11 «solo avviso»): `month-outside-presence`
 * when the tenant has no live presence in the apartment that month, `month-already-paid` when
 * another confirmed rent payment of the tenant is for the same month.
 */
export interface IncomeMonthWarning {
  code: 'month-outside-presence' | 'month-already-paid';
  month: YearMonth;
}

export type ConfirmIncomeResult =
  | {
      status: 'confirmed';
      operationId: string;
      paymentIds: string[];
      payerId?: string;
      warnings?: IncomeMonthWarning[];
    }
  | {
      status: 'refused';
      reason:
        | 'inconsistent-store'
        | 'unknown-proposal'
        | 'stale-proposal'
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
  if (await writesBlocked(store)) return refuse('inconsistent-store');
  const state = await loadIncomeState(store);
  const income = reconcileIncome(state);
  const proposal = income.proposals.find((p) => p.id === input.proposalId);
  const tx = state.transactions.find((t) => t.id === proposal?.transactionId);
  const account = state.accounts.find((a) => a.id === tx?.accountId);
  if (proposal === undefined || tx === undefined || account === undefined) {
    // E7: the movement of the proposal has become automatic after another confirmation: run
    // riconcilia again (it writes the payment), the listing in hand is out of date.
    const txId = /^p-(?:chi|cosa)-(.+)$/.exec(input.proposalId)?.[1];
    const stale = proposal === undefined && income.payments.some((p) => p.transactionId === txId);
    return refuse(stale ? 'stale-proposal' : 'unknown-proposal');
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

  const warnings: IncomeMonthWarning[] = [];
  for (const p of payments) {
    if (p.kind !== 'canone' || p.forMonth === undefined) continue;
    const month = p.forMonth;
    const present = state.tenancies.some(
      (t) =>
        t.deleted !== true &&
        t.tenantId === input.tenantId &&
        t.apartmentId === apartmentId &&
        isPresent(t, month),
    );
    if (!present) warnings.push({ code: 'month-outside-presence', month });
    const paid = state.payments.some(
      (other) =>
        other.deleted !== true &&
        other.confirmed &&
        other.kind === 'canone' &&
        other.tenantId === input.tenantId &&
        other.forMonth === month &&
        other.transactionId !== tx.id,
    );
    if (paid) warnings.push({ code: 'month-already-paid', month });
  }

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
    ...(warnings.length > 0 ? { warnings } : {}),
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
  if (await writesBlocked(store)) return refuse('inconsistent-store');
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
