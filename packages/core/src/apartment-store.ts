/**
 * Creating and updating an apartment (plan 8, task 2, R191): the condominium setting
 * `condoDifferenceTo` is asked at creation. One `apartment.save` operation, nothing written while
 * `checkConsistency` reports a problem, nothing for the same request on the same state.
 */
import { SettlementInputError, checkBeds, isPresent } from './conguaglio';
import type { SettlementInputErrorCode } from './conguaglio';
import { commitChange, writesBlocked } from './journal';
import { ApartmentSchema, TenancySchema } from './model';
import type { Apartment, Tenancy } from './model';
import { addMonths } from './period';
import type { YearMonth } from './period';
import { isSafePath, loadAll } from './store/load';
import { recordPath } from './store/records';
import { liveSupplies, sameCode } from './supply-store';
import type { Store } from './store/store';
import { compareText } from './text';
import { bedsAt, datedChange } from './valid-from';

type DataFields = Omit<Apartment, 'id' | 'v' | 'rev' | 'deleted'>;
export type SaveApartmentInput = { id: string } & Partial<DataFields> & {
    /**
     * Plan 22: the month the new `posti` and `rooms` hold from («valido dal»); before it the old
     * ones stay (`earlierBeds`). Without it the change holds from always, as before.
     */
    bedsValidFrom?: YearMonth;
  };

export type SaveApartmentResult =
  | { status: 'created' | 'updated'; operationId: string; apartmentId: string }
  | { status: 'unchanged'; apartmentId: string }
  | {
      status: 'refused';
      reason:
        | 'inconsistent-store'
        | 'missing-fields'
        | 'invalid-apartment'
        | 'needs-confirmation'
        /** Plan 22: `bedsValidFrom` before the month of the last change (undo that first). */
        | 'valid-from-order';
    }
  | ({ status: 'refused' } & BedsConflict)
  /** F12: a live supply of the apartment has a code the new codes leave out (its ids). */
  | { status: 'refused'; reason: 'codes-in-use'; supplyIds: string[] };

/**
 * Why the live stays no longer fit an apartment whose beds changed (review of 18 Nov 2026, U13):
 * `rooms-in-use`, the rooms of live stays it no longer has (sorted, with those stays); otherwise
 * `beds-conflict`, what `checkBeds` (so `calcConguaglio`) would throw, at its first month.
 */
export type BedsConflict =
  | { reason: 'rooms-in-use'; rooms: string[]; tenancyIds: string[] }
  | {
      reason: 'beds-conflict';
      code: SettlementInputErrorCode;
      month?: YearMonth;
      tenancyIds: string[];
    };

/** The conflict of the live `tenancies` with `apartment` as it would be (see `BedsConflict`). */
export function bedsConflictOf(
  apartment: Apartment,
  tenancies: readonly Tenancy[],
): BedsConflict | undefined {
  const own = tenancies.filter((t) => t.deleted !== true && t.apartmentId === apartment.id);
  // Every overlap begins in the first month of some stay or of some beds (plan 22).
  const months = [
    ...new Set([
      ...own.map((t) => t.from),
      ...(apartment.earlierBeds ?? []).map((e) => addMonths(e.to, 1)),
    ]),
  ].sort(compareText);
  const lost = own.filter((t) =>
    months.some((m) => {
      const { rooms } = bedsAt(apartment, m);
      return (
        isPresent(t, m) && rooms !== undefined && t.room !== undefined && !rooms.includes(t.room)
      );
    }),
  );
  if (lost.length > 0) {
    return {
      reason: 'rooms-in-use',
      rooms: [...new Set(lost.map((t) => t.room ?? ''))].sort(compareText),
      tenancyIds: lost.map((t) => t.id).sort(compareText),
    };
  }
  try {
    checkBeds(apartment, own, months);
    return undefined;
  } catch (error) {
    if (!(error instanceof SettlementInputError)) throw error;
    return {
      reason: 'beds-conflict',
      code: error.code,
      ...(error.month === undefined ? {} : { month: error.month }),
      tenancyIds: error.tenancyIds ?? [],
    };
  }
}

/** Required to create one: `condoDifferenceTo` is the question asked at creation. */
const CREATE_FIELDS = [
  'name',
  'locatore',
  'posti',
  'annualitaStart',
  'condoDifferenceTo',
] as const satisfies readonly (keyof DataFields)[];

/**
 * Creates `input.id` (`created`; every field of `CREATE_FIELDS` needed, else `missing-fields`) or
 * updates it (`updated`): the fields given replace the stored ones, the others stay. A deleted
 * apartment comes back with its old fields (`created`). `invalid-apartment` when the id is not a
 * safe file name part or the schema refuses the result; changing `posti` or `annualitaStart` of a
 * live apartment needs `options.confirmed` (`needs-confirmation`: they change every settlement).
 * Changing `rooms` or `posti` of a live apartment under live stays that would no longer fit is
 * refused with `bedsConflictOf` (`rooms-in-use` or `beds-conflict`, with the stays).
 */
export async function saveApartment(
  store: Store,
  input: SaveApartmentInput,
  profileId: string,
  clock: () => string,
  newId: () => string,
  options: { confirmed?: boolean } = {},
): Promise<SaveApartmentResult> {
  const refuse = (
    reason:
      | 'inconsistent-store'
      | 'missing-fields'
      | 'invalid-apartment'
      | 'needs-confirmation'
      | 'valid-from-order',
  ) => ({ status: 'refused', reason }) as const;
  if (await writesBlocked(store)) return refuse('inconsistent-store');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(input.id) || !isSafePath(input.id)) {
    return refuse('invalid-apartment'); // isSafePath: no CON, NUL, COM1 (Windows device names)
  }
  const all = (await loadAll(store, 'apartment', ApartmentSchema, { includeDeleted: true }))
    .records;
  const before = all.find((a) => a.id === input.id);
  // `nord` next to `Nord` is the same file on macOS and Windows.
  const lower = input.id.toLowerCase();
  if (before === undefined && all.some((a) => a.id.toLowerCase() === lower)) {
    return refuse('invalid-apartment');
  }
  const live = before !== undefined && before.deleted !== true;
  const { bedsValidFrom, ...fields } = input;
  const given: Partial<DataFields> = Object.fromEntries(
    Object.entries(fields).filter(([, v]) => v !== undefined),
  );
  const kept = Object.fromEntries(
    Object.entries(before ?? {}).filter(([key]) => key !== 'deleted'),
  ) as Partial<DataFields>;
  let merged = { ...kept, ...given };
  // Plan 22: new beds from a month keep the old ones before it.
  if (
    live &&
    bedsValidFrom !== undefined &&
    (merged.posti !== before.posti || JSON.stringify(merged.rooms) !== JSON.stringify(before.rooms))
  ) {
    const earlierBeds = datedChange(
      before.earlierBeds,
      bedsValidFrom,
      before.rooms === undefined
        ? { posti: before.posti }
        : { posti: before.posti, rooms: before.rooms },
    );
    if (earlierBeds === undefined) return refuse('valid-from-order');
    merged = { ...merged, earlierBeds };
  }
  if (!live && CREATE_FIELDS.some((field) => merged[field] === undefined)) {
    return refuse('missing-fields');
  }
  if (
    live &&
    options.confirmed !== true &&
    ((given.posti !== undefined && given.posti !== before.posti) ||
      (given.annualitaStart !== undefined &&
        JSON.stringify(given.annualitaStart) !== JSON.stringify(before.annualitaStart)))
  ) {
    return refuse('needs-confirmation');
  }
  const parsed = ApartmentSchema.safeParse({
    ...merged,
    v: 1,
    rev: (before?.rev ?? 0) + 1,
  });
  if (!parsed.success) return refuse('invalid-apartment');
  const after = parsed.data;
  if (
    live &&
    (after.posti !== before.posti ||
      JSON.stringify(after.rooms) !== JSON.stringify(before.rooms) ||
      JSON.stringify(after.earlierBeds) !== JSON.stringify(before.earlierBeds))
  ) {
    const tenancies = (await loadAll(store, 'tenancy', TenancySchema)).records;
    const conflict = bedsConflictOf(after, tenancies);
    if (conflict !== undefined) return { status: 'refused', ...conflict };
  }
  if (live && JSON.stringify({ ...after, rev: before.rev }) === JSON.stringify(before)) {
    return { status: 'unchanged', apartmentId: input.id };
  }
  // F12 (plan 25): the codes of a live supply of the apartment stay among the apartment's codes.
  if (live && JSON.stringify(after.supplyCodes) !== JSON.stringify(before.supplyCodes)) {
    const used = (await liveSupplies(store))
      .filter((s) => s.apartments.some((a) => a.apartmentId === input.id))
      .filter((s) =>
        (s.supplyCodes ?? []).some(
          (c) => !(after.supplyCodes ?? []).some((own) => sameCode(own, c)),
        ),
      )
      .map((s) => s.id)
      .sort();
    if (used.length > 0) return { status: 'refused', reason: 'codes-in-use', supplyIds: used };
  }
  const operation = await commitChange(
    store,
    {
      profileId,
      kind: 'apartment.save',
      apartmentId: input.id,
      summary: 'Appartamento salvato.',
      changes: [{ path: recordPath('apartment', input.id), before, after }],
    },
    clock,
    newId,
  );
  return { status: live ? 'updated' : 'created', operationId: operation.id, apartmentId: input.id };
}
