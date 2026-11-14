// Bank accounts and statements from the command line (`pnpm estratti <command> ...`, plan 3a,
// task 8): profilo, conto, importa, decidi, annulla. The core does the work; this file reads
// the clock, makes the ids, opens the data folder with FsStore and reads the statement file
// (read only, never copied) as a CSV (core reader) or an XLSX (`python -I -m bollette_pdf table`).
//
// The output is one JSON line with a status, counts and ids: never a name, an IBAN, an amount, a
// description or a path, unless `--dettagli` asks for the held rows. Every message is constant.
// Exit codes: 0 done, 1 refused (or already imported), 2 arguments or files not valid.

import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { FsStore } from '../packages/store-fs/src/fs-store.ts';
import {
  AccountSchema,
  BankProfileSchema,
  CsvError,
  ISODateSchema,
  StatementReadError,
  StatementTableSchema,
  TimestampSchema,
  importStatement,
  loadAll,
  parseCsv,
  resolveHeld,
  saveAccount,
  saveBankProfile,
  undoImport,
} from '../packages/core/src/index.ts';

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const PYTHON_TIMEOUT_MS = 60_000;

const MESSAGES = {
  'bad-arguments': 'Argomenti non validi: vedere l’uso di «pnpm estratti».',
  'bad-folder': 'La cartella dei dati non esiste o non è una cartella.',
  'bad-file': 'Il file non esiste, non si può leggere o è troppo grande.',
  'bad-profile': 'Il profilo della banca non è valido.',
  'unreadable-statement': 'L’estratto non si può leggere: file non valido o troppo grande.',
  'no-python': 'Impossibile leggere l’XLSX: interprete Python non utilizzabile.',
  'already-imported': 'Questo estratto è già stato importato.',
  'unknown-apartment': 'Rifiutato: appartamento sconosciuto.',
  'unknown-bank-profile': 'Rifiutato: profilo della banca sconosciuto.',
  'bad-iban': 'Rifiutato: IBAN non valido.',
  'iban-in-use': 'Rifiutato: IBAN già usato da un altro conto.',
  'unknown-account': 'Rifiutato: conto sconosciuto.',
  'wrong-profile': 'Rifiutato: il profilo non è quello del conto.',
  'wrong-account': 'Rifiutato: il conto dell’estratto non è quello indicato.',
  'bad-declared-account': 'Rifiutato: il conto scritto nell’estratto è vuoto.',
  'masked-account': 'Rifiutato: il conto scritto nell’estratto è mascherato.',
  'needs-period': 'Rifiutato: serve il periodo (--dal e --al).',
  'period-mismatch': 'Rifiutato: il periodo indicato non è quello dell’estratto.',
  'row-outside-period': 'Rifiutato: una riga è fuori dal periodo.',
  'not-decidable': 'Rifiutato: estratto sconosciuto, o riga non da decidere o già decisa.',
  'no-import': 'Rifiutato: nessuna importazione da annullare per questo estratto.',
  'shared-transactions': 'Rifiutato: un altro estratto elenca gli stessi movimenti.',
  'held-duplicates': 'Rifiutato: un altro estratto ha righe da rivedere che ne dipendono.',
  'later-changes': 'Rifiutato: dopo l’importazione ci sono state altre modifiche.',
  'journal-not-aligned': 'Rifiutato: il registro non è riallineato con i dati.',
  failed: 'Operazione non riuscita.',
};

/** Thrown to stop with a status; `invalid` is exit 2, `rejected` exit 1. */
class Stop extends Error {
  constructor(status, reason, extra = {}) {
    super(reason);
    this.status = status;
    this.reason = reason;
    this.extra = extra;
  }
}
const invalid = (reason, extra) => new Stop('invalid', reason, extra);

const OPTIONS = {
  cartella: { type: 'string' },
  utente: { type: 'string' },
  ora: { type: 'string' },
  appartamento: { type: 'string' },
  profilo: { type: 'string' },
  etichetta: { type: 'string' },
  iban: { type: 'string' },
  conto: { type: 'string' },
  dal: { type: 'string' },
  al: { type: 'string' },
  estratto: { type: 'string' },
  riga: { type: 'string' },
  tieni: { type: 'boolean' },
  escludi: { type: 'boolean' },
  dettagli: { type: 'boolean' },
};

function need(values, ...names) {
  for (const name of names) {
    if (typeof values[name] !== 'string' || values[name] === '') throw invalid('bad-arguments');
  }
}

/** The text of a JSON file or of a statement, read only; never longer than `MAX_FILE_BYTES`. */
function readBytes(file) {
  try {
    if (statSync(file).size > MAX_FILE_BYTES) throw invalid('bad-file');
    return readFileSync(file);
  } catch (error) {
    throw error instanceof Stop ? error : invalid('bad-file');
  }
}

/** The table of an XLSX, from the Python reader: no shell, a timeout, at most 8 MB of output. */
function xlsxTable(file) {
  const interpreter = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  const run = spawnSync(interpreter, ['-I', '-m', 'bollette_pdf', 'table', file], {
    timeout: PYTHON_TIMEOUT_MS,
    maxBuffer: MAX_FILE_BYTES,
    stdio: ['ignore', 'pipe', 'ignore'],
    windowsHide: true,
  });
  // ENOENT/EACCES: no interpreter; ETIMEDOUT/ENOBUFS: the reader was killed.
  if (run.error?.code === 'ENOENT' || run.error?.code === 'EACCES') throw invalid('no-python');
  if (run.error !== undefined || run.status !== 0) throw invalid('unreadable-statement');
  try {
    return StatementTableSchema.parse(JSON.parse(run.stdout.toString('utf8')));
  } catch {
    throw invalid('unreadable-statement');
  }
}

function csvTable(bytes, separator) {
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw invalid('unreadable-statement');
  }
  try {
    return parseCsv(text, separator);
  } catch (error) {
    if (error instanceof CsvError) {
      throw invalid('unreadable-statement', { code: error.code, row: error.row });
    }
    throw error;
  }
}

async function command(name, values, positionals, store, who, clock, newId) {
  if (name === 'profilo') {
    if (positionals.length !== 1) throw invalid('bad-arguments');
    let profile;
    try {
      profile = BankProfileSchema.parse(JSON.parse(readBytes(positionals[0]).toString('utf8')));
    } catch (error) {
      throw error instanceof Stop ? error : invalid('bad-profile');
    }
    const operation = await saveBankProfile(store, profile, who, clock, newId);
    return { status: 'saved', id: profile.id, operationId: operation.id };
  }

  if (name === 'conto') {
    need(values, 'appartamento', 'profilo', 'etichetta');
    const result = await saveAccount(
      store,
      {
        apartmentId: values.appartamento,
        label: values.etichetta,
        bankProfileId: values.profilo,
        ...(values.iban === undefined ? {} : { iban: values.iban }),
      },
      who,
      clock,
      newId,
    );
    if (result.status === 'rejected') throw new Stop('rejected', result.reason);
    return { status: 'saved', id: result.account.id, operationId: result.operationId };
  }

  if (name === 'importa') {
    need(values, 'conto');
    if (positionals.length !== 1 || (values.dal === undefined) !== (values.al === undefined)) {
      throw invalid('bad-arguments');
    }
    const period =
      values.dal === undefined
        ? undefined
        : { from: ISODateSchema.safeParse(values.dal), to: ISODateSchema.safeParse(values.al) };
    if (period !== undefined && !(period.from.success && period.to.success)) {
      throw invalid('bad-arguments');
    }
    const account = (await loadAll(store, 'account', AccountSchema)).records.find(
      (a) => a.id === values.conto,
    );
    const profile = (await loadAll(store, 'bankProfile', BankProfileSchema)).records.find(
      (p) => p.id === account?.bankProfileId,
    );
    if (account === undefined || profile === undefined) {
      throw new Stop('rejected', account === undefined ? 'unknown-account' : 'wrong-profile');
    }
    const file = positionals[0];
    const bytes = readBytes(file);
    const table =
      profile.container === 'xlsx' ? xlsxTable(file) : csvTable(bytes, profile.csvSeparator ?? ';');
    let result;
    try {
      result = await importStatement(
        store,
        {
          accountId: account.id,
          fileBytes: new Uint8Array(bytes),
          // The name goes into the statement record (the data folder), never into the output.
          fileName: file.split(/[\\/]/).at(-1) ?? 'estratto',
          table,
          ...(period === undefined
            ? {}
            : { period: { from: period.from.data, to: period.to.data } }),
        },
        who,
        clock,
        newId,
      );
    } catch (error) {
      if (error instanceof StatementReadError) {
        throw invalid('unreadable-statement', {
          code: error.code,
          row: error.row,
          ...(error.column === undefined ? {} : { column: error.column }),
        });
      }
      throw error;
    }
    if (result.status === 'already-imported') {
      throw new Stop('already-imported', 'already-imported', { statementId: result.statementId });
    }
    if (result.status === 'rejected') {
      throw new Stop(
        'rejected',
        result.reason,
        result.row === undefined ? {} : { row: result.row },
      );
    }
    const waiting = result.statement.held.filter((h) => h.decision === undefined);
    return {
      status: 'imported',
      statementId: result.statement.id,
      added: result.added,
      alreadyKnown: result.alreadyKnown,
      held: result.held,
      heldRows: waiting.map((h) => h.row),
      ...(values.dettagli === true
        ? {
            details: waiting.map((h) => ({
              row: h.row,
              date: h.transaction.date,
              amount: h.transaction.amount,
              description: h.transaction.description,
            })),
          }
        : {}),
    };
  }

  if (name === 'decidi') {
    need(values, 'estratto', 'riga');
    if (
      (values.tieni === true) === (values.escludi === true) ||
      !/^[1-9][0-9]{0,8}$/.test(values.riga)
    ) {
      throw invalid('bad-arguments');
    }
    const decision = values.tieni === true ? 'keep' : 'exclude';
    try {
      await resolveHeld(store, values.estratto, Number(values.riga), decision, who, clock, newId);
    } catch (error) {
      if (error instanceof RangeError) throw new Stop('rejected', 'not-decidable');
      throw error;
    }
    return { status: 'decided', statementId: values.estratto, row: Number(values.riga), decision };
  }

  // annulla
  need(values, 'estratto');
  try {
    const result = await undoImport(store, values.estratto, who, clock, newId);
    if (result.status === 'refused') throw new Stop('rejected', result.reason);
    return { status: 'undone', statementId: values.estratto, operationId: result.operation.id };
  } catch (error) {
    if (error instanceof Stop) throw error;
    if (error instanceof RangeError) throw new Stop('rejected', 'no-import');
    // refuseIfDiverged (journal.ts): the folder is not as the journal leaves it (R106, N2).
    if (error instanceof Error && error.message.startsWith('Cannot undo:')) {
      throw new Stop('rejected', 'journal-not-aligned');
    }
    throw error;
  }
}

/**
 * Runs one command line. `io.now` is the clock and `io.newId` the generator of ids (both live
 * outside the core); returns the exit code and the JSON line.
 */
export async function main(argv, io = { now: () => new Date().toISOString(), newId: randomUUID }) {
  const done = (code, body) => ({ code, output: `${JSON.stringify(body)}\n` });
  try {
    const [name, ...rest] = argv;
    if (!['profilo', 'conto', 'importa', 'decidi', 'annulla'].includes(name ?? '')) {
      throw invalid('bad-arguments');
    }
    let parsed;
    try {
      parsed = parseArgs({ args: rest, options: OPTIONS, allowPositionals: true, strict: true });
    } catch {
      throw invalid('bad-arguments');
    }
    const { values, positionals } = parsed;
    need(values, 'cartella');
    const now = values.ora ?? io.now();
    if (!TimestampSchema.safeParse(now).success) throw invalid('bad-arguments');
    try {
      if (!statSync(values.cartella).isDirectory()) throw new Error('not a folder');
    } catch {
      throw invalid('bad-folder');
    }
    const store = new FsStore(values.cartella);
    const body = await command(
      name,
      values,
      positionals,
      store,
      values.utente ?? 'cli',
      () => now,
      io.newId,
    );
    return done(0, body);
  } catch (error) {
    if (error instanceof Stop) {
      return done(error.status === 'invalid' ? 2 : 1, {
        status: error.status,
        reason: error.reason,
        message: MESSAGES[error.reason],
        ...error.extra,
      });
    }
    // Never the message or the stack: they could hold a path or a value.
    return done(1, { status: 'rejected', reason: 'failed', message: MESSAGES.failed });
  }
}

if (
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { code, output } = await main(process.argv.slice(2));
  process.stdout.write(output, () => process.exit(code));
}
