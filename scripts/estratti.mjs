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
  AccountSchema,
  ApartmentSchema,
  BillSchema,
  BankProfileSchema,
  CsvError,
  ExcludeReasonSchema,
  ISODateSchema,
  StatementReadError,
  StatementTableSchema,
  BankTransactionSchema,
  OutgoingKindSchema,
  TaxVoiceSchema,
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
  loadRentYears,
  loadAccountBalances,
  loadImuRates,
  loadCondo,
  loadCondoEstimate,
  loadContacts,
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
  saveApartment,
  saveCondoDocument,
  saveContact,
  saveTenantRecovery,
  equalShares,
  saveContract,
  setContractRent,
  saveTenancy,
  endTenancy,
  recordRoomSwap,
  recordTakeover,
  loadContractStatus,
  loadDepositReturn,
  saveLegalRate,
  confirmTaxDiscrepancy,
  saveTenantCard,
  saveConsumptionSettings,
  billFileMove,
  loadConsumption,
  saveTenant,
  setImuYear,
  setRentYear,
  assignImuF24,
  assignTaxPayment,
  copyPreviousTaxYear,
  loadTaxTable,
  setTaxEstimate,
  PayableKindSchema,
  loadScadenzario,
  repeatPayable,
  savePayable,
  setPayablePaid,
  undoBlockedBy,
  undoImport,
  undoOperation,
  ExtractionResultSchema,
  hashBytes,
  importBill,
  loadDashboard,
  undoBillImport,
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
    'Rifiutato: si annullano solo le operazioni della riconciliazione (incassi, esclusioni, abbinamenti, uscite, giroconti, IMU, contratti, appartamenti, condominio, scadenze, tasse, presenze, rubrica).',
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
  'imu-has-assignments':
    'Rifiutato: un F24 è assegnato a una rata IMU che cambierebbe: annullare prima l’assegnazione.',
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
  'cedolare-estimate': 'Cedolare stimata: da confermare, non è un pagamento.',
  'contract-overlap':
    'Due contratti vivi dello stesso appartamento hanno mesi in comune: controllare le date.',
  'unknown-payable': 'Rifiutato: scadenza sconosciuta o annullata.',
  'not-repeating': 'Rifiutato: la scadenza non è segnata «ogni anno».',
  'already-repeated': 'Rifiutato: la scadenza ha già la voce successiva.',
  'already-paid': 'Rifiutato: la scadenza è già segnata pagata: annullare prima.',
  'transaction-not-classified':
    'Rifiutato: il movimento non ha una classificazione confermata a mano (esclusioni escluse).',
  'payable-linked': 'Rifiutato: il movimento paga già una scadenza: annullare prima.',
  'bad-date': 'Rifiutato: serve la data del pagamento o il movimento.',
  'date-and-transaction': 'Rifiutato: indicare la data o il movimento, non tutti e due.',
  'missing-fields':
    'Rifiutato: per un appartamento nuovo servono nome, locatore, posti, annualità e differenza del condominio.',
  'invalid-document': 'Rifiutato: i dati del documento del condominio non sono validi.',
  'esercizio-format':
    'Rifiutato: l’esercizio ha una forma diversa da quella degli altri documenti dell’appartamento (2026 o 2026-27).',
  'not-extraordinary':
    'Rifiutato: la voce non è una spesa condominiale straordinaria viva di questo appartamento.',
  'amount-too-high': 'Rifiutato: da recuperare più della spesa anticipata.',
  'bad-shares':
    'Rifiutato: quote non valide (inquilino ripetuto o senza presenza, quota zero o di segno diverso, somma diversa).',
  'unknown-expense':
    'Rifiutato: il movimento non è un’uscita viva classificata a questo appartamento.',
  'missing-date':
    'Rifiutato: senza spesa collegata servono la data della spesa (--data) o il periodo (--periodo).',
  'recovery-above-expense':
    'Avviso: i recuperi superano la spesa straordinaria, corretta dopo: controllare i recuperi.',
  'invalid-recovery': 'Rifiutato: i dati del recupero non sono validi.',
  'needs-confirmation':
    'Rifiutato: posti e inizio dell’annualità cambiano ogni conguaglio: ripetere con --modifica.',
  'invalid-apartment': 'Rifiutato: i dati dell’appartamento non sono validi.',
  'f24-pattern-missing':
    'Nota: il profilo della banca non riconosce ancora gli F24 di questo conto.',
  'invalid-tenancy':
    'Rifiutato: i dati della presenza non sono validi (identificativo, mesi o importi).',
  'unknown-tenant': 'Rifiutato: inquilino sconosciuto o cancellato.',
  'same-tenant': 'Rifiutato: nel subentro l’inquilino che entra è quello che esce.',
  'no-contract': 'Rifiutato: la presenza che esce non è in esattamente un contratto vivo.',
  'tenancy-exists': 'Rifiutato: la presenza che entra esiste già con altri dati.',
  'beds-conflict':
    'Rifiutato: con questa presenza il conguaglio non si può calcolare (posto occupato, posto sconosciuto, troppi inquilini o inquilino presente due volte).',
  'tenancy-has-dependents':
    'Rifiutato: versamenti, recuperi o presenze nello stesso posto dipendono da questa operazione: annullarli prima.',
  'takeover-unlinked':
    'Rifiutato: il contratto ha un subentro: ripetere --presenze con le presenze del subentro.',
  'no-room': 'Rifiutato: una delle due presenze non ha un posto.',
  'same-room': 'Rifiutato: le due presenze sono nello stesso posto.',
  'different-contract': 'Rifiutato: le due presenze sono in contratti diversi.',
  'pending-takeover':
    'Rifiutato: una delle due presenze ha già un subentro registrato: annullare prima il subentro.',
  'id-too-long':
    'Rifiutato: l’identificativo della presenza nuova supera 64 caratteri (vedi part): indicarlo con --id-a o --id-b.',
  'swap-unlinked':
    'Rifiutato: il contratto ha un cambio di posto: ripetere --presenze con entrambe le presenze di ciascun inquilino.',
  'swap-rent-unchanged':
    'Nota: i due posti hanno affitti diversi e almeno uno resta quello di prima: indicare --canone-a e --canone-b se cambiano.',
  'swap-forfait-unchanged': 'Nota: i due forfait sono diversi e ciascuno tiene il proprio.',
  'has-recoveries':
    'Rifiutato: l’inquilino ha un recupero in un periodo in cui non sarebbe più presente: correggere prima il recupero.',
  'deposit-check': 'Caparra mancante o diversa da quella attesa: controllare i versamenti.',
  'no-deposit': 'Rifiutato: nessuna caparra versata da questo inquilino in questo appartamento.',
  'already-returned': 'Rifiutato: la caparra risulta già restituita.',
  'missing-rate':
    'Rifiutato: manca il tasso legale di un anno della permanenza: inserirlo con «tasso-legale».',
  'no-exit': 'Rifiutato: la permanenza dell’inquilino non ha ancora una fine.',
  'partial-return':
    'Rifiutato: c’è già una restituzione parziale della caparra: come contarla non è ancora deciso.',
  'several-stays':
    'Rifiutato: l’inquilino ha avuto più permanenze separate nell’appartamento: quale caparra appartenga a quale non è ancora deciso.',
  'mixed-f24-out':
    'Da verificare: la parte non IMU di un F24 misto resta fuori dal saldo tra appartamenti.',
  'recovery-waiting':
    'Avviso: un recupero da trattenere aspetta il pagamento della spesa: non è ancora nel prospetto.',
  'no-period': 'Rifiutato: nessun periodo di conguaglio contiene il mese di uscita.',
  'ambiguous-period': 'Rifiutato: più periodi di conguaglio contengono il mese di uscita.',
  'settlement-error':
    'Rifiutato: il conguaglio del periodo di uscita non si calcola (presenze o rate da correggere).',
  'invalid-rate': 'Rifiutato: anno o tasso non validi.',
  'deposit-return-draft':
    'Prospetto con le date, i tassi e il conguaglio indicati: da controllare prima dell’invio.',
  'bad-year': 'Rifiutato: anno non valido.',
  'bad-parts':
    'Rifiutato: parti non valide (importo non positivo, voce e anno ripetuti, voce non ammessa).',
  'year-not-empty':
    'Rifiutato: l’anno ha già delle stime per un appartamento indicato: non si sovrascrive nulla.',
  'nothing-to-copy': 'Rifiutato: nessuna stima dell’anno prima da copiare.',
  'not-tax-debit': 'Rifiutato: il movimento non è un addebito contabilizzato classificato «tasse».',
  'imu-assigned': 'Rifiutato: il movimento paga una rata IMU: annullare prima l’assegnazione.',
  'tax-assigned':
    'Rifiutato: il movimento è assegnato a cedolare o registro: annullare prima l’assegnazione.',
  'invalid-contact':
    'Rifiutato: contatto non valido (id o campi vuoti, categoria sconosciuta, collegamento ripetuto).',
  'unknown-supply': 'Rifiutato: utenza sconosciuta.',
  'condo-estimate-copied':
    'Stima copiata da un esercizio precedente: non è un documento del condominio e non si salva.',
  'tax-year-empty':
    'Avviso: nessuna stima delle tasse per quest’anno: «tasse-copia» copia l’anno prima.',
  'tax-no-payable':
    'Da verificare: nessuna scadenza con anno di riferimento per questa voce e quest’anno; una scadenza senza anno va riscritta con «scadenza-nuova --id <id> --anno-riferimento <AAAA>».',
  'no-discrepancy': 'Rifiutato: la voce di quest’anno non ha una discrepanza da confermare.',
  'bad-note': 'Rifiutato: la nota è vuota.',
  'invalid-card': 'Rifiutato: la scheda riservata è vuota o ha dati non validi (date AAAA-MM-GG).',
  'bad-values':
    'Il file dei valori non è valido: un oggetto JSON con testi per codice_fiscale, luogo_nascita, data_nascita, residenza, documento_numero, documento_ente, documento_rilascio, documento_scadenza.',
  'invalid-settings': 'Rifiutato: soglie non valide.',
  'unknown-bill': 'Rifiutato: bolletta sconosciuta o cancellata.',
  'no-consumption-thresholds':
    'Nessuna soglia dell’allarme consumi: inserirle con «soglie-consumi» (nessun valore predefinito).',
  'bad-voce': 'Rifiutato: voce delle tasse non valida.',
  'bad-voice': 'Rifiutato: una scadenza di cedolare o registro è già la sua voce: niente --voce.',
  'tax-discrepancy':
    'Discrepanza tra la stima e il pagato più l’ancora previsto: solo un avviso, non blocca nulla.',
  failed: 'Operazione non riuscita: ripetere il comando (per un estratto, «importa»).',
  'bad-reading': 'La lettura non è valida: rifarla con «python -I -m bollette_pdf extract».',
  'bill-rejected': 'Rifiutato: niente da registrare, o file diverso da quello letto.',
  'duplicate-bill': 'Questo documento è già registrato.',
  'possible-duplicate-bill': 'Un documento con gli stessi dati è già registrato: controllare.',
  'several-documents':
    'Rifiutato: il file contiene più documenti; indicare quale con --pagine a-b (o --pagine intero).',
  'has-dependents-bill':
    'Rifiutato: un abbinamento o un recupero usa la bolletta; annullare prima quelli.',
};

/** Thrown to stop with a status; `invalid` is exit 2, `rejected` exit 1. */
// Plan 18: the refusals of scambio-camera whose general message speaks of a takeover or an arrival.
const SWAP_MESSAGES = {
  'same-tenant': 'Rifiutato: nello scambio le due presenze sono dello stesso inquilino.',
  'no-contract': 'Rifiutato: una delle due presenze non è in esattamente un contratto vivo.',
  'tenancy-exists':
    'Rifiutato: una presenza nuova esiste già con altri dati: annullare lo scambio precedente (annulla-riconciliazione) o scegliere altri identificativi con --id-a e --id-b.',
};

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
  'apartment.save',
  'condo.document',
  'recovery.save',
  'rent.year',
  'payable.save',
  'payable.repeat',
  'payable.paid',
  'tenancy.save',
  'tenancy.end',
  'tenancy.takeover',
  'tenancy.swap',
  'tax.estimate',
  'tax.copy',
  'tax.assign',
  'contact.save',
  'legal-rate.save',
  'tax.confirm',
  'tenant.card',
  'consumption.settings',
];

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

  if (name === 'soglie-consumi') {
    // Plan 17, R313: the thresholds of the consumption alarm, typed by user1 (none in the code).
    if (positionals.length > 0 || (values.giallo === undefined && values.rosso === undefined)) {
      throw invalid('bad-arguments');
    }
    const result = await saveConsumptionSettings(
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
      who,
      clock,
      newId,
    );
    if (result.status === 'refused') throw new Stop('rejected', result.reason);
    return result;
  }

  if (name === 'consumi') {
    // Differences in basis points and levels; the sides (amounts, quantities) with --dettagli.
    need(values, 'bolletta');
    if (positionals.length > 0) throw invalid('bad-arguments');
    const result = await loadConsumption(store, values.bolletta);
    if (result.status === 'refused') throw new Stop('rejected', result.reason);
    const side = (c) =>
      c === undefined
        ? undefined
        : {
            differences: c.differences,
            ...(values.dettagli === true ? { reference: c.reference } : {}),
          };
    return {
      status: 'ok',
      thresholds: result.thresholds,
      ...(result.thresholds ? {} : { message: MESSAGES['no-consumption-thresholds'] }),
      yearBefore: side(result.comparison.yearBefore),
      recent: side(result.comparison.recent),
      ...(values.dettagli === true ? { current: result.comparison.current } : {}),
    };
  }

  if (name === 'scheda-inquilino') {
    // Plan 17, R311: the reserved card of a tenant, from a JSON file (never personal data as
    // arguments, never echoed). Keys: codice_fiscale, luogo_nascita, data_nascita, residenza,
    // documento_numero, documento_ente, documento_rilascio, documento_scadenza. Replaces the card.
    need(values, 'inquilino', 'valori');
    if (positionals.length > 0) throw invalid('bad-arguments');
    let given;
    try {
      given = JSON.parse(readBytes(values.valori).toString('utf8'));
    } catch {
      throw invalid('bad-values');
    }
    const keys = [
      'codice_fiscale',
      'luogo_nascita',
      'data_nascita',
      'residenza',
      'documento_numero',
      'documento_ente',
      'documento_rilascio',
      'documento_scadenza',
    ];
    if (
      typeof given !== 'object' ||
      given === null ||
      Array.isArray(given) ||
      Object.entries(given).some(([k, v]) => !keys.includes(k) || typeof v !== 'string')
    ) {
      throw invalid('bad-values');
    }
    if (
      given.documento_numero === undefined &&
      Object.keys(given).some((k) => k.startsWith('documento_'))
    ) {
      throw invalid('bad-values');
    }
    const date = (text) => (ISODateSchema.safeParse(text).success ? text : null);
    const card = {
      ...optional('taxCode', given.codice_fiscale),
      ...optional('birthPlace', given.luogo_nascita),
      ...optional(
        'birthDate',
        given.data_nascita === undefined ? undefined : date(given.data_nascita),
      ),
      ...optional('residence', given.residenza),
      ...(given.documento_numero === undefined
        ? {}
        : {
            idDocument: {
              number: given.documento_numero,
              ...optional('issuer', given.documento_ente),
              ...optional(
                'issuedOn',
                given.documento_rilascio === undefined ? undefined : date(given.documento_rilascio),
              ),
              ...optional(
                'expiresOn',
                given.documento_scadenza === undefined ? undefined : date(given.documento_scadenza),
              ),
            },
          }),
    };
    const result = await saveTenantCard(
      store,
      { tenantId: values.inquilino, card },
      who,
      clock,
      newId,
    );
    if (result.status === 'refused') throw new Stop('rejected', result.reason);
    return result;
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
          // Group, year and index only (plan 3d, task 5): always to confirm with imu-f24.
          ...(p.imuSuggestion === undefined ? {} : { imuSuggestion: p.imuSuggestion }),
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
    if (result.status === 'refused' && result.reason === 'has-dependents') {
      // Plan 10: a tax payment on the movement.
      throw new Stop('rejected', result.reason, {
        message: MESSAGES['movement-has-dependents'],
        recordIds: result.recordIds,
      });
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
        mixedF24: result.mixedF24,
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
      // Plan 17, R307: the part of a mixed F24 that is no IMU, out of the balance (to check).
      ...(result.mixedF24.length > 0
        ? { mixedF24: result.mixedF24.length, message: MESSAGES['mixed-f24-out'] }
        : {}),
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
    if (result.status === 'refused' && result.reason === 'has-dependents') {
      throw new Stop('rejected', result.reason, {
        message: MESSAGES['imu-has-assignments'],
        recordIds: result.recordIds,
      });
    }
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
        rememberRule: values['solo-questa-volta'] !== true,
      },
      who,
      clock,
      newId,
    );
    if (result.status === 'refused') throw new Stop('rejected', result.reason);
    if (result.status === 'unchanged') return { status: 'unchanged', classId: result.classId };
    return {
      status: 'assigned',
      operationId: result.operationId,
      classId: result.classId,
      ...(result.ruleId === undefined ? {} : { ruleId: result.ruleId }),
    };
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
    const result = await saveApartment(
      store,
      {
        id: v.id,
        ...optional('name', v.nome),
        ...optional('locatore', v.locatore),
        ...optional('posti', v.posti === undefined ? undefined : Number(v.posti)),
        ...optional(
          'annualitaStart',
          v.annualita === undefined ? undefined : yearStart(v.annualita),
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
      },
      who,
      clock,
      newId,
      { confirmed: v.modifica === true },
    );
    if (result.status === 'refused') throw new Stop('rejected', result.reason);
    return {
      status: result.status,
      apartmentId: result.apartmentId,
      ...(result.status === 'unchanged' ? {} : { operationId: result.operationId }),
    };
  }

  if (name === 'condominio-documento') {
    need(values, 'appartamento', 'esercizio', 'tipo', 'totale');
    if (positionals.length > 0 || !['preventivo', 'consuntivo'].includes(values.tipo)) {
      throw invalid('bad-arguments');
    }
    const quota = values['quota-conduttore'];
    const result = await saveCondoDocument(
      store,
      {
        apartmentId: values.appartamento,
        esercizio: values.esercizio,
        kind: values.tipo,
        total: euro(values.totale),
        ...optional('quotaConduttore', quota === undefined ? undefined : euro(quota)),
      },
      who,
      clock,
      newId,
    );
    if (result.status === 'refused') {
      // R310: which documents have the other form (ids only).
      throw new Stop(
        'rejected',
        result.reason,
        result.reason === 'esercizio-format' ? { documentIds: result.documentIds } : {},
      );
    }
    return {
      status: result.status,
      documentId: result.documentId,
      ...(result.status === 'saved' ? { operationId: result.operationId } : {}),
    };
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
    const result = await saveTenantRecovery(
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
      who,
      clock,
      newId,
    );
    if (result.status === 'refused') throw new Stop('rejected', result.reason);
    return {
      status: result.status,
      recoveryId: result.recoveryId,
      ...(result.status === 'saved' ? { operationId: result.operationId } : {}),
    };
  }

  // The owners' check of the condominium expenses (section 12) and the differences consuntivo −
  // preventivo; amounts and dates only with --dettagli (R107, R194).
  if (name === 'condominio') {
    if (positionals.length > 0) throw invalid('bad-arguments');
    const result = await loadCondo(store, {
      asOf: day(clock().slice(0, 10)),
      ...optional('apartmentId', values.appartamento),
      ...optional('esercizio', values.esercizio),
    });
    if (result.status === 'refused') throw new Stop('rejected', result.reason);
    const details = values.dettagli === true;
    const rates = result.rates.map((r) => ({
      instalmentId: r.instalmentId,
      apartmentId: r.apartmentId,
      esercizio: r.esercizio,
      rateIndex: r.rateIndex,
      rateCount: r.rateCount,
      straordinaria: r.straordinaria,
      status: r.status,
      ...(details
        ? { expected: r.expected, debited: r.debited, dueDate: r.dueDate, debitDates: r.debitDates }
        : {}),
    }));
    return {
      status: 'ok',
      rates,
      anomalies: rates.filter((r) =>
        ['senza-addebito', 'importo-diverso', 'duplicato'].includes(r.status),
      ).length,
      differences: result.differences.map((d) => ({
        apartmentId: d.apartmentId,
        esercizio: d.esercizio,
        to: d.to,
        conduttore: d.conduttore === undefined ? 0 : 1,
        ...(details
          ? {
              preventivo: d.preventivo,
              consuntivo: d.consuntivo,
              difference: d.difference,
              ...optional('conduttoreDetails', d.conduttore),
            }
          : {}),
      })),
      recoveries: result.recoveries.map((r) => ({
        recoveryId: r.id,
        apartmentId: r.apartmentId,
        ...optional('instalmentId', r.instalmentId),
        ...optional('transactionId', r.transactionId),
        status: r.status,
        ...optional('periodLabel', r.periodLabel),
        tenants: r.shares.length,
        ...(details ? { amount: r.amount, shares: r.shares } : {}),
      })),
      warnings: result.warnings.map((w) => ({ ...w, message: MESSAGES[w.code] })),
    };
  }

  // The estimate of a fiscal year (plan 14, R250): source always, amounts only with --dettagli.
  if (name === 'condominio-stima') {
    need(values, 'appartamento', 'esercizio');
    // The same form as a fiscal year of condominio-documento (`saveCondoDocument`).
    if (positionals.length > 0 || !/^[A-Za-z0-9_-]{1,32}$/.test(values.esercizio)) {
      throw invalid('bad-arguments');
    }
    const result = await loadCondoEstimate(store, {
      apartmentId: values.appartamento,
      esercizio: values.esercizio,
    });
    if (result.status === 'refused') throw new Stop('rejected', result.reason);
    const e = result.estimate;
    if (e === undefined) return { status: 'ok' };
    return {
      status: 'ok',
      estimate: {
        apartmentId: e.apartmentId,
        esercizio: e.esercizio,
        source: e.source,
        fromEsercizio: e.fromEsercizio,
        fromKind: e.fromKind,
        ...(e.source === 'copiata' ? { message: MESSAGES['condo-estimate-copied'] } : {}),
        ...(values.dettagli === true
          ? { total: e.total, quotaConduttore: e.quotaConduttore, lines: e.lines }
          : {}),
      },
    };
  }

  // The address book (plan 14, R253): every field replaced, a field left out is removed.
  if (name === 'contatto') {
    need(values, 'id', 'ruolo', 'nome');
    if (positionals.length > 0 || !CONTACT_ROLES.includes(values.ruolo)) {
      throw invalid('bad-arguments');
    }
    const result = await saveContact(
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
      who,
      clock,
      newId,
    );
    if (result.status === 'refused') throw new Stop('rejected', result.reason);
    return {
      status: result.status,
      contactId: result.contactId,
      ...(result.status === 'saved' ? { operationId: result.operationId } : {}),
    };
  }

  // Ids, role and links; the name and the contacts only with --dettagli (R107).
  if (name === 'contatti') {
    if (
      positionals.length > 0 ||
      (values.ruolo !== undefined && !CONTACT_ROLES.includes(values.ruolo))
    ) {
      throw invalid('bad-arguments');
    }
    const result = await loadContacts(store, {
      ...optional('apartmentId', values.appartamento),
      ...optional('role', values.ruolo),
    });
    if (result.status === 'refused') throw new Stop('rejected', result.reason);
    return {
      status: 'ok',
      contacts: result.contacts.map((c) => ({
        contactId: c.id,
        role: c.role,
        apartmentIds: c.apartmentIds,
        supplyIds: c.supplyIds ?? [],
        categories: c.categories ?? [],
        ...(values.dettagli === true
          ? { name: c.name, phone: c.phone, email: c.email, notes: c.notes }
          : {
              phone: c.phone === undefined ? 0 : 1,
              email: c.email === undefined ? 0 : 1,
              notes: c.notes === undefined ? 0 : 1,
            }),
      })),
    };
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
            annual: r.annual,
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

  if (name === 'affitti-anno') {
    need(values, 'appartamento', 'anno', 'totale');
    if (positionals.length > 0 || !YearSchema.safeParse(values.anno).success) {
      throw invalid('bad-arguments');
    }
    const totalRent = euro(values.totale);
    if (totalRent <= 0) throw invalid('bad-arguments');
    const result = await setRentYear(
      store,
      { apartmentId: values.appartamento, year: values.anno, totalRent },
      who,
      clock,
      newId,
    );
    if (result.status === 'refused') throw new Stop('rejected', result.reason);
    return {
      status: result.status,
      rentYearId: result.rentYearId,
      ...(result.status === 'saved' ? { operationId: result.operationId } : {}),
    };
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
    const result = await setTaxEstimate(
      store,
      { apartmentId: values.appartamento, year: values.anno, voce: values.voce, amount },
      who,
      clock,
      newId,
    );
    if (result.status === 'refused') throw new Stop('rejected', result.reason);
    return {
      status: result.status,
      estimateId: result.estimateId,
      ...(result.status === 'saved' ? { operationId: result.operationId } : {}),
    };
  }

  if (name === 'tasse-copia') {
    need(values, 'anno');
    if (positionals.length > 0 || !YearSchema.safeParse(values.anno).success) {
      throw invalid('bad-arguments');
    }
    const result = await copyPreviousTaxYear(
      store,
      { year: values.anno, ...optional('apartmentId', values.appartamento) },
      who,
      clock,
      newId,
    );
    if (result.status === 'refused') throw new Stop('rejected', result.reason);
    return {
      status: result.status,
      estimateIds: result.estimateIds,
      ...(result.status === 'copied' ? { operationId: result.operationId } : {}),
    };
  }

  if (name === 'tasse-assegna') {
    need(values, 'movimento');
    if (positionals.length > 0 || values.parte === undefined) throw invalid('bad-arguments');
    const result = await assignTaxPayment(
      store,
      { transactionId: values.movimento, parts: values.parte.map(parseTaxPart) },
      who,
      clock,
      newId,
    );
    if (result.status === 'refused') throw new Stop('rejected', result.reason);
    return {
      status: result.status,
      taxPaymentId: result.taxPaymentId,
      ...(result.status === 'assigned' ? { operationId: result.operationId } : {}),
    };
  }

  if (name === 'tasse-conferma') {
    // Plan 17, R304: a discrepancy confirmed with a note no longer warns (undone with
    // annulla-riconciliazione). The note is not echoed: it is free text.
    need(values, 'appartamento', 'anno', 'voce', 'note');
    if (positionals.length > 0) throw invalid('bad-arguments');
    const result = await confirmTaxDiscrepancy(
      store,
      { apartmentId: values.appartamento, year: values.anno, voce: values.voce, note: values.note },
      who,
      clock,
      newId,
    );
    if (result.status === 'refused') throw new Stop('rejected', result.reason);
    return {
      status: result.status,
      confirmationId: result.confirmationId,
      ...(result.status === 'confirmed' ? { operationId: result.operationId } : {}),
    };
  }

  if (name === 'tasse') {
    need(values, 'anno');
    if (positionals.length > 0 || !YearSchema.safeParse(values.anno).success) {
      throw invalid('bad-arguments');
    }
    // Today: --oggi, or the UTC date of the clock (as scadenze).
    const result = await loadTaxTable(store, {
      year: values.anno,
      today: day(values.oggi ?? clock().slice(0, 10)),
    });
    if (result.status === 'refused') throw new Stop('rejected', result.reason);
    const details = values.dettagli === true;
    // Voce, state, reasons and ids only; amounts and the taxpayer (a name) with --dettagli (R107).
    return {
      status: 'ok',
      year: values.anno,
      tables: result.tables.map((t) => ({
        apartmentIds: t.apartmentIds,
        ...(details ? { taxpayer: t.taxpayer } : {}),
        rows: t.rows.map((r) => ({
          voce: r.voce,
          state: r.state,
          reasons: r.reasons,
          ...(r.state === 'discrepanza' ? { message: MESSAGES['tax-discrepancy'] } : {}),
          ...(r.reasons.includes('no-expected-source')
            ? { message: MESSAGES['tax-no-payable'] }
            : {}),
          ...(details
            ? {
                estimate: r.estimate,
                paid: r.paid,
                expected: r.expected,
                difference: r.difference,
                ...(r.annualDifference === undefined
                  ? {}
                  : { annualDifference: r.annualDifference }),
                ...(r.cedolareProposals === undefined
                  ? {}
                  : {
                      cedolareProposals: r.cedolareProposals,
                      proposalMessage: MESSAGES['cedolare-estimate'],
                    }),
              }
            : {}),
        })),
      })),
      warnings: result.warnings.map((w) => ({ ...w, message: MESSAGES['tax-year-empty'] })),
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
    const years = await loadRentYears(store, optional('apartmentId', values.appartamento));
    if (years.status === 'refused') throw new Stop('rejected', years.reason);
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
        otherContractId: c.otherContractId,
        from: c.from,
        to: c.to,
        ...(['rent-differs', 'contract-overlap'].includes(c.code)
          ? { message: MESSAGES[c.code] }
          : {}),
        ...(details
          ? {
              tenancyId: c.tenancyId,
              paymentId: c.paymentId,
              expected: c.expected,
              actual: c.actual,
            }
          : {}),
      })),
      // The rents of the year and the estimate are amounts: only with --dettagli (R107, R182).
      rentYears: years.rentYears.map((y) => ({
        apartmentId: y.apartmentId,
        year: y.year,
        ...(details
          ? {
              totalRent: y.totalRent,
              cedolareRateBp: y.cedolareRateBp,
              cedolareExpected: y.cedolareExpected,
              ...(y.cedolareExpected === undefined
                ? {}
                : { message: MESSAGES['cedolare-estimate'] }),
            }
          : {}),
      })),
    };
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
    let result;
    try {
      if (name === 'presenza') {
        need(v, 'id', 'appartamento', 'inquilino', 'dal', 'affitto', 'forfait');
        result = await saveTenancy(
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
          who,
          clock,
          newId,
        );
      } else if (name === 'fine-presenza') {
        need(v, 'presenza', 'mese');
        result = await endTenancy(
          store,
          { tenancyId: v.presenza, lastMonth: month(v.mese) },
          who,
          clock,
          newId,
        );
      } else {
        need(v, 'presenza', 'mese', 'id', 'inquilino', 'affitto', 'forfait');
        result = await recordTakeover(
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
          who,
          clock,
          newId,
        );
      }
    } catch (error) {
      // An id the store refuses (a name reserved on Windows) is a bad argument.
      if (error instanceof RangeError) throw invalid('bad-arguments');
      throw error;
    }
    if (result.status === 'refused') {
      throw new Stop('rejected', result.reason, {
        ...optional('code', result.code),
        ...optional('month', result.month),
      });
    }
    return {
      status: result.status,
      tenancyId: result.tenancyId,
      ...(result.status === 'saved' ? { operationId: result.operationId } : {}),
    };
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
    let result;
    try {
      result = await recordRoomSwap(
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
        who,
        clock,
        newId,
      );
    } catch (error) {
      // An id the store refuses (a name reserved on Windows) is a bad argument.
      if (error instanceof RangeError) throw invalid('bad-arguments');
      throw error;
    }
    if (result.status === 'refused') {
      throw new Stop('rejected', result.reason, {
        ...optional('message', SWAP_MESSAGES[result.reason]),
        ...optional('part', result.part),
        ...optional('code', result.code),
        ...optional('month', result.month),
      });
    }
    return {
      status: result.status,
      tenancyIds: result.tenancyIds,
      ...(result.status === 'saved' ? { operationId: result.operationId } : {}),
      ...(result.warnings === undefined
        ? {}
        : {
            warnings: result.warnings,
            message: result.warnings.map((w) => MESSAGES[w]).join(' '),
          }),
    };
  }

  if (name === 'stato-contratti') {
    if (positionals.length > 0) throw invalid('bad-arguments');
    const result = await loadContractStatus(store, {
      asOf: month(clock().slice(0, 7)),
      ...optional('apartmentId', values.appartamento),
    });
    if (result.status === 'refused') throw new Stop('rejected', result.reason);
    const details = values.dettagli === true;
    const count = (list, keys) =>
      Object.fromEntries(keys.map((k) => [k, list.filter((x) => x === k).length]));
    // Counts and codes only; tenancies, tenants, months and amounts with --dettagli (R107).
    return {
      status: 'ok',
      contracts: result.contracts.map(({ contract, tenancies, deposits, checks }) => ({
        contractId: contract.id,
        apartmentId: contract.apartmentId,
        tenancies: count(
          tenancies.map((t) => t.state),
          ['futura', 'in-corso', 'uscita'],
        ),
        takeovers: contract.takeovers?.length ?? 0,
        deposits: count(
          deposits.map((d) => d.status),
          ['versata', 'diversa', 'mancante', 'non-impostata'],
        ),
        ...(deposits.some((d) => d.status === 'diversa' || d.status === 'mancante')
          ? { message: MESSAGES['deposit-check'] }
          : {}),
        checks: checks.map((c) => c.code),
        ...(details
          ? {
              tenancyList: tenancies.map(({ tenancy: t, state }) => ({
                tenancyId: t.id,
                tenantId: t.tenantId,
                room: t.room,
                from: t.from,
                to: t.to,
                state,
                monthlyRent: t.monthlyRent,
                monthlyForfait: t.monthlyForfait,
                expectedDeposit: t.expectedDeposit,
              })),
              takeoverList: contract.takeovers,
              depositList: deposits,
            }
          : {}),
      })),
    };
  }

  if (name === 'tasso-legale') {
    // Plan 17, R301: the legal rate of a year, typed by user1 like the IMU amounts.
    need(values, 'anno');
    if (positionals.length > 0 || values.tasso?.length !== 1 || !/^[0-9]{4}$/.test(values.anno)) {
      throw invalid('bad-arguments');
    }
    const result = await saveLegalRate(
      store,
      { year: values.anno, rateBp: basisPoints(values.tasso[0]) },
      who,
      clock,
      newId,
    );
    if (result.status === 'refused') throw new Stop('rejected', result.reason);
    return {
      status: result.status,
      rateId: result.rateId,
      ...(result.status === 'saved' ? { operationId: result.operationId } : {}),
    };
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
    const result = await loadDepositReturn(store, {
      apartmentId: values.appartamento,
      tenantId: values.inquilino,
      ...(values.conguaglio === undefined ? {} : { conguaglio: euro(values.conguaglio) }),
      extraCharges,
    });
    if (result.status === 'refused') throw new Stop('rejected', result.reason);
    // Every line is an amount: only with --dettagli (R107).
    return {
      status: 'ok',
      lines: result.statement.lines.length,
      message: MESSAGES['deposit-return-draft'],
      ...(result.recoveriesWaiting > 0
        ? { recoveriesWaiting: result.recoveriesWaiting, warning: MESSAGES['recovery-waiting'] }
        : {}),
      ...(values.dettagli === true ? { statement: result.statement } : {}),
    };
  }

  if (name === 'bolletta') {
    // The reading comes from `python -I -m bollette_pdf extract` (plan 2a): no new reader here.
    need(values, 'appartamento', 'lettura', 'soglia-consumi');
    if (positionals.length !== 1) throw invalid('bad-arguments');
    // The threshold of the anomaly check is not decided in the code (R262).
    if (!/^[0-9]{1,4}(?:\.[0-9]{1,4})?$/.test(values['soglia-consumi'])) {
      throw invalid('bad-arguments');
    }
    const bytes = readBytes(positionals[0]);
    let read;
    try {
      read = ExtractionResultSchema.safeParse(
        JSON.parse(readBytes(values.lettura).toString('utf8')),
      );
    } catch {
      throw invalid('bad-reading');
    }
    if (!read.success) throw invalid('bad-reading');
    // Without --codici, those of the apartment (`appartamento --codici`, R314).
    const knownCodes =
      values.codici === undefined ? undefined : values.codici.split(',').filter((c) => c !== '');
    const result = await importBill(
      store,
      {
        result: read.data,
        bytes,
        apartmentId: values.appartamento,
        knownCodes,
        thresholds: { consumptionAnomalyPercent: Number(values['soglia-consumi']) },
        mode: values.conferma === true ? 'manual' : 'auto',
      },
      who,
      clock,
      newId,
    );
    const details = values.dettagli === true;
    // Codes and ids only; the messages hold amounts, months and quantities (R107).
    const checks = (list) =>
      list.map((c) => ({
        code: c.code,
        severity: c.severity,
        ...(details ? { message: c.message } : {}),
      }));
    if (result.status === 'refused') throw new Stop('rejected', result.reason);
    if (result.status === 'rejected') {
      throw new Stop('rejected', 'bill-rejected', {
        checks: checks(result.checks),
        ...(details ? { detail: result.reason } : {}),
      });
    }
    if (result.status === 'duplicate' || result.status === 'possible-duplicate') {
      throw new Stop('rejected', `${result.status}-bill`, { existingId: result.existingId });
    }
    if (result.status === 'da-rivedere') {
      return {
        status: result.status,
        pendingId: result.pendingId,
        ...optional('operationId', result.operationId),
        codes: result.codes,
        checks: checks(result.checks),
        ...(details ? { reasons: result.reasons } : {}),
      };
    }
    // Plan 17, R315: the PDF of a whole file registered as a bill goes to the Bollette folder of
    // the apartment, never over another file and only from inside the shared folder.
    const bills = (await loadAll(store, 'bill', BillSchema)).records;
    const bill = bills.find((b) => result.ids.includes(b.id));
    const apartments = (await loadAll(store, 'apartment', ApartmentSchema)).records;
    const apartment = apartments.find((a) => a.id === values.appartamento);
    const [first, last] = read.data.pageRange ?? [1, read.data.pages];
    let file = 'not-moved';
    if (bill !== undefined && apartment !== undefined && first === 1 && last === read.data.pages) {
      const inside = relative(resolve(values.cartella), resolve(positionals[0]));
      if (inside.startsWith('..') || isAbsolute(inside)) file = 'outside-folder';
      else {
        const plan = billFileMove(apartment, bill.filePath);
        // The bill is registered whatever happens to the file: never «failed» for a move.
        file = await moveSafely(values.cartella, inside.split(/[\\/]/).join('/'), plan.filed);
      }
    }
    return {
      status: result.status,
      ids: result.ids,
      operationId: result.operationId,
      checks: checks(result.checks),
      file,
    };
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
    const fileHash = await hashBytes(readBytes(positionals[0]));
    // Read before the undo: the bill tells where the file is and which Da_smistare it goes to.
    const filed = (await loadAll(store, 'bill', BillSchema)).records.find(
      (b) => b.fileHash === fileHash,
    );
    let result;
    try {
      result = await undoBillImport(store, fileHash, who, clock, newId, optional('pages', pages));
    } catch (error) {
      const text = error instanceof Error ? error.message : '';
      if (text.includes('depend on it')) throw new Stop('rejected', 'has-dependents-bill');
      if (text.startsWith('Cannot undo:')) throw new Stop('rejected', 'journal-not-aligned');
      throw error;
    }
    if (result.status === 'refused') {
      if (result.reason === 'several-documents') {
        throw new Stop('rejected', 'several-documents', { documents: result.documents });
      }
      if (result.reason === 'has-dependents') {
        // Counts only: the ids are shown with --dettagli (R107).
        throw new Stop('rejected', 'has-dependents-bill', {
          dependents: result.recordIds.length,
          ...(values.dettagli === true ? { recordIds: result.recordIds } : {}),
        });
      }
      throw new Stop('rejected', result.reason);
    }
    // Plan 17, R315: the file goes back to Da_smistare, once nothing of it is registered, never
    // over another file.
    let file = 'not-moved';
    const left = (await loadAll(store, 'bill', BillSchema)).records.some(
      (b) => b.fileHash === fileHash,
    );
    const apartment =
      filed === undefined
        ? undefined
        : (await loadAll(store, 'apartment', ApartmentSchema)).records.find(
            (a) => a.id === filed.apartmentId,
          );
    if (filed !== undefined && apartment !== undefined && !left) {
      const plan = billFileMove(apartment, filed.filePath);
      const inside = relative(resolve(values.cartella), resolve(positionals[0]))
        .split(/[\\/]/)
        .join('/');
      if (inside.normalize('NFC') === plan.filed.normalize('NFC')) {
        file = await moveSafely(values.cartella, plan.filed, plan.inbox);
      }
    }
    return {
      status: 'undone',
      records: result.records,
      operationIds: result.operations.map((o) => o.id),
      file,
    };
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
    const result = await loadDashboard(store, {
      // Today: --oggi, or the UTC date of the clock, as `scadenze`.
      today: day(values.oggi ?? clock().slice(0, 10)),
      ...optional('soonDays', entro === undefined ? undefined : Number(entro)),
      ...optional('taxYear', anno),
      // Without --periodo-conguaglio, the period in course of each apartment (R316).
      ...(settlements.length === 0 ? {} : { settlements }),
    });
    if (result.status === 'refused') throw new Stop('rejected', result.reason);
    // Counts and codes; the share of the empty beds is an amount: only with --dettagli (R107).
    return {
      status: 'ok',
      apartments: result.apartments,
      settlements: result.settlements.map((r) => ({
        apartmentId: r.apartmentId,
        periodLabel: r.periodLabel,
        ...optional('problem', r.problem),
        ...optional('pending', r.pending),
        ...(values.dettagli === true ? optional('unassigned', r.unassigned) : {}),
      })),
    };
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
    const result = await loadScadenzario(store, {
      today,
      ...optional('soonDays', entro === undefined ? undefined : Number(entro)),
    });
    if (result.status === 'refused') throw new Stop('rejected', result.reason);
    const details = values.dettagli === true;
    const years = details ? await loadRentYears(store, {}) : undefined;
    if (years?.status === 'refused') throw new Stop('rejected', years.reason);
    return {
      status: 'ok',
      // Dates, amounts, movements and names only with --dettagli (R107).
      items: result.items
        .filter(
          (i) =>
            (stato === undefined || i.state === stato) && (tipo === undefined || i.kind === tipo),
        )
        .map((i) => ({
          source: i.source,
          id: i.id,
          kind: i.kind,
          apartmentIds: i.apartmentIds,
          state: i.state,
          ...optional('check', i.check),
          ...optional('repeatYearly', i.repeatYearly),
          ...optional('taxYear', i.taxYear),
          ...optional('repeated', i.repeated),
          ...(details
            ? {
                taxpayers: i.taxpayers,
                ...optional('dueDate', i.dueDate),
                ...optional('expected', i.expected),
                ...optional('paidOn', i.paidOn),
                ...optional('transactionId', i.transactionId),
              }
            : {}),
        })),
      contractEnds: result.contractEnds.map((c) => ({
        contractId: c.contractId,
        apartmentId: c.apartmentId,
        ...(details ? { end: c.end } : {}),
      })),
      // The cedolare estimate is shown beside the list, never an item (plan 9, question 4).
      ...(years === undefined
        ? {}
        : {
            estimates: years.rentYears
              .filter((y) => y.cedolareExpected !== undefined)
              .map((y) => ({
                apartmentId: y.apartmentId,
                year: y.year,
                cedolareExpected: y.cedolareExpected,
                message: MESSAGES['cedolare-estimate'],
              })),
          }),
    };
  }

  if (name === 'scadenza-nuova') {
    need(values, 'appartamento', 'tipo', 'scadenza');
    if (
      positionals.length > 0 ||
      !PayableKindSchema.safeParse(values.tipo).success ||
      ![undefined, 'cedolare', 'registro'].includes(values.voce)
    ) {
      throw invalid('bad-arguments');
    }
    const result = await savePayable(
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
      who,
      clock,
      newId,
    );
    if (result.status === 'refused') throw new Stop('rejected', result.reason);
    return result;
  }

  if (name === 'scadenza-ripeti') {
    need(values, 'id', 'scadenza');
    if (positionals.length > 0) throw invalid('bad-arguments');
    const result = await repeatPayable(
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
      who,
      clock,
      newId,
    );
    if (result.status === 'refused') throw new Stop('rejected', result.reason);
    return result;
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
    const result = await setPayablePaid(
      store,
      {
        payableId: values.id,
        ...optional('transactionId', values.movimento),
        ...optional('date', values.data === undefined ? undefined : day(values.data)),
      },
      who,
      clock,
      newId,
    );
    if (result.status === 'refused') throw new Stop('rejected', result.reason);
    return result;
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
    // A cancellation whose movement has had another use since: undoing it would give a second one;
    // an imu.expected under an assigned F24 would change its rate (plan 3d).
    const recordIds = await undoBlockedBy(store, target.id);
    if (recordIds.length > 0) {
      throw new Stop('rejected', 'has-dependents', {
        message:
          MESSAGES[
            target.kind === 'imu.expected'
              ? 'imu-has-assignments'
              : target.kind.startsWith('tenancy.')
                ? 'tenancy-has-dependents'
                : 'movement-has-dependents'
          ],
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
      dettagli: [
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
      ],
      motivo: ['escludi'],
      proposta: ['conferma', 'uscita', 'uscita-inquilino', 'giroconto'],
      inquilino: [
        'conferma',
        'uscita-inquilino',
        'presenza',
        'subentro',
        'caparra-restituzione',
        'scheda-inquilino',
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
      ],
      voce: ['recupero', 'tasse-stima', 'scadenza-nuova', 'tasse-conferma'],
      inquilini: ['recupero'],
      quote: ['recupero'],
      periodo: ['recupero'],
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
      esercizio: ['condominio-documento', 'condominio', 'condominio-stima'],
      'quota-conduttore': ['condominio-documento'],
      anno: [
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
      rata: ['imu-atteso', 'imu-f24'],
      categoria: ['uscita'],
      f24: ['uscita'],
      tipo: ['uscita-inquilino', 'contratto', 'scadenze', 'scadenza-nuova', 'condominio-documento'],
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
      ],
      data: ['giroconto-manuale', 'scadenza-pagata', 'recupero'],
      entro: ['scadenze', 'cruscotto'],
      oggi: ['scadenze', 'tasse', 'cruscotto'],
      lettura: ['bolletta'],
      'soglia-consumi': ['bolletta'],
      codici: ['bolletta', 'appartamento'],
      conferma: ['bolletta'],
      'periodo-conguaglio': ['cruscotto'],
      pagine: ['annulla-bolletta'],
      scadenza: ['scadenza-nuova', 'scadenza-ripeti'],
      'ogni-anno': ['scadenza-nuova'],
      'anno-riferimento': ['scadenza-nuova', 'scadenza-ripeti'],
      dal: ['importa', 'contratto-canone', 'presenza'],
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
        ].map((option) => [option, ['appartamento']]),
      ),
      conguaglio: ['contratto', 'caparra-restituzione'],
      contratto: ['contratto-canone', 'presenza'],
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
