# Piano 3: estratti conto della banca (disegno)

Stato: **bozza da approvare da Carlo.** Solo disegno, nessun codice. Il piano copre il core
(`packages/core`), la lettura dei file (core e, per l'XLSX, Python) e la riga di comando; **niente
schermate e niente veste grafica**, che si fanno con Carlo. Specifica di riferimento: `docs/spec.md`,
sezioni 11, 12, 13, 15, 18, 20, 23, 24, 28, 36, 40 e 42 (R1-R8, che prevalgono); registro
`docs/progress.md` (R15-R22, R27, R28, R30); regole ricavate dagli Excel e dagli estratti di ottobre
2026 in `docs/rules/conguaglio-rules.md` (punti d, e, h, i, k); ricognizione
`docs/plans/2026-11-14-ricognizione-roadmap.md` (ramo `docs/ricognizione-roadmap`, voce C). Nessun
estratto reale aperto per questo disegno.

## Perché

Per R2 un costo entra nel conguaglio solo quando il suo addebito è nell'estratto conto, e per R4 il
forfait che conta è quello incassato. Senza estratti l'app può solo «assumere» i pagamenti: è il
piano che sblocca l'uso reale. Il motore di abbinamento delle uscite c'è già; mancano il lettore dei
file, i conti, gli inquilini, i paganti, la classificazione delle entrate e delle uscite, l'F24 e il
saldo tra conti.

## Decisioni di Carlo (14 novembre 2026)

1. **Estratti non cifrati.** Nicola ha già tutti gli accessi ai conti (è cointestatario, sezione 11,
   «Accesso»): movimenti in chiaro in `_app/dati/`, come gli altri record, e file originali in
   `Riservato_proprietari/`. Cambia la sezione 11 («Sicurezza») e la sezione 20 («estratti conto
   (cifrati)»): vedi «Modifiche alla specifica».
2. **Struttura dei file della sezione 20:** `<Appartamento>/<annualità>/<Tipo>/`, periodo come mese.
   Qui vale per il percorso proposto dell'estratto (sotto, «Estratto»); il codice di oggi
   (`suggestedFilePath`, sezione 22) va allineato dal piano dello smistamento, non da questo.
3. **Pagante → inquilino:** «sicuro» solo con R4 stretto (pagante già confermato per
   quell'inquilino e importo esattamente affitto + forfait del mese); tutto il resto «da rivedere»
   con il più probabile in cima e **senza punteggio**. La conferma si chiede **una sola volta per
   associazione** (apprendimento supervisionato, sezione 15).
4. **IMU di Berchet e Lovarini:** Carlo risponde il 15 novembre su come ripartirla. Domanda aperta,
   parte isolata nel sotto-piano 3d, l'ultimo.

## Obiettivi

1. Leggere gli estratti dei conti dei tre appartamenti in movimenti normalizzati, con il formato
   della banca come configurazione.
2. Stesso file, stesso risultato: rileggere un file non cambia nulla; file che si sovrappongono non
   duplicano i movimenti (R2, «senza duplicare i movimenti già letti»).
3. Conti (più di uno per appartamento, sezione 13), inquilini e paganti come record.
4. Riconoscere il pagante e proporre l'inquilino (decisione 3); classificare le entrate (canone,
   caparra, saldo di conguaglio, altro) e creare i `Payment` confermati.
5. Collegare gli estratti all'abbinamento di bollette e rate che esiste (`match.ts`), con i periodi
   coperti **per conto**.
6. Classificare le uscite non abbinate (proprietà, privato, giroconto, F24, ignora) con regole
   apprese alla prima conferma (sezione 23).
7. F24 come voce del proprietario con righe per appartamento; saldo tra conti (sezione 24).
8. Ogni scrittura è un'operazione del registro, annullabile; nessuna scrittura senza operazione.
9. Riga di comando per importare, riconciliare, confermare e vedere i saldi, che di default stampa
   solo conteggi e id (sezione 28: i dati reali non arrivano a Claude).

## Non obiettivi

- Schermate («Da rivedere», scheda Movimenti, Saldo tra conti, Scadenze), veste grafica, azioni di
  massa: requisiti scritti qui, costruzione con Carlo.
- Scadenze e pagamenti (sezioni 21, 23, 30): record della scadenza, stati, ricorrenze (voce F2 della
  ricognizione). Qui solo l'F24 come voce abbinabile; il collegamento con le scadenze lo farà F2.
- Stato del conguaglio «saldato» (R6) ed Excel: piano 5. Qui solo i `Payment` di tipo `conguaglio`
  che quel piano userà.
- Spostamento e rinomina dei file (smistamento, voce I della ricognizione): qui solo il percorso
  proposto, come `suggestedFilePath`.
- Banche diverse da quella dei tre conti, PDF degli estratti, cifratura, importazione dagli Excel
  «Affitti Versati» (`source: 'excel'`, già nel modello).
- Tasse e stime (sezione 34): userà i movimenti classificati, in un altro piano.

## Vincoli

- `packages/core` puro: niente `node:*`, niente orologio né `id` casuali; orologio e generatore di
  `id` sono argomenti. Il lettore CSV sta nel core; il lettore XLSX, se si fa in Python (approccio
  A1 sotto), usa solo la libreria standard (`zipfile`, `xml.etree`): nessuna dipendenza nuova.
- Importi in `Cents`, date `YYYY-MM-DD` in UTC con interi; nessun `float` né `Decimal` di Python
  verso il core (gli importi arrivano come testo e li converte il core).
- Nessuna regola di calcolo o di confidenza nuova decisa da solo: ogni dubbio è in «Aperto con
  Carlo». Il formato della banca e le regole apprese sono dati, non codice (sezione 13, «regole come
  dati»).
- Un file JSON per record, mai cancellato dal disco (`deleted`); un file per operazione in
  `_app/journal/`.
- Nessun dato personale nei log, nei messaggi d'errore, nei `summary` delle operazioni né
  nell'uscita predefinita della riga di comando: niente nomi, IBAN, causali.
- Fixture solo sintetiche: l'unico IBAN ammesso oggi da `pnpm data:check` è quello d'esempio di
  `fixtures/README.md`; per i casi con più IBAN si aggiungono codici inventati a quella tabella, con
  la verifica in revisione.
- Test anche con `TZ=Pacific/Auckland` e `TZ=America/Los_Angeles`; copertura del core almeno 90%.

## Cosa c'è oggi nel codice (verificato su `origin/main`, commit `487a819`)

- `BankTransaction` (`model.ts`): `apartmentId`, `date`, `amount` (negativo = addebito),
  `description`, `dispCode`, `statementHash`. **Nessun `accountId`.**
- `transactionKey` e `keyTransactions` (`dedupe.ts`): `id` del movimento = SHA-256 di
  `[apartmentId, date, amount, foldText(description), occorrenza]`; l'occorrenza numera i movimenti
  identici dello stesso giorno **dentro una lista**. Nessuna funzione d'importazione la usa ancora.
- `matchToTransactions` (`match.ts`): abbinamento esatto uno a uno per componenti connesse (R15),
  fornitore nella causale o proposta (R27), avvisi comuni (R28), proposte d'importo diverso,
  presunti (R17, R21), commissioni (`commission.ts`, R7, R20). **`statementPeriods` non dice di
  quale conto è un periodo**: un estratto di Berchet fa considerare «coperte» anche le voci di Pulci,
  che restano in attesa invece di essere presunte. Va corretto in 3a.
- `Payment` con `kind` (`canone`, `conguaglio`, `caparra`, `altro`), `confirmed`, `source`,
  `transactionId`, `forMonth`; `collectedForfait` (`conguaglio.ts`) imputa prima all'affitto, poi al
  forfait (R4).
- `Tenancy.tenantId` è una stringa senza record; nessun record di conto, inquilino, pagante,
  estratto, F24, classificazione o giroconto. Nessun lettore di CSV o XLSX, nessuna riga di comando
  in TypeScript (solo script `tsx` come `golden:report`).
- Gli estratti reali visti l'11 novembre (`docs/rules/conguaglio-rules.md`) sono file
  **`Lista_Operazioni_*.xlsx`**, non CSV, con una colonna o un campo «Cod Disp.».

## Approcci per i punti più incerti

### A. Formato degli estratti per banca

Due domande distinte: il **contenitore** (CSV o XLSX) e la **disposizione delle colonne**.

Contenitore:

- **A1. XLSX letto in Python con la libreria standard.** Un nuovo comando `python -I -m
  bollette_pdf table <file>` che stampa le righe del primo foglio come JSON di sole stringhe.
  Pro: nessuna dipendenza, Python è già nell'installer e il core lo chiama già così nei test
  d'integrazione; il core resta puro e riceve una tabella. Contro: la sezione 41 vuole Python solo
  per i PDF (modifica di specifica); l'XML di un file esterno è un confine di fiducia (limiti su
  dimensioni del file decompresso e numero di righe; espansione delle entità da verificare su
  `expat` di Python 3.13); la riga di comando ha bisogno di Python anche per gli estratti.
- **A2. XLSX letto nel core con `DecompressionStream('deflate-raw')` e un lettore XML minimo.**
  Pro: tutto in TypeScript, nessun processo esterno, funziona anche sul telefono. Contro: lettore
  ZIP e XML scritti in casa (più codice al confine di fiducia); la disponibilità di `deflate-raw`
  in Node 20, WebView2 e WKWebView non è verificata.
- **A3. Solo CSV:** Nicola salva l'XLSX come CSV (o lo scarica in CSV, se la banca lo offre). Pro:
  lettore banale e puro. Contro: un passo a mano ogni mese; il CSV salvato da Excel in italiano
  cambia separatore (`;`), codifica (UTF-8 con BOM, Windows-1252) e formato dei numeri secondo il
  computer: più formati invece di uno.

Disposizione delle colonne:

- **B1. Un lettore in codice per banca.** Pro: semplice per una sola banca. Contro: una banca nuova
  o un'esportazione cambiata richiedono una versione nuova dell'app (contro le sezioni 13 e 40).
- **B2. Profilo della banca come dati** (`bankProfile`, versionato come i profili dei fornitori):
  testo delle intestazioni per ogni campo, riga d'intestazione, formato di data e importo, colonna
  unica con segno o dare/avere, espressioni per ricavare dalla causale codice disposizione, nome e
  IBAN della controparte. Un profilo seed per la banca dei tre conti. Pro: configurazione, non
  codice; provabile con fixture. Contro: serve conoscere le intestazioni vere (campione di
  struttura, sotto).
- **B3. Colonne scelte dall'utente alla prima importazione** e salvate come profilo. Pro:
  qualunque banca. Contro: è interfaccia; usa comunque lo schema di B2.

**Raccomandazione: A1 + B2**, con lo schema di B2 pronto per B3 quando si farà l'interfaccia. Il
core ha due funzioni pure: `parseCsv(text)` (per A3 o per una banca che dà CSV) e
`readStatementTable(rows, profile)` che vale per tutti e due i contenitori. A2 resta la riserva se
Carlo non vuole Python per gli estratti.

### B. Dove vivono gli alias pagante → inquilino

- **C1. Dentro il record dell'inquilino** (`tenant.payers[]`, come i «pagatori abituali» della
  sezione 26). Pro: un solo record da leggere. Contro: ogni conferma riscrive l'inquilino (conflitti
  di Dropbox tra due persone che confermano paganti diversi dello stesso inquilino); un pagante di due
  inquilini (un genitore con due figli) si scrive due volte.
- **C2. Un record per associazione** (`payer`, `_app/dati/payer/<id>.json`): chiave del pagante
  (IBAN normalizzato, altrimenti nome normalizzato con `foldText`), `tenantId`, `validFrom`,
  `validTo` facoltativo. Pro: una conferma = un file e un'operazione, annullabile da sola; data di
  validità (sezione 15); i conflitti restano su un record. Contro: un tipo di record in più.
- **C3. Nessuna tabella: gli alias si ricavano dai `Payment` confermati** con lo stesso pagante. Pro:
  niente record nuovi. Contro: annullare un pagamento cambia il riconoscimento dei successivi; la data
  di validità è implicita; non si può «spegnere» un alias senza toccare i pagamenti.

**Raccomandazione: C2.** La scheda dell'inquilino mostrerà i suoi paganti leggendo i `payer`.

### C. Abbinamento a due fasi

Le due fasi sono **chi o che cosa** è il movimento (controparte → inquilino, fornitore, conto
proprio, regola appresa) e **a che cosa** si abbina (mese dovuto, voce, F24, giroconto).

- **D1. Due fasi in sequenza per tutti i movimenti:** prima si classifica ogni movimento, poi lo si
  abbina dentro la sua classe. Pro: semplice da spiegare. Contro: una classe sbagliata nasconde
  l'abbinamento giusto; la classificazione delle uscite rifarebbe ciò che `match.ts` fa già.
- **D2. Prima l'abbinamento delle uscite che esiste, poi le due fasi solo su ciò che resta.**
  `matchToTransactions` resta com'è per bollette e rate; sui movimenti che non usa: entrate →
  pagante → inquilino → mese e tipo; uscite → regole apprese, F24, giroconti, poi «da classificare».
  Pro: riusa il codice provato (R15-R28); le entrate non incontrano mai le bollette (segno opposto).
  Contro: due percorsi da tenere coerenti (un movimento non deve finire in tutti e due: lo esclude
  l'insieme dei movimenti già usati).
- **D3. Un grafo unico con tutte le voci attese** (bollette, rate, F24, canone di ogni inquilino e
  mese) e la regola uno a uno di R15. Pro: un solo meccanismo. Contro: canoni uguali tra inquilini
  rendono ambigua quasi ogni entrata; R4 chiede un pagante confermato, che il grafo non sa.

**Raccomandazione: D2.**

## Disegno

### Record nuovi (tutti `v: 1`, campi minimi)

- **`account`** (conto): `apartmentId` (appartamento a cui il conto è dedicato), `label`,
  `bankProfileId`, `iban` facoltativo (serve a riconoscere i giroconti), `holder` (`profileId` o
  testo). Più conti per appartamento ammessi (sezione 13).
- **`bankProfile`**: come in B2; `validFrom`/`validTo` come `SupplierProfile`. Seed in
  `python/seed-profiles/` o accanto, copiato al primo avvio come gli altri (piano 6).
- **`statement`** (estratto importato): `id` = impronta del file, `accountId`, `from`, `to`
  (periodo coperto, domanda 3), `fileName` originale, `suggestedPath`, `rowCount`, `bankProfileId`.
- **`tenant`** (inquilino): `name`, `language` facoltativa. Solo ciò che serve a questo piano; il
  resto della scheda (sezione 26) si aggiunge quando serve.
- **`payer`**: come in C2.
- **`f24`**: `paidFromAccountId`, `dueDate`, `total`, `lines: [{ apartmentId, amount, label }]` con
  somma = `total`, `fileHash` facoltativo della ricevuta. Le righe non portano codici tributo né
  aliquote (nessuna regola fiscale nel codice).
- **`movementClass`** (classificazione di un movimento che non è né `Payment` né `BillMatch`):
  `transactionId`, `kind` (`proprieta`, `privato`, `giroconto`, `f24`, `ignora`), `apartmentId` di
  destinazione per la proprietà, `ruleId` se viene da una regola, `confirmed`.
- **`movementRule`** (regola appresa, sezione 23): testo cercato nella causale (con `foldText`),
  verso (entrata o uscita), conto facoltativo, `kind` e destinazione; `validFrom`.
- **`transfer`** (giroconto o restituzione tra conti): i due `transactionId` (o uno solo e
  `manual: true`), `purpose` (`saldo`, `mutuo`, `altro`).

### Campi che cambiano

- `BankTransaction`: `accountId` (obbligatorio nei nuovi movimenti; `apartmentId` resta quello del
  conto, così `match.ts` non cambia), `counterparty: { name?, iban? }` ricavato dal profilo
  all'importazione. Si salvano solo data, importo, causale, codice disposizione e controparte (sezione
  11: i soli campi necessari); la categoria della banca non si salva (R4: non conta).
- `transactionKey`: l'identità usa `accountId` al posto di `apartmentId`, così due conti dello stesso
  appartamento non si scambiano i movimenti. Nessun movimento reale è ancora salvato: nessuna
  migrazione.
- `MatchInput.statementPeriods`: ogni periodo porta il conto (`apartmentId` del conto, come
  `node.account`) e copre solo le voci pagate da quel conto.

### Estratto: importazione (sotto-piano 3a)

1. **Lettura:** XLSX → tabella di stringhe (Python, A1) o CSV → tabella (core). Il core applica il
   profilo: intestazione, colonne, date, importi in `Cents`, controparte, codice disposizione. Una
   riga che non si legge ferma l'importazione con il numero di riga e il campo, mai il valore.
2. **Impronta del file:** già importato con la stessa impronta → esito `already-imported`, nessuna
   scrittura.
3. **Movimenti:** `keyTransactions` sulla lista del file; un `id` già presente si salta (stesso
   movimento da un estratto che si sovrappone). Sui giorni già coperti da un altro estratto dello
   stesso conto, un movimento nuovo con stessa data e importo di uno esistente ma causale diversa è
   `possible-duplicate` (domanda 13): non si scrive finché una persona non decide.
4. **Scrittura:** una sola operazione `import-statement` con il record `statement` e i movimenti
   nuovi. Annullarla segna `deleted` i movimenti di quell'estratto che nessun altro estratto contiene;
   ciò che ne dipende (abbinamenti, pagamenti) si mostra prima, come per ogni annullamento (sezione
   35).
5. **Percorso proposto** (decisione 2):
   `Riservato_proprietari/Estratti_conto/<Appartamento>/<annualità>/AAAA-MM-GG_Estratto_<Banca>_AAAA-MM.<ext>`
   con la data dell'ultimo giorno coperto e il mese di fine periodo; annualità dell'appartamento che
   contiene quel giorno; stesse regole di nome sicuro di `suggestedFilePath`. Il file non si sposta
   in questo piano.

### Riconciliazione (sotto-piani 3b e 3c)

Una funzione pura `reconcile(stato)` che, dagli stessi record, dà sempre lo stesso risultato:
scritture automatiche e proposte con `id` deterministici (`pay-<transactionId>`,
`p-<tipo>-<transactionId>`), ordinate per `id`. La riga di comando la scrive in **un'operazione
separata** dall'importazione (`reconcile`), così gli automatismi si annullano senza annullare
l'estratto. Rieseguirla su uno stato già riconciliato non scrive nulla.

1. **Uscite verso voci note:** `matchToTransactions` com'è, con i periodi per conto.
2. **Entrate, fase «chi»:** chiave del pagante dalla controparte (IBAN se c'è, altrimenti nome
   normalizzato; domanda 7). `payer` valido alla data del movimento → inquilino noto. Altrimenti
   proposta «chi è» con gli inquilini dell'appartamento del conto in ordine (domanda 5), senza
   punteggio. **Una conferma crea il `payer`** e non si chiede più per quel pagante (decisione 3).
3. **Entrate, fase «che cosa»:** automatico (`Payment` `canone`, `confirmed: true`, `source:
   'csv'`) solo con R4 stretto: pagante confermato per **un solo** inquilino (domanda 6) e importo
   esattamente `monthlyRent + monthlyForfait` del mese (domanda 4). Tutto il resto è una proposta «che
   cosa è» (canone, caparra, saldo di conguaglio, altro; mese) con l'inquilino già scritto: 500 €,
   importi parziali, più mesi, compensazioni (R4). Le categorie della banca non contano.
4. **Uscite rimaste:** regola appresa valida → `movementClass` confermata (domanda 10); un F24
   registrato → proposta di abbinamento, mai automatica (domanda 8); controparte = IBAN di un conto
   proprio → proposta di giroconto (domanda 9); il resto «da classificare» (rimborso a un
   inquilino, proprietà, imposta di subentro, privato, ignora).
5. **Entrate rimaste che non vengono da inquilini** (rimborsi dei fornitori, giroconti in entrata):
   stesse regole del punto 4, nel verso dell'entrata.

### F24 e saldo tra conti (sotto-piano 3c)

- **F24:** l'utente lo registra (dalla ricevuta o a mano) con le righe per appartamento; si abbina a
  un addebito come una voce, con `validateMatches` per le somme (R2: un addebito per più voci o più
  addebiti per una voce si abbinano a mano e le somme devono tornare).
- **Saldo tra conti** (sezione 24), funzione pura `accountBalances`: per ogni coppia di conti, la
  somma delle quote pagate da un conto per un altro appartamento, ognuna con data, descrizione,
  quota e documento: avvisi TARI comuni (`splitSharedDebit`, già nella nota TARI R3), rate con
  `paidFromApartmentId`, righe F24 di un altro appartamento, uscite classificate «proprietà» con
  destinazione diversa dal conto; meno i `transfer` con scopo `saldo`, ciascuno col suo segno
  (domanda 9). Risultato netto per coppia («Lovarini deve a Berchet X»), mai una percentuale fissa.
- **IMU di Berchet e Lovarini:** fino al sotto-piano 3d un F24 IMU con una riga sola resta tutto sul
  conto che l'ha pagato e porta l'avviso «da ripartire»; il saldo tra conti lo elenca a parte, senza
  importo, così nessun saldo appare giusto quando non lo è.

### Riga di comando

Script `tsx` con `@bollette/store-fs`, come `golden:report`. Comandi (nomi in italiano, lasciati al
costruttore nei dettagli): `estratti importa --cartella <workspace> --conto <id> <file>`,
`estratti riconcilia --cartella <workspace> [--prova]`, `estratti conferma <idProposta> [scelte]`,
`estratti saldi`. Uscita JSON con **soli conteggi, esiti e `id`**; `--dettagli` aggiunge date,
importi e causali per chi lavora sul proprio computer, ed è vietato nei test e nella CI. Orologio
e profilo utente passati come opzioni (come il core).

## Sotto-piani (in sequenza; ognuno parte solo dopo la revisione del precedente)

| Sotto-piano | Contenuto | Obiettivo verificabile |
| --- | --- | --- |
| **3a. Conti ed estratti** | strumento di struttura per il campione; `account`, `bankProfile` seed, `statement`; tabella da CSV (core) e XLSX (Python); `accountId` e nuova identità; importazione con duplicati e sovrapposizioni; `statementPeriods` per conto; comando `importa` | lo stesso file sintetico importato due volte lascia l'archivio identico byte per byte e la seconda volta non scrive nulla; due file sovrapposti danno l'unione senza doppioni; un estratto di un conto non cambia le voci presunte di un altro conto |
| **3b. Inquilini, paganti e incassi** | `tenant`, `payer`; fasi «chi» e «che cosa» delle entrate; R4 stretto; proposte ordinate; `Payment` da movimento; comandi `riconcilia` e `conferma` | su una fixture di un anno: gli automatici sono esattamente quelli attesi; dopo **una** conferma del pagante i mesi successivi con importo esatto sono automatici e nessuna domanda «chi è» si ripete; `collectedForfait` sui pagamenti creati dà i valori attesi; ordine dell'ingresso mescolato, stesso risultato |
| **3c. Uscite, F24 e saldo tra conti** | `movementClass`, `movementRule`, `f24`, `transfer`; uscite e entrate rimaste; `accountBalances`; comando `saldi` | fixture con TARI comune, rata di Lovarini pagata da Berchet, F24 a due righe e un giroconto: saldo netto della coppia uguale al valore atteso, con l'elenco delle voci; ogni movimento è in una sola categoria (abbinato, pagamento, classificato, da rivedere) |
| **3d. IMU di Berchet e Lovarini** | solo la ripartizione dell'F24 IMU tra i due appartamenti, secondo la risposta di Carlo del 15 novembre; correzione di R3 nella sezione 42 | l'esempio di Carlo (inventato) ripartito come lui indica, resti con la regola già in uso (R3 dei Ruling); nessun avviso «da ripartire» rimasto |

3a e 3b sono il minimo per l'uso reale (R2 e R4). 3d tocca solo una funzione e i suoi test.

## Rischi

- **Movimento attribuito all'inquilino sbagliato** con un pagante comune a due inquilini: mai
  automatico (domanda 6).
- **Periodo coperto sbagliato:** se si ricavasse dalle date dei movimenti, i giorni senza movimenti
  ai bordi farebbero «assumere» pagamenti che l'estratto copre (R2). Domanda 3.
- **Movimenti non ancora contabilizzati** che cambiano causale o data quando vengono contabilizzati:
  doppioni. Esclusi dall'importazione (domanda 12), da verificare sul campione.
- **Profilo che legge male la controparte:** chiave del pagante sbagliata, quindi domande ripetute.
  Una correzione del profilo è una versione nuova più un'operazione esplicita «rileggi i movimenti»
  dell'estratto (rev + 1), mai una riscrittura silenziosa.
- **Privacy:** i movimenti in chiaro nella cartella condivisa (decisione 1) si vedono da chiunque
  abbia la cartella intera: va detto nella specifica che la cartella `App Bollette` non si condivide
  mai con gli inquilini, solo le sottocartelle di tipologia (sezione 27).
- **XLSX come confine di fiducia** (A1): limiti di dimensione e di righe, nessuna formula valutata,
  solo valori delle celle.

## Test (solo fixture sintetiche)

- **Lettura:** tabelle sintetiche con la struttura del campione (intestazioni vere, valori
  inventati); XLSX costruito durante il test da un JSON (nessun file binario nel repository, così
  `pnpm data:check` controlla il JSON); CSV con BOM, `;`, virgole decimali, righe vuote, riga
  illeggibile (errore con riga e campo, senza valore).
- **Ripetibilità:** importazione e riconciliazione due volte con orologio e generatore fissi, archivio
  confrontato byte per byte; ingresso mescolato; movimenti identici nello stesso giorno; file
  sovrapposti; `possible-duplicate`.
- **Riconciliazione:** ogni caso di R4 (esatto, 500 €, parziale, più mesi, pagante di due
  inquilini, pagante nuovo); commissione che segue la bolletta (R7, già provata, qui con l'estratto
  vero); regole apprese; F24 con somme che non tornano (`validateMatches`); saldi tra conti.
- **Riga di comando:** l'uscita predefinita non contiene causali, nomi né IBAN (controllo con
  `scanText` di `check-personal-data.mjs` sui risultati).
- **Python** (A1): `table` su XLSX sintetici, file troppo grande, foglio vuoto, celle con stringhe
  condivise e numeri; uscita UTF-8; nessuna rete.

## Modifiche alla specifica necessarie (da approvare con il disegno)

1. **Sezione 11, «Sicurezza»:** sostituire con «Gli estratti conto non sono cifrati (decisione del 14
   novembre 2026): Nicola è cointestatario e ha già tutti gli accessi. I movimenti si salvano con i
   soli campi necessari (data, importo, causale, codice disposizione, controparte) in
   `_app/dati/transaction/` e il file originale in `Riservato_proprietari/`. La cartella `App
   Bollette` non si condivide con gli inquilini, che ricevono solo i link alle sottocartelle di
   tipologia (sezione 27).» Sezione 11, «Importazione»: il file della banca è oggi un XLSX («Lista
   operazioni»), letto direttamente.
2. **Sezione 20:** «estratti conto (cifrati)» diventa «estratti conto, in `Estratti_conto/<Appartamento>/<annualità>/`».
3. **Sezione 41** (solo con A1): Python legge anche gli estratti XLSX, sul desktop.
4. **Sezione 42, R3 (IMU):** dopo la risposta del 15 novembre (domanda 11), il testo «in parti
   proporzionali» si allinea alla sezione 24 o viceversa.
5. **Sezione 23, «Da chiarire»:** chiusa con la risposta alla domanda 2.

## Mie scelte (da controllare)

1. **`accountId` nell'identità del movimento** al posto di `apartmentId`: nessun dato reale da
   migrare; evita che due conti dello stesso appartamento si sovrascrivano i movimenti.
2. **Controparte salvata all'importazione**, non ricalcolata a ogni lettura: stesso file, stesso
   risultato anche se il profilo cambia dopo; si rilegge solo con un'operazione esplicita.
3. **Riconciliazione in un'operazione separata dall'importazione**, con `id` deterministici: rieseguirla
   è innocuo e gli automatismi si annullano da soli.
4. **`tenant` minimo** (nome, lingua): la scheda completa della sezione 26 è dati personali che questo
   piano non usa.
5. **F24 senza codici tributo** e senza calcolo: righe per appartamento scritte dall'utente.
6. **Il file dell'estratto non si sposta** in questo piano: solo il percorso proposto, come per le
   bollette.
7. **Uscita della riga di comando senza dati personali di default**, perché le prove sui file veri le
   fa Carlo e i risultati possono finire in una conversazione con Claude (sezione 28).

## Lasciato al costruttore

Nomi esatti dei comandi e delle opzioni; forma del JSON di uscita; testi in italiano delle proposte e
dei messaggi; nome del comando Python; limiti numerici di dimensione dell'XLSX; dove sta il profilo
seed della banca (cartella dei seed esistente o una nuova); ordine dei campi nei record.

## Non verificato

- **Struttura vera dei file della banca:** intestazioni, riga dove iniziano, formato di data e
  importo, colonna unica o dare/avere, dove sta «Cod Disp.» (colonna o testo della causale), se c'è
  una data valuta oltre alla contabile e quale usava il confronto del punto (h) di
  `docs/rules/conguaglio-rules.md`, se il file dichiara il periodo, se elenca movimenti non
  contabilizzati, se la banca offre anche un CSV. Primo task di 3a: uno strumento locale (come
  `python/tools/pdf_report.py`) che Carlo lancia sui suoi file e che stampa **solo** le
  intestazioni, i tipi delle colonne e i conteggi, mai i valori.
- Che i tre conti siano della stessa banca (il nome «Lista_Operazioni» lo suggerisce).
- Protezione di `expat` di Python 3.13 dall'espansione delle entità (A1); disponibilità di
  `DecompressionStream('deflate-raw')` in Node 20, WebView2 e WKWebView (A2).
- Se nel modello F24 l'IMU di due immobili dello stesso comune sta su righe separate o su una riga
  sola con «numero immobili» 2: decide se «righe dell'F24 per immobile» è possibile (domanda 11).
- Formato della causale dei bonifici in entrata (dove stanno nome e IBAN di chi paga).

## Aperto con Carlo

Domande chiuse, ognuna con la mia raccomandazione. Le 3, 4, 5, 6, 8, 9 e 11 sono regole di calcolo o
di confidenza: decide Carlo.

1. **Contenitore:** si leggono direttamente gli XLSX della banca, in Python con la libreria standard
   (A1)? **Raccomando sì.** In alternativa A2 (tutto nel core) o A3 (Nicola salva in CSV).
2. **Conti (fatto, sezione 23 «da chiarire»):** IMU, F24 e rate condominiali escono solo dai tre conti
   degli appartamenti, o anche da altri conti (per esempio di Nicola)? E i tre conti sono della stessa
   banca? Serve la risposta, non una raccomandazione; l'app ammette comunque più conti.
3. **Periodo coperto da un estratto (R2, voci «assunte»):** si prende dal file, o lo indica l'utente
   all'importazione, e mai dalle date dei movimenti? **Raccomando sì**: un estratto senza periodo
   dichiarato chiede le date.
4. **Mese di un canone automatico (R4):** il mese della data del bonifico, solo se l'inquilino è
   presente in quel mese e il mese non è già pagato; un bonifico di fine mese per il mese dopo va «da
   rivedere»? **Raccomando sì.**
5. **Ordine delle proposte «chi è», senza punteggio:** prima chi ha il nome (tutte le parole) nella
   causale, poi chi ha importo atteso uguale, poi chi è presente nel mese senza pagamento, poi
   alfabetico? **Raccomando sì.**
6. **Pagante di più inquilini** (un genitore per due figli): mai automatico, sempre «da rivedere» con
   gli inquilini di quel pagante in cima? **Raccomando sì.**
7. **Chiave del pagante:** l'IBAN quando c'è, il nome normalizzato solo quando manca; lo stesso IBAN
   con un nome diverso resta lo stesso pagante? **Raccomando sì.**
8. **F24:** sempre proposta da confermare, anche con un solo addebito «F24» di pari importo nella
   finestra (R2: abbinamento manuale)? **Raccomando sì.**
9. **Giroconti tra conti propri:** la prima volta si conferma lo scopo (restituzione del saldo, mutuo,
   altro) e solo «restituzione» entra nel saldo tra conti, col suo segno (un giroconto nel verso
   opposto aumenta il debito)? Abbinamento automatico dei due movimenti (stesso importo, segni
   opposti, entro 5 giorni) come proposta? **Raccomando sì a entrambe.**
10. **Regole apprese per le uscite** (bollo, SUNIA, mutuo, commissioni senza bolletta): dopo la prima
    conferma si applicano da sole, con Annulla, come dice la sezione 23 per le scadenze?
    **Raccomando sì**, mai per entrate da inquilini (lì vale R4).
11. **IMU di Berchet e Lovarini (risposta attesa il 15 novembre, sotto-piano 3d):** si ripartisce
    dalle righe dell'F24 per immobile quando sono separate e, se l'F24 ha una riga sola per i due
    immobili, con le quote del prospetto di calcolo del commercialista inserite una volta (in punti
    base, come i pesi delle utenze, R80)? **Raccomando sì**; R3 («in parti proporzionali») si corregge
    di conseguenza.
12. **Movimenti non contabilizzati:** esclusi dall'importazione? **Raccomando sì.**
13. **Possibile doppione tra estratti** (stessa data e importo, causale diversa, giorni già coperti):
    «da rivedere», non scritto finché una persona non decide? **Raccomando sì.**
14. **Modifiche alla specifica** delle sezioni 11, 20 e (con A1) 41 come scritte sopra: si approvano?
15. **Campione di struttura:** Carlo lancia lo strumento del primo task di 3a sui file di ottobre 2026
    e incolla solo l'uscita (intestazioni e conteggi)? **Raccomando sì**: senza questo il profilo
    seed della banca non si può scrivere.
