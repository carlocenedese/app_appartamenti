/**
 * Writing and reading the condominium records (plan 8): the documents of an apartment and fiscal
 * year (`saveCondoDocument`) and the owners' check (`loadCondo`). Each write one operation of the journal, nothing written while
 * `checkConsistency` reports a problem, nothing for the same request on the same state. No amount
 * or name in a summary.
 */
import { condoCheck, condoDifferences } from './condominio';
import type { CondoCheckRow, CondoDifference } from './condominio';
import { checkConsistency, commitChange } from './journal';
import { planMatch } from './match-store';
import { ApartmentSchema, BillMatchSchema, CondoDocumentSchema, InstalmentSchema } from './model';
import type { CondoDocument } from './model';
import type { ISODate } from './period';
import { loadAll } from './store/load';
import { recordPath } from './store/records';
import type { Store } from './store/store';

export type SaveCondoDocumentInput = Omit<CondoDocument, 'id' | 'v' | 'rev' | 'deleted'>;

export type SaveCondoDocumentResult =
  | { status: 'saved'; operationId: string; documentId: string }
  | { status: 'unchanged'; documentId: string }
  | { status: 'refused'; reason: 'inconsistent-store' | 'unknown-apartment' | 'invalid-document' };

/**
 * Creates or replaces `condoc-<apartmentId>-<esercizio>-<kind>` (a new `rev`; a deleted one comes
 * back) in one `condo.document` operation. Refused: the apartment is not live, the schema refuses
 * the document or the fiscal year is not a safe file name part (`invalid-document`).
 */
export async function saveCondoDocument(
  store: Store,
  input: SaveCondoDocumentInput,
  profileId: string,
  clock: () => string,
  newId: () => string,
): Promise<SaveCondoDocumentResult> {
  const refuse = (reason: Extract<SaveCondoDocumentResult, { status: 'refused' }>['reason']) =>
    ({ status: 'refused', reason }) as const;
  if ((await checkConsistency(store)).length > 0) return refuse('inconsistent-store');
  const apartments = (await loadAll(store, 'apartment', ApartmentSchema)).records;
  if (!apartments.some((a) => a.id === input.apartmentId)) return refuse('unknown-apartment');
  // The fiscal year is part of the id, hence of a file name.
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(input.esercizio)) return refuse('invalid-document');
  const id = `condoc-${input.apartmentId}-${input.esercizio}-${input.kind}`;
  const docs = (
    await loadAll(store, 'condoDocument', CondoDocumentSchema, { includeDeleted: true })
  ).records;
  const before = docs.find((d) => d.id === id);
  const record = (rev: number) => CondoDocumentSchema.safeParse({ ...input, id, v: 1, rev });
  const parsed = record((before?.rev ?? 0) + 1);
  if (!parsed.success) return refuse('invalid-document');
  if (
    before !== undefined &&
    before.deleted !== true &&
    JSON.stringify(record(before.rev).data) === JSON.stringify(before)
  ) {
    return { status: 'unchanged', documentId: id };
  }
  const operation = await commitChange(
    store,
    {
      profileId,
      kind: 'condo.document',
      apartmentId: input.apartmentId,
      summary: 'Documento del condominio salvato.',
      changes: [{ path: recordPath('condoDocument', id), before, after: parsed.data }],
    },
    clock,
    newId,
  );
  return { status: 'saved', operationId: operation.id, documentId: id };
}

export type LoadCondoResult =
  | { status: 'computed'; rates: CondoCheckRow[]; differences: CondoDifference[] }
  | { status: 'refused'; reason: 'inconsistent-store' };

/**
 * The owners' check on `query.asOf` and the differences of the documents, for one apartment and
 * fiscal year when given; the matches are the saved ones plus the assumed ones of `planMatch`
 * (R2, as the Excel). Writes nothing; refused while `checkConsistency` reports a problem.
 */
export async function loadCondo(
  store: Store,
  query: { asOf: ISODate; apartmentId?: string; esercizio?: string },
): Promise<LoadCondoResult> {
  if ((await checkConsistency(store)).length > 0) {
    return { status: 'refused', reason: 'inconsistent-store' };
  }
  const wanted = (r: { apartmentId: string; esercizio: string }) =>
    (query.apartmentId === undefined || r.apartmentId === query.apartmentId) &&
    (query.esercizio === undefined || r.esercizio === query.esercizio);
  const instalments = (await loadAll(store, 'instalment', InstalmentSchema)).records.filter(wanted);
  const matches = [
    ...(await loadAll(store, 'match', BillMatchSchema)).records,
    ...(await planMatch(store)).assumedMatches,
  ];
  const documents = (await loadAll(store, 'condoDocument', CondoDocumentSchema)).records.filter(
    wanted,
  );
  const apartments = (await loadAll(store, 'apartment', ApartmentSchema)).records;
  return {
    status: 'computed',
    rates: condoCheck({ instalments, matches, asOf: query.asOf }),
    differences: condoDifferences(apartments, documents),
  };
}
