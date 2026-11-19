// One line of help in Italian for each command of `pnpm estratti` (review of 18 Nov 2026, Q9):
// `pnpm estratti --help` lists them, `pnpm estratti <comando> --help` adds the options of the
// command from the option table of estratti.mjs. A test fails when a command has no line here.

export const USAGE =
  'Uso: pnpm estratti <comando> --cartella <cartella dei dati> [opzioni]. «pnpm estratti <comando> --help» elenca le opzioni del comando. Uscita: 0 fatto, 1 rifiutato, 2 argomenti o file non validi, 3 errore inatteso.';

export const COMMAND_HELP = {
  profilo: 'Salva il profilo di lettura di una banca da un file JSON.',
  conto: 'Registra il conto di un appartamento (profilo, etichetta, IBAN facoltativo).',
  importa:
    'Importa un estratto conto CSV o XLSX su un conto (--dal e --al se il file non li dice).',
  decidi: 'Tiene o esclude una riga in sospeso di un estratto importato.',
  annulla: 'Annulla l’importazione di un estratto (--estratto).',
  inquilino: 'Crea o aggiorna un inquilino (--id, --nome, --lingua).',
  riconcilia:
    'Esegue la riconciliazione: incassi, bollette, uscite, giroconti; --prova non scrive.',
  conferma: 'Conferma una proposta d’incasso per un inquilino con le sue parti.',
  ripara: 'Ripara ciò che un’operazione interrotta ha lasciato a metà.',
  'annulla-incassi': 'Sinonimo di annulla-riconciliazione.',
  'annulla-riconciliazione':
    'Annulla un’operazione del registro (--operazione), se nulla dipende da essa.',
  'annulla-pagamento': 'Annulla un pagamento automatico: il movimento torna da rivedere.',
  'eccedenza-canone':
    'Assegna un canone versato in più al mese che manca, come lo propone riconcilia (--proposta).',
  escludi: 'Esclude un movimento (doppione, non contabilizzato, non reale).',
  abbina: 'Abbina a mano bollette e rate a un addebito (--parte).',
  uscita: 'Classifica un’uscita (utenze, tasse, condominio, altro).',
  'annulla-uscita': 'Annulla la classificazione di un’uscita.',
  'uscita-inquilino': 'Registra un’uscita verso un inquilino (caparra, conguaglio, altro).',
  giroconto: 'Conferma un giroconto tra due conti dalle proposte.',
  'giroconto-manuale': 'Registra a mano un movimento tra due conti.',
  saldi: 'Mostra il saldo tra i conti degli appartamenti.',
  'imu-atteso': 'Salva l’IMU attesa di un appartamento e anno, per rata.',
  'imu-f24': 'Assegna un F24 a una rata IMU.',
  imu: 'Controlla le rate IMU di un anno.',
  contratto: 'Crea o sostituisce un contratto di locazione.',
  'contratto-canone': 'Aggiunge una voce alla storia del canone di un contratto.',
  contratti: 'Elenca i contratti e i loro controlli.',
  'affitti-anno': 'Salva gli affitti di un appartamento e anno per la stima della cedolare.',
  scadenze: 'Elenca le scadenze della proprietà.',
  'scadenza-nuova': 'Crea una scadenza scritta a mano.',
  'scadenza-ripeti': 'Ripete una scadenza nell’anno dopo.',
  'scadenza-pagata': 'Segna pagata una scadenza (con il movimento o la data).',
  appartamento:
    'Crea un appartamento o aggiorna i campi dati (anche --posti-nomi e --codici; --dal AAAA-MM: posti nuovi da quel mese).',
  'condominio-documento': 'Salva il preventivo o il consuntivo di un esercizio del condominio.',
  condominio: 'Controlla le spese del condominio della proprietà e le differenze.',
  'condominio-stima': 'Mostra la stima del condominio di un esercizio.',
  recupero: 'Registra una spesa da recuperare dagli inquilini.',
  contatto: 'Crea o sostituisce un amministratore o un fornitore della rubrica.',
  contatti: 'Elenca la rubrica.',
  presenza: 'Registra l’arrivo di un inquilino in un appartamento.',
  'fine-presenza': 'Indica l’ultimo mese di una presenza.',
  subentro: 'Registra un subentro dentro un contratto.',
  'scambio-camera': 'Due inquilini dello stesso contratto si scambiano il posto da un mese.',
  'stato-contratti': 'Mostra presenze, subentri, caparre e controlli di ogni contratto.',
  'caparra-restituzione': 'Mostra il prospetto di restituzione di una caparra.',
  'tasso-legale': 'Salva il tasso legale di un anno.',
  'tasse-stima': 'Salva la stima di inizio anno di una voce delle tasse.',
  'tasse-copia': 'Copia le stime dell’anno prima.',
  'tasse-assegna': 'Assegna un addebito di tasse a cedolare o registro.',
  'tasse-conferma': 'Conferma con una nota una differenza delle tasse.',
  'scheda-inquilino': 'Salva i dati personali della scheda di un inquilino (mai mostrati).',
  'soglie-consumi': 'Salva le soglie dell’allarme consumi.',
  consumi: 'Confronta una bolletta con le soglie dei consumi.',
  tasse: 'Mostra la tabella delle tasse per contribuente.',
  bolletta: 'Importa un PDF di bolletta con la sua lettura (--conferma per registrarla).',
  'annulla-bolletta': 'Annulla ciò che un PDF ha creato e lo riporta in Da_smistare.',
  cruscotto: 'Mostra i conteggi della Home per appartamento e lo stato dei conguagli.',
  riferimenti: 'Elenca i record che puntano a un record mancante o cancellato.',
  utenza:
    'Collega un’utenza (il codice dell’avviso) a uno o più appartamenti (--dal AAAA-MM: percentuali nuove da quel mese).',
  'rata-condominio': 'Registra una rata del condominio di un esercizio.',
  impostazioni: 'Mostra o cambia le impostazioni dell’area di lavoro (--tolleranza-imu).',
  'chiudi-periodo': 'Chiude un periodo di conguaglio con l’istantanea.',
  'conguaglio-supplementare':
    'Mostra lo stato e il conguaglio supplementare di un periodo chiuso o riaperto (importi con --dettagli).',
  'invia-conguaglio': 'Segna il conguaglio di un periodo chiuso come inviato (--data).',
  'conguaglio-saldato':
    'Segna saldato il conguaglio di un inquilino (--inquilino, --data, --movimento facoltativo; --supplementare per il supplementare).',
  'forfait-verificato':
    'Registra l’esito del forfait «da verificare» di un inquilino (--inquilino, --data, --esito rimborso|credito|stessi-soldi, --movimento facoltativo).',
  'canone-non-incassato':
    'Segna il canone non incassato di un inquilino dopo una riapertura (--inquilino, --data, --esito richiesto|saldato|non-recuperabile, --movimento facoltativo).',
  'riapri-periodo':
    'Riapre un periodo chiuso con --data e --motivo; l’istantanea resta nello storico.',
  'scegli-versione':
    'Sceglie quale versione tenere di un record con due versioni diverse (biforcazione).',
  aiuto: 'Mostra questo aiuto; «aiuto <comando>» le opzioni del comando.',
};
