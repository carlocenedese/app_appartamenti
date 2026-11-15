/**
 * Writing the outgoings (plan 3c, task 6): the automatic run, the confirmation of a proposal with
 * its rule and the cancellation of one automatic class, each one operation of the journal.
 * Nothing is written while `checkConsistency` reports a problem (R113). Summaries carry counts.
 */
import { planIncome } from './income-store';
import { checkConsistency, commitChange, latestOperationByPath, readJournal } from './journal';
import {
  AccountSchema,
  ApartmentSchema,
  BankProfileSchema,
  BankTransactionSchema,
  BillMatchSchema,
  BillSchema,
  MovementClassSchema,
  MovementRuleSchema,
  OutgoingKindSchema,
  PayerSchema,
  PaymentSchema,
  SupplierProfileSchema,
  TenancySchema,
  TenantSchema,
  TransferSchema,
} from './model';
import type { OutgoingKind } from './model';
import { movementUses } from './movements';
import { outgoingCandidate, reconcileOutgoing, validRules } from './outgoing';
import type { MovementClassDraft, OutgoingProposal } from './outgoing';
import { parseOrThrow } from './parse';
import { firstPresenceDay } from './payers';
import { addDays } from './period';
import type { ISODate, YearMonth } from './period';
import { loadAll } from './store/load';
import { recordPath } from './store/records';
import type { Store } from './store/store';

const plural = (n: number, one: string, many: string): string =>
  `${String(n)} ${n === 1 ? one : many}`;

/**
 * Every record the outgoings read, deleted ones included, and the journal; `used` are the
 * movements with a use (`movementUses`), plus `alsoUsed` (what a phase before would take).
 */
async function loadOutgoingState(store: Store, alsoUsed: ReadonlySet<string> = new Set()) {
  const all = { includeDeleted: true };
  const classes = (await loadAll(store, 'movementClass', MovementClassSchema, all)).records;
  const matches = (await loadAll(store, 'match', BillMatchSchema, all)).records;
  const uses = movementUses({
    classes,
    payments: (await loadAll(store, 'payment', PaymentSchema, all)).records,
    matches,
    transfers: (await loadAll(store, 'transfer', TransferSchema, all)).records,
  });
  const state = {
    accounts: (await loadAll(store, 'account', AccountSchema, all)).records,
    transactions: (await loadAll(store, 'transaction', BankTransactionSchema, all)).records,
    classes,
    rules: (await loadAll(store, 'movementRule', MovementRuleSchema, all)).records,
    payers: (await loadAll(store, 'payer', PayerSchema, all)).records,
    tenants: (await loadAll(store, 'tenant', TenantSchema, all)).records,
    bills: (await loadAll(store, 'bill', BillSchema, all)).records,
    supplierProfiles: (await loadAll(store, 'supplierProfile', SupplierProfileSchema, all)).records,
    matches,
    used: new Set([...alsoUsed, ...uses.keys()]),
    operations: (await readJournal(store)).operations,
    bankProfiles: (await loadAll(store, 'bankProfile', BankProfileSchema, all)).records,
  };
  return { ...state, result: reconcileOutgoing(state) };
}
type OutgoingState = Awaited<ReturnType<typeof loadOutgoingState>>;

/**
 * What `runOutgoing` would write on the current state, without checking it or writing, and the
 * movements of those classes that are incoming (`runReconciliation` keeps them from the income).
 */
export async function planOutgoing(store: Store, alsoUsed?: ReadonlySet<string>) {
  const state = await loadOutgoingState(store, alsoUsed);
  const incoming = state.result.classes
    .filter((c) => (state.transactions.find((t) => t.id === c.transactionId)?.amount ?? 0) > 0)
    .map((c) => c.transactionId);
  return { ...state.result, incoming };
}

const classChange = (state: OutgoingState, draft: MovementClassDraft) => {
  const after = parseOrThrow(MovementClassSchema, { ...draft, v: 1, rev: 1 }, 'movementClass');
  return {
    path: recordPath('movementClass', after.id),
    before: state.classes.find((c) => c.id === after.id),
    after,
  };
};

/** The apartment of the account of each movement, when they are all one. */
function apartmentOf(state: OutgoingState, transactionIds: string[]) {
  const apartments = new Set(
    transactionIds.map((id) => {
      const tx = state.transactions.find((t) => t.id === id);
      return state.accounts.find((a) => a.id === tx?.accountId)?.apartmentId;
    }),
  );
  const [apartmentId] = apartments;
  return apartments.size === 1 && apartmentId !== undefined ? { apartmentId } : {};
}

export type OutgoingRunResult =
  | {
      status: 'reconciled';
      /** The automatic classes written; with `dryRun`, the ones that would be written. */
      written: number;
      /** Their movements, sorted. */
      classified: string[];
      proposals: OutgoingProposal[];
      missingDocument: string[];
      operationId?: string;
    }
  | { status: 'refused'; reason: 'inconsistent-store' };

/**
 * Writes the automatic classes of `reconcileOutgoing` in one `outgoing.reconcile` operation; none
 * when there are none or with `dryRun`. Running it again on the same state writes nothing.
 * `alsoUsed`: movements to skip as well (what a dry run of `runReconciliation` would write).
 */
export async function runOutgoing(
  store: Store,
  profileId: string,
  clock: () => string,
  newId: () => string,
  options: { dryRun?: boolean; alsoUsed?: ReadonlySet<string> } = {},
): Promise<OutgoingRunResult> {
  if ((await checkConsistency(store)).length > 0) {
    return { status: 'refused', reason: 'inconsistent-store' };
  }
  const state = await loadOutgoingState(store, options.alsoUsed);
  const { classes, proposals, missingDocument } = state.result;
  const classified = classes.map((c) => c.transactionId);
  const result = {
    status: 'reconciled' as const,
    written: classes.length,
    classified,
    proposals,
    missingDocument,
  };
  if (options.dryRun === true || classes.length === 0) return result;
  const operation = await commitChange(
    store,
    {
      profileId,
      kind: 'outgoing.reconcile',
      ...apartmentOf(state, classified),
      summary: `Classificate le uscite: ${plural(classes.length, 'automatica', 'automatiche')}, ${String(proposals.length)} da rivedere.`,
      changes: classes.map((c) => classChange(state, c)),
    },
    clock,
    newId,
  );
  return { ...result, operationId: operation.id };
}

export interface ConfirmOutgoingInput {
  /** A `p-uscita-` or `p-f24-` proposal, or the `p-chi-` `new-payer` of an incoming one by IBAN. */
  proposalId: string;
  kind: OutgoingKind;
  apartmentId: string;
  /** False for «solo questa volta» («Mie scelte» 8): no rule is saved. */
  rememberRule: boolean;
  /**
   * An F24 (decision 5): `kind` must be `tasse`, the class has `f24: true` and no rule is saved.
   * False on a `p-f24-` proposal: an ordinary outgoing (the pattern was wrong).
   */
  f24?: boolean;
}

export type ConfirmOutgoingResult =
  | { status: 'confirmed'; operationId: string; classId: string; ruleId?: string }
  | {
      status: 'refused';
      reason:
        | 'inconsistent-store'
        | 'unknown-proposal'
        | 'unknown-apartment'
        | 'rule-conflict-dates'
        | 'f24-not-tasse'
        | 'f24-not-outgoing';
    };

/**
 * Confirms the proposal `proposalId` as recomputed on the current state (gone since:
 * `unknown-proposal`): a `p-uscita-` of the outgoings, or a «chi» `new-payer` of the income for
 * an incoming candidate (`outgoingCandidate`, so an `iban:` key without a valid payer). Writes
 * `mc-<transactionId>` without `ruleId` and, with `rememberRule` and a key, the rule
 * `rule-<transactionId>` last, in one `outgoing.confirm` operation. `apartmentId` must be a live
 * apartment (`unknown-apartment`), any of them, also for an F24 (question 5). With `f24` the
 * class is `tasse` (`f24-not-tasse` otherwise) with `f24: true`, and never gets a rule; an incoming
 * movement is never an F24 (`f24-not-outgoing`). The new rule closes the valid rules in conflict
 * with it (another category or apartment) with `validTo` the day before the movement and starts
 * itself on the movement (`validFrom`), in the same operation; one of them starting on or after
 * the movement is `rule-conflict-dates` (user1, 15 Nov 2026).
 */
export async function confirmOutgoing(
  store: Store,
  input: ConfirmOutgoingInput,
  profileId: string,
  clock: () => string,
  newId: () => string,
): Promise<ConfirmOutgoingResult> {
  const refuse = (reason: Extract<ConfirmOutgoingResult, { status: 'refused' }>['reason']) =>
    ({ status: 'refused', reason }) as const;
  if ((await checkConsistency(store)).length > 0) return refuse('inconsistent-store');
  const state = await loadOutgoingState(store);
  let transactionId = state.result.proposals.find((p) => p.id === input.proposalId)?.transactionId;
  if (transactionId === undefined && input.proposalId.startsWith('p-chi-')) {
    const chi = (await planIncome(store)).result.proposals.find(
      (p) => p.id === input.proposalId && p.step === 'chi' && p.reason === 'new-payer',
    );
    transactionId = chi?.transactionId;
  }
  const tx = state.transactions.find((t) => t.id === transactionId);
  const candidate = tx === undefined ? undefined : outgoingCandidate(tx, state);
  if (tx === undefined || candidate === undefined) return refuse('unknown-proposal');
  const apartments = (await loadAll(store, 'apartment', ApartmentSchema)).records;
  if (!apartments.some((a) => a.id === input.apartmentId)) return refuse('unknown-apartment');

  const kind = OutgoingKindSchema.parse(input.kind);
  const f24 = input.f24 === true;
  if (f24 && kind !== 'tasse') return refuse('f24-not-tasse');
  if (f24 && candidate.direction !== 'out') return refuse('f24-not-outgoing'); // R129
  const changes: { path: string; before: unknown; after: unknown }[] = [
    classChange(state, {
      id: `mc-${tx.id}`,
      transactionId: tx.id,
      kind,
      apartmentId: input.apartmentId,
      ...(f24 ? { f24: true as const } : {}),
    }),
  ];
  const { key } = candidate;
  const remember = input.rememberRule && !f24 && key !== undefined;
  // A new rule closes the live rules in conflict with it (same key, account and direction,
  // another category or apartment) the day before the movement (user1, 15 Nov 2026): from then
  // on the newer rule holds. One that starts on or after the movement is not decided here.
  const dayBefore = addDays(tx.date as ISODate, -1);
  const closed = remember
    ? validRules(state.rules, tx, candidate.direction, key).filter(
        (r) => r.kind !== kind || r.apartmentId !== input.apartmentId,
      )
    : [];
  if (closed.some((r) => r.validFrom !== undefined && r.validFrom > dayBefore)) {
    return refuse('rule-conflict-dates');
  }
  for (const r of closed) {
    changes.push({
      path: recordPath('movementRule', r.id),
      before: r,
      after: parseOrThrow(MovementRuleSchema, { ...r, validTo: dayBefore }, 'movementRule'),
    });
  }
  const rule = remember
    ? parseOrThrow(
        MovementRuleSchema,
        {
          id: `rule-${tx.id}`,
          v: 1,
          rev: 1,
          direction: candidate.direction,
          accountId: tx.accountId,
          key,
          kind,
          apartmentId: input.apartmentId,
          ...(closed.length > 0 ? { validFrom: tx.date } : {}),
        },
        'movementRule',
      )
    : undefined;
  // The rule last: an interrupted confirmation never leaves a rule without its class.
  if (rule !== undefined) {
    changes.push({
      path: recordPath('movementRule', rule.id),
      before: state.rules.find((r) => r.id === rule.id),
      after: rule,
    });
  }
  const operation = await commitChange(
    store,
    {
      profileId,
      kind: 'outgoing.confirm',
      ...apartmentOf(state, [tx.id]),
      summary: 'Classificato un movimento.',
      changes,
    },
    clock,
    newId,
  );
  return {
    status: 'confirmed',
    operationId: operation.id,
    classId: `mc-${tx.id}`,
    ...(rule === undefined ? {} : { ruleId: rule.id }),
  };
}

export interface ConfirmTenantOutgoingInput {
  /** A `p-uscita-` proposal of an outgoing movement. */
  proposalId: string;
  tenantId: string;
  /** Never `canone`: the rent is an income. */
  kind: 'caparra' | 'conguaglio' | 'altro';
  forMonth: YearMonth;
}

export type ConfirmTenantOutgoingResult =
  | { status: 'confirmed'; operationId: string; paymentId: string }
  | {
      status: 'refused';
      reason: 'inconsistent-store' | 'unknown-proposal' | 'tenant-not-allowed';
    };

/**
 * Registers the outgoing `proposalId` (a `p-uscita-` recomputed on the current state, gone since:
 * `unknown-proposal`) as a payment to a tenant (question 9, R130): `pay-<transactionId>-1` with
 * the negative amount of the movement, the apartment of its account, `confirmed` and `source`
 * `csv`, in one `outgoing.tenant` operation. Always by hand, never from a rule, and no rule is
 * saved. The tenant must be live with a presence in that apartment (`tenant-not-allowed`).
 */
export async function confirmTenantOutgoing(
  store: Store,
  input: ConfirmTenantOutgoingInput,
  profileId: string,
  clock: () => string,
  newId: () => string,
): Promise<ConfirmTenantOutgoingResult> {
  const refuse = (reason: Extract<ConfirmTenantOutgoingResult, { status: 'refused' }>['reason']) =>
    ({ status: 'refused', reason }) as const;
  if ((await checkConsistency(store)).length > 0) return refuse('inconsistent-store');
  const state = await loadOutgoingState(store);
  const proposal = state.result.proposals.find(
    (p) => p.id === input.proposalId && p.step === 'uscita',
  );
  const tx = state.transactions.find((t) => t.id === proposal?.transactionId);
  const apartmentId = state.accounts.find((a) => a.id === tx?.accountId)?.apartmentId;
  if (tx === undefined || apartmentId === undefined) return refuse('unknown-proposal');
  const tenancies = (await loadAll(store, 'tenancy', TenancySchema, { includeDeleted: true }))
    .records;
  const live = state.tenants.some((t) => t.id === input.tenantId && t.deleted !== true);
  if (!live || firstPresenceDay(tenancies, input.tenantId, apartmentId) === undefined) {
    return refuse('tenant-not-allowed');
  }
  const payment = parseOrThrow(
    PaymentSchema,
    {
      id: `pay-${tx.id}-1`,
      v: 1,
      rev: 1,
      apartmentId,
      tenantId: input.tenantId,
      date: tx.date,
      amount: tx.amount,
      confirmed: true,
      kind: input.kind,
      forMonth: input.forMonth,
      source: 'csv',
      transactionId: tx.id,
    },
    'payment',
  );
  const path = recordPath('payment', payment.id);
  const before = (
    await loadAll(store, 'payment', PaymentSchema, { includeDeleted: true })
  ).records.find((p) => p.id === payment.id);
  const operation = await commitChange(
    store,
    {
      profileId,
      kind: 'outgoing.tenant',
      apartmentId,
      summary: "Registrata un'uscita verso un inquilino.",
      changes: [{ path, before, after: payment }],
    },
    clock,
    newId,
  );
  return { status: 'confirmed', operationId: operation.id, paymentId: payment.id };
}

export type CancelClassResult =
  | { status: 'cancelled'; operationId: string }
  | { status: 'refused'; reason: 'inconsistent-store' | 'unknown-class' | 'not-automatic' };

/**
 * Cancels the automatic class of `transactionId` by itself (as R121): an `outgoing.cancel-auto`
 * operation that deletes it, which `undoOperation` takes back. The movement is then `undone` and
 * never automatic again. Automatic: a live class with `ruleId` whose latest change is an
 * `outgoing.reconcile` (`not-automatic` otherwise); none live is `unknown-class`.
 */
export async function cancelAutomaticClass(
  store: Store,
  transactionId: string,
  profileId: string,
  clock: () => string,
  newId: () => string,
): Promise<CancelClassResult> {
  const refuse = (reason: Extract<CancelClassResult, { status: 'refused' }>['reason']) =>
    ({ status: 'refused', reason }) as const;
  if ((await checkConsistency(store)).length > 0) return refuse('inconsistent-store');
  const id = `mc-${transactionId}`;
  const cls = (await loadAll(store, 'movementClass', MovementClassSchema)).records.find(
    (c) => c.id === id,
  );
  if (cls === undefined) return refuse('unknown-class');
  const path = recordPath('movementClass', id);
  const by = latestOperationByPath((await readJournal(store)).operations).get(path);
  if (cls.ruleId === undefined || by?.kind !== 'outgoing.reconcile') return refuse('not-automatic');
  const operation = await commitChange(
    store,
    {
      profileId,
      kind: 'outgoing.cancel-auto',
      ...(cls.apartmentId === undefined ? {} : { apartmentId: cls.apartmentId }),
      summary: 'Annullata una classificazione automatica.',
      changes: [{ path, before: cls, after: undefined }],
    },
    clock,
    newId,
  );
  return { status: 'cancelled', operationId: operation.id };
}
