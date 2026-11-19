import { describe, expect, it } from 'vitest';
import {
  InstalmentSchema,
  commitChange,
  loadAll,
  readJournal,
  recordPath,
  recordSchemas,
  saveCondoDocument,
  saveCondoInstalment,
} from '../src/index';
import type { SaveCondoInstalmentInput } from '../src/index';
import { cents } from '../src/money';
import { isoDate } from '../src/period';
import { clock, ids, snapshot } from './helpers/income-year';
import { MemoryStore } from './helpers/memory-store';

// Review of 18 Nov 2026 (I3, E4): the condominium instalments typed by user1. Invented amounts:
// the R3 example, rata 150,00 with 18,00 a year of owner share and 48,00 of last year's settlement.
async function withApartment(
  condominioStart: { month: number; day: number } | null = { month: 10, day: 1 },
) {
  const store = new MemoryStore();
  await store.writeJsonAtomic(
    recordPath('apartment', 'apt-a'),
    recordSchemas.apartment.parse({
      id: 'apt-a',
      v: 1,
      rev: 1,
      name: 'Appartamento A',
      locatore: 'user1',
      posti: 2,
      annualitaStart: { month: 10, day: 1 },
      ...(condominioStart === null ? {} : { condominioStart }),
    }),
  );
  return store;
}
const first: SaveCondoInstalmentInput = {
  id: 'rata-a-1',
  apartmentId: 'apt-a',
  esercizio: '2025-26',
  rateIndex: 1,
  rateCount: 3,
  dueDate: isoDate('2025-10-10'),
  rata: cents(15000),
  quotaProprieta: cents(1800),
  conguaglioPrec: cents(4800),
};
const save = (store: MemoryStore, input: SaveCondoInstalmentInput, prefix = 'e') =>
  saveCondoInstalment(store, input, 'p1', clock, ids(prefix));

describe('saveCondoInstalment', () => {
  it('writes the instalment with the months of its rate, then unchanged, then a new rev', async () => {
    const store = await withApartment();
    expect(await save(store, first)).toEqual({
      status: 'saved',
      operationId: 'e-1',
      instalmentId: 'rata-a-1',
    });
    const [op] = (await readJournal(store)).operations;
    expect(op).toMatchObject({ kind: 'condo.instalment', apartmentId: 'apt-a' });
    const [saved] = (await loadAll(store, 'instalment', InstalmentSchema)).records;
    expect(saved).toMatchObject({
      kind: 'condominio',
      coversFrom: '2025-10',
      coversTo: '2026-01',
      rev: 1,
    });
    expect(await save(store, first, 'f')).toEqual({
      status: 'unchanged',
      instalmentId: 'rata-a-1',
    });
    const third = await save(
      store,
      {
        ...first,
        id: 'rata-a-3',
        rateIndex: 3,
        dueDate: isoDate('2026-04-10'),
        conguaglioPrec: cents(0),
      },
      'g',
    );
    expect(third.status).toBe('saved');
    const all = (await loadAll(store, 'instalment', InstalmentSchema)).records;
    expect(all.find((i) => i.id === 'rata-a-3')).toMatchObject({
      coversFrom: '2026-06',
      coversTo: '2026-09',
    });
    expect((await save(store, { ...first, rata: cents(15100) }, 'h')).status).toBe('saved');
    const again = (await loadAll(store, 'instalment', InstalmentSchema)).records;
    expect(again.find((i) => i.id === 'rata-a-1')).toMatchObject({ rev: 2, rata: 15100 });
  });

  it('a different owner share in the same esercizio: saved with a warning and the ids (I5)', async () => {
    const store = await withApartment();
    await save(store, first);
    const second = await save(
      store,
      {
        ...first,
        id: 'rata-a-2',
        rateIndex: 2,
        quotaProprieta: cents(2400),
        conguaglioPrec: cents(0),
      },
      'f',
    );
    expect(second).toMatchObject({
      status: 'saved',
      warnings: [{ code: 'owner-share-differs', instalmentIds: ['rata-a-1', 'rata-a-2'] }],
    });
  });

  it('refuses what cannot be placed, writing nothing', async () => {
    const store = await withApartment();
    const before = await snapshot(store);
    const refused = async (input: SaveCondoInstalmentInput, reason: string) =>
      expect(await save(store, input)).toMatchObject({ status: 'refused', reason });
    await refused({ ...first, apartmentId: 'apt-x' }, 'unknown-apartment');
    await refused({ ...first, esercizio: '25' }, 'esercizio-format');
    await refused({ ...first, esercizio: '2025-27' }, 'invalid-instalment');
    await refused({ ...first, rateIndex: 4 }, 'invalid-instalment');
    await refused({ ...first, rateCount: 5 }, 'invalid-instalment');
    await refused({ ...first, id: 'con/sl' }, 'invalid-instalment');
    expect(await snapshot(store)).toEqual(before);
    const none = await withApartment(null);
    expect(await save(none, first)).toEqual({
      status: 'refused',
      reason: 'missing-condominio-start',
    });
    const mid = await withApartment({ month: 10, day: 15 });
    expect(await save(mid, first)).toEqual({
      status: 'refused',
      reason: 'missing-condominio-start',
    });
  });

  it('F7: takes the form «2026», here the calendar year (fiscal year from 1 January)', async () => {
    const store = await withApartment({ month: 1, day: 1 });
    const year = { ...first, esercizio: '2026', dueDate: isoDate('2026-01-10') };
    expect(await save(store, year)).toMatchObject({ status: 'saved' });
    const [saved] = (await loadAll(store, 'instalment', InstalmentSchema)).records;
    expect(saved).toMatchObject({ esercizio: '2026', coversFrom: '2026-01', coversTo: '2026-04' });
    // One form per apartment (R310): the cross-year form is refused next to it.
    expect(
      await save(store, { ...first, id: 'rata-a-2', rateIndex: 2, esercizio: '2026-27' }),
    ).toEqual({ status: 'refused', reason: 'esercizio-format', documentIds: ['rata-a-1'] });
  });

  it('F7: «2025» with a fiscal year from October is the one that starts in October 2025', async () => {
    const store = await withApartment();
    expect(await save(store, { ...first, esercizio: '2025' })).toMatchObject({ status: 'saved' });
    const [saved] = (await loadAll(store, 'instalment', InstalmentSchema)).records;
    expect(saved).toMatchObject({ esercizio: '2025', coversFrom: '2025-10', coversTo: '2026-01' });
  });

  it('refuses an esercizio of another form than the documents of the apartment (R310)', async () => {
    const store = await withApartment();
    await saveCondoDocument(
      store,
      { apartmentId: 'apt-a', esercizio: '2025', kind: 'preventivo', total: cents(45000) },
      'p1',
      clock,
      ids('d'),
    );
    expect(await save(store, first)).toEqual({
      status: 'refused',
      reason: 'esercizio-format',
      documentIds: ['condoc-apt-a-2025-preventivo'],
    });
  });

  it('refuses to change a matched instalment or one of a TARI (instalment-in-use, id-collision)', async () => {
    const store = await withApartment();
    await save(store, first);
    const match = recordSchemas.match.parse({
      id: 'm-1',
      v: 1,
      rev: 1,
      itemType: 'instalment',
      itemId: 'rata-a-1',
      transactionId: 'tx-1',
      transactionDate: '2025-10-10',
      amount: 19800,
      part: 'amount',
      confirmed: true,
      by: 'manual',
    });
    await commitChange(
      store,
      {
        profileId: 'p1',
        kind: 'test.seed',
        summary: 'x',
        changes: [{ path: recordPath('match', 'm-1'), after: match }],
      },
      clock,
      ids('s'),
    );
    expect(await save(store, { ...first, rata: cents(15100) }, 'f')).toEqual({
      status: 'refused',
      reason: 'instalment-in-use',
      recordIds: ['m-1'],
    });
    expect(await save(store, first, 'g')).toEqual({
      status: 'unchanged',
      instalmentId: 'rata-a-1',
    });
    const tari = recordSchemas.instalment.parse({
      ...first,
      id: 'tari-1',
      v: 1,
      rev: 1,
      kind: 'tari',
      esercizio: '2026',
      coversFrom: '2026-01',
      coversTo: '2026-04',
    });
    await commitChange(
      store,
      {
        profileId: 'p1',
        kind: 'test.seed',
        summary: 'x',
        changes: [{ path: recordPath('instalment', 'tari-1'), after: tari }],
      },
      clock,
      ids('t'),
    );
    expect(await save(store, { ...first, id: 'tari-1' }, 'h')).toEqual({
      status: 'refused',
      reason: 'id-collision',
    });
  });
});
