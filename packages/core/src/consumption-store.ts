/**
 * The consumption alarm on the store (plan 17, R313): the thresholds typed by user1 (the same for
 * every apartment, or an apartment's own) and the comparison of one bill with them. No threshold
 * or level is decided in the code: without settings there is no level.
 */
import { compareConsumption } from './consumption';
import type { ConsumptionComparison, ConsumptionThresholds } from './consumption';
import { checkConsistency, commitChange } from './journal';
import { ApartmentSchema, BillSchema, ConsumptionSettingsSchema } from './model';
import type { ConsumptionSettings } from './model';
import { loadAll } from './store/load';
import { recordPath } from './store/records';
import type { Store } from './store/store';

/** The thresholds of `apartmentId`: its own settings, else the common ones, else none. */
export function consumptionThresholdsFor(
  settings: readonly ConsumptionSettings[],
  apartmentId: string,
): ConsumptionThresholds | undefined {
  const live = settings.filter((s) => s.deleted !== true);
  const chosen =
    live.find((s) => s.apartmentId === apartmentId) ??
    live.find((s) => s.apartmentId === undefined);
  if (chosen === undefined) return undefined;
  return {
    ...(chosen.giallo === undefined ? {} : { giallo: chosen.giallo }),
    ...(chosen.rosso === undefined ? {} : { rosso: chosen.rosso }),
  };
}

export type SaveConsumptionSettingsResult =
  | { status: 'saved'; operationId: string; settingsId: string }
  | { status: 'unchanged'; settingsId: string }
  | { status: 'refused'; reason: 'inconsistent-store' | 'unknown-apartment' | 'invalid-settings' };

/**
 * Creates or replaces the thresholds, common (`apartmentId` absent) or of one live apartment, in one
 * `consumption.settings` operation. Refused without writing: `inconsistent-store`,
 * `unknown-apartment`, `invalid-settings` (not whole basis points ≥ 0).
 */
export async function saveConsumptionSettings(
  store: Store,
  input: Pick<ConsumptionSettings, 'apartmentId' | 'giallo' | 'rosso'>,
  profileId: string,
  clock: () => string,
  newId: () => string,
): Promise<SaveConsumptionSettingsResult> {
  const refuse = (
    reason: Extract<SaveConsumptionSettingsResult, { status: 'refused' }>['reason'],
  ) => ({ status: 'refused', reason }) as const;
  if ((await checkConsistency(store)).length > 0) return refuse('inconsistent-store');
  if (
    input.apartmentId !== undefined &&
    !(await loadAll(store, 'apartment', ApartmentSchema)).records.some(
      (a) => a.id === input.apartmentId,
    )
  ) {
    return refuse('unknown-apartment');
  }
  const id =
    input.apartmentId === undefined ? 'soglie-consumi' : `soglie-consumi-${input.apartmentId}`;
  const before = (
    await loadAll(store, 'consumptionSettings', ConsumptionSettingsSchema, { includeDeleted: true })
  ).records.find((s) => s.id === id);
  const record = (rev: number) =>
    ConsumptionSettingsSchema.safeParse({
      id,
      v: 1,
      rev,
      ...(input.apartmentId === undefined ? {} : { apartmentId: input.apartmentId }),
      ...(input.giallo === undefined ? {} : { giallo: input.giallo }),
      ...(input.rosso === undefined ? {} : { rosso: input.rosso }),
    });
  const parsed = record((before?.rev ?? 0) + 1);
  if (!parsed.success) return refuse('invalid-settings');
  if (
    before !== undefined &&
    before.deleted !== true &&
    JSON.stringify(record(before.rev).data) === JSON.stringify(before)
  ) {
    return { status: 'unchanged', settingsId: id };
  }
  const operation = await commitChange(
    store,
    {
      profileId,
      kind: 'consumption.settings',
      ...(input.apartmentId === undefined ? {} : { apartmentId: input.apartmentId }),
      summary: 'Soglie dell’allarme consumi salvate.',
      changes: [{ path: recordPath('consumptionSettings', id), before, after: parsed.data }],
    },
    clock,
    newId,
  );
  return { status: 'saved', operationId: operation.id, settingsId: id };
}

export type LoadConsumptionResult =
  | { status: 'computed'; comparison: ConsumptionComparison; thresholds: boolean }
  | { status: 'refused'; reason: 'inconsistent-store' | 'unknown-bill' };

/** `compareConsumption` of the live bill `billId` with the thresholds of its apartment. */
export async function loadConsumption(
  store: Store,
  billId: string,
): Promise<LoadConsumptionResult> {
  if ((await checkConsistency(store)).length > 0) {
    return { status: 'refused', reason: 'inconsistent-store' };
  }
  const bills = (await loadAll(store, 'bill', BillSchema)).records;
  const bill = bills.find((b) => b.id === billId);
  if (bill === undefined) return { status: 'refused', reason: 'unknown-bill' };
  const thresholds = consumptionThresholdsFor(
    (await loadAll(store, 'consumptionSettings', ConsumptionSettingsSchema)).records,
    bill.apartmentId,
  );
  return {
    status: 'computed',
    comparison: compareConsumption(bill, bills, thresholds === undefined ? {} : { thresholds }),
    thresholds: thresholds !== undefined,
  };
}
