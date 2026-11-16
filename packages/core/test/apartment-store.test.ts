import { describe, expect, it } from 'vitest';
import { ApartmentSchema, loadAll, readJournal, recordPath, saveApartment } from '../src/index';
import type { SaveApartmentInput } from '../src/index';
import { clock, ids } from './helpers/income-year';
import { MemoryStore } from './helpers/memory-store';

const create: SaveApartmentInput = {
  id: 'apt-a',
  name: 'Appartamento A',
  locatore: 'user1',
  posti: 4,
  annualitaStart: { month: 10, day: 1 },
  condominioStart: { month: 5, day: 1 },
  condoDifferenceTo: 'owner',
};
const save = (store: MemoryStore, input: SaveApartmentInput, prefix = 'e') =>
  saveApartment(store, input, 'p1', clock, ids(prefix));
const records = async (store: MemoryStore) =>
  (await loadAll(store, 'apartment', ApartmentSchema)).records;

describe('saveApartment (plan 8, task 2)', () => {
  it('creates an apartment with the condominium setting in one operation', async () => {
    const store = new MemoryStore();
    expect(await save(store, create)).toEqual({
      status: 'saved',
      operationId: 'e-1',
      apartmentId: 'apt-a',
    });
    const [op] = (await readJournal(store)).operations;
    expect(op).toMatchObject({
      kind: 'apartment.save',
      apartmentId: 'apt-a',
      summary: 'Appartamento salvato.',
    });
    expect(await records(store)).toEqual([{ v: 1, rev: 1, ...create }]);
  });

  it('refuses to create without the setting or a required field', async () => {
    const store = new MemoryStore();
    expect(await save(store, { ...create, condoDifferenceTo: undefined })).toEqual({
      status: 'refused',
      reason: 'missing-fields',
    });
    expect(await save(store, { ...create, posti: undefined })).toEqual({
      status: 'refused',
      reason: 'missing-fields',
    });
    expect(await records(store)).toEqual([]);
  });

  it('updates only the fields given and keeps the others; same request is unchanged', async () => {
    const store = new MemoryStore();
    await store.writeJsonAtomic(
      recordPath('apartment', 'apt-a'),
      ApartmentSchema.parse({
        v: 1,
        rev: 3,
        id: 'apt-a',
        name: 'Appartamento A',
        locatore: 'user1',
        posti: 2,
        rooms: ['Camera 1', 'Camera 2'],
        annualitaStart: { month: 10, day: 1 },
      }),
    );
    const update = { id: 'apt-a', condoDifferenceTo: 'tenants' as const };
    expect(await save(store, update)).toMatchObject({ status: 'saved' });
    expect(await records(store)).toEqual([
      expect.objectContaining({
        rev: 4,
        rooms: ['Camera 1', 'Camera 2'],
        condoDifferenceTo: 'tenants',
      }),
    ]);
    expect(await save(store, update, 'f')).toEqual({ status: 'unchanged', apartmentId: 'apt-a' });
  });

  it('refuses an apartment the schema refuses, and an inconsistent store', async () => {
    const store = new MemoryStore();
    expect(await save(store, { ...create, posti: 0 })).toEqual({
      status: 'refused',
      reason: 'invalid-apartment',
    });
    await save(store, create);
    const path = recordPath('apartment', 'apt-a');
    store.putRaw(path, (store.getRaw(path) ?? '').replace('Appartamento A', 'Altro'));
    expect(await save(store, { id: 'apt-a', posti: 3 }, 'f')).toEqual({
      status: 'refused',
      reason: 'inconsistent-store',
    });
  });
});
