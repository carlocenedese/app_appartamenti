# Ricognizione della roadmap dopo il piano 2b-2 (14 novembre 2026)

Ricognizione in sola lettura di `origin/main` (commit `487a819`): `CLAUDE.md`, `docs/spec.md` (tutta),
`docs/progress.md` (R1-R92), i piani e i disegni in `docs/plans/`, `docs/rules/` e il codice di
`packages/`, `python/`, `apps/desktop/`. Nessun PDF reale e nessun dato reale aperto. Vincolo di
Carlo: tutto ciò che si può fare **senza veste grafica e senza finalizzare l'interfaccia** (quelle si
fanno insieme). Per ogni voce: (1) cosa c'è e cosa dice la specifica, (2) cosa manca di non grafico
costruibile ora, (3) decisioni di Carlo come domande chiuse con la mia raccomandazione, (4) dati
reali o campioni, (5) stima relativa (S, M, L) e rischio.

## Premessa: stato reale di `main`

- **Piano 2b-2 (PDF con più documenti), fase 1: disegno e piano approvati, codice NON ancora
  scritto.** Su `main` non ci sono `--pages`, `pageRange`, `documentKind` né `fileDocument`
  (`python/bollette_pdf/__main__.py`, `packages/core/src/extraction.ts`, `dedupe.ts`). Le regole del
  piano partono da R93; in `docs/progress.md` l'ultima è R92. Se un'esecuzione è già in corso su un
  altro ramo, questa voce va tolta dall'ordine qui sotto.
- Il core (`packages/core/src`, circa 6.200 righe) copre: importi e date, modello dei record, archivio
  e registro con annullamento, impronte e duplicati, abbinamento di bollette e rate agli addebiti
  (`match.ts`), commissione, riparto e conguaglio con condominio e conguaglio supplementare
  (`conguaglio.ts`), interessi e restituzione della caparra (`interest.ts`, `caparra.ts`), nota TARI,
  proposta e politica di conferma, utenze con pesi, utenti, cartella di lavoro, presenza.
- Python (`python/bollette_pdf`) legge PDF di testo, scansioni e immagini (OCR solo macOS), con 11
  profili seed.
- L'app desktop (`apps/desktop/src`) ha solo primo avvio, impostazioni per macchina e le schermate
  delle utenze dietro ancore di sviluppo. **Non chiama ancora il programma Python**: il limite di
  tempo dell'estrazione (R54) esiste solo nell'aiuto dei test (`packages/core/test/helpers`).

## Voce A. Piano 2b-2, fase 1 (PDF con più documenti)

1. **C'è:** disegno e piano approvati il 14 novembre 2026
   (`2026-11-14-piano-2b-2-pdf-multi-documento-disegno.md` e `-multi-documento.md`, cinque task).
   Specifica: sezione 22 («l'app propone di separarli e chiede conferma»).
2. **Manca (tutto non grafico):** `extract --pages a-b` con vista ristretta del `Document`, avviso
   «più documenti», `pageRange` e `documentKind` in Zod e Python, `fileDocument` su `Bill` e
   `Instalment`, duplicati per intervallo, nota automatica, «annulla tutto il file», non regressione
   delle 18 fixture e conteggi sui PDF reali.
3. **Decisioni:** nessuna aperta (disegno: «Nessuna domanda che blocchi la fase 1»).
4. **Dati reali:** solo il conteggio finale dell'avviso sui PDF reali (Task 5), con Carlo, soli numeri.
5. **Stima:** M. Rischio basso; il punto delicato è la non regressione delle fixture e lo schema
   `ExtractionResult` che cambia insieme in Python e Zod.

## Voce B. Piano 2b-3, condominio (prima il piano rate, poi preventivo e rendiconto)

1. **C'è:** il calcolo è già nel core. `Instalment` con `kind: 'condominio'`, `rata`,
   `quotaProprieta`, `conguaglioPrec`, `straordinaria`, `coversFrom`/`coversTo`,
   `paidFromApartmentId` (`model.ts`); `allocateInstalment`, quota della proprietà divisa in parti
   uguali tra le rate, conguaglio dell'anno prima sui 12 mesi dell'esercizio, rata in sospeso se
   l'addebito non è `rata + conguaglioPrec` (`conguaglio.ts`, `match.ts`); controllo di fine esercizio
   (`golden.ts`, R36, R37). Specifica: sezioni 7 (spese condominiali), 12, 15, 16, 32 e 42 R3 e R8;
   disegno 2b-1, decisione 4 («condominio in due tempi»). Nessun disegno 2b-3 scritto. I profili
   ammettono solo `kind: 'bill' | 'tari'`: nessun profilo condominiale.
2. **Manca di non grafico, prima parte (piano rate):** un tipo di profilo o di documento
   «piano rate» che legga, per ogni rata, scadenza, importo della rata e conguaglio dell'anno prima;
   una funzione del core che trasformi un piano rate (letto o inserito a mano) nelle `Instalment`
   dell'esercizio, con i controlli (numero di rate divisore di 12, mesi coperti in ordine, somma delle
   rate, rata straordinaria), la registrazione con il registro e i duplicati; `documentKind`
   condominiale (il 2b-2 lo prevede come estensione). **Seconda parte (preventivo e rendiconto):**
   lettura delle voci del bilancio dell'unità con le colonne conduttore e proprietario, tabella di
   regole voce → inquilini o proprietà (sezione 7: «tabella di regole modificabile»), calcolo della
   `quotaProprieta` annua; dati per il file riservato della proprietà (R8).
3. **Decisioni di Carlo:**
   - Finché il preventivo non è letto, la `quotaProprieta` di un esercizio si inserisce a mano
     dall'utente o resta 0 con la rata «da confermare»? **Raccomando: a mano, e la rata resta in
     revisione finché non c'è** (un importo mancante non diventa 0 in silenzio).
   - Il piano rate di Pulci («riparto inquilini fornito dall'amministratore», sezione 16) dà già la
     quota degli inquilini: si usa quella invece di rata meno quota della proprietà? È una regola di
     calcolo. **Raccomando: sì, se il riparto dell'amministratore è per rata**, con la differenza
     segnalata; ma decide Carlo.
   - Le tre regole della sezione 16 (Berchet «preventivo meno Generali Proprietà», Lovarini «quote
     conduttore del bilancio», Pulci «riparto dell'amministratore») restano tre modi per appartamento
     o si riducono all'unica regola di R3? **Raccomando: un'unica regola R3 con la tabella delle voci
     per amministratore** (configurazione, non codice).
   - Il primo passo si fa senza lettura automatica (piano rate inserito a mano, profili dopo il
     campione)? **Raccomando: sì**: 4 dei 10 file del campione di Carlo erano documenti condominiali
     scansionati e l'OCR non riconosce nulla senza ancore (R92).
4. **Campioni:** indispensabili per i profili: almeno un piano rate, un preventivo e un rendiconto
   per ciascuno dei tre amministratori, letti con Carlo presente, con fixture anonimizzate. Il primo
   passo (piano rate a mano) non ne ha bisogno.
5. **Stima:** piano rate a mano S-M; lettura del piano rate M; preventivo e rendiconto L. Rischio
   alto sulla seconda parte (tabelle a più colonne, scansioni, formati diversi per amministratore).

## Voce C. Piano 3, estratti conto CSV

1. **C'è:** `BankTransaction` (`apartmentId`, `date`, `amount`, `description`, `dispCode`,
   `statementHash`) già normalizzata e con `id` deterministico (`transactionKey`, piano 1 Task 6);
   `Payment` con `kind`, `confirmed`, `source: 'csv' | 'manual' | 'excel'`; abbinamento di bollette e
   rate e commissione (`match.ts`, `commission.ts`, R15-R22, R27, R28); abbinamenti presunti senza
   estratto (R17, R21); forfait incassato (`collectedForfait`). **Non c'è** nessun lettore di CSV,
   nessun record per conto, inquilino (anagrafica), alias del pagante, classificazione delle entrate,
   F24, giroconto o saldo tra conti. Specifica: sezioni 11, 18, 23 (controllo sul CSV), 24, 42 R2, R4,
   R6, R7; piano 1, riga 3 della tabella dei piani.
2. **Manca di non grafico:** lettore del CSV Intesa (sezione 18: data, operazione, dettagli,
   conto, categoria, importo) in movimenti normalizzati, con più CSV per periodo senza doppioni (R2);
   record `account` (più conti per appartamento, sezione 13) e `tenant`; alias pagante → inquilino
   con data di validità (sezione 15); proposta di classificazione delle entrate (canone, caparra,
   saldo di conguaglio, altro) con l'automatismo stretto di R4 (pagante già confermato e importo
   esatto) e tutto il resto in «Da rivedere»; classificazione delle uscite non abbinate; abbinamento
   F24 e rate a più voci (R2: manuale, somme che tornano); saldo tra conti (sezione 24) con
   giroconti; chiusura del saldo dei conguagli solo con il bonifico (R6).
3. **Decisioni di Carlo:**
   - **Cifratura degli estratti (sezione 11).** Oggi i movimenti si scriverebbero in chiaro in
     `_app/dati/transaction/` (R5), contro la sezione 11. Si cifrano i soli campi necessari con la
     chiave nel portachiavi del sistema, o si tiene una cartella cifrata a parte? **Raccomando: campi
     cifrati nel record, chiave nel portachiavi**, ma serve sapere come la chiave arriva sul computer
     di Nicola (stessa chiave su due macchine) e richiede una libreria crittografica (licenza) o Rust.
   - I CSV originali scaricati dalla banca restano nella cartella condivisa? **Raccomando: no, in
     `Riservato_proprietari/` cifrati o cancellati dall'utente dopo l'importazione.**
   - Livelli di confidenza della proposta pagante → inquilino (sezione 11 «grado di certezza»): è una
     regola di confidenza. **Raccomando: nessun punteggio numerico; solo «sicuro» (R4 stretto) o «da
     rivedere» con l'inquilino più probabile in cima**, ordinato per nome nella causale, importo
     atteso e mese.
   - IMU di Berchet e Lovarini dal conto di Berchet: R3 dice «in parti proporzionali», la sezione 24
     «dalle righe del documento (F24 per immobile)». **Raccomando: dalle righe dell'F24 per immobile**,
     con R3 corretta di conseguenza.
   - IMU, F24 e rate condominiali escono anche da conti diversi da quelli Intesa (sezione 23, «da
     chiarire»)? Serve una risposta di fatto, non una raccomandazione.
   - Lettura dei CSV di altre banche: solo Intesa nella prima versione? **Raccomando: sì**, con il
     formato come configurazione (colonne e formato data), non codice.
4. **Campioni:** almeno un CSV Intesa per conto, anonimizzato con Carlo presente (intestazioni,
   codifica, formato di date e importi, «Cod Disp.»), più un caso di commissione e di giroconto.
   `docs/rules/conguaglio-rules.md` cita gli estratti di ottobre 2026 già visti: bastano per le
   fixture se si anonimizzano.
5. **Stima:** L (è il piano più grande rimasto). Rischio alto: R2 dice che nulla entra nel
   conguaglio senza il CSV, quindi è il piano che sblocca l'uso reale; la sicurezza è un rischio di
   privacy.

## Voce D. Resto del piano 4 (interfaccia)

Esclusa per decisione di Carlo. Le uniche parti non grafiche utili ora: l'esecutore di produzione
del programma Python con limite di tempo (R54) e lo spostamento e rinomina dei file (voce I).
Restano al lavoro con Carlo: «Documento n di N», PDF affiancato con evidenziazione, collegamento di
Modifica, Aggiungi nota e Rimuovi, indirizzo e catasto nelle impostazioni (R82).

## Voce E. Piano 5, Excel, subentro, moduli e messaggi

1. **C'è:** il calcolo che l'Excel deve mostrare (`calcConguaglio`, `byCategory`, conguaglio
   supplementare, `canClosePeriod`, `caparraReturn` con interessi a mesi interi). Specifica: sezioni
   6, 17, 19, 21, 26, 27, 33, 42 R5, R6 e R8; il formato degli Excel di oggi è descritto in
   `docs/rules/conguaglio-rules.md` (fogli R, C, AV). Nessuna libreria per scrivere xlsx o docx.
2. **Manca di non grafico:** generatore dell'Excel degli inquilini (dettaglio delle bollette, una sola
   voce Condominio, nome del file e link della cartella condivisa) e del file riservato della
   proprietà (rata, conguaglio dell'anno prima, quota della proprietà e data dell'addebito in
   colonne separate); versioni in `excel_versioni/` e differenza dalla precedente; istantanea di
   chiusura e notifica del conguaglio supplementare (R5); testi dei messaggi agli inquilini (gruppo
   o per inquilino, italiano o inglese) come file `.txt`; divisione dei 67 € tra chi cede nello
   stesso mese (sezione 26, regola 2); moduli Word da modelli con segnaposto.
3. **Decisioni di Carlo:**
   - Dove si genera l'Excel? La sezione 41 vuole Python solo per i PDF, `CLAUDE.md` ammette in Python
     solo `jsonschema` oltre a `pdfminer.six`. **Raccomando: in TypeScript**, con una libreria MIT da
     verificare (per esempio scrittura diretta dell'xlsx con un compressore zip MIT) invece di
     `openpyxl`; la scelta della libreria è di licenza, quindi di Carlo.
   - L'Excel contiene formule o soli valori? **Raccomando: soli valori** (le correzioni si fanno
     nell'app, sezione 29), con i totali calcolati dall'app.
   - Il controllo «Excel modificato a mano» (sezione 29) è nella prima versione? **Raccomando: no,
     dopo**: richiede anche la lettura dell'xlsx.
   - Importo dell'imposta fissa di cessione (67 €) e tassi di interesse legale per anno: vanno in un
     record di configurazione con fonte e data (sezione 40, `CLAUDE.md`). Chi li inserisce e con
     quale fonte? **Raccomando: un record `legal-rate` e `fixed-tax` scritto dall'utente nelle
     impostazioni, con fonte e data obbligatorie**; i tassi 2025 e 2026 restano «da verificare»
     (sezione 39).
   - Moduli Word: si usano i modelli più recenti che Carlo indica (sezione 26, «da chiarire»)? Serve la
     risposta e un modello senza dati personali per le prove.
4. **Campioni:** un Excel di oggi per tipo (inquilini e proprietà) come forma di riferimento, senza
   dati (solo intestazioni e struttura); i modelli Word più recenti, anonimizzati.
5. **Stima:** Excel M-L, messaggi S, moduli M, istantanea e chiusura S-M. Rischio medio: licenze
   delle librerie xlsx e docx, formato da concordare.

## Voce F. Resto del piano 6: aggiornamenti firmati, Scadenze e pagamenti, Tasse e stime

### F1. Aggiornamenti firmati (sezione 37)

1. **C'è:** chiave privata fuori dal repository (R31). Nessun plugin di aggiornamento in
   `apps/desktop/src-tauri/Cargo.toml` (solo fs, dialog, persisted-scope).
2. **Manca:** plugin di aggiornamento di Tauri, manifest firmato pubblicato con le versioni,
   interruttore per disattivarlo, passi in `build.yml`, verifica delle licenze Rust (`cargo deny`).
3. **Decisioni:** dove si pubblicano manifest e installer (repository pubblico delle versioni,
   sezione 37)? **Raccomando: GitHub Releases di un repository pubblico senza codice.** Si accettano le
   dipendenze Rust del plugin (rete https) dopo l'inventario delle licenze? **Raccomando: sì solo se
   tutte nell'elenco**, altrimenti stop come per l'OCR.
4. **Dati:** nessuno. 5. **Stima:** M. Rischio medio: si prova solo in CI (R9, nessun Rust in
   locale) e su un computer vero.

### F2. Scadenze e pagamenti (sezioni 21, 23, 30)

1. **C'è:** nulla nel core oltre all'abbinamento delle rate.
2. **Manca di non grafico:** record di una scadenza (tipo: IMU, imposta di registro, cedolare, TARI,
   rate condominiali, F24, altro; appartamento, intestatario, scadenza, importo atteso o «da
   inserire», ricevuta); stato calcolato da un orologio passato come argomento (da pagare, entro 30
   giorni, in ritardo, pagata); ricorrenza annuale; voci create dalle `Instalment` (rate
   condominiali); abbinamento con le uscite del CSV e regola salvata alla prima conferma (dipende
   dal piano 3); filtri della sezione 30 come funzioni.
3. **Decisioni:** «in scadenza» vuol dire entro 30 giorni (sezione 21) anche per le voci senza
   importo? **Raccomando: sì.** Le scadenze fiscali (RLI, termini) le inserisce l'utente, nessuna
   regola nel codice (sezione 39)? **Raccomando: sì.**
4. **Dati:** nessuno per il motore; le voci vere le inserisce Carlo. 5. **Stima:** M. Rischio basso
   senza il CSV, medio con l'abbinamento.

### F3. Tasse e stime (sezione 34)

1. **C'è:** nulla.
2. **Manca di non grafico:** tabella voce × anno per contribuente con stima, pagato (dal CSV),
   ancora previsto (dalle scadenze) e differenza = pagato + ancora previsto − stima; avviso di gennaio
   per l'anno vuoto con copia dell'anno prima; esportazione per il commercialista (dipende dalla
   libreria xlsx, voce E).
3. **Decisioni (regole di calcolo):** quando una differenza diventa «discrepanza» (qualunque
   centesimo o una soglia)? **Raccomando: qualunque differenza diversa da 0 è «discrepanza»**, senza
   soglie. Come si «estrapolano» le spese condominiali degli anni senza dati? **Raccomando: l'ultimo
   anno noto copiato com'è**, con la fonte «estrapolata dal …». Entrambe da decidere da Carlo.
4. **Dati:** nessuno. 5. **Stima:** S-M. Rischio basso.

## Voce G. Piano 7, app del telefono di sola lettura (sezione 41)

1. **C'è:** il core è già TypeScript puro e portabile; gli schemi JSON dei record sono in
   `docs/schemas/` (`pnpm schemas:export`).
2. **Manca di non grafico:** la specifica a sé del formato dei file come contratto tra desktop e
   telefono (sezione 41, punto 1), compresa la regola di unione; un archivio di sola lettura per il
   telefono; le notifiche programmate. Il resto è interfaccia.
3. **Decisioni:** framework (Tauri 2 mobile, Capacitor, React Native) dopo una verifica; Carlo l'ha
   rimandata a dopo la versione desktop. **Raccomando: non partire ora**, salvo la specifica del
   formato dei file, utile anche al desktop.
4. **Dati:** nessuno. 5. **Stima:** L. Rischio medio (accesso offline alla cartella Dropbox su iOS).

## Voce H. OCR su Windows (rimandato per le DLL LGPL)

1. **C'è:** OCR solo macOS; su Windows una scansione dà `senza-testo` con avviso
   (`docs/rules/ocr-licenze.md`): la ruota Windows di tesserocr porta libiconv e libcharset
   (LGPL-2.1), ca-certificates (MPL-2.0) e runtime Microsoft.
2. **Manca:** una build di Tesseract e tesserocr per Windows senza libarchive e libcurl (da
   verificare che spariscano le librerie fuori elenco), o un'altra fonte.
3. **Decisione:** con R92 nessuna scansione reale è riconosciuta (39 su 39 `non-riconosciuta`) e
   nessuna delle dieci del campione era una bolletta attuale. Si chiude la voce come «non si fa»
   finché non arrivano scansioni di bollette vere? **Raccomando: sì, chiusa per ora**; Windows resta
   con l'inserimento a mano.
4. **Dati:** scansioni vere di bollette attuali, se mai arriveranno. 5. **Stima:** L. Rischio alto
   (compilazione nativa in CI, licenze).

## Voce I. Pezzi non grafici che non hanno un piano

- **Smistamento dei file (sezioni 20 e 22, punti 1, 6 e 8).** Il piano 2a l'ha escluso, il 2b-2 lo
  rimanda «al piano che sposta i file», nessun piano lo prende. Serve: destinazione e nome del file,
  suffisso numerico per i nomi uguali, copia della TARI comune nell'altro appartamento, ritorno in
  `Da_smistare` all'annullamento, «serve aiuto» per i file non letti. C'è solo `suggestedFilePath`
  (`proposal.ts`). **Incongruenza da chiudere prima (domanda a Carlo):** il codice segue la sezione
  22 (`Bollette/<Tipo>/<anno di emissione>/…`, periodo `AAAAMMGG-AAAAMMGG`), mentre la sezione 20,
  dello stesso giorno, vuole `<Appartamento>/<annualità>/<Tipo>/` con il periodo come mese
  (`2026-03`) e la copia per ciascuna annualità delle bollette a cavallo. **Raccomando la sezione 20**
  (è la struttura per annualità decisa espressamente). Stima M; dipende dall'esecutore dei file in
  Tauri (permessi `fs`).
- **Esecutore di produzione del programma Python** con limite di tempo e uscita limitata (R54): oggi
  solo nell'aiuto dei test. Va in `apps/desktop` (Tauri) e serve a ogni lettura dall'app. Decisione:
  plugin ufficiale `tauri-plugin-shell` (MIT o Apache-2.0) o comando Rust proprio? **Raccomando il
  plugin**, come per `persisted-scope` (R84). Stima S-M.
- **Record dell'inquilino** (sezione 26, scheda; lingua dei messaggi; paganti abituali): oggi
  `tenantId` è una stringa senza record. Serve ai piani 3 e 5. Stima S.
- **Configurazione fiscale con fonte e data** (tassi legali, imposta fissa): `legalInterest` riceve
  già i tassi come argomento, ma nessun record li conserva. Stima S.
- **«Parola chiesta nell'app»** (R90, R92): la parte non grafica è una funzione del core che aggiunge
  una parola a `recognise.ocrAnyOf` di un profilo scelto, con le regole di validità di R90 e
  un'operazione annullabile. Stima S, nessuna decisione.

## Ordine consigliato delle prossime tre voci

1. **Piano 2b-2, fase 1 (voce A).** Disegno e piano già approvati, nessuna decisione aperta: si
   esegue il piano così com'è. Non serve un nuovo disegno.
2. **Seguiti tecnici senza decisioni di calcolo:** funzione «parola chiesta nell'app» nel core,
   record dell'inquilino, configurazione fiscale con fonte e data (vuota, valori inseriti
   dall'utente), correzioni rimandate senza decisioni (sotto, «Debito tecnico»), aggiornamento di
   `docs/progress.md`. Basta un piano breve rivisto; serve il sì di Carlo solo sull'esecutore Python
   (plugin) se lo si include. Se Carlo risponde sulla struttura delle cartelle, si aggiunge lo
   smistamento dei file.
3. **Scadenze e pagamenti, parte senza CSV (voce F2).** La specifica (sezioni 21, 23, 30) è precisa
   e non contiene regole di calcolo nuove; serve **un disegno approvato da Carlo** (record, stati,
   ricorrenza, le due domande di F2). L'abbinamento con il CSV si aggiunge con il piano 3.

In parallelo, senza codice: **disegno del piano 3 (CSV)**, perché è il piano che sblocca l'uso reale
(R2) e ha le decisioni più pesanti (cifratura, conti, confidenza). Poi il piano rate del condominio
(voce B, prima parte, a mano).

## Debito tecnico e incongruenze trovate

### Fra specifica, codice e registro

- **Sezione 11 contro R5:** gli estratti non vanno lasciati in chiaro nella cartella condivisa, ma
  il modello prevede `_app/dati/transaction/` in chiaro. Da decidere prima del piano 3.
- **Sezione 20 contro sezione 22 e `suggestedFilePath`:** struttura delle cartelle e formato del
  periodo nel nome (voce I).
- **R3 contro sezione 24:** ripartizione dell'IMU «in parti proporzionali» o «dalle righe del
  documento» (voce C).
- **Sezione 32 contro R3:** la 32 dice che la differenza del consuntivo entra nel conguaglio «su
  conferma», R3 che il conguaglio dell'anno prima entra per intero con la rata. Prevale la 42; da
  correggere il testo della 32.
- **Sezione 42 non aggiornata con regole decise dopo il 10 novembre:** resti ai primi posti
  nell'ordine di `Apartment.rooms` (R30), finestra −5/+10 giorni (R30), pesi delle utenze in punti
  base (R80), perequative sommate all'utenza (R81), proposta quando la causale non nomina il
  fornitore (R27). «Da confermare: nessun punto aperto al 10 novembre» non dice che esistono.
  Raccomando di aggiungerle alla 42 perché resti l'unica fonte delle regole di calcolo.
- **Tabella della sezione 16 superata:** «Commissione 0,80 € non applicata dal …» (superata da R7),
  «conguagli a richiesta» per Lovarini e Pulci (superata da R1). Così le sezioni 8, 28, 31 e 37
  citano `pdfplumber` e `openpyxl` (R43 usa `pdfminer.six`; `openpyxl` è fuori dalla regola Python di
  `CLAUDE.md`).
- **`docs/progress.md`:** l'intestazione «Stato generale (13 novembre 2026)» dice ancora «Prossimi:
  piano 6, poi il disegno del piano 2b», entrambi fatti; non cita 2b-1, R92 né il 2b-2. R80 dice «Da
  fare: sostituire `parts-total`», tolto da R81. R85 dice ancora «da rinumerare quando i rami si
  uniscono», già fatto nel merge. R88 descrive `read_pdf` con riconoscimento solo dai primi byte,
  il disegno 2b-1 «dall'estensione e dai primi byte»: vale R88, il disegno va annotato.
- **Licenze «da confermare da Carlo» aperte dall'11 novembre:** bzip2, SQLite e `vcruntime140*.dll`
  (R69), PSF-2.0 dell'interprete (R45), nessun Mac Intel (R71), archivio Windows non ridotto (R71).
  In più `cffi` fermo a 2.0.0 per MIT-0 (R48) e `Apache-2.0 WITH LLVM-exception` forse chiesto da
  `cargo deny` (R29).
- **Ramo Dependabot `vite-8.3.6`:** Vite 8 porta lightningcss (MPL-2.0), escluso dal Task 1 del piano
  1. Non va unito: chiuderlo o fissare Vite 7 nella configurazione di Dependabot.

### Rimandati dal registro, costruibili senza decisioni

- Task 9 M1 (registrare di nuovo dopo un annullamento dà `StaleWriteError`), M3 (scrittura TARI
  parziale vista come doppione al nuovo tentativo), M4 (`checkConsistency` e R68).
- Abbinamenti rifiutati che tornano; nessuna registrazione forzata dopo un «possibile duplicato»;
  `registerBill` ignora i file di bolletta rotti nel controllo dei duplicati; conservare i campi
  sconosciuti quando si riscrive un record; nessun nuovo tentativo di `rename` su Windows.
- `parse.py`: `\d` → `[0-9]`, sequenze di cifre limitate, unità delle quantità troppo larga, test
  mancanti del Task 3. `reader.py`: `char_margin`, pagine ruotate, MediaBox invece di CropBox,
  `except Exception` che chiama «file corrotto» un errore del modulo. Riga di comando: file letto due
  volte, avvisi persi con `illeggibile`.
- `registerProposal` legge il profilo prima dei controlli sui duplicati; test mancanti su
  `readSupplierProfile`; `decideRegistration` ignora `profile.deleted`.
- `identifiers: []` in tutti i profili (I6): il controllo dei codici dell'appartamento manca. Come il
  profilo impara POD, PDR e codice cliente è una decisione di prodotto da porre con il disegno del
  piano 4.
- Rilievi minori della Fase C (`conguaglio.ts` di circa 720 righe, conguaglio supplementare che non
  filtra i contratti di altri appartamenti, colonna «Spese» senza commissione nel rapporto).
- Non verificati finché non gira `build.yml`: installazione NSIS, MSI con circa 3000 file, interprete
  nell'app macOS universale, lettura dei PDF dall'app installata (R74), spike del primo avvio (R84).

## Domande per Carlo, in ordine di importanza

1. Estratti conto: campi cifrati con la chiave nel portachiavi (raccomandato) o cartella cifrata a
   parte? E come arriva la chiave sul computer di Nicola?
2. Struttura dei file smistati: sezione 20 (`<Appartamento>/<annualità>/<Tipo>/`, periodo come mese,
   raccomandata) o sezione 22 (`Bollette/<Tipo>/<anno>/`, come il codice oggi)?
3. Proposta pagante → inquilino: solo «sicuro» (R4 stretto) o «da rivedere» con l'inquilino più
   probabile in cima, senza punteggi (raccomandato)?
4. IMU di Berchet e Lovarini: ripartita dalle righe dell'F24 per immobile (raccomandato) invece che
   «in parti proporzionali»?
5. Condominio: `quotaProprieta` inserita a mano finché il preventivo non è letto, con la rata in
   revisione (raccomandato)? E per Pulci si usa il riparto dell'amministratore?
6. Excel generato in TypeScript con una libreria MIT da approvare (raccomandato), con soli valori?
7. Tasse e stime: discrepanza per ogni differenza diversa da 0 e spese condominiali estrapolate
   copiando l'ultimo anno noto (raccomandato)?
8. Licenze aperte dall'11 novembre (R45, R69, R71, R48): si confermano?
9. Esecutore del programma Python nell'app con `tauri-plugin-shell` (raccomandato)?
10. OCR su Windows: chiuso per ora (raccomandato)?
11. Aggiornamenti firmati: GitHub Releases di un repository pubblico senza codice (raccomandato)?
