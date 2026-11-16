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
// 3c adds escludi (excludes one movement written by an import), abbina (confirms a match of bills
// and instalments by hand) and annulla-riconciliazione (undoes one operation of the
// reconciliation; annulla-incassi is its synonym, R116); riconcilia runs every phase (R126);
// uscita, annulla-uscita, uscita-inquilino, giroconto, giroconto-manuale and saldi (R132);
// plan 3d adds imu-atteso (the expected IMU of an apartment and year), imu-f24 (an F24
// assigned to an IMU rate by hand) and imu (the check of the rates); plan 7 adds contratto (a
// lease contract; it replaces every field, so an option left out, --presenze and --caparre
// included, removes it), contratto-canone (an entry of its rent history) and contratti (the contracts
// and their read-only checks).
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
  OutgoingKindSchema,
  TenantSchema,
  TransferPurposeSchema,
  TimestampSchema,
  YearMonthSchema,
  YearSchema,
  cancelAutomaticClass,
  cancelAutomaticPayment,
  checkConsistency,
  confirmIncome,
  confirmMatch,
  confirmOutgoing,
  confirmTenantOutgoing,
  confirmTransfer,
  excludeMovement,
  importStatement,
  loadContractChecks,
  loadAccountBalances,
  loadImuRates,
  loadAll,
  parseCsv,
  parseEuro,
  readJournal,
  recordManualTransfer,
  repairDiverged,
  resolveHeld,
  runReconciliation,
  saveAccount,
  saveBankProfile,
  saveContract,
  setContractRent,
  saveTenant,
  setImuYear,
  assignImuF24,
  undoBlockedBy,
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
  'invalid-kind': 'Rifiutato: tipo non ammesso per un’uscita verso un inquilino.',
  'rule-conflict-dates':
    'Rifiutato: una regola in conflitto comincia il giorno del movimento o dopo; confermare «solo questa volta».',
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
  'dependent-records':
    'Rifiutato: abbinamenti o classificazioni dipendono dai movimenti di questo estratto.',
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
  'not-reconcile-operation':
    'Rifiutato: si annullano solo le operazioni della riconciliazione (incassi, esclusioni, abbinamenti, uscite, giroconti, IMU, contratti).',
  'unknown-payment': 'Rifiutato: pagamento sconosciuto o già annullato.',
  'not-automatic': 'Rifiutato: non è un pagamento automatico di una riconciliazione.',
  'unknown-operation': 'Rifiutato: operazione sconosciuta.',
  'already-undone': 'Rifiutato: l’operazione è già stata annullata.',
  'has-dependents': 'Rifiutato: operazioni successive dipendono da questa: annullarle prima.',
  'movement-has-dependents':
    'Rifiutato: dei record dipendono da questo movimento: annullarli prima.',
  'unknown-transaction': 'Rifiutato: movimento sconosciuto o cancellato.',
  'already-classified': 'Rifiutato: il movimento è già escluso o classificato: annullarlo prima.',
  'unknown-item': 'Rifiutato: bolletta o rata sconosciuta o cancellata.',
  'transaction-used': 'Rifiutato: il movimento è escluso, già pagato o classificato a mano.',
  'duplicate-part': 'Rifiutato: la stessa parte compare due volte.',
  'invalid-group': 'Rifiutato: l’avviso comune della rata non è valido.',
  'invalid-matches': 'Rifiutato: le somme dell’abbinamento non tornano.',
  'unknown-class': 'Rifiutato: il movimento non ha una classificazione.',
  'class-not-automatic': 'Rifiutato: non è una classificazione automatica di una riconciliazione.',
  'f24-not-tasse': 'Rifiutato: un F24 va nella categoria «tasse».',
  'f24-not-outgoing': 'Rifiutato: un F24 è solo un’uscita.',
  'leg-not-allowed': 'Rifiutato: il movimento indicato non è una gamba di questo giroconto.',
  'same-account': 'Rifiutato: i due conti sono lo stesso conto.',
  'invalid-amount': 'Rifiutato: l’importo deve essere positivo.',
  'bad-rates': 'Rifiutato: le rate vanno numerate da 1 senza buchi, con importi positivi.',
  'rates-mismatch':
    'Rifiutato: un altro appartamento dello stesso gruppo e anno ha un altro numero di rate.',
  'not-imu-candidate':
    'Rifiutato: il movimento non è un F24 da assegnare (proposta F24 o F24 da ripartire del conto).',
  'unknown-rate': 'Rifiutato: nessun appartamento del gruppo ha questa rata in questo anno.',
  'payer-not-in-group': 'Rifiutato: l’appartamento del conto non è nel gruppo in questo anno.',
  'rate-already-paid': 'Rifiutato: un altro F24 è già assegnato a questa rata.',
  'imu-to-reconcile': 'Rata IMU da riconciliare: controllare gli importi attesi (imu-atteso).',
  'unknown-tenancy': 'Rifiutato: una presenza indicata non esiste o è di un altro appartamento.',
  'unknown-deposit':
    'Rifiutato: una caparra indicata non è un pagamento «caparra» di questo appartamento.',
  'rent-outside-contract':
    'Rifiutato: le nuove date lasciano fuori una voce del canone già scritta.',
  'unknown-contract': 'Rifiutato: contratto sconosciuto o cancellato.',
  'invalid-contract': 'Rifiutato: i dati del contratto non sono validi.',
  'month-outside-contract': 'Rifiutato: il mese è fuori dalle date del contratto.',
  'bad-amount': 'Rifiutato: il canone deve essere positivo e l’acconto non negativo.',
  'rent-differs':
    'Canone del contratto diverso dal totale delle presenze: controllare il contratto o le presenze.',
  'f24-pattern-missing':
    'Nota: il profilo della banca non riconosce ancora gli F24 di questo conto.',
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
  categoria: { type: 'string' },
  f24: { type: 'boolean' },
  tipo: { type: 'string' },
  mese: { type: 'string' },
  scopo: { type: 'string' },
  'altra-gamba': { type: 'string' },
  gambe: { type: 'string' },
  da: { type: 'string' },
  a: { type: 'string' },
  importo: { type: 'string' },
  data: { type: 'string' },
  anno: { type: 'string' },
  gruppo: { type: 'string' },
  totale: { type: 'string' },
  rata: { type: 'string', multiple: true },
  inizio: { type: 'string' },
  fine: { type: 'string' },
  conguaglio: { type: 'string' },
  concordato: { type: 'boolean' },
  studenti: { type: 'boolean' },
  durata: { type: 'string' },
  firmato: { type: 'string' },
  'codice-registrazione': { type: 'string' },
  registrato: { type: 'string' },
  regime: { type: 'string' },
  'aliquota-cedolare': { type: 'string' },
  presenze: { type: 'string' },
  caparre: { type: 'string' },
  contratto: { type: 'string' },
  canone: { type: 'string' },
  acconto: { type: 'string' },
};

/** The kinds of an outgoing to a tenant: never `canone`, the rent is an income (R130). */
const TENANT_KINDS = ['caparra', 'conguaglio', 'altro'];
/** The operations `annulla-riconciliazione` undoes (R116, R126, R132). */
const RECONCILE_KINDS = [
  'income.reconcile',
  'income.confirm',
  'income.cancel-payment',
  'movement.exclude',
  'match.reconcile',
  'match.confirm',
  'outgoing.reconcile',
  'outgoing.confirm',
  'outgoing.cancel-auto',
  'outgoing.tenant',
  'transfer.reconcile',
  'transfer.confirm',
  'transfer.manual',
  'imu.expected',
  'imu.assign',
  'contract.save',
  'contract.rent',
];

const PART_KINDS = ['canone', 'conguaglio', 'caparra', 'altro'];

/** `<bill|instalment>:<voce>:<movimento>:<importo>[:commissione]` (amount as `parseEuro` reads it). */
function parseMatchPart(text) {
  const [itemType, itemId, transactionId, amount, commission, ...rest] = text.split(':');
  if (
    !['bill', 'instalment'].includes(itemType) ||
    !itemId ||
    !transactionId ||
    rest.length > 0 ||
    ![undefined, 'commissione'].includes(commission)
  ) {
    throw invalid('bad-arguments');
  }
  try {
    const part = commission === undefined ? 'amount' : 'commission';
    return { itemType, itemId, transactionId, amount: parseEuro(amount ?? ''), part };
  } catch {
    throw invalid('bad-arguments');
  }
}

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

/** `<n>[:<importo>][:<AAAA-MM-GG>]`: an empty or missing field is not known (plan 3d). */
function parseRate(text) {
  const [index, amount = '', dueDate = '', ...rest] = text.split(':');
  const date = ISODateSchema.safeParse(dueDate);
  if (!/^[1-9][0-9]{0,2}$/.test(index) || rest.length > 0 || (dueDate !== '' && !date.success)) {
    throw invalid('bad-arguments');
  }
  return {
    index: Number(index),
    ...(amount === '' ? {} : { expected: euro(amount) }),
    ...(dueDate === '' ? {} : { dueDate: date.data }),
  };
}

/** `<id>,<id>` as `--gambe` (R132): an empty, repeated or unsafe id is a bad argument. */
function idList(text) {
  if (text === undefined) return undefined;
  const list = text.split(',');
  if (list.some((id) => !/^[A-Za-z0-9_-]{1,128}$/.test(id)) || new Set(list).size !== list.length) {
    throw invalid('bad-arguments');
  }
  return list;
}

/** A percentage `10` or `10,5` (at most two decimals) as whole basis points, 1..10000. */
function basisPoints(text) {
  const found = /^([0-9]{1,3})(?:,([0-9]{1,2}))?$/.exec(text);
  if (found === null) throw invalid('bad-arguments');
  const bp = Number(found[1]) * 100 + Number((found[2] ?? '').padEnd(2, '0'));
  if (bp < 1 || bp > 10000) throw invalid('bad-arguments');
  return bp;
}

const month = (text) => {
  const parsed = YearMonthSchema.safeParse(text);
  if (!parsed.success) throw invalid('bad-arguments');
  return parsed.data;
};
const day = (text) => {
  const parsed = ISODateSchema.safeParse(text);
  if (!parsed.success) throw invalid('bad-arguments');
  return parsed.data;
};
const optional = (key, value) => (value === undefined ? {} : { [key]: value });

/** An amount as `parseEuro` reads it; anything else is a bad argument. */
function euro(text) {
  try {
    return parseEuro(text);
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
    const run = await runReconciliation(store, who, clock, newId, {
      dryRun: values.prova === true,
    });
    if (run.status === 'refused') throw new Stop('rejected', run.reason);
    const { income: result, match, transfers, outgoing } = run;
    let extra = () => ({});
    let arrearExtra = () => ({});
    let txExtra = () => ({});
    if (values.dettagli === true) {
      const all = { includeDeleted: true };
      const txs = (await loadAll(store, 'transaction', BankTransactionSchema, all)).records;
      const tenants = (await loadAll(store, 'tenant', TenantSchema, all)).records;
      txExtra = (p) => {
        const tx = txs.find((t) => t.id === p.transactionId);
        return {
          transactionId: p.transactionId,
          date: tx?.date,
          amount: tx?.amount,
          description: tx?.description,
        };
      };
      arrearExtra = (a) => ({
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
    // No F24 is recognised while the profile of the account has no f24Pattern (R129): say so.
    const profiles = (await loadAll(store, 'bankProfile', BankProfileSchema)).records;
    const notes = (await loadAll(store, 'account', AccountSchema)).records
      .filter((a) => profiles.find((p) => p.id === a.bankProfileId)?.f24Pattern === undefined)
      .map((a) => ({
        accountId: a.id,
        f24PatternMissing: true,
        message: MESSAGES['f24-pattern-missing'],
      }));
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
      exclusions: run.exclusions.map((e) => ({
        id: e.id,
        reason: e.reason,
      })),
      // Month and apartment (its id is always shown, user1, 15 Nov 2026, R117); the tenant,
      // whose id is chosen by the user like tenantIds, only with --dettagli.
      arrears: result.arrears.map((a) => ({
        month: a.month,
        apartmentId: a.apartmentId,
        ...arrearExtra(a),
      })),
      ...(result.operationId === undefined ? {} : { operationId: result.operationId }),
      // Ids, reasons and counts only (R107, R126).
      match: {
        written: match.written,
        yielded: match.yielded,
        proposals: match.proposals.map((p) => ({ id: p.id, reason: p.reason })),
        pending: match.pending.length,
        assumed: match.assumed.length,
        invalidGroups: match.invalidGroups.length,
        ...(match.operationId === undefined ? {} : { operationId: match.operationId }),
      },
      // Ids, reasons and counts only (R132); the movements and the legs with --dettagli.
      transfers: {
        written: transfers.written,
        completed: transfers.completed,
        proposals: transfers.proposals.map((p) => ({
          id: p.id,
          reason: p.reason,
          legCount: p.legIds.length,
          // Movement ids, as inside `p-giro-<id>`: `giroconto --gambe` gives them back (R132).
          legIds: p.legIds,
          ...txExtra(p),
        })),
        ...(transfers.operationId === undefined ? {} : { operationId: transfers.operationId }),
      },
      outgoing: {
        written: outgoing.written,
        proposals: outgoing.proposals.map((p) => ({
          id: p.id,
          step: p.step,
          reason: p.reason,
          ...(p.suggestedKind === undefined ? {} : { suggestedKind: p.suggestedKind }),
          ...txExtra(p),
        })),
        missingDocument: outgoing.missingDocument.length,
        ...(outgoing.operationId === undefined ? {} : { operationId: outgoing.operationId }),
      },
      notes,
    };
  }

  if (name === 'uscita') {
    need(values, 'proposta', 'categoria', 'appartamento');
    if (positionals.length > 0 || !OutgoingKindSchema.safeParse(values.categoria).success) {
      throw invalid('bad-arguments');
    }
    const result = await confirmOutgoing(
      store,
      {
        proposalId: values.proposta,
        kind: values.categoria,
        apartmentId: values.appartamento,
        rememberRule: values['solo-questa-volta'] !== true,
        f24: values.f24 === true,
      },
      who,
      clock,
      newId,
    );
    if (result.status === 'refused') throw new Stop('rejected', result.reason);
    return {
      status: 'confirmed',
      operationId: result.operationId,
      classId: result.classId,
      ...(result.ruleId === undefined ? {} : { ruleId: result.ruleId }),
    };
  }

  if (name === 'annulla-uscita') {
    need(values, 'movimento');
    if (positionals.length > 0) throw invalid('bad-arguments');
    const result = await cancelAutomaticClass(store, values.movimento, who, clock, newId);
    if (result.status === 'refused' && result.reason === 'not-automatic') {
      // The reason is the core's; the message is the one of a class, not of a payment.
      throw new Stop('rejected', result.reason, { message: MESSAGES['class-not-automatic'] });
    }
    if (result.status === 'refused') throw new Stop('rejected', result.reason);
    return { status: 'cancelled', operationId: result.operationId };
  }

  if (name === 'uscita-inquilino') {
    need(values, 'proposta', 'inquilino', 'tipo', 'mese');
    if (
      positionals.length > 0 ||
      !TENANT_KINDS.includes(values.tipo) ||
      !YearMonthSchema.safeParse(values.mese).success
    ) {
      throw invalid('bad-arguments');
    }
    const result = await confirmTenantOutgoing(
      store,
      {
        proposalId: values.proposta,
        tenantId: values.inquilino,
        kind: values.tipo,
        forMonth: values.mese,
      },
      who,
      clock,
      newId,
    );
    if (result.status === 'refused') throw new Stop('rejected', result.reason);
    return { status: 'confirmed', operationId: result.operationId, paymentId: result.paymentId };
  }

  if (name === 'giroconto') {
    need(values, 'proposta', 'scopo');
    if (positionals.length > 0 || !TransferPurposeSchema.safeParse(values.scopo).success) {
      throw invalid('bad-arguments');
    }
    // The legs the user saw in `riconcilia` (none without --gambe): the core recomputes them and
    // refuses `unknown-proposal` when they differ (R127), e.g. the only leg excluded since.
    const legIds = values.gambe === undefined ? [] : values.gambe.split(',');
    if (
      legIds.some((id) => !/^[A-Za-z0-9_-]{1,128}$/.test(id)) ||
      new Set(legIds).size !== legIds.length
    ) {
      throw invalid('bad-arguments');
    }
    const result = await confirmTransfer(
      store,
      {
        proposalId: values.proposta,
        purpose: values.scopo,
        rememberPair: values['solo-questa-volta'] !== true,
        legIds,
        ...(values['altra-gamba'] === undefined ? {} : { otherLegId: values['altra-gamba'] }),
      },
      who,
      clock,
      newId,
    );
    if (result.status === 'refused') throw new Stop('rejected', result.reason);
    return { status: 'confirmed', operationId: result.operationId, transferId: result.transferId };
  }

  if (name === 'giroconto-manuale') {
    need(values, 'da', 'a', 'importo', 'data', 'scopo');
    const date = ISODateSchema.safeParse(values.data);
    if (
      positionals.length > 0 ||
      !date.success ||
      !TransferPurposeSchema.safeParse(values.scopo).success
    ) {
      throw invalid('bad-arguments');
    }
    let amount;
    try {
      amount = parseEuro(values.importo);
    } catch {
      throw invalid('bad-arguments');
    }
    if (amount <= 0) throw invalid('bad-arguments');
    const result = await recordManualTransfer(
      store,
      {
        fromAccountId: values.da,
        toAccountId: values.a,
        amount,
        date: date.data,
        purpose: values.scopo,
      },
      who,
      clock,
      newId,
    );
    if (result.status === 'refused') throw new Stop('rejected', result.reason);
    return { status: 'recorded', operationId: result.operationId, transferId: result.transferId };
  }

  if (name === 'saldi') {
    if (positionals.length > 0) throw invalid('bad-arguments');
    const result = await loadAccountBalances(store);
    if (result.status === 'refused') throw new Stop('rejected', result.reason);
    // Without --dettagli only the apartments of each pair and counts: no amount, no date (R132).
    const toSplitImu = result.toSplit.filter((t) => t.imu !== undefined).length;
    if (values.dettagli === true) {
      return {
        status: 'ok',
        pairs: result.pairs,
        toSplit: result.toSplit,
        toSplitImu,
        unverified: result.unverified,
      };
    }
    return {
      status: 'ok',
      pairs: result.pairs.map((p) => ({
        creditorApartmentId: p.creditorApartmentId,
        debtorApartmentId: p.debtorApartmentId,
        items: p.items.length,
      })),
      toSplit: result.toSplit.length,
      toSplitImu,
      unverified: result.unverified.length,
    };
  }

  if (name === 'imu-atteso') {
    need(values, 'appartamento', 'anno', 'gruppo');
    if (
      positionals.length > 0 ||
      values.rata === undefined ||
      !YearSchema.safeParse(values.anno).success
    ) {
      throw invalid('bad-arguments');
    }
    const result = await setImuYear(
      store,
      {
        apartmentId: values.appartamento,
        year: values.anno,
        f24Group: values.gruppo,
        ...(values.totale === undefined ? {} : { annualTotal: euro(values.totale) }),
        rates: values.rata.map(parseRate),
      },
      who,
      clock,
      newId,
    );
    if (result.status === 'refused') throw new Stop('rejected', result.reason);
    return {
      status: result.status,
      imuYearId: result.imuYearId,
      ...(result.status === 'saved' ? { operationId: result.operationId } : {}),
    };
  }

  if (name === 'imu-f24') {
    need(values, 'movimento', 'gruppo', 'anno');
    const [rata, ...more] = values.rata ?? [];
    if (
      positionals.length > 0 ||
      more.length > 0 ||
      !/^[1-9][0-9]{0,2}$/.test(rata ?? '') ||
      !YearSchema.safeParse(values.anno).success
    ) {
      throw invalid('bad-arguments');
    }
    const result = await assignImuF24(
      store,
      {
        transactionId: values.movimento,
        f24Group: values.gruppo,
        year: values.anno,
        rateIndex: Number(rata),
      },
      who,
      clock,
      newId,
    );
    if (result.status === 'refused') throw new Stop('rejected', result.reason);
    if (result.status === 'unchanged') return { status: 'unchanged', classId: result.classId };
    return { status: 'assigned', operationId: result.operationId, classId: result.classId };
  }

  if (name === 'imu') {
    if (
      positionals.length > 0 ||
      (values.anno !== undefined && !YearSchema.safeParse(values.anno).success)
    ) {
      throw invalid('bad-arguments');
    }
    const result = await loadImuRates(
      store,
      values.anno === undefined ? {} : { year: values.anno },
    );
    if (result.status === 'refused') throw new Stop('rejected', result.reason);
    // Group, year, index and state only; amounts, dates and the movement with --dettagli (R107).
    const rates = result.rates.map((r) => ({
      f24Group: r.f24Group,
      year: r.year,
      rateIndex: r.rateIndex,
      status: r.status,
      f24: r.transactionId === undefined ? 0 : 1,
      ...(r.status === 'da-riconciliare' ? { message: MESSAGES['imu-to-reconcile'] } : {}),
      ...(values.dettagli === true
        ? {
            expected: r.expected,
            paid: r.paid,
            difference:
              r.paid === undefined || r.expected === undefined ? undefined : r.paid - r.expected,
            dueDate: r.dueDate,
            transactionId: r.transactionId,
          }
        : {}),
    }));
    return {
      status: 'ok',
      rates,
      toReconcile: rates.filter((r) => r.status === 'da-riconciliare').length,
    };
  }

  // contratto replaces every field of the contract (rent history aside): an option left out,
  // --presenze and --caparre included, removes that field; the user repeats the ones to keep.
  if (name === 'contratto') {
    need(values, 'id', 'appartamento', 'tipo', 'inizio', 'fine', 'conguaglio');
    const v = values;
    if (
      positionals.length > 0 ||
      !/^[A-Za-z0-9_-]{1,64}$/.test(v.id) ||
      !['1+1', '3+2', '4+4', 'altro'].includes(v.tipo) ||
      !['annuale', 'intero-contratto'].includes(v.conguaglio) ||
      (v.durata !== undefined && !/^[1-9][0-9]{0,3}$/.test(v.durata)) ||
      v['codice-registrazione'] === '' ||
      (v.regime !== undefined && !['cedolare', 'ordinario'].includes(v.regime)) ||
      (v['aliquota-cedolare'] !== undefined && v.regime !== 'cedolare')
    ) {
      throw invalid('bad-arguments');
    }
    const start = month(v.inizio);
    const end = month(v.fine);
    if (end < start) throw invalid('bad-arguments');
    const code = v['codice-registrazione'];
    const date = v.registrato === undefined ? undefined : day(v.registrato);
    const input = {
      id: v.id,
      apartmentId: v.appartamento,
      type: v.tipo,
      start,
      end,
      settlement: v.conguaglio,
      ...optional('agreedRent', v.concordato === true ? true : undefined),
      ...optional('forStudents', v.studenti === true ? true : undefined),
      ...optional('durationMonths', v.durata === undefined ? undefined : Number(v.durata)),
      ...optional('signedOn', v.firmato === undefined ? undefined : day(v.firmato)),
      ...(code === undefined && date === undefined
        ? {}
        : { registration: { ...optional('code', code), ...optional('date', date) } }),
      ...optional('taxRegime', v.regime),
      ...optional(
        'cedolareRateBp',
        v['aliquota-cedolare'] === undefined ? undefined : basisPoints(v['aliquota-cedolare']),
      ),
      ...optional('tenancyIds', idList(v.presenze)),
      ...optional('depositPaymentIds', idList(v.caparre)),
    };
    let result;
    try {
      result = await saveContract(store, input, who, clock, newId);
    } catch (error) {
      // An id the store refuses (a name reserved on Windows, a bad segment) is a bad argument.
      if (error instanceof RangeError) throw invalid('bad-arguments');
      throw error;
    }
    if (result.status === 'refused') throw new Stop('rejected', result.reason);
    return {
      status: result.status,
      contractId: result.contractId,
      ...(result.status === 'saved' ? { operationId: result.operationId } : {}),
    };
  }

  if (name === 'contratto-canone') {
    need(values, 'contratto', 'dal', 'canone', 'acconto');
    if (positionals.length > 0) throw invalid('bad-arguments');
    const from = month(values.dal);
    const monthlyRent = euro(values.canone);
    const monthlyAdvance = euro(values.acconto);
    if (monthlyRent <= 0 || monthlyAdvance < 0) throw invalid('bad-arguments');
    const result = await setContractRent(
      store,
      { contractId: values.contratto, from, monthlyRent, monthlyAdvance },
      who,
      clock,
      newId,
    );
    if (result.status === 'refused') throw new Stop('rejected', result.reason);
    return {
      status: result.status,
      contractId: result.contractId,
      ...(result.status === 'saved' ? { operationId: result.operationId } : {}),
    };
  }

  if (name === 'contratti') {
    if (positionals.length > 0) throw invalid('bad-arguments');
    const result = await loadContractChecks(store, {
      // The month of the clock: later months have no tenancies written yet.
      asOf: month(clock().slice(0, 7)),
      ...optional('apartmentId', values.appartamento),
    });
    if (result.status === 'refused') throw new Stop('rejected', result.reason);
    const details = values.dettagli === true;
    // Codes, ids and months only; amounts, codes, dates and linked ids with --dettagli (R107).
    return {
      status: 'ok',
      contracts: result.contracts.map((c) => ({
        id: c.id,
        apartmentId: c.apartmentId,
        type: c.type,
        start: c.start,
        end: c.end,
        settlement: c.settlement,
        agreedRent: c.agreedRent,
        forStudents: c.forStudents,
        taxRegime: c.taxRegime,
        tenancies: c.tenancyIds?.length ?? 0,
        deposits: c.depositPaymentIds?.length ?? 0,
        rentEntries: c.rent?.length ?? 0,
        ...(details
          ? {
              durationMonths: c.durationMonths,
              signedOn: c.signedOn,
              registration: c.registration,
              cedolareRateBp: c.cedolareRateBp,
              rent: c.rent,
              tenancyIds: c.tenancyIds,
              depositPaymentIds: c.depositPaymentIds,
            }
          : {}),
      })),
      checks: result.checks.map((c) => ({
        code: c.code,
        contractId: c.contractId,
        from: c.from,
        to: c.to,
        ...(c.code === 'rent-differs' ? { message: MESSAGES['rent-differs'] } : {}),
        ...(details
          ? {
              tenancyId: c.tenancyId,
              paymentId: c.paymentId,
              expected: c.expected,
              actual: c.actual,
            }
          : {}),
      })),
    };
  }

  if (name === 'abbina') {
    if (positionals.length > 0 || values.parte === undefined) throw invalid('bad-arguments');
    const result = await confirmMatch(
      store,
      { parts: values.parte.map(parseMatchPart) },
      who,
      clock,
      newId,
    );
    if (result.status === 'refused') {
      // The errors of invalid-matches are codes and ids only, no amount.
      throw new Stop(
        'rejected',
        result.reason,
        'errors' in result ? { errors: result.errors } : {},
      );
    }
    return { status: 'confirmed', operationId: result.operationId, matchIds: result.matchIds };
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

  if (name === 'annulla-riconciliazione' || name === 'annulla-incassi') {
    need(values, 'operazione');
    if (positionals.length > 0) throw invalid('bad-arguments');
    const { operations } = await readJournal(store);
    const target = operations.find((o) => o.id === values.operazione);
    if (target === undefined) throw new Stop('rejected', 'unknown-operation');
    if (!RECONCILE_KINDS.includes(target.kind)) {
      throw new Stop('rejected', 'not-reconcile-operation');
    }
    // A cancellation whose movement has had another use since: undoing it would give a second one.
    const recordIds = await undoBlockedBy(store, target.id);
    if (recordIds.length > 0) {
      throw new Stop('rejected', 'has-dependents', {
        message: MESSAGES['movement-has-dependents'],
        recordIds,
      });
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
        result.reason === 'dependent-payments'
          ? { paymentIds: result.paymentIds }
          : result.reason === 'dependent-records'
            ? { recordIds: result.recordIds }
            : {},
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
        'annulla-riconciliazione',
        'annulla-pagamento',
        'escludi',
        'abbina',
        'uscita',
        'annulla-uscita',
        'uscita-inquilino',
        'giroconto',
        'giroconto-manuale',
        'saldi',
        'imu-atteso',
        'imu-f24',
        'imu',
        'contratto',
        'contratto-canone',
        'contratti',
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
      dettagli: ['riconcilia', 'importa', 'saldi', 'imu', 'contratti'],
      parte: ['conferma', 'abbina'],
      'solo-questa-volta': ['conferma', 'uscita', 'giroconto'],
      pagamento: ['annulla-pagamento'],
      movimento: ['escludi', 'annulla-uscita', 'imu-f24'],
      motivo: ['escludi'],
      proposta: ['conferma', 'uscita', 'uscita-inquilino', 'giroconto'],
      inquilino: ['conferma', 'uscita-inquilino'],
      appartamento: ['conto', 'uscita', 'imu-atteso', 'contratto', 'contratti'],
      anno: ['imu-atteso', 'imu-f24', 'imu'],
      gruppo: ['imu-atteso', 'imu-f24'],
      totale: ['imu-atteso'],
      rata: ['imu-atteso', 'imu-f24'],
      categoria: ['uscita'],
      f24: ['uscita'],
      tipo: ['uscita-inquilino', 'contratto'],
      mese: ['uscita-inquilino'],
      scopo: ['giroconto', 'giroconto-manuale'],
      'altra-gamba': ['giroconto'],
      gambe: ['giroconto'],
      da: ['giroconto-manuale'],
      a: ['giroconto-manuale'],
      importo: ['giroconto-manuale'],
      data: ['giroconto-manuale'],
      dal: ['importa', 'contratto-canone'],
      al: ['importa'],
      ...Object.fromEntries(
        [
          'inizio',
          'fine',
          'conguaglio',
          'concordato',
          'studenti',
          'durata',
          'firmato',
          'codice-registrazione',
          'registrato',
          'regime',
          'aliquota-cedolare',
          'presenze',
          'caparre',
        ].map((option) => [option, ['contratto']]),
      ),
      contratto: ['contratto-canone'],
      canone: ['contratto-canone'],
      acconto: ['contratto-canone'],
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
