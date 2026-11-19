/**
 * F5 (decided by user1 on 18 Nov 2026): while a settlement period is closed, what existed at its
 * closing and touches it cannot change until the period is reopened with a reason. `commitChange`
 * (every write, the undo too), `undoOperation` and `undoFile` (before their first write) call
 * `refuseClosedPeriodChanges`. A record created after the closing (a late bill, a new movement, a
 * new payment or match for an item that was pending) is accepted and goes into the supplementary
 * settlement. Refused even when new: a tenancy, a contract or a supply of the apartment inside
 * the period (they change the presences, rents or shares of the snapshot, answers A and B of
 * user1). The apartment itself (beds, start of the year, condominium settings) cannot change
 * while one of its periods is closed (answer B): those fields have no date, so a change reaches
 * every period; beds and weights with a start month (plan 22) are compared month by month. A movement and its class that back a match or a recovery of the period are
 * guarded too (answer J).
 *
 * Each guarded kind is compared through what the period sees of it (`viewIn`), so a change outside
 * the closed months (the end of a stay in a later year, the path of a PDF) passes. Whether a
 * record existed at the closing is read from the closing's `inputs` (`periodInputs`), not from the
 * clocks. Imports nothing that imports `journal.ts`: `journal.ts` calls it.
 */
import { settlementPeriodOf } from './conguaglio';
import type { Operation } from './journal';
import { ApartmentSchema, ContractSchema, PeriodCloseSchema } from './model';
import type { Apartment, PeriodClose, Supply } from './model';
import { settlementPeriods } from './period';
import type { YearMonth } from './period';
import { loadAll } from './store/load';
import type { Store } from './store/store';
import { compareText } from './text';
import { compareTimestamps } from './time';
import { bedsOver, weightsOver } from './valid-from';

/** Thrown, writing nothing, by a write that would change what a closed period counted (F5). */
export class ClosedPeriodError extends Error {
  readonly path: string;
  readonly apartmentId: string;
  readonly periodLabel: string;

  /** Every closed period to reopen (a field of the apartment without a date reaches them all). */
  readonly periodLabels: string[];

  /** `others` (a field of the apartment): the message lists every closed period to reopen. */
  constructor(path: string, apartmentId: string, periodLabel: string, others?: string[]) {
    const labels = [periodLabel, ...(others ?? [])];
    super(
      others === undefined
        ? `Il periodo di conguaglio ${periodLabel} dell'appartamento ${apartmentId} è chiuso: ` +
            `questa modifica (${path}) cambierebbe ciò che conteneva alla chiusura. Per farla ` +
            'riapri il periodo con il motivo («riapri-periodo»).'
        : `L'appartamento ${apartmentId} ha periodi di conguaglio chiusi e questa modifica ` +
            `(${path}) vale per tutti. Per farla riapri con il motivo («riapri-periodo») i ` +
            `periodi chiusi dell'appartamento: ${labels.join(', ')}.`,
    );
    this.name = 'ClosedPeriodError';
    this.path = path;
    this.apartmentId = apartmentId;
    this.periodLabel = periodLabel;
    this.periodLabels = labels;
  }
}

/**
 * Thrown by `undoOperation`, writing nothing, when undoing a closing or a reopening would close a
 * period without a new snapshot (finding 9): `closing-changed`, `reopen-changed`, or
 * `closing-unknown` when the settlement cannot be computed now.
 */
export class ClosingUndoError extends Error {
  constructor(
    readonly reason: 'closing-changed' | 'reopen-changed' | 'closing-unknown',
    readonly apartmentId: string,
    readonly periodLabel: string,
  ) {
    super(
      reason === 'closing-unknown'
        ? `Il conguaglio del periodo ${periodLabel} dell'appartamento ${apartmentId} ora non si ` +
            'calcola: correggere prima i dati del periodo.'
        : `Il periodo ${periodLabel} dell'appartamento ${apartmentId} è cambiato dopo la ` +
            (reason === 'reopen-changed'
              ? 'riapertura: chiuderlo di nuovo con «chiudi-periodo».'
              : 'chiusura: riaprirlo con il motivo («riapri-periodo»).'),
    );
    this.name = 'ClosingUndoError';
  }
}

type Json = Record<string, unknown>;
type Change = { path: string; before?: unknown; after?: unknown };
type Close = { apartmentId: string; periodLabel: string; from: string; to: string } & Partial<
  Pick<PeriodClose, 'closedAt' | 'inputs'>
>;
type Span = { from: YearMonth; to: YearMonth };

/** The kinds a closed period guards, in the order `periodInputs` reads them. */
const GUARDED: readonly string[] = [
  'apartment',
  'supply',
  'tenancy',
  'contract',
  'bill',
  'instalment',
  'payment',
  'match',
  'tenantRecovery',
  'transaction',
  'movementClass',
];
/**
 * Refused even when the record is new: they change the presences or rents. A new supply is always
 * accepted (finding 2 of the third review: linking the code of a new bill is routine).
 */
const NEW_REFUSED = new Set(['apartment', 'tenancy', 'contract']);

const kindOf = (path: string): string | undefined =>
  /^_app\/dati\/([^/]+)\/[^/]+\.json$/.exec(path)?.[1];
const idOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1, -'.json'.length);

const isLive = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && (value as Json).deleted !== true;

const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const max = (a: string, b: string): string => (a > b ? a : b);
const min = (a: string, b: string): string => (a < b ? a : b);
const pick = (record: Json, keys: readonly string[]): Json =>
  Object.fromEntries(keys.filter((k) => record[k] !== undefined).map((k) => [k, record[k]]));

/** A record file as it is on disk, `undefined` when it cannot be read. */
const readRaw = (store: Store, path: string): Promise<unknown> =>
  store.readJson(path).catch(() => undefined);

/** The live records of a kind, read raw. */
async function liveRaw(store: Store, kind: string): Promise<Json[]> {
  const names = (await store.list(`_app/dati/${kind}`)).filter((n) => n.endsWith('.json'));
  const values = await Promise.all(names.map((n) => readRaw(store, `_app/dati/${kind}/${n}`)));
  return values.filter(isLive);
}

/** What one guard call reads once: the periods of each apartment, the matches and recoveries. */
class Context {
  private readonly spans = new Map<string, Span[]>();
  private links?: { matches: Json[]; recoveries: Json[] };
  private notices?: Json[];

  constructor(readonly store: Store) {}

  /** The settlement periods of the apartment, as the settlement reads them (R177). */
  async periodsOf(apartmentId: string): Promise<Span[]> {
    const known = this.spans.get(apartmentId);
    if (known !== undefined) return known;
    const apartment = (await loadAll(this.store, 'apartment', ApartmentSchema)).records.find(
      (a) => a.id === apartmentId,
    );
    const spans = (await loadAll(this.store, 'contract', ContractSchema)).records
      .filter((c) => c.apartmentId === apartmentId)
      .flatMap((c) => {
        if (apartment === undefined) return [];
        try {
          return settlementPeriods(c, apartment.annualitaStart);
        } catch {
          return []; // a contract without settlement periods (its checks say so)
        }
      });
    this.spans.set(apartmentId, spans);
    return spans;
  }

  /** The live instalments, for the supplies they are linked to (finding 2). */
  async instalments(): Promise<Json[]> {
    this.notices ??= await liveRaw(this.store, 'instalment');
    return this.notices;
  }

  /** The live matches and recoveries, for the movements that back them (answer J). */
  async backing(): Promise<{ matches: Json[]; recoveries: Json[] }> {
    this.links ??= {
      matches: await liveRaw(this.store, 'match'),
      recoveries: await liveRaw(this.store, 'tenantRecovery'),
    };
    return this.links;
  }
}

/**
 * What the closed period sees of a record, as a JSON text, or `undefined` when the record is
 * absent, deleted, of another apartment or outside the period. Months are `YYYY-MM` texts.
 */
async function viewIn(
  ctx: Context,
  kind: string,
  value: unknown,
  close: Close,
): Promise<string | undefined> {
  if (!isLive(value)) return undefined;
  const { from, to } = close;
  const overlaps = (start: string, end: string) => start <= to && end >= from;
  const inside = (month: string) => from <= month && month <= to;
  /** The month's settlement period is this one (`settlementPeriodOf`, R177). */
  const home = async (month: string) => {
    const span = settlementPeriodOf(month as YearMonth, await ctx.periodsOf(close.apartmentId));
    return span === undefined ? inside(month) : span.from === from && span.to === to;
  };
  let view: Json | undefined;
  switch (kind) {
    case 'apartment':
      if (value.id !== close.apartmentId) break;
      view = {
        ...pick(value, ['annualitaStart', 'condominioStart', 'condoDifferenceTo']),
        // Plan 22: the beds in force in the months of the period («valido dal»).
        beds: bedsOver(value as Pick<Apartment, 'posti' | 'rooms' | 'earlierBeds'>, from, to),
      };
      break;
    case 'supply': {
      // Only a supply that a notice counted in the period is linked to (finding 2).
      let linked = false;
      for (const notice of await ctx.instalments()) {
        if (linked || notice.supplyId !== value.id) continue;
        linked = (await viewIn(ctx, 'instalment', notice, close)) !== undefined;
      }
      if (!linked) break;
      // Plan 22: the weights in force in the months of the period («valido dal»).
      const sorted = (rows: readonly Json[]) =>
        [...rows].sort((a, b) => compareText(str(a.apartmentId), str(b.apartmentId)));
      view = {
        apartments: weightsOver(
          {
            apartments: Array.isArray(value.apartments)
              ? (value.apartments as Supply['apartments'])
              : [],
            ...(Array.isArray(value.earlierApartments)
              ? {
                  earlierApartments: value.earlierApartments as NonNullable<
                    Supply['earlierApartments']
                  >,
                }
              : {}),
          },
          from,
          to,
        ).map((s) => ({ ...s, value: sorted(s.value) })),
      };
      break;
    }
    case 'tenancy': {
      if (value.apartmentId !== close.apartmentId) break;
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
      if (value.apartmentId !== close.apartmentId) break;
      const start = max(str(value.start), from);
      const end = min(str(value.end), to);
      if (start > end) break;
      // The rent entries that hold inside the months, the first one from `start`.
      const rent = (Array.isArray(value.rent) ? (value.rent as Json[]) : [])
        .filter((e) => str(e.from) <= end)
        .sort((a, b) => compareText(str(a.from), str(b.from)));
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
      if (value.apartmentId !== close.apartmentId) break;
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
      if (value.apartmentId !== close.apartmentId) break;
      if (!overlaps(str(value.coversFrom), str(value.coversTo))) break;
      view = Object.fromEntries(
        Object.entries(value).filter(([k]) => !['rev', 'fileHash', 'fileDocument'].includes(k)),
      );
      break;
    case 'payment':
      if (value.apartmentId !== close.apartmentId) break;
      // A deposit is not part of the settlement of the period.
      if (value.kind === 'caparra') break;
      // By the month given, else by the period of its date, as the settlement (R172, R177).
      if (
        value.forMonth === undefined
          ? !(await home(str(value.date).slice(0, 7)))
          : !inside(str(value.forMonth))
      ) {
        break;
      }
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
      const item = await readRaw(
        ctx.store,
        `_app/dati/${str(value.itemType)}/${str(value.itemId)}.json`,
      );
      if (!isLive(item) || item.apartmentId !== close.apartmentId) break;
      const [start, end] =
        value.itemType === 'bill'
          ? [str(item.periodStart).slice(0, 7), str(item.periodEnd).slice(0, 7)]
          : [str(item.coversFrom), str(item.coversTo)];
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
      if (value.apartmentId !== close.apartmentId) break;
      const own =
        value.periodLabel === undefined
          ? value.date !== undefined && (await home(str(value.date).slice(0, 7)))
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
    case 'transaction':
    case 'movementClass': {
      // Answer J: the movement (or its class) that backs a match or a recovery of the period.
      const txId = kind === 'transaction' ? str(value.id) : str(value.transactionId);
      const { matches, recoveries } = await ctx.backing();
      let backs = false;
      for (const [linkKind, links] of [
        ['match', matches],
        ['tenantRecovery', recoveries],
      ] as const) {
        for (const link of links) {
          if (backs || link.transactionId !== txId) continue;
          backs = (await viewIn(ctx, linkKind, link, close)) !== undefined;
        }
      }
      if (!backs) break;
      view =
        kind === 'transaction'
          ? pick(value, ['date', 'amount', 'booked', 'apartmentId'])
          : pick(value, ['kind', 'apartmentId']);
      break;
    }
  }
  return view === undefined ? undefined : JSON.stringify(view);
}

/**
 * The records a closing counts, as sorted `<kind>/<id>` (stored as `periodClose.inputs`): every
 * live record of a guarded kind that the period sees. A record is in it exactly when it was in the
 * folder when the snapshot was computed, whatever the clocks say: an operation of another
 * computer that arrives after the closing was not, and counts as new.
 */
export async function periodInputs(store: Store, close: Close): Promise<string[]> {
  const ctx = new Context(store);
  const inputs: string[] = [];
  for (const kind of GUARDED) {
    for (const value of await liveRaw(store, kind)) {
      if ((await viewIn(ctx, kind, value, close)) !== undefined) {
        inputs.push(`${kind}/${str(value.id)}`);
      }
    }
  }
  return inputs.sort(compareText);
}

/**
 * Whether the record at `path` existed when the period was closed. With `inputs` (every closing
 * written since round 2 of plan 20) it is exact: the records the snapshot counted. Without them (a
 * closing written before) the journal's clocks decide: the last change up to `closedAt` left it
 * live, or, when no change is that old, the first change found it there (a record older than the
 * journal). shortcut: the clocks of two computers can differ, so this fallback can misjudge a
 * record made around the closing; it holds only for closings written before `inputs` existed.
 */
function existedAt(
  operations: readonly Operation[],
  path: string,
  close: Close,
  before: unknown,
): boolean {
  if (close.inputs !== undefined) return close.inputs.includes(`${kindOf(path)}/${idOf(path)}`);
  const touches = operations.flatMap((operation) =>
    operation.changes
      .filter((c) => c.path === path)
      .map((c) => ({ at: operation.at, before: c.before, after: c.after })),
  );
  if (touches.length === 0) return before !== undefined;
  const earlier = touches.filter((t) => compareTimestamps(t.at, close.closedAt ?? '') <= 0);
  const last = earlier.at(-1);
  return last === undefined ? isLive(touches[0]?.before) : isLive(last.after);
}

/** The closes to guard: the live ones, and those that cannot be read safely (forked, damaged). */
async function guardedCloses(
  store: Store,
  forked: ReadonlySet<string>,
): Promise<{ closes: Close[]; blocking: Close[] }> {
  const loaded = await loadAll(store, 'periodClose', PeriodCloseSchema, { tolerant: true });
  const bad = new Set([
    ...loaded.missing.map((p) => p.path),
    ...[...forked].filter((path) => path.startsWith('_app/dati/periodClose/')),
  ]);
  const closes = loaded.records.filter(
    (c) => c.reopened === undefined && !bad.has(`_app/dati/periodClose/${c.id}.json`),
  );
  // Finding 6: a forked or damaged closing blocks every guarded change that touches its apartment
  // and months (which version is right is not known), and nothing else; one whose content cannot
  // be read at all blocks every guarded change.
  const blocking: Close[] = [];
  for (const path of [...bad].sort(compareText)) {
    const parsed = PeriodCloseSchema.safeParse(await readRaw(store, path));
    blocking.push(
      parsed.success
        ? parsed.data
        : { apartmentId: '', periodLabel: idOf(path), from: '0000-01', to: '9999-12' },
    );
  }
  return { closes, blocking };
}

/**
 * Throws `ClosedPeriodError` if a change would alter what a closed period (a live closing, not
 * reopened) counted: a record of a guarded kind that existed at the closing (or a new tenancy,
 * contract or supply) whose view of the period differs before and after. `operations` is the
 * journal, in time order; `forked` the paths it leaves forked. Returns at once when no change is
 * of a guarded kind or nothing is closed.
 */
export async function refuseClosedPeriodChanges(
  store: Store,
  operations: readonly Operation[],
  changes: readonly Change[],
  forked: ReadonlySet<string> = new Set(),
): Promise<void> {
  const guarded = changes.filter((c) => GUARDED.includes(kindOf(c.path) ?? ''));
  if (guarded.length === 0) return;
  const { closes, blocking } = await guardedCloses(store, forked);
  if (closes.length === 0 && blocking.length === 0) return;
  const ctx = new Context(store);
  for (const change of guarded) {
    const kind = kindOf(change.path) ?? '';
    for (const close of blocking) {
      const touches =
        close.apartmentId === '' ||
        (await viewIn(ctx, kind, change.before, close)) !== undefined ||
        (await viewIn(ctx, kind, change.after, close)) !== undefined;
      if (touches) throw new ClosedPeriodError(change.path, close.apartmentId, close.periodLabel);
    }
    const refusing: Close[] = [];
    for (const close of closes) {
      const was = await viewIn(ctx, kind, change.before, close);
      const will = await viewIn(ctx, kind, change.after, close);
      if (was === will) continue;
      if (!NEW_REFUSED.has(kind) && !existedAt(operations, change.path, close, change.before)) {
        continue;
      }
      refusing.push(close);
    }
    const [first, ...others] = refusing.sort((a, b) => compareText(a.from, b.from));
    if (first !== undefined) {
      // A field of the apartment reaches every closed period: the message names them all.
      throw new ClosedPeriodError(
        change.path,
        first.apartmentId,
        first.periodLabel,
        kind === 'apartment' ? others.map((c) => c.periodLabel) : undefined,
      );
    }
  }
}
