/**
 * What the app may do with a workspace folder when it opens it (design of plan 6, choices 1, 2
 * and 7). Nothing is repaired here: `repairDiverged` runs only when the user asks for it.
 */
import type { ZodType } from 'zod';
import { JOURNAL_DIR, checkConsistency, readJournal } from './journal';
import { WorkspaceSchema, recordSchemas } from './model';
import { DEFAULT_CONFLICT_RULES, compareText, loadAll } from './store/load';
import type { ConflictNameRule } from './store/load';
import { MalformedJsonError, WORKSPACE_PATH, isFileAccessError } from './store/store';
import type { Problem, Store } from './store/store';
import { checkCompat } from './version';
import type { Compat } from './version';

/**
 * Why the folder is open read-only, one entry per kind of cause with the files involved (paths
 * relative to the workspace root; a conflict copy's name can hold a computer name, so it is for
 * the screen only, never for a log). `readOnlyMessage` gives the Italian text for each code.
 */
export type ReadOnlyCode =
  | 'invalid-workspace'
  | 'newer-format'
  | 'older-format'
  | 'conflict-copies'
  | 'forked'
  | 'diverged'
  | 'damaged-journal'
  | 'newer-data'
  | 'unreadable-files';
export type ReadOnlyReason = { code: ReadOnlyCode; paths: string[] };

export type WorkspaceAssessment = {
  /** `checkCompat`, or `invalid` when `workspace.json` is missing, not JSON or not a workspace. */
  compat: Compat | 'invalid';
  /**
   * `behind` when a record is not as its latest operation in the journal says or is missing, or
   * when an operation file is cut short.
   */
  sync: 'ok' | 'behind';
  /** True only when `reasons` is empty. */
  writable: boolean;
  /** The problems of the data folder and the journal (see `loadAll`, `checkConsistency`), by path. */
  problems: Problem[];
  /** Why the folder is not writable, in a fixed order; empty when it is writable. */
  reasons: ReadOnlyReason[];
};

/** The text to show for a reason, in Italian, with what to do. */
export function readOnlyMessage(code: ReadOnlyCode): string {
  return READ_ONLY_MESSAGES[code];
}

const READ_ONLY_MESSAGES: Record<ReadOnlyCode, string> = {
  'invalid-workspace': 'Questa cartella non contiene un gruppo valido.',
  'newer-format':
    "La cartella è stata scritta da una versione più nuova dell'app: aggiorna l'app per modificarla.",
  'older-format':
    'I dati della cartella sono di una versione precedente e vanno aggiornati: per ora è aperta in sola lettura.',
  'conflict-copies':
    'Dropbox (o iCloud) ha creato delle copie in conflitto: due persone hanno salvato gli stessi ' +
    'dati insieme. Confronta ogni copia con il file originale, tieni la versione giusta e sposta ' +
    "la copia fuori dalla cartella _app; l'app non sceglie da sola.",
  forked:
    'Due persone hanno modificato gli stessi dati nello stesso momento e il registro ha tutte e ' +
    'due le versioni: scegli quale tenere. Nessuna delle due viene scelta in automatico.',
  diverged:
    'Alcuni dati non sono come dice il registro: sincronizzazione in corso o un salvataggio ' +
    'interrotto. Aspetta che Dropbox finisca; se il messaggio resta, usa «Ripara».',
  'damaged-journal':
    'Un file del registro è vuoto o rovinato. Se Dropbox ha finito di sincronizzare, ' +
    'ripristinalo dalla cronologia delle versioni di Dropbox; se è dimostrato che non ha lasciato ' +
    'effetti, si può mettere da parte.',
  'unreadable-files':
    'Alcuni file non si possono leggere ora: chiudili se sono aperti in un altro programma ' +
    "(Excel, l'antivirus), controlla che Dropbox li tenga su questo computer e che tu abbia i " +
    'permessi, poi ricontrolla.',
  'newer-data':
    "Alcuni dati sono stati scritti da una versione più nuova dell'app: aggiorna l'app per " +
    'modificarli. Fino ad allora la cartella è in sola lettura, anche per gli annullamenti.',
};

/** The order of the reasons: what to fix first. */
const REASON_ORDER: readonly ReadOnlyCode[] = [
  'invalid-workspace',
  'newer-format',
  'older-format',
  'newer-data',
  'unreadable-files',
  'conflict-copies',
  'forked',
  'damaged-journal',
  'diverged',
];

/** The reason a problem gives, if it blocks writing. */
function blockingCode(problem: Problem, inJournal: boolean): ReadOnlyCode | undefined {
  switch (problem.reason) {
    case 'conflicted-copy':
      return 'conflict-copies';
    case 'forked':
      return 'forked';
    case 'unreadable':
      return 'unreadable-files';
    case 'diverged':
      return 'diverged';
    case 'future-version':
    case 'unknown-fields':
      return 'newer-data';
    case 'malformed-json':
    case 'schema-mismatch':
      return inJournal ? 'damaged-journal' : undefined;
    default:
      return undefined;
  }
}

/**
 * Assesses the folder behind `store` for this app. Never throws for a bad `workspace.json`, nor
 * for a file that cannot be read now (`unreadable-files`, with its path); any other failure of the
 * store goes up (a folder that cannot be listed).
 */
export async function assessWorkspace(
  store: Store,
  app: { version: string; schemaVersion: number },
  conflictRules: readonly ConflictNameRule[] = DEFAULT_CONFLICT_RULES,
): Promise<WorkspaceAssessment> {
  let raw: unknown;
  let unreadableWorkspace = false;
  try {
    raw = await store.readJson(WORKSPACE_PATH);
  } catch (error) {
    unreadableWorkspace = isFileAccessError(error);
    if (!unreadableWorkspace && !(error instanceof MalformedJsonError)) throw error;
  }
  const workspace = WorkspaceSchema.safeParse(raw);
  const compat = workspace.success ? checkCompat(workspace.data, app) : 'invalid';
  const found: Problem[] = [];
  const schemas: [string, ZodType<{ id: string }>][] = Object.entries(recordSchemas);
  for (const [kind, schema] of schemas) {
    found.push(...(await loadAll(store, kind, schema, {}, conflictRules)).problems);
  }
  const journal = (await readJournal(store, conflictRules)).problems;
  // checkConsistency also reports the conflict copies of the records, the journal and workspace.json.
  const consistency = await checkConsistency(store, conflictRules);
  found.push(...journal, ...consistency);
  const seen = new Set<string>();
  const problems = found.filter(({ path, reason }) => {
    const key = `${reason}\u0000${path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  problems.sort((a, b) => compareText(a.path, b.path) || compareText(a.reason, b.reason));

  const byCode = new Map<ReadOnlyCode, string[]>();
  const add = (code: ReadOnlyCode, path: string) =>
    byCode.set(code, [...(byCode.get(code) ?? []), path]);
  if (unreadableWorkspace) add('unreadable-files', WORKSPACE_PATH);
  else if (compat === 'invalid') add('invalid-workspace', WORKSPACE_PATH);
  if (compat === 'readonly') add('newer-format', WORKSPACE_PATH);
  if (compat === 'upgrade-needed') add('older-format', WORKSPACE_PATH);
  for (const problem of problems) {
    const code = blockingCode(problem, problem.path.startsWith(`${JOURNAL_DIR}/`));
    if (code !== undefined) add(code, problem.path);
  }
  const reasons = REASON_ORDER.flatMap((code) => {
    const paths = byCode.get(code);
    return paths === undefined ? [] : [{ code, paths }];
  });

  // An operation file cut short is a journal that has not fully arrived (or a damaged one).
  const halfArrived = journal.some(({ reason }) => reason === 'malformed-json');
  const diverged = consistency.some(({ reason }) => reason === 'diverged');
  const sync = diverged || halfArrived ? 'behind' : 'ok';
  return { compat, sync, writable: reasons.length === 0, problems, reasons };
}
