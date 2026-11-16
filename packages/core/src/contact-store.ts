/**
 * The address book (plan 14, R252): condominium administrators and suppliers typed by user1. Each
 * write one `contact.save` operation, nothing written while `checkConsistency` reports a problem,
 * nothing for the same request on the same state. No name or contact in a summary.
 */
import { checkConsistency, commitChange } from './journal';
import { ApartmentSchema, ContactSchema, SupplySchema } from './model';
import type { Contact } from './model';
import { loadAll } from './store/load';
import { recordPath } from './store/records';
import type { Store } from './store/store';
import { compareText } from './text';

export type SaveContactInput = Omit<Contact, 'v' | 'rev' | 'deleted'>;

export type SaveContactResult =
  | { status: 'saved'; operationId: string; contactId: string }
  | { status: 'unchanged'; contactId: string }
  | {
      status: 'refused';
      reason: 'inconsistent-store' | 'invalid-contact' | 'unknown-apartment' | 'unknown-supply';
    };

/**
 * Creates or replaces the whole contact `input.id` (a field left out is removed; a new `rev`).
 * Refused without writing, in this order: `inconsistent-store`; `invalid-contact` (an id that is
 * not a safe file name part, or fields the schema refuses); `unknown-apartment` and
 * `unknown-supply` (a link to a record that is not live).
 */
export async function saveContact(
  store: Store,
  input: SaveContactInput,
  profileId: string,
  clock: () => string,
  newId: () => string,
): Promise<SaveContactResult> {
  const refuse = (reason: Extract<SaveContactResult, { status: 'refused' }>['reason']) =>
    ({ status: 'refused', reason }) as const;
  if ((await checkConsistency(store)).length > 0) return refuse('inconsistent-store');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(input.id)) return refuse('invalid-contact');
  const all = (await loadAll(store, 'contact', ContactSchema, { includeDeleted: true })).records;
  const before = all.find((c) => c.id === input.id);
  const record = (rev: number) => ContactSchema.safeParse({ ...input, v: 1, rev });
  const parsed = record((before?.rev ?? 0) + 1);
  if (!parsed.success) return refuse('invalid-contact');
  const ids = (records: { id: string }[]) => new Set(records.map((r) => r.id));
  const apartments = ids((await loadAll(store, 'apartment', ApartmentSchema)).records);
  if (input.apartmentIds.some((id) => !apartments.has(id))) return refuse('unknown-apartment');
  const supplies = ids((await loadAll(store, 'supply', SupplySchema)).records);
  if ((input.supplyIds ?? []).some((id) => !supplies.has(id))) return refuse('unknown-supply');
  if (
    before !== undefined &&
    before.deleted !== true &&
    JSON.stringify(record(before.rev).data) === JSON.stringify(before)
  ) {
    return { status: 'unchanged', contactId: input.id };
  }
  const operation = await commitChange(
    store,
    {
      profileId,
      kind: 'contact.save',
      ...(input.apartmentIds.length === 1 ? { apartmentId: input.apartmentIds[0] } : {}),
      summary: 'Contatto della rubrica salvato.',
      changes: [{ path: recordPath('contact', input.id), before, after: parsed.data }],
    },
    clock,
    newId,
  );
  return { status: 'saved', operationId: operation.id, contactId: input.id };
}

export type LoadContactsResult =
  { status: 'ok'; contacts: Contact[] } | { status: 'refused'; reason: 'inconsistent-store' };

/** The live contacts, of one apartment and role when given, sorted by id. Writes nothing. */
export async function loadContacts(
  store: Store,
  query: { apartmentId?: string; role?: Contact['role'] },
): Promise<LoadContactsResult> {
  if ((await checkConsistency(store)).length > 0) {
    return { status: 'refused', reason: 'inconsistent-store' };
  }
  const contacts = (await loadAll(store, 'contact', ContactSchema)).records
    .filter(
      (c) =>
        (query.apartmentId === undefined || c.apartmentIds.includes(query.apartmentId)) &&
        (query.role === undefined || c.role === query.role),
    )
    .sort((a, b) => compareText(a.id, b.id));
  return { status: 'ok', contacts };
}
