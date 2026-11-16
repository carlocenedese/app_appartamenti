import { describe, expect, it } from 'vitest';
import { loadContacts, readJournal, recordPath, recordSchemas, saveContact } from '../src/index';
import type { SaveContactInput } from '../src/index';
import { clock, ids, snapshot } from './helpers/income-year';
import { MemoryStore } from './helpers/memory-store';

// Invented apartments, supply, names and contacts (plan 14, R252).
async function withApartments() {
  const store = new MemoryStore();
  for (const id of ['apt-a', 'apt-b']) {
    await store.writeJsonAtomic(
      recordPath('apartment', id),
      recordSchemas.apartment.parse({
        id,
        v: 1,
        rev: 1,
        name: `Appartamento ${id}`,
        locatore: 'user1',
        posti: 2,
        annualitaStart: { month: 10, day: 1 },
      }),
    );
  }
  await store.writeJsonAtomic(
    recordPath('supply', 'sup-1'),
    recordSchemas.supply.parse({
      id: 'sup-1',
      v: 1,
      rev: 1,
      label: 'Utenza prova',
      apartments: [{ apartmentId: 'apt-a', weight: 10000 }],
    }),
  );
  return store;
}
const admin: SaveContactInput = {
  id: 'ctc-1',
  role: 'amministratore',
  name: 'Amministratore Prova',
  phone: '+39 000 000 0000',
  email: 'amministratore@example.test',
  apartmentIds: ['apt-a'],
};
const save = (store: MemoryStore, input: SaveContactInput, prefix = 'c') =>
  saveContact(store, input, 'p1', clock, ids(prefix));

describe('saveContact (plan 14, R252)', () => {
  it('saves, then unchanged, then replaces every field (an omitted one goes)', async () => {
    const store = await withApartments();
    expect(await save(store, admin)).toEqual({
      status: 'saved',
      operationId: 'c-1',
      contactId: 'ctc-1',
    });
    const [op] = (await readJournal(store)).operations;
    expect(op).toMatchObject({ kind: 'contact.save', summary: 'Contatto della rubrica salvato.' });
    expect(JSON.stringify(op?.summary)).not.toContain('Prova');
    expect(await save(store, admin, 'd')).toEqual({ status: 'unchanged', contactId: 'ctc-1' });
    const withoutPhone = { ...admin };
    delete withoutPhone.phone;
    await save(store, { ...withoutPhone, supplyIds: ['sup-1'] }, 'e');
    const listed = await loadContacts(store, {});
    expect(listed).toEqual({
      status: 'ok',
      contacts: [
        {
          ...withoutPhone,
          supplyIds: ['sup-1'],
          v: 1,
          rev: 2,
        },
      ],
    });
  });

  it('refuses without writing: bad id or fields, unknown apartment or supply', async () => {
    const store = await withApartments();
    const before = await snapshot(store);
    const refused = (reason: string) => ({ status: 'refused', reason });
    expect(await save(store, { ...admin, id: 'a/b' })).toEqual(refused('invalid-contact'));
    expect(await save(store, { ...admin, name: '' })).toEqual(refused('invalid-contact'));
    expect(await save(store, { ...admin, apartmentIds: ['apt-x'] })).toEqual(
      refused('unknown-apartment'),
    );
    expect(await save(store, { ...admin, supplyIds: ['sup-x'] })).toEqual(
      refused('unknown-supply'),
    );
    expect(await snapshot(store)).toEqual(before);
  });

  it('refuses an inconsistent store', async () => {
    const store = await withApartments();
    await save(store, admin);
    const path = recordPath('contact', 'ctc-1');
    store.putRaw(path, (store.getRaw(path) ?? '').replace('Prova', 'Altro'));
    expect(await save(store, { ...admin, notes: 'x' }, 'd')).toEqual({
      status: 'refused',
      reason: 'inconsistent-store',
    });
    expect(await loadContacts(store, {})).toEqual({
      status: 'refused',
      reason: 'inconsistent-store',
    });
  });
});

describe('loadContacts (plan 14, R252)', () => {
  it('filters by apartment and role, sorted by id', async () => {
    const store = await withApartments();
    await save(store, { ...admin, id: 'ctc-2', apartmentIds: ['apt-b'] }, 'a');
    await save(store, admin, 'b');
    await save(
      store,
      { id: 'ctc-0', role: 'fornitore', name: 'Fornitore Prova', apartmentIds: ['apt-a', 'apt-b'] },
      'c',
    );
    const idsOf = async (query: Parameters<typeof loadContacts>[1]) => {
      const r = await loadContacts(store, query);
      return r.status === 'ok' ? r.contacts.map((c) => c.id) : r;
    };
    expect(await idsOf({})).toEqual(['ctc-0', 'ctc-1', 'ctc-2']);
    expect(await idsOf({ apartmentId: 'apt-a' })).toEqual(['ctc-0', 'ctc-1']);
    expect(await idsOf({ role: 'amministratore', apartmentId: 'apt-b' })).toEqual(['ctc-2']);
  });
});
