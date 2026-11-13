/**
 * What the app may do with a workspace folder when it opens it (design of plan 6, choices 1, 2
 * and 7). Nothing is repaired here: `repairDiverged` runs only when the user asks for it.
 */
import type { ZodType } from 'zod';
import { checkConsistency } from './journal';
import {
  BillSchema,
  InstalmentSchema,
  NoteSchema,
  SupplierProfileSchema,
  SupplySchema,
  UserSchema,
  WorkspaceSchema,
} from './model';
import { DROPBOX_CONFLICT_RULE, compareText, loadAll } from './store/load';
import type { ConflictNameRule } from './store/load';
import { MalformedJsonError, WORKSPACE_PATH } from './store/store';
import type { Problem, Store } from './store/store';
import { checkCompat } from './version';
import type { Compat } from './version';

// The kinds of record the app writes in `_app/dati/`; a `Store` cannot list folders, so they are
// named here. shortcut: a kind added later must be added here too to have its files checked.
const KINDS: [string, ZodType<{ id: string }>][] = [
  ['bill', BillSchema],
  ['instalment', InstalmentSchema],
  ['note', NoteSchema],
  ['supplierProfile', SupplierProfileSchema],
  ['supply', SupplySchema],
  ['user', UserSchema],
];

export type WorkspaceAssessment = {
  /** `checkCompat`, or `invalid` when `workspace.json` is missing, not JSON or not a workspace. */
  compat: Compat | 'invalid';
  /** `behind` when a record is not as its latest operation in the journal says, or is missing. */
  sync: 'ok' | 'behind';
  /** True only when `compat` and `sync` are both `ok`. Conflict copies and duplicates do not block. */
  writable: boolean;
  /** The problems of the data folder (see `loadAll`) and the `diverged` records, by path. */
  problems: Problem[];
};

/**
 * Assesses the folder behind `store` for this app. Never throws for a bad `workspace.json`; a
 * failure of the store itself (permissions, I/O) goes up.
 */
export async function assessWorkspace(
  store: Store,
  app: { version: string; schemaVersion: number },
  conflictRules: readonly ConflictNameRule[] = [DROPBOX_CONFLICT_RULE],
): Promise<WorkspaceAssessment> {
  let raw: unknown;
  try {
    raw = await store.readJson(WORKSPACE_PATH);
  } catch (error) {
    if (!(error instanceof MalformedJsonError)) throw error;
  }
  const workspace = WorkspaceSchema.safeParse(raw);
  const compat = workspace.success ? checkCompat(workspace.data, app) : 'invalid';
  const problems: Problem[] = [];
  for (const [kind, schema] of KINDS) {
    problems.push(...(await loadAll(store, kind, schema, {}, conflictRules)).problems);
  }
  const diverged = await checkConsistency(store);
  problems.push(...diverged);
  problems.sort((a, b) => compareText(a.path, b.path));
  const sync = diverged.length > 0 ? 'behind' : 'ok';
  return { compat, sync, writable: compat === 'ok' && sync === 'ok', problems };
}
