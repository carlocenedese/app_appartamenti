/**
 * The workspace settings (review of 18 Nov 2026, I9): the control thresholds user1 types, with
 * the defaults of the code when a field is absent. One record, `impostazioni`, written in one
 * `settings.save` operation (undone with the reconciliation undo).
 */
import { DEFAULT_IMU_TOLERANCE_BP } from './imu';
import { checkConsistency, commitChange } from './journal';
import { WORKSPACE_SETTINGS_ID, WorkspaceSettingsSchema } from './model';
import { loadAll } from './store/load';
import { recordPath } from './store/records';
import type { Store } from './store/store';

/** The settings in force: each one with its value and whether it is the default. */
export interface Settings {
  imuToleranceBp: { value: number; isDefault: boolean };
}

/** The settings of the store (the defaults for the fields absent or without a record). */
export async function loadSettings(store: Store): Promise<Settings> {
  const record = (await loadAll(store, 'workspaceSettings', WorkspaceSettingsSchema)).records.find(
    (r) => r.id === WORKSPACE_SETTINGS_ID,
  );
  const imu = record?.imuToleranceBp;
  return {
    imuToleranceBp: { value: imu ?? DEFAULT_IMU_TOLERANCE_BP, isDefault: imu === undefined },
  };
}

export type SaveSettingsResult =
  | { status: 'saved'; operationId: string }
  | { status: 'unchanged' }
  | { status: 'refused'; reason: 'inconsistent-store' | 'invalid-workspace-settings' };

/**
 * Sets the fields given (the others stay); `null` takes a field back to its default. Nothing is
 * written while `checkConsistency` reports a problem, nor for the same values.
 */
export async function saveSettings(
  store: Store,
  input: { imuToleranceBp?: number | null },
  profileId: string,
  clock: () => string,
  newId: () => string,
): Promise<SaveSettingsResult> {
  if ((await checkConsistency(store)).length > 0) {
    return { status: 'refused', reason: 'inconsistent-store' };
  }
  const before = (
    await loadAll(store, 'workspaceSettings', WorkspaceSettingsSchema, { includeDeleted: true })
  ).records.find((r) => r.id === WORKSPACE_SETTINGS_ID);
  const live = before !== undefined && before.deleted !== true;
  const kept = Object.entries(live ? before : {}).filter(
    ([key]) => key !== 'deleted' && (input as Record<string, unknown>)[key] === undefined,
  );
  const given = Object.entries(input).filter(([, value]) => value !== null && value !== undefined);
  const fields = Object.fromEntries([...kept, ...given]);
  const parsed = WorkspaceSettingsSchema.safeParse({
    ...fields,
    id: WORKSPACE_SETTINGS_ID,
    v: 1,
    rev: (before?.rev ?? 0) + 1,
  });
  if (!parsed.success) return { status: 'refused', reason: 'invalid-workspace-settings' };
  if (live && JSON.stringify({ ...parsed.data, rev: before.rev }) === JSON.stringify(before)) {
    return { status: 'unchanged' };
  }
  const operation = await commitChange(
    store,
    {
      profileId,
      kind: 'settings.save',
      summary: 'Impostazioni salvate.',
      changes: [
        {
          path: recordPath('workspaceSettings', WORKSPACE_SETTINGS_ID),
          before,
          after: parsed.data,
        },
      ],
    },
    clock,
    newId,
  );
  return { status: 'saved', operationId: operation.id };
}
