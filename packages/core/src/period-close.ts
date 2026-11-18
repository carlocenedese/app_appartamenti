/**
 * The closing of a settlement period (review of 18 Nov 2026, I2, R5): `closePeriod` writes the
 * snapshot when `canClosePeriod` allows it, `loadPeriodClosing` compares the current calculation
 * with it (`calcConguaglioSupplementare`). One `period.close` operation, undone with the
 * reconciliation undo. No amount or name in a summary.
 */
import { closingOf, periodCloseId, snapshotOf } from './closing';
import type { PeriodClosed } from './closing';
import { SettlementInputError, calcConguaglio, canClosePeriod } from './conguaglio';
import type { CloseMissing, ConguaglioResult, SettlementInputErrorCode } from './conguaglio';
import { loadExcelInput } from './excel-store';
import type { ExcelInput } from './excel';
import { commitChange, writesBlocked } from './journal';
import { PeriodCloseSchema, SupplySchema } from './model';
import type { PeriodClose } from './model';
import { isoDate, monthsInPeriod } from './period';
import type { ISODate } from './period';
import { loadAll } from './store/load';
import { recordPath } from './store/records';
import type { Store } from './store/store';

type Query = { apartmentId: string; periodLabel: string };
type LoadRefusal =
  'inconsistent-store' | 'unknown-apartment' | 'unknown-period' | 'ambiguous-period';

export type ClosePeriodResult =
  | { status: 'closed'; operationId: string; closeId: string }
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

/** The live closing of the period, if any. */
async function liveClose(store: Store, query: Query): Promise<PeriodClose | undefined> {
  const id = periodCloseId(query.apartmentId, query.periodLabel);
  return (await loadAll(store, 'periodClose', PeriodCloseSchema)).records.find((c) => c.id === id);
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
  if (!check.ok) return { status: 'refused', reason: 'cannot-close', missing: check.missing };
  // R3: an apartment with a supply of the shared TARI notice closes only after the December
  // notice inside the period is debited (a real match, not assumed), so that the September share
  // of that notice does not open the period again (F4, decided by user1 on 18 Nov 2026).
  const shared = (await loadAll(store, 'supply', SupplySchema)).records.some((supply) =>
    supply.apartments.some((a) => a.apartmentId === query.apartmentId),
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
  const id = periodCloseId(query.apartmentId, query.periodLabel);
  const before = (
    await loadAll(store, 'periodClose', PeriodCloseSchema, { includeDeleted: true })
  ).records.find((c) => c.id === id);
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
    snapshot: snapshotOf(result),
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
  return { status: 'closed', operationId: operation.id, closeId: id };
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
  const close = await liveClose(store, query);
  if (close === undefined) return { status: 'open' };
  return closingOf(close, calc.result, calc.input, asOf);
}
