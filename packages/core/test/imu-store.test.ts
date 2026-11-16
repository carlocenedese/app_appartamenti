import { describe, expect, it } from 'vitest';
import {
  ImuYearSchema,
  loadAll,
  readJournal,
  recordPath,
  recordSchemas,
  setImuYear,
} from '../src/index';
import type { RecordKind, SetImuYearInput } from '../src/index';
import { cents } from '../src/money';
import { clock, ids, snapshot } from './helpers/income-year';
import { MemoryStore } from './helpers/memory-store';

// Invented amounts only (plan 3d, decision 1): the real IMU totals never enter the repository.
const base = { v: 1, rev: 1 };
const apartment = (id: string) => ({
  ...base,
  id,
  name: id,
  locatore: 'Locatore fittizio',
  posti: 2,
  annualitaStart: { month: 1, day: 1 },
});

async function put(
  store: MemoryStore,
  kind: RecordKind,
  records: ({ id: string } & Record<string, unknown>)[],
) {
  for (const r of records) {
    await store.writeJsonAtomic(recordPath(kind, r.id), recordSchemas[kind].parse(r));
  }
}
async function apartments() {
  const store = new MemoryStore();
  await put(store, 'apartment', [apartment('berchet'), apartment('lovarini')]);
  return store;
}
const berchet = (extra: Partial<SetImuYearInput> = {}): SetImuYearInput => ({
  apartmentId: 'berchet',
  year: '2026',
  f24Group: 'berchet-lovarini',
  rates: [{ index: 1 }, { index: 2 }],
  ...extra,
});
const save = (store: MemoryStore, input: SetImuYearInput, prefix = 'e') =>
  setImuYear(store, input, 'p1', clock, ids(prefix));
const years = async (store: MemoryStore) =>
  (await loadAll(store, 'imuYear', ImuYearSchema, { includeDeleted: true })).records;

describe('setImuYear (plan 3d, task 1)', () => {
  it('saves, updates with a new rev, and writes nothing for the same request again', async () => {
    const store = await apartments();
    expect(await save(store, berchet())).toEqual({
      status: 'saved',
      operationId: 'e-1',
      imuYearId: 'imu-berchet-2026',
    });
    const [op] = (await readJournal(store)).operations;
    expect(op).toMatchObject({
      kind: 'imu.expected',
      apartmentId: 'berchet',
      summary: 'Aggiornati gli importi IMU attesi.',
    });
    const update = berchet({ rates: [{ index: 1, expected: cents(60000) }, { index: 2 }] });
    expect(await save(store, update, 'f')).toMatchObject({ status: 'saved', operationId: 'f-1' });
    expect(await years(store)).toEqual([
      {
        ...base,
        rev: 2,
        id: 'imu-berchet-2026',
        apartmentId: 'berchet',
        year: '2026',
        f24Group: 'berchet-lovarini',
        rates: [{ index: 1, expected: 60000 }, { index: 2 }],
      },
    ]);
    const before = await snapshot(store);
    expect(await save(store, update, 'g')).toEqual({
      status: 'unchanged',
      imuYearId: 'imu-berchet-2026',
    });
    expect(await snapshot(store)).toEqual(before);
  });

  it('a deleted record comes back with a new rev', async () => {
    const store = await apartments();
    await put(store, 'imuYear', [
      {
        ...base,
        rev: 3,
        deleted: true,
        id: 'imu-berchet-2026',
        apartmentId: 'berchet',
        year: '2026',
        f24Group: 'berchet-lovarini',
        rates: [{ index: 1 }, { index: 2 }],
      },
    ]);
    expect(await save(store, berchet())).toMatchObject({ status: 'saved' });
    const [saved] = await years(store);
    expect(saved).toMatchObject({ rev: 4 });
    expect(saved).not.toHaveProperty('deleted');
  });

  it('an annual total without amounts per rate is saved (question 10, data only)', async () => {
    const store = await apartments();
    expect(await save(store, berchet({ annualTotal: cents(130000) }))).toMatchObject({
      status: 'saved',
    });
    expect((await years(store))[0]).toMatchObject({ annualTotal: 130000 });
  });

  it('refusals write nothing', async () => {
    const store = await apartments();
    await save(store, berchet());
    const before = await snapshot(store);
    const refused = (reason: string) => ({ status: 'refused', reason });
    const three = { index: 3 };
    expect(
      await save(store, {
        ...berchet({ rates: [{ index: 1 }, { index: 2 }, three] }),
        apartmentId: 'lovarini',
      }),
    ).toEqual(refused('rates-mismatch'));
    expect(await save(store, berchet({ apartmentId: 'nessuno' }))).toEqual(
      refused('unknown-apartment'),
    );
    expect(await save(store, berchet({ rates: [{ index: 1 }, three] }))).toEqual(
      refused('bad-rates'),
    );
    expect(await save(store, berchet({ rates: [] }))).toEqual(refused('bad-rates'));
    expect(await save(store, berchet({ rates: [{ index: 1, expected: cents(0) }] }))).toEqual(
      refused('bad-rates'),
    );
    expect(await save(store, berchet({ annualTotal: cents(-1) }))).toEqual(refused('bad-rates'));
    expect(await snapshot(store)).toEqual(before);

    // Another year or another group: no mismatch.
    expect(
      await save(store, { ...berchet({ year: '2027', rates: [three] }), apartmentId: 'lovarini' }),
    ).toEqual(refused('bad-rates'));
    expect(
      await save(
        store,
        {
          ...berchet({ f24Group: 'solo-lovarini', rates: [{ index: 1 }] }),
          apartmentId: 'lovarini',
        },
        'x',
      ),
    ).toMatchObject({ status: 'saved' });
  });

  it('a diverged store is inconsistent-store, nothing written', async () => {
    const store = await apartments();
    await save(store, berchet());
    const path = recordPath('imuYear', 'imu-berchet-2026');
    store.putRaw(path, (store.getRaw(path) ?? '').replace('berchet-lovarini', 'altro-gruppo'));
    const before = await snapshot(store);
    expect(await save(store, berchet({ annualTotal: cents(1000) }), 'h')).toEqual({
      status: 'refused',
      reason: 'inconsistent-store',
    });
    expect(await snapshot(store)).toEqual(before);
  });
});
