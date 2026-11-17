import { describe, expect, it } from 'vitest';
import {
  consumptionThresholdsFor,
  loadConsumption,
  recordPath,
  recordSchemas,
  saveConsumptionSettings,
} from '../src/index';
import { clock, ids } from './helpers/income-year';
import { MemoryStore } from './helpers/memory-store';

// Invented apartments, bills and thresholds (plan 17, R313).
const base = { v: 1, rev: 1 };
async function storeWithBills() {
  const store = new MemoryStore();
  const put = async (kind: 'apartment' | 'bill', r: Record<string, unknown> & { id: string }) =>
    store.writeJsonAtomic(recordPath(kind, r.id), recordSchemas[kind].parse({ ...base, ...r }));
  for (const id of ['nord', 'sud']) {
    await put('apartment', {
      id,
      name: id,
      locatore: 'user1',
      posti: 2,
      annualitaStart: { month: 10, day: 1 },
    });
  }
  const bill = (id: string, start: string, end: string, quantity: string) => ({
    id,
    apartmentId: 'nord',
    supplier: 'Gas Prova',
    category: 'gas',
    periodStart: start,
    periodEnd: end,
    amount: 10000,
    consumption: { quantity, unit: 'Smc' },
    includedInConguaglio: true,
    sharedWithTenants: true,
    filePath: `${id}.pdf`,
    fileHash: `h-${id}`,
  });
  await put('bill', bill('b-prev', '2025-01-01', '2025-01-31', '100'));
  await put('bill', bill('b-now', '2026-01-01', '2026-01-31', '160'));
  return store;
}

describe('consumption settings and alarm (plan 17, R313)', () => {
  it('no settings: no level; common ones, then the apartment’s own win', async () => {
    const store = await storeWithBills();
    const level = async () => {
      const r = await loadConsumption(store, 'b-now');
      return r.status === 'computed'
        ? r.comparison.yearBefore?.differences.find((d) => d.metric === 'consumption')?.level
        : 'refused';
    };
    expect(await level()).toBeUndefined();
    const save = (apartmentId: string | undefined, giallo: number, rosso: number, p: string) =>
      saveConsumptionSettings(
        store,
        {
          ...(apartmentId === undefined ? {} : { apartmentId }),
          giallo: { consumption: giallo },
          rosso: { consumption: rosso },
        },
        'p1',
        clock,
        ids(p),
      );
    expect(await save(undefined, 3000, 5000, 'a')).toEqual({
      status: 'saved',
      operationId: 'a-1',
      settingsId: 'soglie-consumi',
    });
    expect(await level()).toBe('rosso'); // +60 %
    expect(await save('nord', 3000, 7000, 'b')).toMatchObject({
      settingsId: 'soglie-consumi-nord',
    });
    expect(await level()).toBe('giallo');
    expect(await save('nord', 3000, 7000, 'c')).toEqual({
      status: 'unchanged',
      settingsId: 'soglie-consumi-nord',
    });
    expect(await save('ovest', 1, 2, 'd')).toEqual({
      status: 'refused',
      reason: 'unknown-apartment',
    });
    expect(await save(undefined, -1, 2, 'e')).toEqual({
      status: 'refused',
      reason: 'invalid-settings',
    });
    expect(await loadConsumption(store, 'b-x')).toEqual({
      status: 'refused',
      reason: 'unknown-bill',
    });
  });

  it('consumptionThresholdsFor ignores deleted settings', () => {
    const common = recordSchemas.consumptionSettings.parse({
      ...base,
      id: 'soglie-consumi',
      rosso: { amount: 1 },
    });
    const own = { ...common, id: 'soglie-consumi-sud', apartmentId: 'sud', deleted: true };
    expect(consumptionThresholdsFor([common, own], 'sud')).toEqual({ rosso: { amount: 1 } });
    expect(consumptionThresholdsFor([], 'sud')).toBeUndefined();
  });
});
