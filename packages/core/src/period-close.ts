/**
 * The closing of a settlement period (review of 18 Nov 2026, I2, R5): `closePeriod` writes the
 * snapshot when `canClosePeriod` allows it, `loadPeriodClosing` compares the current calculation
 * with it (`calcConguaglioSupplementare`). One `period.close` operation, undone with the
 * reconciliation undo. No amount or name in a summary.
 */
import {
  closingOf,
  flatPaymentsOf,
  isLiveClose,
  periodCloseId,
  rentOf,
  snapshotOf,
  tenantBalance,
} from './closing';
import { ClosingUndoError, periodInputs } from './closed-period-guard';
import type { PeriodClosed } from './closing';
import { SettlementInputError, calcConguaglio, canClosePeriod } from './conguaglio';
import type { CloseMissing, ConguaglioResult, SettlementInputErrorCode } from './conguaglio';
import { loadExcelInput } from './excel-store';
import type { ExcelInput } from './excel';
import { commitChange, writesBlocked } from './journal';
import { BankTransactionSchema, PeriodCloseSchema, SupplySchema } from './model';
import type { PeriodClose } from './model';
import { isoDate, monthsInPeriod } from './period';
import type { ISODate } from './period';
import { cents } from './money';
import type { Cents } from './money';
import { loadAll } from './store/load';
import { recordPath } from './store/records';
import { weightsOver } from './valid-from';
import type { Store } from './store/store';

type Query = { apartmentId: string; periodLabel: string };
type LoadRefusal =
  'inconsistent-store' | 'unknown-apartment' | 'unknown-period' | 'ambiguous-period';

/** Plan 22: a rent of a reopened period closed again without it (decision 1 of user1). */
export type RentMissing = { tenantId: string; month: string; amount: Cents };

export type ClosePeriodResult =
  | {
      status: 'closed';
      operationId: string;
      closeId: string;
      /** The warning: rents not collected, each a row «Canone non incassato» (plan 22). */
      rentMissing?: RentMissing[];
    }
  | { status: 'refused'; reason: LoadRefusal | 'already-closed' }
  /** R3: the December TARI notice (`month`) of an apartment of the shared notice is not debited. */
  | { status: 'refused'; reason: 'tari-december-missing'; month: string }
  | { status: 'refused'; reason: 'settlement-error'; code: SettlementInputErrorCode }
  /** What is not collected or still waiting (`canClosePeriod`). */
  | { status: 'refused'; reason: 'cannot-close'; missing: CloseMissing[] };

async function computed(
  store: Store,
  query: Query,
): Promise<
  | { status: 'ok'; input: ExcelInput; result: ConguaglioResult }
  | { status: 'refused'; reason: LoadRefusal }
  | { status: 'refused'; reason: 'settlement-error'; code: SettlementInputErrorCode }
> {
  const loaded = await loadExcelInput(store, query);
  if (loaded.status === 'refused') return loaded;
  try {
    return { status: 'ok', input: loaded.input, result: calcConguaglio(loaded.input) };
  } catch (error) {
    if (!(error instanceof SettlementInputError)) throw error;
    return { status: 'refused', reason: 'settlement-error', code: error.code };
  }
}

/** The closing record of the period, not deleted, reopened or not (F3). */
async function currentClose(store: Store, query: Query): Promise<PeriodClose | undefined> {
  const id = periodCloseId(query.apartmentId, query.periodLabel);
  return (await loadAll(store, 'periodClose', PeriodCloseSchema)).records.find((c) => c.id === id);
}

/** The live closing of the period (closed, not reopened), if any. */
async function liveClose(store: Store, query: Query): Promise<PeriodClose | undefined> {
  const close = await currentClose(store, query);
  return close !== undefined && isLiveClose(close) ? close : undefined;
}

/**
 * The Decembers whose TARI debit a closing waits for (R3, F4): the Decembers inside the period,
 * sorted. A period of several years waits for every one of them; a period without a December
 * waits for none (answers of user1, 18 Nov 2026, R339).
 */
export function tariDecembers(from: string, to: string): string[] {
  return monthsInPeriod(isoDate(`${from}-01`), isoDate(`${to}-01`)).filter((m) =>
    m.endsWith('-12'),
  );
}

/**
 * Closes the period with the snapshot of its calculation (R5) when every rent and flat charge of
 * its months is collected and no item of the period is waiting for its debit (`canClosePeriod`,
 * `cannot-close` with what is missing). Refused too: the refusals of `loadExcelInput`, an input
 * the settlement cannot compute (`settlement-error`), a period already closed. That the
 * settlement was sent to the tenants is user1's word: the command itself (question in the review
 * document).
 */
export async function closePeriod(
  store: Store,
  query: Query,
  profileId: string,
  clock: () => string,
  newId: () => string,
): Promise<ClosePeriodResult> {
  if (await writesBlocked(store)) {
    return { status: 'refused', reason: 'inconsistent-store' };
  }
  const calc = await computed(store, query);
  if (calc.status === 'refused') return calc;
  if ((await liveClose(store, query)) !== undefined) {
    return { status: 'refused', reason: 'already-closed' };
  }
  const { input, result } = calc;
  const id = periodCloseId(query.apartmentId, query.periodLabel);
  const before = (
    await loadAll(store, 'periodClose', PeriodCloseSchema, { includeDeleted: true })
  ).records.find((c) => c.id === id);
  const reopened = before !== undefined && before.deleted !== true ? before.reopened : undefined;
  const months = monthsInPeriod(
    isoDate(`${input.period.from}-01`),
    isoDate(`${input.period.to}-01`),
  );
  const check = canClosePeriod({
    tenancies: input.tenancies,
    payments: input.payments,
    months,
    // `calcConguaglio` lists only the items that touch the period: each one holds it open.
    pending: result.pending.map((p) => ({ itemType: p.itemType, itemId: p.itemId, months })),
  });
  // H (answer of user1, 18 Nov 2026): closing a reopened period again, the flat charge counted
  // at the previous closing and no longer collected does not hold it open: it becomes the line
  // «Forfait non incassato» (`forfaitNonIncassato`). Only up to what the previous snapshot had
  // collected more than today; a period never closed keeps the refusal.
  const allowance = new Map<string, number>();
  if (reopened !== undefined && before !== undefined) {
    for (const t of before.snapshot.tenants) {
      const now = result.tenants.find((r) => r.tenantId === t.tenantId)?.forfaitIncassato ?? 0;
      allowance.set(t.tenantId, t.forfaitIncassato + (t.forfaitNonIncassato ?? 0) - now);
    }
  }
  const forfaitMissing = new Map<string, number>();
  // Plan 22, decision 1 of user1 (19 Nov 2026): a rent not collected after a reopening (a bounced
  // transfer) does not hold a reopened period open; the closing warns and shows the row
  // «Canone non incassato». Never closed: refused as before.
  const rentMissing: RentMissing[] = [];
  const missing = check.missing.filter((m) => {
    if (m.kind === 'rent' && reopened !== undefined) {
      rentMissing.push({ tenantId: m.tenantId, month: m.month, amount: m.amount });
      return false;
    }
    if (m.kind !== 'forfait') return true;
    const used = (forfaitMissing.get(m.tenantId) ?? 0) + m.amount;
    if (used > (allowance.get(m.tenantId) ?? 0)) return true;
    forfaitMissing.set(m.tenantId, used);
    return false;
  });
  if (missing.length > 0) return { status: 'refused', reason: 'cannot-close', missing };
  // R3: an apartment with a supply of the shared TARI notice closes only after the December
  // notice inside the period is debited (a real match, not assumed), so that the September share
  // of that notice does not open the period again (F4, decided by user1 on 18 Nov 2026).
  // Plan 22: the weights in force in the months of the period («valido dal»), not today's.
  const shared = (await loadAll(store, 'supply', SupplySchema)).records.some((supply) =>
    weightsOver(supply, input.period.from, input.period.to).some((s) =>
      s.value.some((a) => a.apartmentId === query.apartmentId),
    ),
  );
  if (shared) {
    const debited = new Set(
      input.matches
        .filter((m) => m.itemType === 'instalment' && m.part === 'amount' && m.by !== 'assumed')
        .map((m) => m.itemId),
    );
    const missing = tariDecembers(input.period.from, input.period.to).find(
      (december) =>
        !input.instalments.some(
          (i) =>
            i.deleted !== true && i.kind === 'tari' && i.coversTo === december && debited.has(i.id),
        ),
    );
    if (missing !== undefined) {
      return { status: 'refused', reason: 'tari-december-missing', month: missing };
    }
  }
  // F3: a closing after a reopening keeps the one before in `history`, never deleted.
  const earlier =
    before !== undefined && reopened !== undefined
      ? [
          ...(before.history ?? []),
          {
            closedAt: before.closedAt,
            engineVersion: before.engineVersion,
            snapshot: before.snapshot,
            ...(before.sentOn === undefined ? {} : { sentOn: before.sentOn }),
            ...(before.settled === undefined ? {} : { settled: before.settled }),
            ...(before.supplementarySettled === undefined
              ? {}
              : { supplementarySettled: before.supplementarySettled }),
            ...(before.flatChecked === undefined ? {} : { flatChecked: before.flatChecked }),
            ...(before.rentMarks === undefined ? {} : { rentMarks: before.rentMarks }),
            reopened,
          },
        ]
      : (before?.history ?? []);
  const after = PeriodCloseSchema.parse({
    id,
    v: 1,
    rev: (before?.rev ?? 0) + 1,
    apartmentId: query.apartmentId,
    periodLabel: query.periodLabel,
    from: input.period.from,
    to: input.period.to,
    closedAt: clock(),
    engineVersion: result.engineVersion,
    snapshot: {
      ...snapshotOf(result),
      tenants: snapshotOf(result).tenants.map((t) => {
        const fni = forfaitMissing.get(t.tenantId);
        return fni === undefined ? t : { ...t, forfaitNonIncassato: fni };
      }),
    },
    ...(earlier.length === 0 ? {} : { history: earlier }),
    // Finding 4: what the snapshot counted, read from the folder (F5 guard).
    inputs: await periodInputs(store, {
      apartmentId: query.apartmentId,
      periodLabel: query.periodLabel,
      from: input.period.from,
      to: input.period.to,
    }),
  });
  const operation = await commitChange(
    store,
    {
      profileId,
      kind: 'period.close',
      apartmentId: query.apartmentId,
      summary: 'Periodo di conguaglio chiuso.',
      changes: [{ path: recordPath('periodClose', id), before, after }],
    },
    clock,
    newId,
  );
  return {
    status: 'closed',
    operationId: operation.id,
    closeId: id,
    ...(rentMissing.length === 0 ? {} : { rentMissing }),
  };
}

export type PeriodClosingResult =
  | { status: 'open' }
  | PeriodClosed
  | { status: 'refused'; reason: LoadRefusal }
  | { status: 'refused'; reason: 'settlement-error'; code: SettlementInputErrorCode };

/**
 * Whether the period is closed and, if it is, the supplementary settlement of what changed since
 * the snapshot (R5): `calcConguaglioSupplementare` of the current calculation, departures as of
 * `asOf`. Read only.
 */
export async function loadPeriodClosing(
  store: Store,
  query: Query,
  asOf: ISODate,
): Promise<PeriodClosingResult> {
  const calc = await computed(store, query);
  if (calc.status === 'refused') return calc;
  const close = await currentClose(store, query);
  if (close === undefined) return { status: 'open' };
  return closingOf(close, calc.result, calc.input, asOf);
}

export type MarkCloseResult =
  | { status: 'saved'; operationId: string; closeId: string }
  | { status: 'unchanged'; closeId: string }
  | {
      status: 'refused';
      reason:
        | 'inconsistent-store'
        | 'not-closed'
        | 'unknown-tenant'
        | 'unknown-movement'
        | 'missing-reason'
        | 'no-supplementary'
        /** Plan 22: no flat charge «da verificare» left. */
        | 'nothing-to-check'
        /** Plan 22: no rent not collected left for that outcome. */
        | 'nothing-to-mark'
        | 'invalid-input';
    }
  /**
   * The main settlement of this closing is already marked and a supplementary is left (`amount`,
   * positive owed by the tenant): marking the main again would settle nothing, so it is refused.
   */
  | { status: 'refused'; reason: 'use-supplementary'; amount: Cents };

/**
 * One change of the live closing of the period (F1, F3), in one operation of `kind`: `change`
 * gives the new fields, or a refusal. `not-closed` without a live closing; `unchanged` when the
 * record would stay the same.
 */
async function changeClose(
  store: Store,
  query: Query,
  kind: string,
  summary: string,
  change: (
    close: PeriodClose,
  ) => Promise<
    { fields: Record<string, unknown> } | Extract<MarkCloseResult, { status: 'refused' }>
  >,
  profileId: string,
  clock: () => string,
  newId: () => string,
  reason?: string,
): Promise<MarkCloseResult> {
  if (await writesBlocked(store)) return { status: 'refused', reason: 'inconsistent-store' };
  const before = await liveClose(store, query);
  if (before === undefined) return { status: 'refused', reason: 'not-closed' };
  const changed = await change(before);
  if (!('fields' in changed)) return changed;
  const parsed = PeriodCloseSchema.safeParse({ ...before, ...changed.fields });
  if (!parsed.success) return { status: 'refused', reason: 'invalid-input' };
  if (JSON.stringify(parsed.data) === JSON.stringify(before)) {
    return { status: 'unchanged', closeId: before.id };
  }
  const operation = await commitChange(
    store,
    {
      profileId,
      kind,
      apartmentId: query.apartmentId,
      summary,
      ...(reason === undefined ? {} : { reason }),
      changes: [{ path: recordPath('periodClose', before.id), before, after: parsed.data }],
    },
    clock,
    newId,
  );
  return { status: 'saved', operationId: operation.id, closeId: before.id };
}

/** F1: the settlement of the closed period was sent to the tenants on `on` (user1's word). */
export function markPeriodSent(
  store: Store,
  input: Query & { on: string },
  profileId: string,
  clock: () => string,
  newId: () => string,
): Promise<MarkCloseResult> {
  return changeClose(
    store,
    input,
    'period.send',
    'Conguaglio segnato come inviato.',
    () => Promise.resolve({ fields: { sentOn: input.on } }),
    profileId,
    clock,
    newId,
  );
}

/**
 * F1: user1 marks the settlement of `tenantId` as settled on `on`, with the bank movement that
 * paid it if he gives one. Never set by the app on its own. Refused: a tenant who is not in the
 * snapshot (`unknown-tenant`), a movement that is not a live one (`unknown-movement`).
 */
export function markTenantSettled(
  store: Store,
  input: Query & {
    tenantId: string;
    on: string;
    transactionId?: string;
    /** D: the supplementary settlement of the tenant, as it is today, instead of the closing's. */
    supplementary?: boolean;
  },
  profileId: string,
  clock: () => string,
  newId: () => string,
): Promise<MarkCloseResult> {
  return changeClose(
    store,
    input,
    'period.settle',
    input.supplementary === true
      ? 'Conguaglio supplementare di un inquilino segnato come saldato.'
      : 'Conguaglio di un inquilino segnato come saldato.',
    async (close) => {
      if (!close.snapshot.tenants.some((t) => t.tenantId === input.tenantId)) {
        return { status: 'refused', reason: 'unknown-tenant' } as const;
      }
      if (
        input.transactionId !== undefined &&
        !(await loadAll(store, 'transaction', BankTransactionSchema)).records.some(
          (t) => t.id === input.transactionId,
        )
      ) {
        return { status: 'refused', reason: 'unknown-movement' } as const;
      }
      const entry = {
        tenantId: input.tenantId,
        on: input.on,
        ...(input.transactionId === undefined ? {} : { transactionId: input.transactionId }),
      };
      // Fifth round: the mark stores what it declares settled (`amount`) and, for the main, the
      // flat charge collected now (`flatCollected`), from the one computation (`tenantBalance`).
      const calc = await computed(store, input);
      if (calc.status === 'refused') return { status: 'refused', reason: 'invalid-input' } as const;
      const today = calc.result.tenants.find((t) => t.tenantId === input.tenantId);
      const now = {
        due: today?.due ?? 0,
        forfaitIncassato: today?.forfaitIncassato ?? 0,
        payments: flatPaymentsOf(calc.input.payments, input.tenantId, close.from, close.to),
      };
      const others = (close.settled ?? []).filter((s) => s.tenantId !== input.tenantId);
      // Flat charge «da verificare» never blocks a mark (final review) and no mark changes it: the
      // supplementary already leaves the extra out, and a main mark keeps the flat charge of the
      // last main mark, so the extra stays to check, never credited nor folded in.
      const ledger = tenantBalance(close, input.tenantId, now);
      if (input.supplementary === true) {
        // The supplementary of today: a later difference is still due.
        const amount = ledger.supplementary;
        if (amount === 0) return { status: 'refused', reason: 'no-supplementary' } as const;
        const rest = (close.supplementarySettled ?? []).filter(
          (s) => s.tenantId !== input.tenantId,
        );
        return {
          fields: {
            supplementarySettled: [...rest, { ...entry, amount }].sort((a, b) =>
              a.tenantId < b.tenantId ? -1 : 1,
            ),
          },
        };
      }
      // Marked again on this closing: the date and movement change, never what it declared.
      const again = (close.settled ?? []).find((s) => s.tenantId === input.tenantId);
      // Marked again with something left of the supplementary: the owner would believe he settled
      // it, but this mark changes no amount (final review): refused, pointing at --supplementare.
      const left = ledger.supplementary - ledger.supplementarySettled;
      if (again?.amount !== undefined && again.flatCollected !== undefined && left !== 0) {
        return { status: 'refused', reason: 'use-supplementary', amount: cents(left) } as const;
      }
      const declared =
        again?.amount !== undefined && again.flatCollected !== undefined
          ? { amount: again.amount, flatCollected: again.flatCollected }
          : {
              amount: tenantBalance({ ...close, settled: others }, input.tenantId, now)
                .mainRemaining,
              // The flat charge to check before user1's checks (plan 22), so they stay valid.
              flatCollected: cents(now.forfaitIncassato - ledger.toCheck - ledger.flatCleared),
            };
      return {
        fields: {
          settled: [...others, { ...entry, ...declared }].sort((a, b) =>
            a.tenantId < b.tenantId ? -1 : 1,
          ),
        },
      };
    },
    profileId,
    clock,
    newId,
  );
}

/**
 * Plan 22 (decision 3 of user1, 19 Nov 2026): user1 checked the flat charge «da verificare» of
 * `tenantId` on `on`, with its outcome, in one `period.flat-check` (undone with the reconciliation
 * undo). Every outcome takes the amount (all that is to check now) out of what is to check;
 * `rimborso` (refunded on `on`) and `stessi-soldi` leave what is owed and withheld as it is,
 * `credito` puts it in the supplementary settlement as a credit of the tenant (answers 5, 6). The
 * check is tied to the tenant's flat-charge payments of the period (answer 7): if one of them goes
 * or changes, the amount is to check again. The payment can still be corrected by hand. Refused:
 * `not-closed`, `unknown-tenant`, `unknown-movement`, `nothing-to-check`.
 */
export function markFlatChecked(
  store: Store,
  input: Query & {
    tenantId: string;
    on: string;
    outcome: 'rimborso' | 'credito' | 'stessi-soldi';
    transactionId?: string;
  },
  profileId: string,
  clock: () => string,
  newId: () => string,
): Promise<MarkCloseResult> {
  return changeClose(
    store,
    input,
    'period.flat-check',
    'Forfait da verificare di un inquilino verificato.',
    async (close) => {
      if (!close.snapshot.tenants.some((t) => t.tenantId === input.tenantId)) {
        return { status: 'refused', reason: 'unknown-tenant' } as const;
      }
      if (
        input.transactionId !== undefined &&
        !(await loadAll(store, 'transaction', BankTransactionSchema)).records.some(
          (t) => t.id === input.transactionId,
        )
      ) {
        return { status: 'refused', reason: 'unknown-movement' } as const;
      }
      const calc = await computed(store, input);
      if (calc.status === 'refused') return { status: 'refused', reason: 'invalid-input' } as const;
      const today = calc.result.tenants.find((t) => t.tenantId === input.tenantId);
      const payments = flatPaymentsOf(calc.input.payments, input.tenantId, close.from, close.to);
      const ledger = tenantBalance(close, input.tenantId, {
        due: today?.due ?? 0,
        forfaitIncassato: today?.forfaitIncassato ?? 0,
        payments,
      });
      const amount = ledger.toCheck;
      if (amount <= 0) return { status: 'refused', reason: 'nothing-to-check' } as const;
      return {
        fields: {
          flatChecked: [
            ...(close.flatChecked ?? []),
            {
              tenantId: input.tenantId,
              on: input.on,
              outcome: input.outcome,
              amount: cents(amount),
              ...(input.transactionId === undefined ? {} : { transactionId: input.transactionId }),
              // Answer 7: tied to the payments it was made on.
              payments,
            },
          ],
        },
      };
    },
    profileId,
    clock,
    newId,
  );
}

/**
 * Plan 22 (answer 2 of user1, 19 Nov 2026): user1 marks the rent not collected of `tenantId` on the
 * live closing, in one `period.rent-mark` (undone with the reconciliation undo), recording what is
 * open now month by month. `richiesto`: asked from the tenant, nothing else changes. `saldato`:
 * paid outside the payments recorded, no longer open, withheld or asked. `non-recuperabile`: left
 * with the owner (R5), no longer open, withheld or asked. Refused: `not-closed`, `unknown-tenant`,
 * `unknown-movement`, `nothing-to-mark` (nothing open, or for `richiesto` all of it already asked).
 */
export function markRentMissing(
  store: Store,
  input: Query & {
    tenantId: string;
    on: string;
    outcome: 'richiesto' | 'saldato' | 'non-recuperabile';
    transactionId?: string;
  },
  profileId: string,
  clock: () => string,
  newId: () => string,
): Promise<MarkCloseResult> {
  return changeClose(
    store,
    input,
    'period.rent-mark',
    'Canone non incassato di un inquilino segnato.',
    async (close) => {
      if (!close.snapshot.tenants.some((t) => t.tenantId === input.tenantId)) {
        return { status: 'refused', reason: 'unknown-tenant' } as const;
      }
      if (
        input.transactionId !== undefined &&
        !(await loadAll(store, 'transaction', BankTransactionSchema)).records.some(
          (t) => t.id === input.transactionId,
        )
      ) {
        return { status: 'refused', reason: 'unknown-movement' } as const;
      }
      const calc = await computed(store, input);
      if (calc.status === 'refused') return { status: 'refused', reason: 'invalid-input' } as const;
      const rent = rentOf(close, calc.input).get(input.tenantId);
      if (
        rent === undefined ||
        rent.open === 0 ||
        (input.outcome === 'richiesto' && rent.asked === rent.open)
      ) {
        return { status: 'refused', reason: 'nothing-to-mark' } as const;
      }
      return {
        fields: {
          rentMarks: [
            ...(close.rentMarks ?? []),
            {
              tenantId: input.tenantId,
              on: input.on,
              outcome: input.outcome,
              months: rent.months,
              ...(input.transactionId === undefined ? {} : { transactionId: input.transactionId }),
            },
          ],
        },
      };
    },
    profileId,
    clock,
    newId,
  );
}

/**
 * F3: reopens the closed period on `on` for `reason` (not empty). The snapshot stays, with the
 * marks of F1, and a later `closePeriod` moves it into `history`: nothing is deleted. Until then
 * the period is open (`loadPeriodClosing` says `reopened`, compared with that snapshot).
 */
export function reopenPeriod(
  store: Store,
  input: Query & { on: string; reason: string },
  profileId: string,
  clock: () => string,
  newId: () => string,
): Promise<MarkCloseResult> {
  const reason = input.reason.trim();
  return changeClose(
    store,
    input,
    'period.reopen',
    'Periodo di conguaglio riaperto.',
    () =>
      Promise.resolve(
        reason === ''
          ? ({ status: 'refused', reason: 'missing-reason' } as const)
          : { fields: { reopened: { on: input.on, reason } } },
      ),
    profileId,
    clock,
    newId,
    reason,
  );
}

/**
 * Finding 9: an undo that would close a period without a new snapshot is refused in the core,
 * whoever calls `undoOperation`: undoing a closing (`closing-changed`) or a reopening
 * (`reopen-changed`) after the costs or the data of the period changed, or when the settlement
 * cannot be computed now (`closing-unknown`). Called by `undoOperation` before it writes.
 */
export async function refuseClosingUndo(
  store: Store,
  toUndo: readonly {
    kind: string;
    changes: readonly { path: string; before?: unknown; after?: unknown }[];
  }[],
  asOf: ISODate,
): Promise<void> {
  for (const operation of toUndo) {
    // Finding 4 (third review): any undo that puts back a live closing (the undo of an undo of a
    // closing, at any depth) is checked against that closing's snapshot.
    for (const change of operation.changes) {
      if (!change.path.startsWith('_app/dati/periodClose/')) continue;
      const back = PeriodCloseSchema.safeParse(change.before);
      if (!back.success || !isLiveClose(back.data)) continue;
      // Already closed now (the undo of a mark, sent or settled): nothing closes again.
      const now = PeriodCloseSchema.safeParse(await store.readJson(change.path));
      if (now.success && isLiveClose(now.data)) continue;
      const query = { apartmentId: back.data.apartmentId, periodLabel: back.data.periodLabel };
      const calc = await computed(store, query);
      if (calc.status === 'refused') {
        throw new ClosingUndoError('closing-unknown', query.apartmentId, query.periodLabel);
      }
      const since = closingOf(back.data, calc.result, calc.input, asOf);
      if (since.changed || since.dataChanged) {
        // Fourth round, C: the period is reopened now (whatever the operation): its message.
        throw new ClosingUndoError(
          operation.kind === 'period.reopen' || (now.success && now.data.reopened !== undefined)
            ? 'reopen-changed'
            : 'closing-changed',
          query.apartmentId,
          query.periodLabel,
        );
      }
    }
    if (operation.kind !== 'period.close' && operation.kind !== 'period.reopen') continue;
    const parsed = PeriodCloseSchema.safeParse(operation.changes[0]?.after);
    if (!parsed.success || parsed.data.deleted === true) continue;
    const query = { apartmentId: parsed.data.apartmentId, periodLabel: parsed.data.periodLabel };
    const closing = await loadPeriodClosing(store, query, asOf);
    if (closing.status === 'refused') {
      throw new ClosingUndoError('closing-unknown', query.apartmentId, query.periodLabel);
    }
    if (closing.status !== 'open' && (closing.changed || closing.dataChanged)) {
      throw new ClosingUndoError(
        operation.kind === 'period.reopen' ? 'reopen-changed' : 'closing-changed',
        query.apartmentId,
        query.periodLabel,
      );
    }
  }
}
