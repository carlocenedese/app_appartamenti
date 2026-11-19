// Bank accounts and statements from the command line (`pnpm estratti <command> ...`, plan 3a,
// task 8): profilo, conto, importa, decidi, annulla. The core does the work; this file reads
// the clock, makes the ids, opens the data folder with FsStore and reads the statement file
// (read only, never copied) as a CSV (core reader) or an XLSX (`python -I -m bollette_pdf table`).
// Plan 24 (R386): every command is a function of `packages/core/src/commands`, which the screens
// of the app call too; here stay the options, the files, Python, the PDF moves and the printing.
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
// and their read-only checks); affitti-anno saves the rents of an apartment and year typed by
// user1, shown by contratti --dettagli with the cedolare estimate to be confirmed (R182); plan 9
// adds scadenze (the owner's payables, derived), scadenza-nuova, scadenza-ripeti and
// scadenza-pagata (the payables typed by hand); plan 13 adds --anno-riferimento to the first two.
// Plan 8 adds appartamento (creates an apartment, asking who bears the condominium difference,
// or updates the fields given), condominio-documento (preventivo or consuntivo of a fiscal year),
// condominio (the owners' check of the condominium expenses, the differences and the recoveries)
// and recupero (part of an extraordinary expense to recover from tenants chosen by user1).
// Plan 14 adds condominio-stima (the condominium estimate of a fiscal year: its own document, or a
// copy of the nearest earlier one, never written; amounts only with --dettagli), contatto (an
// administrator or a supplier of the address book, every field replaced) and contatti (the list;
// names and contacts only with --dettagli).
// Plan 11 adds presenza (the arrival of a tenant, optionally in a contract), fine-presenza (the last
// month of a stay), subentro (a takeover inside a contract), stato-contratti (tenancies, takeovers,
// deposits and checks of each contract) and caparra-restituzione (the return statement of a deposit,
// read only).
// Plan 18 adds scambio-camera (two tenants of one contract swap rooms from a month, in one
// operation; only tenancy ids and codes in the output).
// Plan 10 adds tasse-stima (the start-of-year estimate of an apartment, year and voce typed by
// user1), tasse-assegna (a «tasse» debit assigned to cedolare or registro and tax years),
// tasse-copia (the estimates of the year before, copied only on this command) and tasse (the
// table by taxpayer and the January warning; amounts and the taxpayer only with --dettagli).
// Plan 15 adds bolletta (imports a PDF with its reading from `python -I -m bollette_pdf extract`:
// registered by itself, confirmed with --conferma, or left «da rivedere»), annulla-bolletta (takes
// back what a PDF created) and cruscotto (counts by code and apartment for the Home).
// Plan 17 adds tasso-legale (the legal rate of a year), tasse-conferma (a tax discrepancy confirmed
// with a note), scheda-inquilino (the personal data of a tenant card, never echoed), soglie-consumi
// (the thresholds of the consumption alarm) and consumi (one bill against them); recupero takes
// --movimento, --data and a negative amount, scadenza-nuova --voce, appartamento --codici;
// caparra-restituzione takes the dates, rates and conguaglio from the store (--conguaglio to type
// it); bolletta and annulla-bolletta move the PDF to Bollette and back to Da_smistare.
// Exit codes: 0 done, 1 refused (or already imported), 2 arguments or files not valid, 3 an
// unexpected failure (an interrupted import is resumed by repeating `importa`).

import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { FsStore, moveFileNoOverwrite } from '../packages/store-fs/src/fs-store.ts';
import {
  ExcludeReasonSchema,
  ISODateSchema,
  StatementTableSchema,
  OutgoingKindSchema,
  TaxVoiceSchema,
  TransferPurposeSchema,
  TimestampSchema,
  YearMonthSchema,
  YearSchema,
  parseEuro,
  equalShares,
  billFileMove,
  PayableKindSchema,
  DATA_FORMAT,
  WORKSPACE_PATH,
  findWorkspace,
  raiseDataFormat,
  CommandStop,
  COMMAND_MESSAGES,
  stopBody,
  commandRefusal,
  FAILED_BODY,
  closedPeriodStates,
  changedClosedPeriods,
  saveBankProfileCommand,
  saveAccountCommand,
  importTargetOf,
  statementCsvTable,
  importStatementCommand,
  resolveHeldCommand,
  undoImportCommand,
  saveTenantCommand,
  saveTenantCardCommand,
  reconcileCommand,
  confirmOutgoingCommand,
  cancelOutgoingCommand,
  confirmTenantOutgoingCommand,
  confirmTransferCommand,
  manualTransferCommand,
  balancesCommand,
  confirmMatchCommand,
  confirmIncomeCommand,
  undoOperationCommand,
  referencesCommand,
  cancelPaymentCommand,
  confirmRentExcessCommand,
  confirmPastYearCommand,
  excludeMovementCommand,
  repairCommand,
  chooseVersionCommand,
  setImuYearCommand,
  assignImuF24Command,
  imuRatesCommand,
  setTaxEstimateCommand,
  copyTaxYearCommand,
  assignTaxCommand,
  confirmTaxCommand,
  taxTableCommand,
  payablesCommand,
  savePayableCommand,
  repeatPayableCommand,
  payablePaidCommand,
  saveContractCommand,
  setContractRentCommand,
  setRentYearCommand,
  contractsCommand,
  saveTenancyCommand,
  endTenancyCommand,
  takeoverCommand,
  roomSwapCommand,
  contractStatusCommand,
  saveLegalRateCommand,
  depositReturnCommand,
  saveApartmentCommand,
  saveCondoDocumentCommand,
  saveRecoveryCommand,
  condoCommand,
  condoEstimateCommand,
  saveContactCommand,
  contactsCommand,
  saveConsumptionSettingsCommand,
  consumptionCommand,
  billReadingOf,
  refuseRegisteredBill,
  importBillCommand,
  undoBillCommand,
  dashboardCommand,
  saveCondoInstalmentCommand,
  settingsCommand,
  closePeriodCommand,
  periodClosingCommand,
  markPeriodSentCommand,
  markTenantSettledCommand,
  reopenPeriodCommand,
  markFlatCheckedCommand,
  markRentMissingCommand,
  saveSupplyCommand,
} from '../packages/core/src/index.ts';
import { COMMAND_HELP, USAGE } from './estratti-aiuto.mjs';

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const PYTHON_TIMEOUT_MS = 60_000;

/** The messages of the core's commands, kept here for the tests of the command line. */
export const MESSAGES = COMMAND_MESSAGES;

/**
 * E12: `--importo -15,00` as `--importo=-15,00`: a value that starts with a minus and a digit,
 * after an option that takes a value, is that value (parseArgs would read an option `-1`).
 */
const negativeValues = (args) =>
  args.flatMap((arg, i) => {
    const previous = args[i - 1] ?? '';
    const name = previous.startsWith('--') && !previous.includes('=') ? previous.slice(2) : '';
    if (/^-\d/.test(arg) && OPTIONS[name]?.type === 'string') return [];
    const next = args[i + 1] ?? '';
    const own = arg.startsWith('--') && !arg.includes('=') ? arg.slice(2) : '';
    return /^-\d/.test(next) && OPTIONS[own]?.type === 'string' ? [`${arg}=${next}`] : [arg];
  });

const Stop = CommandStop;
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
  supplementare: { type: 'boolean' },
  esito: { type: 'string' },
  file: { type: 'string' },
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
  'rimborso-canone': { type: 'boolean' },
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
  stato: { type: 'string' },
  ruolo: { type: 'string' },
  telefono: { type: 'string' },
  email: { type: 'string' },
  note: { type: 'string' },
  giallo: { type: 'string' },
  valori: { type: 'string' },
  bolletta: { type: 'string' },
  rosso: { type: 'string' },
  appartamenti: { type: 'string' },
  utenze: { type: 'string' },
  categorie: { type: 'string' },
  entro: { type: 'string' },
  oggi: { type: 'string' },
  scadenza: { type: 'string' },
  'ogni-anno': { type: 'boolean' },
  'anno-riferimento': { type: 'string' },
  locatore: { type: 'string' },
  posti: { type: 'string' },
  annualita: { type: 'string' },
  'esercizio-condominio': { type: 'string' },
  'differenza-condominio': { type: 'string' },
  modifica: { type: 'boolean' },
  esercizio: { type: 'string' },
  'quota-conduttore': { type: 'string' },
  voce: { type: 'string' },
  inquilini: { type: 'string' },
  quote: { type: 'string' },
  periodo: { type: 'string' },
  posto: { type: 'string' },
  affitto: { type: 'string' },
  forfait: { type: 'string' },
  'caparra-attesa': { type: 'string' },
  presenza: { type: 'string' },
  'presenza-a': { type: 'string' },
  'presenza-b': { type: 'string' },
  'canone-a': { type: 'string' },
  'id-a': { type: 'string' },
  'id-b': { type: 'string' },
  'canone-b': { type: 'string' },
  tasso: { type: 'string', multiple: true },
  addebito: { type: 'string', multiple: true },
  lettura: { type: 'string' },
  'soglia-consumi': { type: 'string' },
  codici: { type: 'string' },
  conferma: { type: 'boolean' },
  'periodo-conguaglio': { type: 'string', multiple: true },
  pagine: { type: 'string' },
  'posti-nomi': { type: 'string' },
  ripartizione: { type: 'string' },
  'quota-proprieta': { type: 'string' },
  'conguaglio-prec': { type: 'string' },
  straordinaria: { type: 'boolean' },
  'tolleranza-imu': { type: 'string' },
  help: { type: 'boolean', short: 'h' },
};

/** The kinds of an outgoing to a tenant: never `canone`, the rent is an income (R130). */
const TENANT_KINDS = ['caparra', 'conguaglio', 'altro'];
/** Plan 22: the outcomes of «forfait-verificato», Italian flag to the core's value. */
const FLAT_OUTCOMES = { rimborso: 'rimborso', credito: 'credito', 'stessi-soldi': 'stessi-soldi' };
/** Plan 22: the outcomes of «canone-non-incassato». */
const RENT_OUTCOMES = {
  richiesto: 'richiesto',
  saldato: 'saldato',
  'non-recuperabile': 'non-recuperabile',
};
const CONTACT_ROLES = ['amministratore', 'fornitore'];
const PAYABLE_STATES = ['da-pagare', 'in-scadenza', 'pagata', 'in-ritardo'];
const PAYABLE_ITEM_KINDS = ['imu', 'condominio', 'tari', ...PayableKindSchema.options];

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

/** `moveFileNoOverwrite`, `move-failed` instead of an error: the records are already written. */
async function moveSafely(root, from, to) {
  try {
    return await moveFileNoOverwrite(root, from, to);
  } catch {
    return 'move-failed';
  }
}

/** `consumi:30,importo:20,prezzo:10` (percent) as basis points by metric (plan 17, R313). */
function metricThresholds(text) {
  const names = { consumi: 'consumption', importo: 'amount', prezzo: 'unitPrice' };
  const out = {};
  for (const part of text.split(',')) {
    const [name, percent, ...rest] = part.split(':');
    const metric = names[name];
    if (metric === undefined || percent === undefined || rest.length > 0 || metric in out) {
      throw invalid('bad-arguments');
    }
    out[metric] = basisPoints(percent);
  }
  return out;
}

/** `<cedolare|registro>:<AAAA>:<importo>` for tasse-assegna (plan 10). */
function parseTaxPart(text) {
  const [voce, year, amount, ...rest] = text.split(':');
  if (
    !['cedolare', 'registro'].includes(voce) ||
    !YearSchema.safeParse(year).success ||
    amount === undefined ||
    rest.length > 0
  ) {
    throw invalid('bad-arguments');
  }
  const value = euro(amount);
  if (value <= 0) throw invalid('bad-arguments');
  return { voce, year, amount: value };
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
/** `MM-GG` as the start of a year (`annualitaStart`, `condominioStart`); the schema checks the day. */
const yearStart = (text) => {
  const found = /^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/.exec(text);
  if (found === null) throw invalid('bad-arguments');
  return { month: Number(found[1]), day: Number(found[2]) };
};
/** E6: settlement periods are whole months, so the lease year starts on day 1 (`MM-01`). */
const leaseYearStart = (text) => {
  const start = yearStart(text);
  if (start.day !== 1) throw invalid('annualita-not-first-day');
  return start;
};
const DIFFERENCE_TO = { inquilini: 'tenants', proprietario: 'owner' };

const optional = (key, value) => (value === undefined ? {} : { [key]: value });
/** The reference year of a payable (plan 13): `AAAA`, not `0000`, as an integer. */
const taxYearOf = (text) => {
  if (text === undefined) return undefined;
  if (!/^\d{4}$/.test(text) || text === '0000') throw invalid('bad-arguments');
  return Number(text);
};
/** An amount that must be positive (an expected amount of a payable). */
const positive = (text) => {
  const amount = euro(text);
  if (amount <= 0) throw invalid('bad-arguments');
  return amount;
};

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

async function command(name, values, positionals, store, who, clock, newId) {
  const ctx = { who, clock, newId };
  if (name === 'profilo') {
    if (positionals.length !== 1) throw invalid('bad-arguments');
    return saveBankProfileCommand(store, readBytes(positionals[0]).toString('utf8'), ctx);
  }

  if (name === 'conto') {
    need(values, 'appartamento', 'profilo', 'etichetta');
    return saveAccountCommand(
      store,
      {
        apartmentId: values.appartamento,
        label: values.etichetta,
        bankProfileId: values.profilo,
        ...(values.iban === undefined ? {} : { iban: values.iban }),
      },
      ctx,
    );
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
    const { account, profile } = await importTargetOf(store, values.conto);
    const file = positionals[0];
    const bytes = readBytes(file);
    let table;
    if (profile.container === 'xlsx') {
      table = xlsxTable(file);
      // Python reads the file itself: if it changed since `bytes` (the hash), the table is not the file's.
      if (!readBytes(file).equals(bytes)) throw invalid('unreadable-statement');
    } else {
      table = statementCsvTable(bytes, profile.csvSeparator ?? ';');
    }
    return importStatementCommand(
      store,
      {
        accountId: account.id,
        fileBytes: new Uint8Array(bytes),
        // The name goes into the statement record (the data folder), never into the output.
        fileName: file.split(/[\\/]/).at(-1) ?? 'estratto',
        table,
        ...(period === undefined ? {} : { period: { from: period.from.data, to: period.to.data } }),
      },
      ctx,
      { details: values.dettagli === true },
    );
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
    return resolveHeldCommand(
      store,
      { statementId: values.estratto, row: Number(values.riga), decision },
      ctx,
    );
  }

  if (name === 'soglie-consumi') {
    // Plan 17, R313: the thresholds of the consumption alarm, typed by user1 (none in the code).
    if (positionals.length > 0 || (values.giallo === undefined && values.rosso === undefined)) {
      throw invalid('bad-arguments');
    }
    return saveConsumptionSettingsCommand(
      store,
      {
        ...optional('apartmentId', values.appartamento),
        ...optional(
          'giallo',
          values.giallo === undefined ? undefined : metricThresholds(values.giallo),
        ),
        ...optional(
          'rosso',
          values.rosso === undefined ? undefined : metricThresholds(values.rosso),
        ),
      },
      ctx,
    );
  }

  if (name === 'consumi') {
    need(values, 'bolletta');
    if (positionals.length > 0) throw invalid('bad-arguments');
    return consumptionCommand(store, values.bolletta, { details: values.dettagli === true });
  }

  if (name === 'scheda-inquilino') {
    // Plan 17, R311: the reserved card of a tenant, from a JSON file (never personal data as
    // arguments, never echoed); the core checks the keys.
    need(values, 'inquilino', 'valori');
    if (positionals.length > 0) throw invalid('bad-arguments');
    let valuesJson;
    try {
      valuesJson = readBytes(values.valori).toString('utf8');
    } catch {
      throw invalid('bad-values');
    }
    return saveTenantCardCommand(store, { tenantId: values.inquilino, valuesJson }, ctx);
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
    return saveTenantCommand(
      store,
      {
        id: values.id,
        name: values.nome,
        ...(values.lingua === undefined ? {} : { language: values.lingua }),
      },
      ctx,
    );
  }

  if (name === 'riconcilia') {
    if (positionals.length > 0) throw invalid('bad-arguments');
    return reconcileCommand(store, { dryRun: values.prova === true }, ctx, {
      details: values.dettagli === true,
    });
  }

  if (name === 'uscita') {
    need(values, 'proposta', 'categoria', 'appartamento');
    if (positionals.length > 0 || !OutgoingKindSchema.safeParse(values.categoria).success) {
      throw invalid('bad-arguments');
    }
    return confirmOutgoingCommand(
      store,
      {
        proposalId: values.proposta,
        kind: values.categoria,
        apartmentId: values.appartamento,
        rememberRule: values['solo-questa-volta'] !== true,
        f24: values.f24 === true,
      },
      ctx,
    );
  }

  if (name === 'annulla-uscita') {
    need(values, 'movimento');
    if (positionals.length > 0) throw invalid('bad-arguments');
    return cancelOutgoingCommand(store, values.movimento, ctx);
  }

  if (name === 'uscita-inquilino') {
    // B5 (c): --rimborso-canone, the refund of rent paid in excess in --mese, without --tipo.
    const refund = values['rimborso-canone'] === true;
    need(values, 'proposta', 'inquilino', 'mese', ...(refund ? [] : ['tipo']));
    if (
      positionals.length > 0 ||
      (refund ? values.tipo !== undefined : !TENANT_KINDS.includes(values.tipo)) ||
      !YearMonthSchema.safeParse(values.mese).success
    ) {
      throw invalid('bad-arguments');
    }
    return confirmTenantOutgoingCommand(
      store,
      {
        proposalId: values.proposta,
        tenantId: values.inquilino,
        kind: refund ? 'altro' : values.tipo,
        forMonth: values.mese,
        ...(refund ? { rentRefund: true } : {}),
      },
      ctx,
    );
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
    return confirmTransferCommand(
      store,
      {
        proposalId: values.proposta,
        purpose: values.scopo,
        rememberPair: values['solo-questa-volta'] !== true,
        legIds,
        ...(values['altra-gamba'] === undefined ? {} : { otherLegId: values['altra-gamba'] }),
      },
      ctx,
    );
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
    if (values.id !== undefined && !/^[A-Za-z0-9_-]{1,64}$/.test(values.id)) {
      throw invalid('bad-arguments');
    }
    return manualTransferCommand(
      store,
      {
        ...optional('id', values.id),
        fromAccountId: values.da,
        toAccountId: values.a,
        amount,
        date: date.data,
        purpose: values.scopo,
      },
      ctx,
    );
  }

  if (name === 'saldi') {
    if (positionals.length > 0) throw invalid('bad-arguments');
    return balancesCommand(store, { details: values.dettagli === true });
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
    return setImuYearCommand(
      store,
      {
        apartmentId: values.appartamento,
        year: values.anno,
        f24Group: values.gruppo,
        ...(values.totale === undefined ? {} : { annualTotal: euro(values.totale) }),
        rates: values.rata.map(parseRate),
      },
      ctx,
    );
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
    return assignImuF24Command(
      store,
      {
        transactionId: values.movimento,
        f24Group: values.gruppo,
        year: values.anno,
        rateIndex: Number(rata),
        rememberRule: values['solo-questa-volta'] !== true,
      },
      ctx,
    );
  }

  // appartamento creates (every field and --differenza-condominio, the question at creation) or
  // updates the fields given (plan 8, task 2).
  if (name === 'appartamento') {
    need(values, 'id');
    const v = values;
    const to = v['differenza-condominio'];
    if (
      positionals.length > 0 ||
      !/^[A-Za-z0-9_-]{1,64}$/.test(v.id) ||
      (v.posti !== undefined && !/^[1-9][0-9]{0,1}$/.test(v.posti)) ||
      (to !== undefined && !Object.hasOwn(DIFFERENCE_TO, to))
    ) {
      throw invalid('bad-arguments');
    }
    return saveApartmentCommand(
      store,
      {
        id: v.id,
        ...optional('name', v.nome),
        ...optional('locatore', v.locatore),
        ...optional('posti', v.posti === undefined ? undefined : Number(v.posti)),
        ...optional(
          'annualitaStart',
          v.annualita === undefined ? undefined : leaseYearStart(v.annualita),
        ),
        ...optional(
          'condominioStart',
          v['esercizio-condominio'] === undefined
            ? undefined
            : yearStart(v['esercizio-condominio']),
        ),
        ...optional('condoDifferenceTo', to === undefined ? undefined : DIFFERENCE_TO[to]),
        ...optional(
          'supplyCodes',
          v.codici === undefined ? undefined : v.codici.split(',').filter((c) => c !== ''),
        ),
        // E19: the names of the beds, in their fixed order (one per bed, unique: the schema checks).
        ...optional(
          'rooms',
          v['posti-nomi']?.split(',').map((r) => r.trim()),
        ),
        // Plan 22: new beds from a month («valido dal»), the old ones before it.
        ...optional('bedsValidFrom', v.dal === undefined ? undefined : month(v.dal)),
      },
      ctx,
      { confirmed: v.modifica === true },
    );
  }

  if (name === 'condominio-documento') {
    need(values, 'appartamento', 'esercizio', 'tipo', 'totale');
    if (positionals.length > 0 || !['preventivo', 'consuntivo'].includes(values.tipo)) {
      throw invalid('bad-arguments');
    }
    const quota = values['quota-conduttore'];
    return saveCondoDocumentCommand(
      store,
      {
        apartmentId: values.appartamento,
        esercizio: values.esercizio,
        kind: values.tipo,
        total: euro(values.totale),
        ...optional('quotaConduttore', quota === undefined ? undefined : euro(quota)),
      },
      ctx,
    );
  }

  // recupero: the part of an extraordinary expense to recover from tenants chosen by user1, with
  // their shares (equal when --quote is absent); --stato set by user1 (plan 8, group B).
  if (name === 'recupero') {
    // Plan 17, R300: --voce (an extraordinary instalment) or --movimento (paid to a supplier) or
    // neither (a negative amount: the tenant paid for the owners, with --data or --periodo).
    need(values, 'id', 'appartamento', 'importo', 'inquilini');
    const tenants = idList(values.inquilini);
    const stato = values.stato ?? 'da-recuperare';
    if (
      positionals.length > 0 ||
      !['da-recuperare', 'recuperata', 'non-recuperabile'].includes(stato) ||
      values.periodo === ''
    ) {
      throw invalid('bad-arguments');
    }
    const amount = euro(values.importo);
    const quotes = values.quote?.split(';').map(euro);
    if (quotes !== undefined && quotes.length !== tenants.length) throw invalid('bad-arguments');
    return saveRecoveryCommand(
      store,
      {
        id: values.id,
        apartmentId: values.appartamento,
        ...optional('instalmentId', values.voce),
        ...optional('transactionId', values.movimento),
        ...(values.data === undefined ? {} : { date: day(values.data) }),
        amount,
        shares:
          quotes === undefined
            ? equalShares(amount, tenants)
            : tenants.map((tenantId, i) => ({ tenantId, amount: quotes[i] })),
        status: stato,
        ...optional('periodLabel', values.periodo),
      },
      ctx,
    );
  }

  // The owners' check of the condominium expenses (section 12) and the differences consuntivo −
  // preventivo; amounts and dates only with --dettagli (R107, R194).
  if (name === 'condominio') {
    if (positionals.length > 0) throw invalid('bad-arguments');
    return condoCommand(
      store,
      {
        ...optional('apartmentId', values.appartamento),
        ...optional('esercizio', values.esercizio),
      },
      ctx,
      { details: values.dettagli === true },
    );
  }

  // The estimate of a fiscal year (plan 14, R250): source always, amounts only with --dettagli.
  if (name === 'condominio-stima') {
    need(values, 'appartamento', 'esercizio');
    // The same form as a fiscal year of condominio-documento (`saveCondoDocument`).
    if (positionals.length > 0 || !/^[A-Za-z0-9_-]{1,32}$/.test(values.esercizio)) {
      throw invalid('bad-arguments');
    }
    return condoEstimateCommand(
      store,
      { apartmentId: values.appartamento, esercizio: values.esercizio },
      { details: values.dettagli === true },
    );
  }

  // The address book (plan 14, R253): every field replaced, a field left out is removed.
  if (name === 'contatto') {
    need(values, 'id', 'ruolo', 'nome');
    if (positionals.length > 0 || !CONTACT_ROLES.includes(values.ruolo)) {
      throw invalid('bad-arguments');
    }
    return saveContactCommand(
      store,
      {
        id: values.id,
        role: values.ruolo,
        name: values.nome,
        ...optional('phone', values.telefono),
        ...optional('email', values.email),
        ...optional('notes', values.note),
        apartmentIds: idList(values.appartamenti) ?? [],
        ...optional('supplyIds', idList(values.utenze)),
        ...optional('categories', idList(values.categorie)),
      },
      ctx,
    );
  }

  // Ids, role and links; the name and the contacts only with --dettagli (R107).
  if (name === 'contatti') {
    if (
      positionals.length > 0 ||
      (values.ruolo !== undefined && !CONTACT_ROLES.includes(values.ruolo))
    ) {
      throw invalid('bad-arguments');
    }
    return contactsCommand(
      store,
      { ...optional('apartmentId', values.appartamento), ...optional('role', values.ruolo) },
      { details: values.dettagli === true },
    );
  }

  if (name === 'imu') {
    if (
      positionals.length > 0 ||
      (values.anno !== undefined && !YearSchema.safeParse(values.anno).success)
    ) {
      throw invalid('bad-arguments');
    }
    return imuRatesCommand(store, values.anno === undefined ? {} : { year: values.anno }, {
      details: values.dettagli === true,
    });
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
    return saveContractCommand(store, input, ctx);
  }

  if (name === 'contratto-canone') {
    need(values, 'contratto', 'dal', 'canone', 'acconto');
    if (positionals.length > 0) throw invalid('bad-arguments');
    const from = month(values.dal);
    const monthlyRent = euro(values.canone);
    const monthlyAdvance = euro(values.acconto);
    if (monthlyRent <= 0 || monthlyAdvance < 0) throw invalid('bad-arguments');
    return setContractRentCommand(
      store,
      { contractId: values.contratto, from, monthlyRent, monthlyAdvance },
      ctx,
    );
  }

  if (name === 'affitti-anno') {
    need(values, 'appartamento', 'anno', 'totale');
    if (positionals.length > 0 || !YearSchema.safeParse(values.anno).success) {
      throw invalid('bad-arguments');
    }
    const totalRent = euro(values.totale);
    if (totalRent <= 0) throw invalid('bad-arguments');
    return setRentYearCommand(
      store,
      { apartmentId: values.appartamento, year: values.anno, totalRent },
      ctx,
    );
  }

  if (name === 'tasse-stima') {
    need(values, 'appartamento', 'anno', 'voce', 'importo');
    if (
      positionals.length > 0 ||
      !YearSchema.safeParse(values.anno).success ||
      !TaxVoiceSchema.safeParse(values.voce).success
    ) {
      throw invalid('bad-arguments');
    }
    const amount = euro(values.importo);
    if (amount < 0) throw invalid('bad-arguments');
    return setTaxEstimateCommand(
      store,
      { apartmentId: values.appartamento, year: values.anno, voce: values.voce, amount },
      ctx,
    );
  }

  if (name === 'tasse-copia') {
    need(values, 'anno');
    if (positionals.length > 0 || !YearSchema.safeParse(values.anno).success) {
      throw invalid('bad-arguments');
    }
    return copyTaxYearCommand(
      store,
      { year: values.anno, ...optional('apartmentId', values.appartamento) },
      ctx,
    );
  }

  if (name === 'tasse-assegna') {
    need(values, 'movimento');
    if (positionals.length > 0 || values.parte === undefined) throw invalid('bad-arguments');
    return assignTaxCommand(
      store,
      { transactionId: values.movimento, parts: values.parte.map(parseTaxPart) },
      ctx,
    );
  }

  if (name === 'tasse-conferma') {
    // Plan 17, R304: a discrepancy confirmed with a note (not echoed: it is free text).
    need(values, 'appartamento', 'anno', 'voce', 'note');
    if (positionals.length > 0) throw invalid('bad-arguments');
    return confirmTaxCommand(
      store,
      { apartmentId: values.appartamento, year: values.anno, voce: values.voce, note: values.note },
      ctx,
    );
  }

  if (name === 'tasse') {
    need(values, 'anno');
    if (positionals.length > 0 || !YearSchema.safeParse(values.anno).success) {
      throw invalid('bad-arguments');
    }
    // Today: --oggi, or the UTC date of the clock (as scadenze).
    return taxTableCommand(
      store,
      { year: values.anno, today: day(values.oggi ?? clock().slice(0, 10)) },
      { details: values.dettagli === true },
    );
  }

  if (name === 'contratti') {
    if (positionals.length > 0) throw invalid('bad-arguments');
    return contractsCommand(store, optional('apartmentId', values.appartamento), ctx, {
      details: values.dettagli === true,
    });
  }

  if (name === 'presenza' || name === 'fine-presenza' || name === 'subentro') {
    if (positionals.length > 0) throw invalid('bad-arguments');
    const v = values;
    const nonNegative = (text) => {
      const amount = euro(text);
      if (amount < 0) throw invalid('bad-arguments');
      return amount;
    };
    const deposit = v['caparra-attesa'] === undefined ? undefined : positive(v['caparra-attesa']);
    if (name === 'presenza') {
      need(v, 'id', 'appartamento', 'inquilino', 'dal', 'affitto', 'forfait');
      return saveTenancyCommand(
        store,
        {
          id: v.id,
          apartmentId: v.appartamento,
          tenantId: v.inquilino,
          ...optional('room', v.posto),
          from: month(v.dal),
          ...optional('to', v.al === undefined ? undefined : month(v.al)),
          monthlyRent: nonNegative(v.affitto),
          monthlyForfait: nonNegative(v.forfait),
          ...optional('expectedDeposit', deposit),
          ...optional('contractId', v.contratto),
        },
        ctx,
      );
    }
    if (name === 'fine-presenza') {
      need(v, 'presenza', 'mese');
      return endTenancyCommand(store, { tenancyId: v.presenza, lastMonth: month(v.mese) }, ctx);
    }
    need(v, 'presenza', 'mese', 'id', 'inquilino', 'affitto', 'forfait');
    return takeoverCommand(
      store,
      {
        outTenancyId: v.presenza,
        lastMonth: month(v.mese),
        incoming: {
          id: v.id,
          tenantId: v.inquilino,
          monthlyRent: nonNegative(v.affitto),
          monthlyForfait: nonNegative(v.forfait),
          ...optional('expectedDeposit', deposit),
        },
      },
      ctx,
    );
  }

  if (name === 'scambio-camera') {
    if (positionals.length > 0) throw invalid('bad-arguments');
    const v = values;
    need(v, 'appartamento', 'presenza-a', 'presenza-b', 'mese');
    const rent = (text) => {
      if (text === undefined) return undefined;
      const amount = euro(text);
      if (amount < 0) throw invalid('bad-arguments');
      return amount;
    };
    return roomSwapCommand(
      store,
      {
        apartmentId: v.appartamento,
        tenancyIdA: v['presenza-a'],
        tenancyIdB: v['presenza-b'],
        month: month(v.mese),
        ...optional('monthlyRentA', rent(v['canone-a'])),
        ...optional('idA', v['id-a']),
        ...optional('idB', v['id-b']),
        ...optional('monthlyRentB', rent(v['canone-b'])),
      },
      ctx,
    );
  }

  if (name === 'stato-contratti') {
    if (positionals.length > 0) throw invalid('bad-arguments');
    return contractStatusCommand(store, optional('apartmentId', values.appartamento), ctx, {
      details: values.dettagli === true,
    });
  }

  if (name === 'tasso-legale') {
    // Plan 17, R301: the legal rate of a year, typed by user1 like the IMU amounts.
    need(values, 'anno');
    if (positionals.length > 0 || values.tasso?.length !== 1 || !/^[0-9]{4}$/.test(values.anno)) {
      throw invalid('bad-arguments');
    }
    return saveLegalRateCommand(
      store,
      { year: values.anno, rateBp: basisPoints(values.tasso[0]) },
      ctx,
    );
  }

  if (name === 'caparra-restituzione') {
    // Plan 17, R302: dates from the stay, rates from `tasso-legale`, conguaglio from the settlement
    // unless typed with --conguaglio.
    need(values, 'appartamento', 'inquilino');
    if (positionals.length > 0) throw invalid('bad-arguments');
    const extraCharges = (values.addebito ?? []).map((text) => {
      const at = text.lastIndexOf(':');
      if (at < 1) throw invalid('bad-arguments');
      return { label: text.slice(0, at), amount: positive(text.slice(at + 1)) };
    });
    return depositReturnCommand(
      store,
      {
        apartmentId: values.appartamento,
        tenantId: values.inquilino,
        ...(values.conguaglio === undefined ? {} : { conguaglio: euro(values.conguaglio) }),
        extraCharges,
      },
      { details: values.dettagli === true },
    );
  }

  if (name === 'bolletta') {
    // The reading comes from `python -I -m bollette_pdf extract` (plan 2a): no new reader here.
    need(values, 'appartamento', 'lettura');
    if (positionals.length !== 1) throw invalid('bad-arguments');
    // The alarm reads `soglie-consumi` (plan 19, R330); --soglia-consumi, optional, still adds the
    // old check on the same months of the year before (R262), never a default.
    const percent = values['soglia-consumi'];
    if (percent !== undefined && !/^[0-9]{1,4}(?:\.[0-9]{1,4})?$/.test(percent)) {
      throw invalid('bad-arguments');
    }
    const details = values.dettagli === true;
    let json;
    try {
      json = readBytes(values.lettura).toString('utf8');
    } catch {
      throw invalid('bad-reading');
    }
    const reading = billReadingOf(json, { details });
    let bytes;
    try {
      bytes = readBytes(positionals[0]);
    } catch (error) {
      // E14: the PDF moved by an earlier registration of this same reading: say so.
      await refuseRegisteredBill(store, reading.fileHash);
      throw error;
    }
    // Without --codici, those of the apartment (`appartamento --codici`, R314).
    const knownCodes =
      values.codici === undefined ? undefined : values.codici.split(',').filter((c) => c !== '');
    const { body, file } = await importBillCommand(
      store,
      {
        result: reading,
        bytes,
        apartmentId: values.appartamento,
        knownCodes,
        ...optional(
          'thresholds',
          percent === undefined ? undefined : { consumptionAnomalyPercent: Number(percent) },
        ),
        mode: values.conferma === true ? 'manual' : 'auto',
      },
      ctx,
      { details },
    );
    if (file === undefined) return body;
    // Plan 17, R315: the PDF of a whole file registered as a bill goes to the Bollette folder of
    // the apartment, never over another file and only from inside the shared folder.
    let moved = 'not-moved';
    if (file !== 'not-moved') {
      const inside = relative(resolve(values.cartella), resolve(positionals[0]));
      if (inside.startsWith('..') || isAbsolute(inside)) moved = 'outside-folder';
      else {
        const plan = billFileMove(file.apartment, file.filePath);
        // The bill is registered whatever happens to the file: never «failed» for a move.
        moved = await moveSafely(values.cartella, inside.split(/[\\/]/).join('/'), plan.filed);
      }
    }
    return { ...body, file: moved };
  }

  if (name === 'annulla-bolletta') {
    if (positionals.length !== 1) throw invalid('bad-arguments');
    // `--pagine a-b` or `--pagine intero` picks one document of a file that holds several (R260).
    let pages;
    if (values.pagine !== undefined) {
      const found = /^([0-9]{1,4})-([0-9]{1,4})$/.exec(values.pagine);
      if (values.pagine === 'intero') pages = null;
      else if (found !== null && Number(found[1]) >= 1 && Number(found[1]) <= Number(found[2])) {
        pages = [Number(found[1]), Number(found[2])];
      } else throw invalid('bad-arguments');
    }
    const { body, move } = await undoBillCommand(
      store,
      { bytes: readBytes(positionals[0]), ...optional('pages', pages) },
      ctx,
      { details: values.dettagli === true },
    );
    // Plan 17, R315: the file goes back to Da_smistare, never over another file.
    let file = 'not-moved';
    if (move !== undefined) {
      const inside = relative(resolve(values.cartella), resolve(positionals[0]))
        .split(/[\\/]/)
        .join('/');
      if (inside.normalize('NFC') === move.from.normalize('NFC')) {
        file = await moveSafely(values.cartella, move.from, move.to);
      }
    }
    return { ...body, file };
  }

  if (name === 'cruscotto') {
    if (positionals.length > 0) throw invalid('bad-arguments');
    const { entro, anno } = values;
    if (entro !== undefined && !/^[0-9]{1,3}$/.test(entro)) throw invalid('bad-arguments');
    if (anno !== undefined && !/^[0-9]{4}$/.test(anno)) throw invalid('bad-arguments');
    const settlements = (values['periodo-conguaglio'] ?? []).map((text) => {
      const at = text.indexOf(':');
      if (at < 1 || at === text.length - 1) throw invalid('bad-arguments');
      return { apartmentId: text.slice(0, at), periodLabel: text.slice(at + 1) };
    });
    return dashboardCommand(
      store,
      {
        // Today: --oggi, or the UTC date of the clock, as `scadenze`.
        today: day(values.oggi ?? clock().slice(0, 10)),
        ...optional('soonDays', entro === undefined ? undefined : Number(entro)),
        ...optional('taxYear', anno),
        // Without --periodo-conguaglio, the period in course of each apartment (R316).
        ...(settlements.length === 0 ? {} : { settlements }),
      },
      { details: values.dettagli === true },
    );
  }

  if (name === 'scadenze') {
    if (positionals.length > 0) throw invalid('bad-arguments');
    const { stato, tipo, entro } = values;
    if (stato !== undefined && !PAYABLE_STATES.includes(stato)) throw invalid('bad-arguments');
    if (tipo !== undefined && !PAYABLE_ITEM_KINDS.includes(tipo)) throw invalid('bad-arguments');
    if (entro !== undefined && !/^[0-9]{1,3}$/.test(entro)) throw invalid('bad-arguments');
    // The window is not decided by user1 (plan 9, question 1): only an explicit --entro.
    if (stato === 'in-scadenza' && entro === undefined) throw invalid('bad-arguments');
    // Today: --oggi, or the UTC date of the clock (plan 9, «Mie scelte» 3).
    const today = day(values.oggi ?? clock().slice(0, 10));
    return payablesCommand(
      store,
      {
        today,
        ...optional('soonDays', entro === undefined ? undefined : Number(entro)),
        ...optional('state', stato),
        ...optional('kind', tipo),
      },
      { details: values.dettagli === true },
    );
  }

  if (name === 'scadenza-nuova') {
    need(values, 'appartamento', 'tipo', 'scadenza');
    if (
      positionals.length > 0 ||
      !PayableKindSchema.safeParse(values.tipo).success ||
      ![undefined, 'cedolare', 'registro'].includes(values.voce) ||
      // E3: the ids of payables start with `scad-`, so a typo is no other kind of id.
      (values.id !== undefined && !/^scad-[A-Za-z0-9_-]{1,59}$/.test(values.id))
    ) {
      throw invalid('bad-arguments');
    }
    return savePayableCommand(
      store,
      {
        ...optional('id', values.id),
        apartmentId: values.appartamento,
        kind: values.tipo,
        dueDate: day(values.scadenza),
        ...optional(
          'expected',
          values.importo === undefined ? undefined : positive(values.importo),
        ),
        ...optional('repeatYearly', values['ogni-anno'] === true ? true : undefined),
        ...optional('taxYear', taxYearOf(values['anno-riferimento'])),
        // The voce of the tax table of a bollo or F24, chosen here (plan 17, R303).
        ...optional('taxVoice', values.voce),
      },
      ctx,
    );
  }

  if (name === 'scadenza-ripeti') {
    need(values, 'id', 'scadenza');
    if (positionals.length > 0) throw invalid('bad-arguments');
    return repeatPayableCommand(
      store,
      {
        payableId: values.id,
        dueDate: day(values.scadenza),
        ...optional(
          'expected',
          values.importo === undefined ? undefined : positive(values.importo),
        ),
        ...optional('taxYear', taxYearOf(values['anno-riferimento'])),
      },
      ctx,
    );
  }

  if (name === 'scadenza-pagata') {
    need(values, 'id');
    // Exactly one of --movimento and --data.
    if (
      positionals.length > 0 ||
      (values.movimento === undefined) === (values.data === undefined)
    ) {
      throw invalid('bad-arguments');
    }
    return payablePaidCommand(
      store,
      {
        payableId: values.id,
        ...optional('transactionId', values.movimento),
        ...optional('date', values.data === undefined ? undefined : day(values.data)),
      },
      ctx,
    );
  }

  if (name === 'abbina') {
    if (positionals.length > 0 || values.parte === undefined) throw invalid('bad-arguments');
    return confirmMatchCommand(store, { parts: values.parte.map(parseMatchPart) }, ctx);
  }

  if (name === 'conferma') {
    need(values, 'proposta', 'inquilino');
    if (positionals.length > 0 || values.parte === undefined) throw invalid('bad-arguments');
    return confirmIncomeCommand(
      store,
      {
        proposalId: values.proposta,
        tenantId: values.inquilino,
        parts: values.parte.map(parsePart),
        rememberPayer: values['solo-questa-volta'] !== true,
      },
      ctx,
    );
  }

  if (name === 'annulla-riconciliazione' || name === 'annulla-incassi') {
    need(values, 'operazione');
    if (positionals.length > 0) throw invalid('bad-arguments');
    return undoOperationCommand(store, values.operazione, ctx);
  }

  // I3, E4 (review of 18 Nov 2026): a condominium instalment of the plan of a fiscal year, as the
  // administrator's documents give it (R3): --rata n/N, --importo (the rata), --quota-proprieta
  // (the owner's yearly share, 0 if absent), --conguaglio-prec (last year's settlement on this
  // rata, negative for a credit), --straordinaria. Ids and codes only in the output.
  if (name === 'rata-condominio') {
    need(values, 'id', 'appartamento', 'esercizio', 'scadenza', 'importo');
    const found = /^([0-9]{1,2})\/([0-9]{1,2})$/.exec(
      values.rata?.length === 1 ? values.rata[0] : '',
    );
    if (positionals.length > 0 || found === null) throw invalid('bad-arguments');
    const amountOr0 = (text) => (text === undefined ? euro('0,00') : euro(text));
    return saveCondoInstalmentCommand(
      store,
      {
        id: values.id,
        apartmentId: values.appartamento,
        esercizio: values.esercizio,
        rateIndex: Number(found[1]),
        rateCount: Number(found[2]),
        dueDate: day(values.scadenza),
        rata: euro(values.importo),
        quotaProprieta: amountOr0(values['quota-proprieta']),
        conguaglioPrec: amountOr0(values['conguaglio-prec']),
        ...(values.straordinaria === true ? { straordinaria: true } : {}),
      },
      ctx,
    );
  }

  // I9 (review of 18 Nov 2026): the workspace settings, read, or set with --tolleranza-imu
  // <percentuale> (`predefinita` takes it back to the default of the code).
  if (name === 'impostazioni') {
    if (positionals.length > 0) throw invalid('bad-arguments');
    const imu = values['tolleranza-imu'];
    return settingsCommand(
      store,
      imu === undefined
        ? {}
        : // 0 is no tolerance at all (the schema allows it); basisPoints starts at 0,01%.
          {
            imuToleranceBp:
              imu === 'predefinita' ? null : /^0(,0{1,2})?$/.test(imu) ? 0 : basisPoints(imu),
          },
      ctx,
    );
  }

  // I2, R5 (review of 18 Nov 2026): the closing of a settlement period with its snapshot, and the
  // supplementary settlement of what changed since. Ids, months and codes; amounts only with
  // --dettagli.
  if (name === 'chiudi-periodo' || name === 'conguaglio-supplementare') {
    need(values, 'appartamento', 'periodo');
    if (positionals.length > 0) throw invalid('bad-arguments');
    const query = { apartmentId: values.appartamento, periodLabel: values.periodo };
    const options = { details: values.dettagli === true };
    return name === 'chiudi-periodo'
      ? closePeriodCommand(store, query, ctx, options)
      : periodClosingCommand(store, query, ctx, options);
  }

  // F1, F3 (decided by user1 on 18 Nov 2026): sent, settled per tenant, reopened with a reason.
  if (name === 'invia-conguaglio' || name === 'conguaglio-saldato' || name === 'riapri-periodo') {
    need(values, 'appartamento', 'periodo', 'data');
    if (positionals.length > 0) throw invalid('bad-arguments');
    const query = { apartmentId: values.appartamento, periodLabel: values.periodo };
    const on = day(values.data);
    if (name === 'invia-conguaglio') return markPeriodSentCommand(store, { ...query, on }, ctx);
    if (name === 'conguaglio-saldato') {
      need(values, 'inquilino');
      return markTenantSettledCommand(
        store,
        {
          ...query,
          tenantId: values.inquilino,
          on,
          ...optional('transactionId', values.movimento),
          // D: the supplementary settlement instead of the closing's.
          ...(values.supplementare === true ? { supplementary: true } : {}),
        },
        ctx,
      );
    }
    need(values, 'motivo');
    return reopenPeriodCommand(store, { ...query, on, reason: values.motivo }, ctx);
  }

  // Plan 22 (decision 3 and answer 2 of user1, 19 Nov 2026): the flat charge «da verificare»
  // checked by user1, and the rent not collected marked, each with its outcome; the payment can
  // still be corrected by hand. Ids only in the output.
  if (name === 'forfait-verificato' || name === 'canone-non-incassato') {
    need(values, 'appartamento', 'periodo', 'inquilino', 'data', 'esito');
    const outcomes = name === 'forfait-verificato' ? FLAT_OUTCOMES : RENT_OUTCOMES;
    if (positionals.length > 0 || !Object.hasOwn(outcomes, values.esito)) {
      throw invalid('bad-arguments');
    }
    return (name === 'forfait-verificato' ? markFlatCheckedCommand : markRentMissingCommand)(
      store,
      {
        apartmentId: values.appartamento,
        periodLabel: values.periodo,
        tenantId: values.inquilino,
        on: day(values.data),
        outcome: outcomes[values.esito],
        ...optional('transactionId', values.movimento),
      },
      ctx,
    );
  }

  // E5 (review of 18 Nov 2026): a supply of a shared notice (the code printed on the TARI notice)
  // and the apartments it belongs to, `--appartamento` alone at 100% or `--ripartizione
  // apt-a:60;apt-b:40` (percentages); undone with annulla-riconciliazione. Ids only in the output.
  if (name === 'utenza') {
    need(values, 'etichetta');
    if (
      positionals.length > 0 ||
      (values.appartamento === undefined) === (values.ripartizione === undefined)
    ) {
      throw invalid('bad-arguments');
    }
    const rows =
      values.ripartizione === undefined
        ? [{ apartmentId: values.appartamento, basisPoints: 10000 }]
        : values.ripartizione.split(';').map((part) => {
            const found = /^([A-Za-z0-9_-]{1,64}):(.+)$/.exec(part);
            if (found === null) throw invalid('bad-arguments');
            return { apartmentId: found[1], basisPoints: basisPoints(found[2]) };
          });
    return saveSupplyCommand(store, { label: values.etichetta.trim(), rows, note: '' }, ctx, {
      // Plan 22: new weights of an existing supply from a month («valido dal»).
      ...(values.dal === undefined ? {} : { validFrom: month(values.dal) }),
      // F12: POD, PDR or customer codes of the supply (empty: none).
      ...(values.codici === undefined
        ? {}
        : { codes: values.codici.split(',').filter((c) => c !== '') }),
    });
  }

  // Review of 18 Nov 2026 (annullo, point 2): the live records pointing at a missing or deleted
  // one; kinds, ids and the field only, never a value.
  if (name === 'riferimenti') {
    if (positionals.length > 0) throw invalid('bad-arguments');
    return referencesCommand(store);
  }

  if (name === 'annulla-pagamento') {
    need(values, 'pagamento');
    if (positionals.length > 0) throw invalid('bad-arguments');
    return cancelPaymentCommand(store, values.pagamento, ctx);
  }

  if (name === 'conferma-anno') {
    // Item 6 of plan 25: the items «da verificare» of a past year, confirmed paid by hand.
    need(values, 'anno');
    if (positionals.length > 0 || !/^[0-9]{4}$/.test(values.anno)) throw invalid('bad-arguments');
    return confirmPastYearCommand(
      store,
      { year: values.anno, today: day(values.oggi ?? clock().slice(0, 10)) },
      ctx,
    );
  }

  if (name === 'eccedenza-canone') {
    // B5: confirms the month a rent paid in excess covers, as `riconcilia` proposes it.
    need(values, 'proposta');
    if (positionals.length > 0) throw invalid('bad-arguments');
    return confirmRentExcessCommand(store, values.proposta, ctx);
  }

  if (name === 'escludi') {
    need(values, 'movimento', 'motivo');
    if (positionals.length > 0 || !ExcludeReasonSchema.safeParse(values.motivo).success) {
      throw invalid('bad-arguments');
    }
    return excludeMovementCommand(
      store,
      { transactionId: values.movimento, reason: values.motivo },
      ctx,
    );
  }

  if (name === 'ripara') {
    if (positionals.length > 0) throw invalid('bad-arguments');
    return repairCommand(store);
  }

  if (name === 'scegli-versione') {
    if (positionals.length > 0) throw invalid('bad-arguments');
    need(values, 'file');
    return chooseVersionCommand(
      store,
      { file: values.file, ...optional('operationId', values.operazione) },
      ctx,
      { details: values.dettagli === true },
    );
  }

  // annulla
  need(values, 'estratto');
  return undoImportCommand(store, values.estratto, ctx);
}

/** The commands `main` accepts; each one has a line in COMMAND_HELP (estratti-aiuto.mjs). */
export const COMMAND_NAMES = [
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
  'eccedenza-canone',
  'conferma-anno',
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
  'affitti-anno',
  'scadenze',
  'scadenza-nuova',
  'scadenza-ripeti',
  'scadenza-pagata',
  'appartamento',
  'condominio-documento',
  'condominio',
  'condominio-stima',
  'recupero',
  'contatto',
  'contatti',
  'presenza',
  'fine-presenza',
  'subentro',
  'scambio-camera',
  'stato-contratti',
  'caparra-restituzione',
  'tasso-legale',
  'tasse-stima',
  'tasse-copia',
  'tasse-assegna',
  'tasse-conferma',
  'scheda-inquilino',
  'soglie-consumi',
  'consumi',
  'tasse',
  'bolletta',
  'annulla-bolletta',
  'cruscotto',
  'riferimenti',
  'utenza',
  'rata-condominio',
  'impostazioni',
  'chiudi-periodo',
  'conguaglio-supplementare',
  'invia-conguaglio',
  'conguaglio-saldato',
  'forfait-verificato',
  'canone-non-incassato',
  'riapri-periodo',
  'scegli-versione',
  'aiuto',
];

/**
 * The data folder of one command line (review of 18 Nov 2026, data format): before its first
 * write of a record or an operation, a folder whose `workspace.json` declares an older data format
 * is raised to `DATA_FORMAT` (`raiseDataFormat`, idempotent), so that an older app opens it
 * read-only instead of reading records it does not know. A newer format is refused by
 * `commitChange` (`newer-data`: update the app); a folder without `workspace.json` is left as it is.
 */
class CliStore extends FsStore {
  formatChecked = false;
  formatRaised = false;

  async writeJsonAtomic(path, value) {
    if (!this.formatChecked && path !== WORKSPACE_PATH) {
      this.formatChecked = true;
      const workspace = await findWorkspace(this);
      if (workspace !== undefined && workspace.schemaVersion < DATA_FORMAT) {
        this.formatRaised = (await raiseDataFormat(this)) === 'raised';
      }
    }
    return super.writeJsonAtomic(path, value);
  }
}

/**
 * Runs one command line. `io.now` is the clock and `io.newId` the generator of ids (both live
 * outside the core); returns the exit code and the JSON line.
 */
export async function main(argv, io = { now: () => new Date().toISOString(), newId: randomUUID }) {
  const done = (code, body) => ({ code, output: `${JSON.stringify(body)}\n` });
  try {
    const [first, ...args] = argv;
    // Q9: `--help` (or `aiuto`) alone lists the commands; `aiuto <comando>` is `<comando> --help`.
    if (first === '--help' || first === '-h' || (first === 'aiuto' && args.length === 0)) {
      return done(0, {
        status: 'help',
        message: USAGE,
        commands: COMMAND_NAMES.map((command) => ({ command, description: COMMAND_HELP[command] })),
      });
    }
    const [name, ...rest] = first === 'aiuto' ? [args[0], ...args.slice(1), '--help'] : argv;
    if (!COMMAND_NAMES.includes(name ?? '')) {
      throw invalid('bad-arguments', { message: MESSAGES['unknown-command'] });
    }
    let parsed;
    try {
      parsed = parseArgs({
        args: negativeValues(rest),
        options: OPTIONS,
        allowPositionals: true,
        strict: true,
      });
    } catch {
      throw invalid('bad-arguments');
    }
    const { values, positionals } = parsed;
    // An option of another command would be ignored in silence (`conferma --prova` would write).
    const only = {
      prova: ['riconcilia'],
      dettagli: [
        'scegli-versione',
        'consumi',
        'riconcilia',
        'importa',
        'saldi',
        'imu',
        'contratti',
        'scadenze',
        'condominio',
        'condominio-stima',
        'contatti',
        'stato-contratti',
        'caparra-restituzione',
        'tasse',
        'bolletta',
        'annulla-bolletta',
        'cruscotto',
        'chiudi-periodo',
        'conguaglio-supplementare',
      ],
      parte: ['conferma', 'abbina', 'tasse-assegna'],
      'solo-questa-volta': ['conferma', 'uscita', 'giroconto', 'imu-f24'],
      pagamento: ['annulla-pagamento'],
      movimento: [
        'escludi',
        'annulla-uscita',
        'imu-f24',
        'scadenza-pagata',
        'tasse-assegna',
        'recupero',
        'conguaglio-saldato',
        'forfait-verificato',
        'canone-non-incassato',
      ],
      motivo: ['escludi', 'riapri-periodo'],
      supplementare: ['conguaglio-saldato'],
      esito: ['forfait-verificato', 'canone-non-incassato'],
      proposta: ['conferma', 'uscita', 'uscita-inquilino', 'giroconto', 'eccedenza-canone'],
      inquilino: [
        'conferma',
        'uscita-inquilino',
        'presenza',
        'subentro',
        'caparra-restituzione',
        'scheda-inquilino',
        'conguaglio-saldato',
        'forfait-verificato',
        'canone-non-incassato',
      ],
      giallo: ['soglie-consumi'],
      bolletta: ['consumi'],
      rosso: ['soglie-consumi'],
      valori: ['scheda-inquilino'],
      appartamento: [
        'conto',
        'uscita',
        'imu-atteso',
        'contratto',
        'contratti',
        'affitti-anno',
        'scadenza-nuova',
        'condominio-documento',
        'condominio',
        'condominio-stima',
        'recupero',
        'presenza',
        'scambio-camera',
        'stato-contratti',
        'caparra-restituzione',
        'tasse-stima',
        'tasse-copia',
        'tasse-conferma',
        'soglie-consumi',
        'bolletta',
        'contatti',
        'utenza',
        'rata-condominio',
        'chiudi-periodo',
        'conguaglio-supplementare',
        'invia-conguaglio',
        'conguaglio-saldato',
        'forfait-verificato',
        'canone-non-incassato',
        'riapri-periodo',
      ],
      voce: ['recupero', 'tasse-stima', 'scadenza-nuova', 'tasse-conferma'],
      inquilini: ['recupero'],
      quote: ['recupero'],
      periodo: [
        'recupero',
        'chiudi-periodo',
        'conguaglio-supplementare',
        'invia-conguaglio',
        'conguaglio-saldato',
        'forfait-verificato',
        'canone-non-incassato',
        'riapri-periodo',
      ],
      stato: ['scadenze', 'recupero'],
      nome: ['inquilino', 'appartamento', 'contatto'],
      ruolo: ['contatto', 'contatti'],
      note: ['contatto', 'tasse-conferma'],
      ...Object.fromEntries(
        ['telefono', 'email', 'appartamenti', 'utenze', 'categorie'].map((option) => [
          option,
          ['contatto'],
        ]),
      ),
      esercizio: ['condominio-documento', 'condominio', 'condominio-stima', 'rata-condominio'],
      'quota-conduttore': ['condominio-documento'],
      anno: [
        'conferma-anno',
        'tasso-legale',
        'tasse-conferma',
        'imu-atteso',
        'imu-f24',
        'imu',
        'affitti-anno',
        'tasse-stima',
        'tasse-copia',
        'tasse',
        'cruscotto',
      ],
      gruppo: ['imu-atteso', 'imu-f24'],
      totale: ['imu-atteso', 'affitti-anno', 'condominio-documento'],
      rata: ['imu-atteso', 'imu-f24', 'rata-condominio'],
      categoria: ['uscita'],
      f24: ['uscita'],
      tipo: ['uscita-inquilino', 'contratto', 'scadenze', 'scadenza-nuova', 'condominio-documento'],
      'rimborso-canone': ['uscita-inquilino'],
      mese: ['uscita-inquilino', 'fine-presenza', 'subentro', 'scambio-camera'],
      scopo: ['giroconto', 'giroconto-manuale'],
      'altra-gamba': ['giroconto'],
      gambe: ['giroconto'],
      da: ['giroconto-manuale'],
      a: ['giroconto-manuale'],
      importo: [
        'giroconto-manuale',
        'scadenza-nuova',
        'scadenza-ripeti',
        'recupero',
        'tasse-stima',
        'rata-condominio',
      ],
      data: [
        'giroconto-manuale',
        'scadenza-pagata',
        'recupero',
        'invia-conguaglio',
        'conguaglio-saldato',
        'forfait-verificato',
        'canone-non-incassato',
        'riapri-periodo',
      ],
      entro: ['scadenze', 'cruscotto'],
      oggi: ['scadenze', 'tasse', 'cruscotto', 'conferma-anno'],
      lettura: ['bolletta'],
      'soglia-consumi': ['bolletta'],
      codici: ['bolletta', 'appartamento', 'utenza'],
      conferma: ['bolletta'],
      'periodo-conguaglio': ['cruscotto'],
      ripartizione: ['utenza'],
      'quota-proprieta': ['rata-condominio'],
      'conguaglio-prec': ['rata-condominio'],
      straordinaria: ['rata-condominio'],
      'tolleranza-imu': ['impostazioni'],
      pagine: ['annulla-bolletta'],
      scadenza: ['scadenza-nuova', 'scadenza-ripeti', 'rata-condominio'],
      'ogni-anno': ['scadenza-nuova'],
      'anno-riferimento': ['scadenza-nuova', 'scadenza-ripeti'],
      dal: ['importa', 'contratto-canone', 'presenza', 'appartamento', 'utenza'],
      al: ['importa', 'presenza'],
      posto: ['presenza'],
      affitto: ['presenza', 'subentro'],
      forfait: ['presenza', 'subentro'],
      'caparra-attesa': ['presenza', 'subentro'],
      presenza: ['fine-presenza', 'subentro'],
      ...Object.fromEntries(
        ['presenza-a', 'presenza-b', 'canone-a', 'canone-b', 'id-a', 'id-b'].map((o) => [
          o,
          ['scambio-camera'],
        ]),
      ),
      tasso: ['tasso-legale'],
      addebito: ['caparra-restituzione'],
      ...Object.fromEntries(
        [
          'inizio',
          'fine',
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
      ...Object.fromEntries(
        [
          'locatore',
          'posti',
          'annualita',
          'esercizio-condominio',
          'differenza-condominio',
          'modifica',
          'posti-nomi',
        ].map((option) => [option, ['appartamento']]),
      ),
      conguaglio: ['contratto', 'caparra-restituzione'],
      file: ['scegli-versione'],
      contratto: ['contratto-canone', 'presenza'],
      canone: ['contratto-canone'],
      acconto: ['contratto-canone'],
    };
    if (values.help === true) {
      // Q9: the options of the command from `only`; the others are not tied to one command.
      const own = Object.keys(only).filter((option) => only[option].includes(name));
      return done(0, {
        status: 'help',
        command: name,
        description: COMMAND_HELP[name],
        message: USAGE,
        options: own.map((option) => `--${option}`),
        otherOptions: Object.keys(OPTIONS)
          .filter((option) => !Object.hasOwn(only, option) && option !== 'help')
          .map((option) => `--${option}`),
      });
    }
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
    const store = new CliStore(values.cartella);
    const today = day(now.slice(0, 10));
    const closedBefore = await closedPeriodStates(store, today);
    const result = await command(
      name,
      values,
      positionals,
      store,
      values.utente ?? 'cli',
      () => now,
      io.newId,
    );
    // The raise of the folder's data format is said in the output (it is not an operation).
    let body = store.formatRaised ? { ...result, dataFormat: 'raised' } : result;
    // Point 6: a write that changed a period closed before it (never a refusal of ours).
    if (store.formatChecked && closedBefore.size > 0) {
      const changed = changedClosedPeriods(closedBefore, await closedPeriodStates(store, today));
      if (changed !== undefined) body = { ...body, ...changed };
    }
    return done(0, body);
  } catch (error) {
    if (error instanceof Stop) return done(error.status === 'invalid' ? 2 : 1, stopBody(error));
    const refusal = commandRefusal(error);
    if (refusal !== undefined) return done(1, refusal);
    // Never the message or the stack: they could hold a path or a value.
    return done(3, FAILED_BODY);
  }
}

if (
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { code, output } = await main(process.argv.slice(2));
  process.stdout.write(output, () => process.exit(code));
}
