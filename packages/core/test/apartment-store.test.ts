import { describe, expect, it } from 'vitest';
import {
  ApartmentSchema,
  TenancySchema,
  loadAll,
  readJournal,
  recordPath,
  saveApartment,
  undoBlockedBy,
} from '../src/index';
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
      status: 'created',
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
    expect(await save(store, update)).toMatchObject({ status: 'updated' });
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

  it('changes beds or lease year start of a live apartment only when confirmed', async () => {
    const store = new MemoryStore();
    await save(store, create);
    expect(await save(store, { id: 'apt-a', posti: 5 }, 'f')).toEqual({
      status: 'refused',
      reason: 'needs-confirmation',
    });
    expect(await save(store, { id: 'apt-a', annualitaStart: { month: 9, day: 1 } }, 'f')).toEqual({
      status: 'refused',
      reason: 'needs-confirmation',
    });
    expect(await save(store, { id: 'apt-a', posti: 4 }, 'f')).toMatchObject({
      status: 'unchanged',
    });
    expect(
      await saveApartment(store, { id: 'apt-a', posti: 5 }, 'p1', clock, ids('g'), {
        confirmed: true,
      }),
    ).toMatchObject({ status: 'updated' });
    expect((await records(store))[0]?.posti).toBe(5);
  });

  it('brings a deleted apartment back with its old fields (rooms, rentLateDays)', async () => {
    const store = new MemoryStore();
    await store.writeJsonAtomic(
      recordPath('apartment', 'apt-a'),
      ApartmentSchema.parse({
        v: 1,
        rev: 2,
        deleted: true,
        id: 'apt-a',
        name: 'Appartamento A',
        locatore: 'user1',
        posti: 2,
        rooms: ['Camera 1', 'Camera 2'],
        rentLateDays: 5,
        annualitaStart: { month: 10, day: 1 },
      }),
    );
    expect(await save(store, { id: 'apt-a' })).toEqual({
      status: 'refused',
      reason: 'missing-fields',
    });
    expect(await save(store, { id: 'apt-a', condoDifferenceTo: 'tenants' })).toMatchObject({
      status: 'created',
    });
    const [back] = await records(store);
    expect(back).toMatchObject({ rev: 3, rooms: ['Camera 1', 'Camera 2'], rentLateDays: 5 });
    expect(back?.deleted).toBeUndefined();
  });

  it('refuses an id that is not a safe file name part', async () => {
    expect(await save(new MemoryStore(), { ...create, id: 'a/b' })).toEqual({
      status: 'refused',
      reason: 'invalid-apartment',
    });
  });
});

describe('saveApartment under live stays (review of 18 Nov 2026, U13)', () => {
  const stay = (id: string, room: string, from = '2027-01') =>
    TenancySchema.parse({
      id,
      v: 1,
      rev: 1,
      apartmentId: 'apt-a',
      tenantId: `t-${id}`,
      room,
      from,
      monthlyRent: 50000,
      monthlyForfait: 5000,
    });
  async function withStays() {
    const store = new MemoryStore();
    const first = await save(store, { ...create, posti: 2, rooms: ['A', 'B'] });
    if (first.status !== 'created') throw new Error('not created');
    await store.writeJsonAtomic(recordPath('tenancy', 'ten1'), stay('ten1', 'A'));
    await store.writeJsonAtomic(recordPath('tenancy', 'ten2'), stay('ten2', 'B'));
    return { store, created: first.operationId };
  }

  it('refuses to rename or drop the rooms of live stays, naming them', async () => {
    const { store } = await withStays();
    expect(await save(store, { id: 'apt-a', rooms: ['C', 'B'] })).toEqual({
      status: 'refused',
      reason: 'rooms-in-use',
      rooms: ['A'],
      tenancyIds: ['ten1'],
    });
    expect(
      await saveApartment(store, { id: 'apt-a', posti: 1, rooms: ['A'] }, 'p1', clock, ids('x'), {
        confirmed: true,
      }),
    ).toEqual({ status: 'refused', reason: 'rooms-in-use', rooms: ['B'], tenancyIds: ['ten2'] });
    expect((await records(store))[0]?.rooms).toEqual(['A', 'B']);
    // A free room may be renamed.
    await store.writeJsonAtomic(recordPath('tenancy', 'ten2'), {
      ...stay('ten2', 'B'),
      rev: 2,
      deleted: true,
    });
    expect(await save(store, { id: 'apt-a', rooms: ['A', 'C'] }, 'y')).toMatchObject({
      status: 'updated',
    });
  });

  it('refuses fewer beds than the stays need, without rooms', async () => {
    const store = new MemoryStore();
    await save(store, { ...create, posti: 2 });
    await store.writeJsonAtomic(recordPath('tenancy', 'ten1'), {
      ...stay('ten1', 'A'),
      room: undefined,
    });
    await store.writeJsonAtomic(recordPath('tenancy', 'ten2'), {
      ...stay('ten2', 'B'),
      room: undefined,
    });
    expect(
      await saveApartment(store, { id: 'apt-a', posti: 1 }, 'p1', clock, ids('x'), {
        confirmed: true,
      }),
    ).toMatchObject({
      status: 'refused',
      reason: 'beds-conflict',
      code: 'too-many-tenants',
      month: '2027-01',
    });
  });

  it('blocks the undo of a change of rooms the live stays now use', async () => {
    const store = new MemoryStore();
    await save(store, { ...create, posti: 2, rooms: ['A', 'B'] });
    const renamed = await save(store, { id: 'apt-a', rooms: ['C', 'D'] }, 'r');
    if (renamed.status !== 'updated') throw new Error('not updated');
    await store.writeJsonAtomic(recordPath('tenancy', 'ten1'), stay('ten1', 'C'));
    expect(await undoBlockedBy(store, renamed.operationId)).toEqual(['ten1']);
  });
});
