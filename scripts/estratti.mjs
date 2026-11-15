// Bank accounts and statements from the command line (`pnpm estratti <command> ...`, plan 3a,
// task 8): profilo, conto, importa, decidi, annulla. The core does the work; this file reads
// the clock, makes the ids, opens the data folder with FsStore and reads the statement file
// (read only, never copied) as a CSV (core reader) or an XLSX (`python -I -m bollette_pdf table`).
//
// The output is one JSON line with a status, counts and ids: never a name, an IBAN, an amount, a
// description or a path, unless `--dettagli` asks for the held rows. Every message is constant.
// Plan 3b, task 8 adds inquilino, riconcilia, conferma and ripara (repairs what an interrupted
// operation left: `checkConsistency` blocks every reconciliation until then); plan 3b-bis adds
// annulla-pagamento (cancels one automatic payment: its movement goes back to review, R121); plan
// 3c adds escludi (excludes one movement written by an import; annulla-incassi takes it back).
// Exit codes: 0 done, 1 refused (or already imported), 2 arguments or files not valid, 3 an
// unexpected failure (an interrupted import is resumed by repeating `importa`).

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
  ExcludeReasonSchema,
  ISODateSchema,
  StatementReadError,
  StatementTableSchema,
  BankTransactionSchema,
  TenantSchema,
  TimestampSchema,
  YearMonthSchema,
  cancelAutomaticPayment,
  checkConsistency,
  confirmIncome,
  excludeMovement,
  importStatement,
  listExclusionProposals,
  loadAll,
  parseCsv,
  parseEuro,
  readJournal,
  repairDiverged,
  resolveHeld,
  runReconcile,
  saveAccount,
  saveBankProfile,
  saveTenant,
  undoImport,
  undoOperation,
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
  'dependent-payments': 'Rifiutato: dei pagamenti dipendono dai movimenti di questo estratto.',
  'later-changes': 'Rifiutato: dopo l’importazione ci sono state altre modifiche.',
  'journal-not-aligned': 'Rifiutato: il registro non è riallineato con i dati.',
  'inconsistent-store':
    'Rifiutato: i dati non sono come li lascia il registro: eseguire «pnpm estratti ripara».',
  'unknown-proposal': 'Rifiutato: proposta sconosciuta o già confermata.',
  'tenant-not-allowed': 'Rifiutato: inquilino non ammesso per questa proposta.',
  'empty-parts': 'Rifiutato: nessuna parte, o una parte senza importo positivo.',
  'sum-mismatch': 'Rifiutato: la somma delle parti non è l’importo del movimento.',
  'no-presence': 'Rifiutato: l’inquilino non ha una presenza nell’appartamento del conto.',
  'repair-refused': 'Rifiutato: un record sul disco è più recente del registro: serve una persona.',
  'not-income-operation':
    'Rifiutato: si annullano solo riconciliazioni e conferme degli incassi, pagamenti annullati ed esclusioni.',
  'unknown-payment': 'Rifiutato: pagamento sconosciuto o già annullato.',
  'not-automatic': 'Rifiutato: non è un pagamento automatico di una riconciliazione.',
  'unknown-operation': 'Rifiutato: operazione sconosciuta.',
  'already-undone': 'Rifiutato: l’operazione è già stata annullata.',
  'has-dependents': 'Rifiutato: operazioni successive dipendono da questa: annullarle prima.',
  'movement-has-dependents':
    'Rifiutato: dei record dipendono da questo movimento: annullarli prima.',
  'unknown-transaction': 'Rifiutato: movimento sconosciuto o cancellato.',
  'already-classified': 'Rifiutato: il movimento è già escluso o classificato: annullarlo prima.',
  failed: 'Operazione non riuscita: ripetere il comando (per un estratto, «importa»).',
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
  id: { type: 'string' },
  nome: { type: 'string' },
  lingua: { type: 'string' },
  prova: { type: 'boolean' },
  proposta: { type: 'string' },
  inquilino: { type: 'string' },
  operazione: { type: 'string' },
  pagamento: { type: 'string' },
  movimento: { type: 'string' },
  motivo: { type: 'string' },
  parte: { type: 'string', multiple: true },
  'solo-questa-volta': { type: 'boolean' },
};

const PART_KINDS = ['canone', 'conguaglio', 'caparra', 'altro'];

/** `<tipo>:<AAAA-MM>:<importo>` (the amount as `parseEuro` reads it, e.g. `850,00`). */
function parsePart(text) {
  const pieces = text.split(':');
  const forMonth = YearMonthSchema.safeParse(pieces[1]);
  if (pieces.length !== 3 || !PART_KINDS.includes(pieces[0]) || !forMonth.success) {
    throw invalid('bad-arguments');
  }
  try {
    return { kind: pieces[0], forMonth: forMonth.data, amount: parseEuro(pieces[2]) };
  } catch {
    throw invalid('bad-arguments');
  }
}

function need(values, ...names) {
  for (const name of names) {
    if (typeof values[name] !== 'string' || values[name] === '') throw invalid('bad-arguments');
  }
}

/** The text of a JSON file or of a statement, read only; never longer than `MAX_FILE_BYTES`. */
function readBytes(file) {
  try {
    // A directory, a FIFO or /dev/zero has size 0 but never ends: only a regular file is read.
    const info = statSync(file);
    if (!info.isFile() || info.size > MAX_FILE_BYTES) throw invalid('bad-file');
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
    let table;
    if (profile.container === 'xlsx') {
      table = xlsxTable(file);
      // Python reads the file itself: if it changed since `bytes` (the hash), the table is not the file's.
      if (!readBytes(file).equals(bytes)) throw invalid('unreadable-statement');
    } else {
      table = csvTable(bytes, profile.csvSeparator ?? ';');
    }
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

  if (name === 'inquilino') {
    need(values, 'id', 'nome');
    if (
      positionals.length > 0 ||
      !/^[A-Za-z0-9_-]{1,64}$/.test(values.id) ||
      (values.lingua !== undefined && !['it', 'en'].includes(values.lingua))
    ) {
      throw invalid('bad-arguments');
    }
    let operation;
    try {
      operation = await saveTenant(
        store,
        {
          id: values.id,
          name: values.nome,
          ...(values.lingua === undefined ? {} : { language: values.lingua }),
        },
        who,
        clock,
        newId,
      );
    } catch (error) {
      // An id the store refuses (a name reserved on Windows, a bad segment) is a bad argument.
      if (error instanceof RangeError) throw invalid('bad-arguments');
      throw error;
    }
    return { status: 'saved', id: values.id, operationId: operation.id };
  }

  if (name === 'riconcilia') {
    if (positionals.length > 0) throw invalid('bad-arguments');
    const result = await runReconcile(store, who, clock, newId, { dryRun: values.prova === true });
    if (result.status === 'refused') throw new Stop('rejected', result.reason);
    let extra = () => ({});
    let arrearExtra = () => ({});
    if (values.dettagli === true) {
      const all = { includeDeleted: true };
      const txs = (await loadAll(store, 'transaction', BankTransactionSchema, all)).records;
      const tenants = (await loadAll(store, 'tenant', TenantSchema, all)).records;
      arrearExtra = (a) => ({
        apartmentId: a.apartmentId,
        tenantId: a.tenantId,
        tenantName: tenants.find((t) => t.id === a.tenantId)?.name ?? a.tenantId,
      });
      extra = (p) => {
        const tx = txs.find((t) => t.id === p.transactionId);
        return {
          tenantIds: p.tenantIds,
          date: tx?.date,
          amount: tx?.amount,
          description: tx?.description,
          tenantNames: p.tenantIds.map((id) => tenants.find((t) => t.id === id)?.name ?? id),
        };
      };
    }
    return {
      status: 'reconciled',
      written: result.written,
      proposals: result.proposals.map((p) => ({
        id: p.id,
        step: p.step,
        reason: p.reason,
        // Ids are chosen by the user (they could be real names): only a count without --dettagli.
        tenantCount: p.tenantIds.length,
        ...(p.month === undefined ? {} : { month: p.month }),
        ...extra(p),
      })),
      skipped: result.skipped,
      // Only id and reason: the movement id, the date and the amount stay out (R124).
      exclusions: (await listExclusionProposals(store)).map((e) => ({
        id: e.id,
        reason: e.reason,
      })),
      // Only the month without --dettagli (R117): ids are chosen by the user, like tenantIds.
      arrears: result.arrears.map((a) => ({ month: a.month, ...arrearExtra(a) })),
      ...(result.operationId === undefined ? {} : { operationId: result.operationId }),
    };
  }

  if (name === 'conferma') {
    need(values, 'proposta', 'inquilino');
    if (positionals.length > 0 || values.parte === undefined) throw invalid('bad-arguments');
    const result = await confirmIncome(
      store,
      {
        proposalId: values.proposta,
        tenantId: values.inquilino,
        parts: values.parte.map(parsePart),
        rememberPayer: values['solo-questa-volta'] !== true,
      },
      who,
      clock,
      newId,
    );
    if (result.status === 'refused') throw new Stop('rejected', result.reason);
    return {
      status: 'confirmed',
      operationId: result.operationId,
      paymentIds: result.paymentIds,
      ...(result.payerId === undefined ? {} : { payerId: result.payerId }),
    };
  }

  if (name === 'annulla-incassi') {
    need(values, 'operazione');
    if (positionals.length > 0) throw invalid('bad-arguments');
    const { operations } = await readJournal(store);
    const target = operations.find((o) => o.id === values.operazione);
    if (target === undefined) throw new Stop('rejected', 'unknown-operation');
    const kinds = [
      'income.reconcile',
      'income.confirm',
      'income.cancel-payment',
      'movement.exclude',
    ];
    if (!kinds.includes(target.kind)) {
      throw new Stop('rejected', 'not-income-operation');
    }
    try {
      const undone = await undoOperation(store, target.id, who, clock, newId);
      return { status: 'undone', operationId: undone.id };
    } catch (error) {
      const text = error instanceof Error ? error.message : '';
      if (text.includes('was already undone')) throw new Stop('rejected', 'already-undone');
      if (text.includes('depend on it')) throw new Stop('rejected', 'has-dependents');
      if (text.startsWith('Cannot undo:')) throw new Stop('rejected', 'journal-not-aligned');
      throw error;
    }
  }

  if (name === 'annulla-pagamento') {
    need(values, 'pagamento');
    if (positionals.length > 0) throw invalid('bad-arguments');
    const result = await cancelAutomaticPayment(store, values.pagamento, who, clock, newId);
    if (result.status === 'refused') throw new Stop('rejected', result.reason);
    return { status: 'cancelled', operationId: result.operationId };
  }

  if (name === 'escludi') {
    need(values, 'movimento', 'motivo');
    if (positionals.length > 0 || !ExcludeReasonSchema.safeParse(values.motivo).success) {
      throw invalid('bad-arguments');
    }
    const result = await excludeMovement(
      store,
      { transactionId: values.movimento, reason: values.motivo },
      who,
      clock,
      newId,
    );
    if (result.status === 'refused' && result.reason === 'has-dependents') {
      // The reason is the core's; the message is the one of a movement, not of an operation.
      throw new Stop('rejected', result.reason, {
        message: MESSAGES['movement-has-dependents'],
        recordIds: result.recordIds,
      });
    }
    if (result.status === 'refused') throw new Stop('rejected', result.reason);
    return { status: 'excluded', operationId: result.operationId };
  }

  if (name === 'ripara') {
    if (positionals.length > 0) throw invalid('bad-arguments');
    // Writes each record as its latest operation in the journal says; one that is newer on disk is left.
    const problems = await checkConsistency(store);
    for (const problem of problems) {
      try {
        await repairDiverged(store, problem.path);
      } catch {
        throw new Stop('rejected', 'repair-refused');
      }
    }
    return { status: 'repaired', repaired: problems.length };
  }

  // annulla
  need(values, 'estratto');
  try {
    const result = await undoImport(store, values.estratto, who, clock, newId);
    if (result.status === 'refused') {
      throw new Stop(
        'rejected',
        result.reason,
        result.reason === 'dependent-payments' ? { paymentIds: result.paymentIds } : {},
      );
    }
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
    if (
      ![
        'profilo',
        'conto',
        'importa',
        'decidi',
        'annulla',
        'inquilino',
        'riconcilia',
        'conferma',
        'ripara',
        'annulla-incassi',
        'annulla-pagamento',
        'escludi',
      ].includes(name ?? '')
    ) {
      throw invalid('bad-arguments');
    }
    let parsed;
    try {
      parsed = parseArgs({ args: rest, options: OPTIONS, allowPositionals: true, strict: true });
    } catch {
      throw invalid('bad-arguments');
    }
    const { values, positionals } = parsed;
    // An option of another command would be ignored in silence (`conferma --prova` would write).
    const only = {
      prova: ['riconcilia'],
      dettagli: ['riconcilia', 'importa'],
      parte: ['conferma'],
      'solo-questa-volta': ['conferma'],
      pagamento: ['annulla-pagamento'],
      movimento: ['escludi'],
      motivo: ['escludi'],
    };
    for (const [option, commands] of Object.entries(only)) {
      if (values[option] !== undefined && !commands.includes(name)) throw invalid('bad-arguments');
    }
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
    return done(3, { status: 'failed', reason: 'failed', message: MESSAGES.failed });
  }
}

if (
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { code, output } = await main(process.argv.slice(2));
  process.stdout.write(output, () => process.exit(code));
}
