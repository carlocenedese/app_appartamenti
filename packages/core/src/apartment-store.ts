/**
 * Creating and updating an apartment (plan 8, task 2, R191): the condominium setting
 * `condoDifferenceTo` is asked at creation. One `apartment.save` operation, nothing written while
 * `checkConsistency` reports a problem, nothing for the same request on the same state.
 */
import { checkConsistency, commitChange } from './journal';
import { ApartmentSchema } from './model';
import type { Apartment } from './model';
import { loadAll } from './store/load';
import { recordPath } from './store/records';
import type { Store } from './store/store';

type DataFields = Omit<Apartment, 'id' | 'v' | 'rev' | 'deleted'>;
export type SaveApartmentInput = { id: string } & Partial<DataFields>;

export type SaveApartmentResult =
  | { status: 'saved'; operationId: string; apartmentId: string }
  | { status: 'unchanged'; apartmentId: string }
  | {
      status: 'refused';
      reason: 'inconsistent-store' | 'missing-fields' | 'invalid-apartment';
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
 * Creates `input.id` (every field of `CREATE_FIELDS` needed, else `missing-fields`) or updates it:
 * the fields given replace the stored ones, the others stay. A deleted apartment comes back.
 * `invalid-apartment` when the schema refuses the result.
 */
export async function saveApartment(
  store: Store,
  input: SaveApartmentInput,
  profileId: string,
  clock: () => string,
  newId: () => string,
): Promise<SaveApartmentResult> {
  const refuse = (reason: Extract<SaveApartmentResult, { status: 'refused' }>['reason']) =>
    ({ status: 'refused', reason }) as const;
  if ((await checkConsistency(store)).length > 0) return refuse('inconsistent-store');
  const all = (await loadAll(store, 'apartment', ApartmentSchema, { includeDeleted: true }))
    .records;
  const before = all.find((a) => a.id === input.id);
  const live = before !== undefined && before.deleted !== true;
  if (!live && CREATE_FIELDS.some((field) => input[field] === undefined)) {
    return refuse('missing-fields');
  }
  const given = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
  const parsed = ApartmentSchema.safeParse({
    ...(live ? before : {}),
    ...given,
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
  return { status: 'saved', operationId: operation.id, apartmentId: input.id };
}
