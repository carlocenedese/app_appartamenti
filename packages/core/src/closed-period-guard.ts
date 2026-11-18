/**
 * F5 (decided by user1 on 18 Nov 2026): while a settlement period is closed, what existed at its
 * closing and touches it cannot change until the period is reopened with a reason. `commitChange`
 * (every write, the undo too) and `undoOperation` (before the first write of a cascade) call
 * `refuseClosedPeriodChanges`. A record created after the closing (a late bill, a new movement, a
 * new payment or match for an item that was pending) is accepted and goes into the supplementary
 * settlement; a new tenancy or contract inside the period is refused too (prudent: it would change
 * the presences of the snapshot).
 *
 * Each guarded kind is compared through what the period sees of it (`viewIn`), so a change outside
 * the closed months (the end of a stay in a later year, the path of a PDF) passes. Imports only
 * `model`, `store` and `time`: `journal.ts` calls it.
 */
import type { Operation } from './journal';
import { PeriodCloseSchema } from './model';
import type { PeriodClose } from './model';
import { loadAll } from './store/load';
import type { Store } from './store/store';
import { compareTimestamps } from './time';

/** Thrown, writing nothing, by a write that would change what a closed period counted (F5). */
export class ClosedPeriodError extends Error {
  readonly path: string;
  readonly apartmentId: string;
  readonly periodLabel: string;

  constructor(path: string, apartmentId: string, periodLabel: string) {
    super(
      `Il periodo di conguaglio ${periodLabel} dell'appartamento ${apartmentId} è chiuso: ` +
        'questa modifica cambierebbe ciò che conteneva alla chiusura. Per farla riapri il ' +
        'periodo con il motivo («riapri-periodo»).',
    );
    this.name = 'ClosedPeriodError';
    this.path = path;
    this.apartmentId = apartmentId;
    this.periodLabel = periodLabel;
  }
}

type Json = Record<string, unknown>;
type Change = { path: string; before?: unknown; after?: unknown };

const GUARDED = new Set([
  'tenancy',
  'contract',
  'bill',
  'instalment',
  'payment',
  'match',
  'tenantRecovery',
]);
/** Refused even when the record is new: they change the presences and rents of the snapshot. */
const NEW_REFUSED = new Set(['tenancy', 'contract']);

const kindOf = (path: string): string | undefined =>
  /^_app\/dati\/([^/]+)\/[^/]+\.json$/.exec(path)?.[1];

const isLive = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && (value as Json).deleted !== true;

const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const max = (a: string, b: string): string => (a > b ? a : b);
const min = (a: string, b: string): string => (a < b ? a : b);
const pick = (record: Json, keys: readonly string[]): Json =>
  Object.fromEntries(keys.filter((k) => record[k] !== undefined).map((k) => [k, record[k]]));

/**
 * What the closed period sees of a record, as a JSON text, or `undefined` when the record is
 * absent, deleted, of another apartment or outside the period. Months are `YYYY-MM` texts.
 */
async function viewIn(
  store: Store,
  kind: string,
  value: unknown,
  close: PeriodClose,
): Promise<string | undefined> {
  if (!isLive(value)) return undefined;
  const { from, to } = close;
  const overlaps = (start: string, end: string) => start <= to && end >= from;
  const inside = (month: string) => from <= month && month <= to;
  let item: unknown;
  if (kind === 'match') {
    item = await store.readJson(`_app/dati/${str(value.itemType)}/${str(value.itemId)}.json`);
    if (!isLive(item) || item.apartmentId !== close.apartmentId) return undefined;
  } else if (value.apartmentId !== close.apartmentId) {
    return undefined;
  }
  let view: Json | undefined;
  switch (kind) {
    case 'tenancy': {
      const end = str(value.to) || '9999-12';
      if (!overlaps(str(value.from), end)) break;
      view = {
        ...pick(value, ['tenantId', 'room', 'monthlyRent', 'monthlyForfait']),
        from: max(str(value.from), from),
        to: min(end, to),
      };
      break;
    }
    case 'contract': {
      const start = max(str(value.start), from);
      const end = min(str(value.end), to);
      if (start > end) break;
      // The rent entries that hold inside the months, the first one from `start`.
      const rent = (Array.isArray(value.rent) ? (value.rent as Json[]) : [])
        .filter((e) => str(e.from) <= end)
        .sort((a, b) => (str(a.from) < str(b.from) ? -1 : 1));
      const first = rent.filter((e) => str(e.from) <= start).length - 1;
      view = {
        ...pick(value, ['type', 'settlement']),
        start,
        end,
        rent: rent.slice(Math.max(first, 0)).map((e) => ({ ...e, from: max(str(e.from), start) })),
        takeovers: (Array.isArray(value.takeovers) ? (value.takeovers as Json[]) : []).filter((t) =>
          inside(str(t.month)),
        ),
      };
      break;
    }
    case 'bill':
      if (!overlaps(str(value.periodStart).slice(0, 7), str(value.periodEnd).slice(0, 7))) break;
      view = pick(value, [
        'category',
        'amount',
        'periodStart',
        'periodEnd',
        'includedInConguaglio',
        'sharedWithTenants',
      ]);
      break;
    case 'instalment':
      if (!overlaps(str(value.coversFrom), str(value.coversTo))) break;
      view = Object.fromEntries(
        Object.entries(value).filter(([k]) => !['rev', 'fileHash', 'fileDocument'].includes(k)),
      );
      break;
    case 'payment':
      // A deposit is not part of the settlement of the period.
      if (value.kind === 'caparra') break;
      if (!inside(str(value.forMonth) || str(value.date).slice(0, 7))) break;
      view = pick(value, [
        'tenantId',
        'date',
        'amount',
        'confirmed',
        'kind',
        'forMonth',
        'transactionId',
      ]);
      break;
    case 'match': {
      const counted = item as Json;
      const months =
        value.itemType === 'bill'
          ? [str(counted.periodStart).slice(0, 7), str(counted.periodEnd).slice(0, 7)]
          : [str(counted.coversFrom), str(counted.coversTo)];
      const [start = '', end = ''] = months;
      if (!overlaps(start, end) && !inside(str(value.transactionDate).slice(0, 7))) break;
      view = pick(value, [
        'itemType',
        'itemId',
        'transactionId',
        'transactionDate',
        'amount',
        'part',
        'confirmed',
        'by',
      ]);
      break;
    }
    case 'tenantRecovery': {
      const own =
        value.periodLabel === undefined
          ? inside(str(value.date).slice(0, 7))
          : value.periodLabel === close.periodLabel;
      if (!own) break;
      view = {
        ...pick(value, [
          'instalmentId',
          'transactionId',
          'amount',
          'shares',
          'periodLabel',
          'date',
        ]),
        // Only `non-recuperabile` changes the settlement.
        lost: value.status === 'non-recuperabile',
      };
      break;
    }
  }
  return view === undefined ? undefined : JSON.stringify(view);
}

/**
 * Whether the record at `path` was live when the period was closed (`closedAt`): the last change
 * the journal has for it up to that time left it live. A record no operation touched predates the
 * journal and counts as there when it exists (`before`).
 */
function existedAt(
  operations: readonly Operation[],
  path: string,
  closedAt: string,
  before: unknown,
): boolean {
  // shortcut: compares the clocks of the operations with closedAt, so a computer whose clock is
  // minutes off can misjudge a record made just around the closing; upgrade with an operation id.
  let touched = false;
  let last: unknown;
  for (const operation of operations) {
    const change = operation.changes.find((c) => c.path === path);
    if (change === undefined) continue;
    touched = true;
    if (compareTimestamps(operation.at, closedAt) <= 0) last = change.after;
  }
  return touched ? isLive(last) : before !== undefined;
}

/**
 * Throws `ClosedPeriodError` if a change would alter what a closed period (a live closing, not
 * reopened) counted: a record of a guarded kind that existed at the closing (or a new tenancy or
 * contract) whose view of the period differs before and after. `operations` is the journal, in
 * time order. Returns at once when no change is of a guarded kind or no period is closed.
 */
export async function refuseClosedPeriodChanges(
  store: Store,
  operations: readonly Operation[],
  changes: readonly Change[],
): Promise<void> {
  const guarded = changes.filter((c) => GUARDED.has(kindOf(c.path) ?? ''));
  if (guarded.length === 0) return;
  const closes = (await loadAll(store, 'periodClose', PeriodCloseSchema)).records.filter(
    (c) => c.reopened === undefined,
  );
  if (closes.length === 0) return;
  for (const change of guarded) {
    const kind = kindOf(change.path) ?? '';
    for (const close of closes) {
      const was = await viewIn(store, kind, change.before, close);
      const will = await viewIn(store, kind, change.after, close);
      if (was === will) continue;
      if (
        !NEW_REFUSED.has(kind) &&
        !existedAt(operations, change.path, close.closedAt, change.before)
      ) {
        continue;
      }
      throw new ClosedPeriodError(change.path, close.apartmentId, close.periodLabel);
    }
  }
}
