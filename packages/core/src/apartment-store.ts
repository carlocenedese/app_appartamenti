/**
 * Creating and updating an apartment (plan 8, task 2, R191): the condominium setting
 * `condoDifferenceTo` is asked at creation. One `apartment.save` operation, nothing written while
 * `checkConsistency` reports a problem, nothing for the same request on the same state.
 */
import { checkConsistency, commitChange } from './journal';
import { ApartmentSchema } from './model';
import type { Apartment } from './model';
import { isSafePath, loadAll } from './store/load';
import { recordPath } from './store/records';
import type { Store } from './store/store';

type DataFields = Omit<Apartment, 'id' | 'v' | 'rev' | 'deleted'>;
export type SaveApartmentInput = { id: string } & Partial<DataFields>;

export type SaveApartmentResult =
  | { status: 'created' | 'updated'; operationId: string; apartmentId: string }
  | { status: 'unchanged'; apartmentId: string }
  | {
      status: 'refused';
      reason: 'inconsistent-store' | 'missing-fields' | 'invalid-apartment' | 'needs-confirmation';
    };

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
 */
export async function saveApartment(
  store: Store,
  input: SaveApartmentInput,
  profileId: string,
  clock: () => string,
  newId: () => string,
  options: { confirmed?: boolean } = {},
): Promise<SaveApartmentResult> {
  const refuse = (reason: Extract<SaveApartmentResult, { status: 'refused' }>['reason']) =>
    ({ status: 'refused', reason }) as const;
  if ((await checkConsistency(store)).length > 0) return refuse('inconsistent-store');
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
  const given: Partial<DataFields> = Object.fromEntries(
    Object.entries(input).filter(([, v]) => v !== undefined),
  );
  const kept = Object.fromEntries(
    Object.entries(before ?? {}).filter(([key]) => key !== 'deleted'),
  ) as Partial<DataFields>;
  const merged = { ...kept, ...given };
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
  if (live && JSON.stringify({ ...after, rev: before.rev }) === JSON.stringify(before)) {
    return { status: 'unchanged', apartmentId: input.id };
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
