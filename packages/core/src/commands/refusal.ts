import { isLiveClose } from '../closing';
import { ClosedPeriodError } from '../closed-period-guard';
import { InconsistentRecordError } from '../journal';
import { PeriodCloseSchema } from '../model';
import type { ISODate } from '../period';
import { loadPeriodClosing } from '../period-close';
import { UnreadableRecordsError, loadAll } from '../store/load';
import { FileAccessError, NewerDataError } from '../store/store';
import type { Store } from '../store/store';
import { COMMAND_MESSAGES } from './messages';
import { CommandStop } from './stop';

/** The output of a command stopped by a `CommandStop`: status, reason, message and its fields. */
export function stopBody(stop: CommandStop): Record<string, unknown> {
  return {
    status: stop.status,
    reason: stop.reason,
    message: COMMAND_MESSAGES[stop.reason],
    ...stop.extra,
  };
}

/**
 * The typed refusals of the core as a `rejected` output (relative paths and ids only, revisione
 * 2026-11-18); `undefined` for any other error, which is a failure (never its message or stack:
 * they could hold a path or a value).
 */
export function commandRefusal(error: unknown): Record<string, unknown> | undefined {
  const refusal =
    error instanceof NewerDataError || error instanceof FileAccessError
      ? {
          reason: error instanceof NewerDataError ? 'newer-data' : 'file-access',
          paths: [error.path],
        }
      : error instanceof InconsistentRecordError
        ? { reason: 'inconsistent-record', paths: [error.path], state: error.reason }
        : error instanceof ClosedPeriodError
          ? {
              reason: 'closed-period',
              paths: [error.path],
              apartmentId: error.apartmentId,
              periodLabel: error.periodLabel,
            }
          : error instanceof UnreadableRecordsError
            ? { reason: 'unreadable-records', paths: error.records.map((r) => r.path) }
            : undefined;
  if (refusal === undefined) return undefined;
  // The core's text for unreadable records names the ids and, for a fork, «scegli-versione».
  const message =
    error instanceof UnreadableRecordsError || error instanceof ClosedPeriodError
      ? error.message
      : COMMAND_MESSAGES[refusal.reason];
  return { status: 'rejected', ...refusal, message };
}

/** The output of a command that failed for an unexpected reason. */
export const FAILED_BODY = {
  status: 'failed',
  reason: 'failed',
  message: COMMAND_MESSAGES.failed,
} as const;

type ClosedStates = Map<
  string,
  { query: { apartmentId: string; periodLabel: string }; state: string }
>;

/**
 * The state of each closed settlement period (R5), by closing id, as `loadPeriodClosing` gives it:
 * compared before and after a write to warn that the write changed a closed period (review,
 * point 6). Nothing when no period is closed; a folder it cannot read gives nothing.
 */
export async function closedPeriodStates(store: Store, today: ISODate): Promise<ClosedStates> {
  const states: ClosedStates = new Map();
  try {
    // Only the periods closed now: a reopened one is open again (F3).
    const closes = (await loadAll(store, 'periodClose', PeriodCloseSchema)).records.filter(
      isLiveClose,
    );
    for (const c of closes) {
      const query = { apartmentId: c.apartmentId, periodLabel: c.periodLabel };
      states.set(c.id, {
        query,
        state: JSON.stringify(await loadPeriodClosing(store, query, today)),
      });
    }
  } catch {
    return new Map();
  }
  return states;
}

/**
 * Point 6: the fields that warn a write changed a period closed before it (never a refusal of
 * ours), or nothing.
 */
export function changedClosedPeriods(
  before: ClosedStates,
  after: ClosedStates,
):
  | { closedPeriods: { apartmentId: string; periodLabel: string }[]; closedPeriodMessage: string }
  | undefined {
  const changed = [...before]
    .filter(([id, { state }]) => after.has(id) && after.get(id)?.state !== state)
    .map(([, { query }]) => query);
  if (changed.length === 0) return undefined;
  return {
    closedPeriods: changed,
    closedPeriodMessage: COMMAND_MESSAGES['closed-period-changed'] ?? '',
  };
}
