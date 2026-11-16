import { describe, expect, it } from 'vitest';
import { commitChange, loadModuleData, recordPath, writeRecord } from '../src/index';
import type { RecordKind } from '../src/index';
import { clock, ids } from './helpers/income-year';
import { MemoryStore } from './helpers/memory-store';

// Invented records.
const base = { v: 1, rev: 1 };
const RECORDS: [RecordKind, { id: string; rev: number } & Record<string, unknown>][] = [
  [
    'apartment',
    {
      ...base,
      id: 'apt-nord',
      name: 'Casa Nord',
      locatore: 'user1',
      posti: 2,
      annualitaStart: { month: 10, day: 1 },
    },
  ],
  ['tenant', { ...base, id: 'ten-1', name: 'Anna Prova' }],
  [
    'tenancy',
    {
      ...base,
      id: 'pres-1',
      apartmentId: 'apt-nord',
      tenantId: 'ten-1',
      from: '2026-08',
      monthlyRent: 30000,
      monthlyForfait: 8000,
    },
  ],
  [
    'contract',
    {
      ...base,
      id: 'ctr-1',
      apartmentId: 'apt-nord',
      type: '4+4',
      start: '2023-10',
      end: '2027-09',
      settlement: 'annuale',
      tenancyIds: ['pres-1'],
    },
  ],
  [
    'contract',
    {
      ...base,
      id: 'ctr-old',
      apartmentId: 'apt-nord',
      type: '4+4',
      start: '2019-10',
      end: '2023-09',
      settlement: 'annuale',
      tenancyIds: ['pres-1'],
      deleted: true,
    },
  ],
  [
    'account',
    {
      ...base,
      id: 'acc-1',
      apartmentId: 'apt-nord',
      label: 'Conto',
      bankProfileId: 'bp',
      iban: 'IT60X0542811101000000123456',
    },
  ],
  [
    'account',
    {
      ...base,
      id: 'acc-2',
      apartmentId: 'apt-nord',
      label: 'Conto bis',
      bankProfileId: 'bp',
      iban: 'IT60X0542811101000000123456',
    },
  ],
  [
    'account',
    {
      ...base,
      id: 'acc-3',
      apartmentId: 'apt-sud',
      label: 'Altro',
      bankProfileId: 'bp',
      iban: 'DE89370400440532013000',
    },
  ],
];

async function storeWith(records = RECORDS) {
  const store = new MemoryStore();
  for (const [kind, record] of records) {
    await writeRecord(store, recordPath(kind, record.id), record, { expectedRev: null });
  }
  return store;
}

describe('loadModuleData', () => {
  it('loads the tenancy with its apartment, tenant, live contract and distinct IBANs', async () => {
    const loaded = await loadModuleData(await storeWith(), { tenancyId: 'pres-1' });
    if (loaded.status !== 'ok') throw new Error(loaded.reason);
    expect(loaded.data.apartment.id).toBe('apt-nord');
    expect(loaded.data.tenant.id).toBe('ten-1');
    expect(loaded.data.contract?.id).toBe('ctr-1');
    expect(loaded.data.ibans).toEqual(['IT60X0542811101000000123456']);
  });

  it('has no contract when no live contract links the tenancy', async () => {
    const records = RECORDS.filter(([, r]) => r.id !== 'ctr-1');
    const loaded = await loadModuleData(await storeWith(records), { tenancyId: 'pres-1' });
    expect(loaded.status === 'ok' && loaded.data.contract).toBeUndefined();
  });

  it('refuses an unknown tenancy, apartment or tenant, and two live contracts', async () => {
    const store = await storeWith();
    expect(await loadModuleData(store, { tenancyId: 'nessuna' })).toEqual({
      status: 'refused',
      reason: 'unknown-tenancy',
    });
    const without = (id: string) => RECORDS.filter(([, r]) => r.id !== id);
    expect(
      await loadModuleData(await storeWith(without('apt-nord')), { tenancyId: 'pres-1' }),
    ).toMatchObject({ reason: 'unknown-apartment' });
    expect(
      await loadModuleData(await storeWith(without('ten-1')), { tenancyId: 'pres-1' }),
    ).toMatchObject({ reason: 'unknown-tenant' });
    const twice = RECORDS.map(([kind, r]): (typeof RECORDS)[number] =>
      r.id === 'ctr-old' ? [kind, { ...r, deleted: undefined }] : [kind, r],
    );
    expect(await loadModuleData(await storeWith(twice), { tenancyId: 'pres-1' })).toMatchObject({
      reason: 'ambiguous-contract',
    });
  });

  it('refuses a store whose record diverged from the journal', async () => {
    const store = await storeWith();
    const path = recordPath('tenant', 'ten-1');
    const tenant = { ...base, id: 'ten-1', name: 'Anna Prova' };
    await commitChange(
      store,
      {
        profileId: 'p1',
        kind: 'test.write',
        summary: 'Prova.',
        changes: [{ path, before: tenant, after: { ...tenant, rev: 2 } }],
      },
      clock,
      ids('op'),
    );
    store.putRaw(path, (store.getRaw(path) ?? '').replace('Anna Prova', 'Anna Diversa'));
    expect(await loadModuleData(store, { tenancyId: 'pres-1' })).toEqual({
      status: 'refused',
      reason: 'inconsistent-store',
    });
  });
});
