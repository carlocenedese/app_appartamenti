# Piano 2b-2: PDF con più documenti (disegno)

Stato: **approvato da Carlo il 14 novembre 2026 (fase 1 snella).** Priorità **bassa**: quasi tutti i PDF reali contengono una sola bolletta. Specifica di riferimento: `docs/spec.md` (sezioni 7, 22 e 42; la sezione 22 dice «PDF con più documenti (l'app propone di separarli e chiede conferma)»); piano 2a (`docs/plans/2026-11-11-piano-2a-lettura-pdf.md`) per la pipeline di lettura; disegno 2b-1 (`docs/plans/2026-11-13-piano-2b-ocr-disegno.md`) e regole R86-R90 di `docs/progress.md` per l'OCR, con R92 (ramo `fix/ocr-senza-ancore-seed`); profili in `docs/rules/lettura-pdf.md`. Il piano 2b-3 (condominio) è indipendente da questo.

## Perché

Oggi un file è un documento: `read_pdf` legge tutte le pagine, `extract` sceglie un profilo per l'intero file e ogni campo prende la **prima** occorrenza della sua ancora nel file intero (`_read_field`). Se un PDF contiene due bollette, o una fattura seguita da un avviso o da un allegato, succede questo:

- si propone **una** bolletta sola; la seconda non entra mai nel conguaglio;
- l'importo, la scadenza e il numero vengono dalla prima bolletta, ma il controllo di concordanza guarda tutte le occorrenze: se le due bollette hanno importi diversi il campo scende a `medium`, se hanno lo stesso importo resta `high` e il documento può risultare `riconosciuta` con un solo record per due spese;
- il periodo `combine: span` (acqua) unisce gli intervalli di tutte le pagine: con due bollette dell'acqua nello stesso file il periodo copre entrambe, ed è sbagliato;
- la regola di duplicato del core (`findBillDuplicate`, `packages/core/src/dedupe.ts`) considera `duplicate` ogni bolletta con lo stesso `fileHash`: la seconda bolletta dello stesso file non si può registrare, nemmeno a mano.

Il caso è raro (decisione 1): per questo la fase 1 è la più piccola che rende possibile registrare ogni documento di un file, e la divisione automatica è la fase 2, da fare solo se i casi veri la richiedono.

## Decisioni di Carlo (14 novembre 2026)

1. **Caso raro, priorità bassa.** Quasi tutti i PDF reali sono associati a una sola bolletta. Fase 1 snella: avviso, un intervallo di pagine per lettura, duplicati per intervallo, tipo di documento e nota. La divisione automatica con `split.startAnyOf` (approccio C) è la **fase 2**, solo se i casi veri la richiedono.
2. **Un solo file con N registrazioni per intervallo di pagine.** Nessun PDF separato, quindi nessuna libreria per scrivere PDF.
3. **Allegato non riconosciuto:** si propone come documento a parte, con una domanda di revisione per quel documento con cui Carlo dice che cosa è.
4. **Annullamento:** l'app offre entrambe le opzioni, «annulla solo questo documento» e «annulla tutto il file».
5. **Registrazione automatica:** un documento di un file diviso **può registrarsi da solo** se ha alta confidenza, con la politica di conferma di oggi (sezione 22). Restano `da-confermare` i documenti con un controllo fallito, con confidenza non alta o non riconosciuti. Ogni documento registrato da un file diviso porta una **nota** che lo dice e un **tipo di documento** (`documentKind`) con cui filtrare nella barra di ricerca.
6. **Fase 1 snella** (seconda risposta del 14 novembre 2026): `--pages` con un solo intervallo per chiamata; `extract` stampa ancora **un** `ExtractionResult` (forma dell'uscita invariata) con in più `pageRange` e `documentKind`; `ExtractionSet`, controlli fra documenti e divisione in un'unica lettura passano alla fase 2.
7. **Conferme di pagamento e note esplicative** non sono mai bollette: sempre `unknown` e `non-riconosciuta`. «Se succedesse dovrai flaggarle come non riconosciute» (Carlo).

## Campione di Carlo (14 novembre 2026)

Delle dieci scansioni reali controllate a mano da Carlo nessuna è una bolletta attuale: 4 preventivi o rendiconti condominiali, 1 conferma di pagamento TARI, 4 note o scarti, 1 Enel del 2020. Solo conteggi: nessun testo copiato. Conta per questo piano per due motivi: un file «strano» spesso non è una bolletta (decisione 7), e i documenti condominiali vanno al piano 2b-3, non divisi qui.

## Obiettivi (fase 1)

1. Un file con più documenti si legge una volta per documento, con l'intervallo di pagine scelto dall'utente: ogni campo si legge **solo dalle pagine del suo documento**.
2. Ogni documento si registra per conto suo: la seconda bolletta di un file non è più un duplicato.
3. Un file che probabilmente contiene più documenti si nota in revisione (avviso).
4. Ogni documento ha un tipo (`documentKind`) e, se viene da un file con più documenti, una nota automatica.
5. Si annulla un documento solo o tutto il file.
6. Funziona con le pagine lette con l'OCR (`textSource`, `ocrPages`) senza cambiare R86-R90 e R92.

## Non obiettivi

- Niente divisione automatica, `ExtractionSet` o controlli fra documenti (fase 2).
- Niente condominio (2b-3): un preventivo o un rendiconto è **un** documento, non va diviso.
- Niente avviso TARI comune diviso per utenza: resta un documento con `parts` (R3, già fatto).
- Niente interfaccia (la schermata «Da rivedere» e la barra di ricerca sono di un piano futuro dell'interfaccia): qui solo il core, Python, gli schemi e i test; il disegno scrive i requisiti per l'interfaccia.
- Niente divisione fisica del file in PDF nuovi (decisione 2).
- Niente documenti mischiati pagina per pagina: solo documenti contigui.

## Vincoli

- **Un file, N registrazioni.** L'impronta resta quella dei byte del file (`fileHash`); l'identità di un documento è `(fileHash, firstPage, lastPage)`. Stesso file, stesso intervallo, stessi profili: stesso risultato (nessuna casualità, nessun orologio in Python, R86).
- **Nessun dato inventato.** Un campo che non si legge dalle pagine del suo documento resta `null`/`missing`. Le pagine che nessun profilo riconosce formano un documento di tipo `unknown` (decisione 3), mai scartato in silenzio.
- **OCR.** `textSource` e `ocrPages` sono quelli delle pagine dell'intervallo; R87 si applica al documento come oggi al file. `ocrAnyOf` (R90) vale per un documento letto per intero con l'OCR; dal 14 novembre 2026 i profili seed non ne hanno (R92, ramo `fix/ocr-senza-ancore-seed`), il meccanismo non cambia. Il limite di 20 pagine OCR (`MAX_OCR_PAGES`) vale per chiamata.
- **Configurazione, non codice.** Ciò che indica l'inizio di un documento (fase 2) o che esclude un tipo di documento (decisione 7) sta nei profili (sezione 7).
- Nessuna regola di calcolo nuova: importi, periodi e riparto restano quelli della sezione 42, per documento.
- Nessun PDF reale e nessun dato personale nel repository; messaggi, avvisi e note in italiano generico, senza testo del documento.
- Python: nessuna dipendenza nuova.

## Come si decide dove finisce un documento

Segnali possibili, guardati pagina per pagina: le ancore di riconoscimento del profilo (`recognise.allOf`, `ocrAnyOf`); il numero di fattura letto (`fields.number`); il cambio di fornitore, tipo o categoria; gli identificativi (POD, PDR; oggi vuoti in tutti i profili seed); le intestazioni di pagina («Pagina 1 di 4») che ricominciano da 1.

### Approcci considerati

**A. Riconoscimento pagina per pagina.** Si applica `recognises` a ogni pagina e si raggruppano le pagine consecutive dello stesso profilo.

- Pro: nessun cambio ai profili; trova il cambio di fornitore.
- Contro: le ancore di `allOf` sono spesso nel piè di pagina di **ogni** pagina e a volte divise su pagine diverse: divide troppo o non riconosce nessuna pagina da sola. Due bollette consecutive dello stesso fornitore non si separano.

**B. Numero di fattura.** Un confine cade dove compare un numero di fattura diverso dal precedente.

- Pro: segnale forte quando c'è; usa le regole già scritte.
- Contro: serve un profilo già scelto; il numero spesso compare solo a pagina 1; le ancore generiche (`del`, `Data`) leggono numeri in tabelle di storico; con l'OCR il numero spesso manca (R90: 8 scansioni riconosciute su 9 senza numero, conteggio rifatto il 14 novembre 2026). Una lettura sbagliata crea un confine sbagliato, cioè importi sbagliati.

**C. Inizio documento dichiarato nel profilo.** Il profilo dichiara i testi che stanno solo sulla prima pagina di un suo documento (`split.startAnyOf`); una pagina che ne contiene uno, dopo la pagina 1, apre un nuovo documento. B e il cambio di fornitore restano controlli.

- Pro: deterministico, verificabile con fixture, configurazione (sezione 7); un profilo senza `split` si comporta come oggi.
- Contro: solo per i fornitori il cui profilo ha `split`; serve sapere quali testi sono davvero solo di pagina 1.

**D. Solo a mano.** L'utente indica le pagine di ogni documento; la lettura di ogni intervallo è automatica.

- Pro: nessun errore automatico sui confini; nessun cambio ai profili; poco codice.
- Contro: un file con più bollette va notato da qualcuno (l'avviso aiuta, non copre tutto); costo per l'utente a ogni file diviso.

### Scelta: D in fase 1, C in fase 2

Con un caso raro il costo di D è basso, e quello che D richiede (lettura per intervallo, duplicati per intervallo, tipo e nota) serve anche a C.

- **Fase 1 (questo piano):** D, più l'avviso.
- **Fase 2 (solo se i casi veri la richiedono):** C come regola dei confini, B e il cambio di fornitore come controlli (`split-number`, `split-supplier`), D per correggere. Porta con sé `ExtractionSet` (tutti i documenti di un file in una sola lettura, con le refine fra documenti: intervalli contigui senza buchi, `source.page` e `ocrPages` dentro il proprio intervallo) e il campo `split` dei profili, solo per i fornitori dei casi veri.

## Cosa cambia (fase 1)

### Avviso

Quando le occorrenze dell'ancora di importo o di numero portano valori diversi (oggi il campo scende già a `medium`), il risultato ha l'avviso costante «Il file potrebbe contenere più documenti.» Non cambia stato né confidenza: lo fa già la regola di oggi. La revisione lo mostra accanto al comando per dividere.

### Python e riga di comando

- `extract --pages a-b` (un solo intervallo, da 1 a `pages`, `a` non oltre `b`) legge solo quelle pagine: riconoscimento, scelta del profilo ed estrazione come oggi, ma su una vista ristretta del `Document` (righe e `ocr_pages` filtrati) che `Layout`, `matching_profiles` ed `extract` usano senza saperlo. Un intervallo non valido dà codice 2 e un messaggio costante.
- `extract` stampa ancora **un** `ExtractionResult`, con in più `pageRange: [firstPage, lastPage]` (da 1, inclusi) e `documentKind`. Senza `--pages` il risultato è quello di oggi con `pageRange` `[1, pages]`. `source.page` resta il numero di pagina **del file**; `pages`, `fileHash` e `fileName` restano quelli del file; `textSource` e `ocrPages` sono quelli dell'intervallo.
- L'app chiama `extract` una volta per documento. **Il file si rilegge a ogni chiamata, anche l'OCR delle pagine scansionate:** costo accettato perché il caso è raro. La lettura unica è della fase 2.

### Tipo di documento (`documentKind`)

- **Valori:** `bill` (bolletta), `tari` (avviso TARI), `unknown` (sconosciuto); nell'interfaccia «bolletta», «avviso TARI», «sconosciuto». Un tipo nuovo (per esempio del condominio, piano 2b-3) si aggiunge all'elenco.
- **Come si valorizza:** dal `kind` del profilo scelto; `unknown` quando nessun profilo è scelto (`non-riconosciuta`, `senza-testo`, `illeggibile`). Quando Carlo risponde alla domanda di revisione di un documento `unknown` e lo registra a mano come bolletta o rata TARI, il record prende il tipo scelto.
- **Conferme di pagamento e note esplicative** (decisione 7) sono sempre `unknown`: oggi nessun profilo le riconosce. Se un profilo ne riconoscesse una, la correzione è un testo in `recognise.noneOf` di quel profilo (configurazione, non codice), con una fixture sintetica che lo prova.
- **Dove vive:** nell'`ExtractionResult` (sempre) e nel record registrato, nel campo opzionale `fileDocument: { pages: [first, last], documentKind }` di `Bill` e delle rate TARI (`Instalment`). Si scrive solo per un documento che non copre tutto il file; assente vale «file intero», quindi i record già scritti restano validi senza migrazione.
- **Ricerca (requisito per il piano dell'interfaccia):** la barra di ricerca deve permettere di filtrare per tipo di documento e per «da un file con più documenti» (più record con lo stesso `fileHash`, o un record con `fileDocument`), insieme agli altri filtri. La funzione di filtro si scrive in quel piano (Mie scelte 3).

### Nota automatica sul record

Come la nota dell'avviso TARI (`tari-note.ts`), è un testo generato dal core e non un record `note` (che è scritto da una persona). Si genera per ogni record con `fileDocument`, dai suoi campi e dagli altri record con lo stesso `fileHash` (da cui si ricava quanti documenti del file sono registrati). Esempio inventato: «Documento delle pagine 3-4 di un file con più documenti. Registrati dallo stesso file anche: bolletta, pagine 1-2.» Compare dove compare la nota TARI.

### Duplicati

`findBillDuplicate` e `findInstalmentDuplicate`: stesso `fileHash` **e** stesso intervallo è `duplicate`; stesso `fileHash` con intervalli sovrapposti è `possible-duplicate` (decide una persona); stesso `fileHash` con intervalli disgiunti non è un duplicato. Un record senza `fileDocument` copre tutto il file (quindi si sovrappone a ogni intervallo). La regola sui dati (fornitore, numero, periodo, importo) resta. `registerProposal` scrive `fileDocument` quando `pageRange` non copre tutto il file.

## Revisione e registrazione (requisiti per l'interfaccia, fase 1)

- **Dividere a mano.** Sul file in «Da rivedere» l'utente indica le pagine di ogni documento; l'app chiama `extract --pages` per ognuno e mostra un documento per riga (pagine, tipo, fornitore, importo, stato). Ogni documento ha la sua schermata di conferma (PDF aperto sulle sue pagine, dati a destra), con i colori di oggi.
- **Registrazione per documento** con la politica di conferma di oggi (decisione 5): un documento `riconosciuta` con tutti i campi ad alta confidenza e i controlli superati si registra da solo; gli altri vanno in revisione. Ogni registrazione è un'operazione a sé nel registro.
- **Documento sconosciuto** (decisione 3): una domanda di revisione per quel documento, «Che cosa è questo documento (pagine x-y)?»: bolletta o avviso TARI da inserire a mano (il record prende quel tipo), oppure allegato senza spesa. Nel secondo caso non nasce nessun record; la risposta resta nel registro delle operazioni.
- **Spostamento e nome del file** (sezione 22, punto 6, piano futuro): il file si sposta solo quando ogni documento è registrato o risolto.
- **Annullamento** (decisione 4): «annulla solo questo documento» annulla l'operazione di quel documento e lascia gli altri; «annulla tutto il file» chiama `undoOperation` su ogni documento registrato con lo stesso `fileHash`, uno per uno, e rimette il file in `Da_smistare`. Il file torna in `Da_smistare` anche quando si annulla da solo l'ultimo documento registrato.

## Rischi

- **Confine sbagliato = importi sbagliati.** In fase 1 i confini li mette una persona; un confine di troppo lascia una metà di bolletta senza importo o con un importo letto da un'ancora diversa (`medium`), uno mancante dà l'avviso se i valori discordano. Resta **sempre `da-confermare`**: ogni documento con un campo non `high` o un campo obbligatorio mancante, con un controllo fallito, o `unknown` (che ha in più la domanda di revisione).
- **Bollette perse in fase 1.** Un file con due bollette dello stesso importo e numero non dà l'avviso, resta un documento `high` e può registrarsi da solo con una bolletta sola (come oggi). Caso raro (decisione 1); se compare nei fatti, è il motivo per fare la fase 2.
- **Documento non bolletta preso per bolletta.** Una conferma di pagamento o una nota riconosciuta da un profilo darebbe una spesa inesistente: la difesa è `noneOf` nel profilo (decisione 7) e il campione di Carlo, che oggi non ne mostra nessuna riconosciuta.
- **Costo della rilettura.** Ogni intervallo rilegge il file (OCR compreso): accettato per la rarità.
- **Regressione.** Senza `--pages` nulla cambia tranne `pageRange` e `documentKind`; il test di non regressione rilegge tutte le fixture di `fixtures/pdf/`.
- **Rilettura con intervalli diversi.** Un intervallo che si sovrappone a uno registrato dà `possible-duplicate`, mai una seconda registrazione silenziosa.
- **Fase 2** (se si fa): un confine automatico sbagliato con campi `high` da entrambe le parti registrerebbe due record senza revisione; per ogni profilo con `split` servirà una fixture di più pagine che resta intera.

## Test (fase 1, solo fixture sintetiche o anonimizzate)

- **Python:** vista ristretta di un `Document`; `--pages` valido e non valido (fuori dal file, `a` oltre `b`, formato sbagliato: codice 2 e messaggio costante); un dump sintetico fatto unendo due fixture di `fixtures/pdf/` (già anonimizzate, numeri inventati) e rinumerando le pagine, letto per intero (avviso «più documenti», campi `medium`) e per intervallo (due documenti con i valori attesi); bolletta più allegato non riconosciuto (`unknown`, `non-riconosciuta`); un intervallo di pagine OCR (`textSource` e `ocrPages` dell'intervallo, R87); `documentKind` per `bill`, `tari` e `unknown`; una conferma di pagamento sintetica non riconosciuta da nessun profilo seed.
- **Non regressione:** le 17 fixture di oggi danno gli stessi valori, confidenze e stati, con `pageRange` `[1, pages]`.
- **Zod e JSON Schema:** `pageRange` dentro `[1, pages]`, `source.page` e `ocrPages` dentro `pageRange`, `documentKind` `unknown` se e solo se nessun profilo è scelto; i casi comuni in un file di casi come `profile-cases.json`.
- **Core:** duplicati con lo stesso `fileHash` e intervalli uguali, sovrapposti, disgiunti, assenti; registrazione della seconda bolletta di un file; `fileDocument` scritto solo per un intervallo parziale; nota automatica (testo atteso); «annulla solo questo documento» e «annulla tutto il file», con il file di nuovo in `Da_smistare`. Anche con `TZ=Pacific/Auckland` e `TZ=America/Los_Angeles`; copertura del core almeno 90%.
- **PDF reali:** solo conteggi con `python/tools/pdf_report.py` (file con l'avviso «più documenti», per fornitore), nessun testo copiato.

## Mie scelte (da controllare)

1. **`fileDocument` ridotto a `{ pages, documentKind }`**, senza `documentCount`: senza `ExtractionSet` l'app non conosce il numero di documenti al momento della registrazione, e la nota lo ricava dai record con lo stesso `fileHash`. Si scrive solo per un intervallo parziale.
2. **Nessuna regola generica nel codice per gli inizi**, nemmeno «Pagina 1 di»: in fase 2 solo se un profilo lo dichiara.
3. **Filtro di ricerca rimandato al piano dell'interfaccia**: il criterio «da un file con più documenti» richiede di raggruppare i record per `fileHash`, che è lavoro della ricerca e non del core di questa fase.
4. **Allegato risolto senza spesa:** nessun record nuovo; resta nel registro delle operazioni.
5. **`ExtractionResult` resta `v: 1`** con `pageRange` e `documentKind` obbligatori nell'uscita: non è un record salvato, e Python e Zod cambiano insieme.

## Lasciato al costruttore

Il formato preciso di `--pages`; la forma della vista ristretta del `Document`; il testo esatto della nota automatica e della domanda di revisione; il nome del file di casi comuni.

## Non verificato

- Quanti PDF reali contengono più documenti: rari secondo Carlo; nessun PDF reale è stato aperto per questo disegno. Il conteggio dell'avviso si fa dopo la fase 1, con i soli numeri.
- Quali testi stanno solo sulla prima pagina dei documenti di ciascun fornitore (serve solo per la fase 2).
- Se esistono file con pagine di due appartamenti diversi (conterebbe la verifica dell'appartamento per documento, sezione 22, punto 3).

## Aperto con Carlo

Nessuna domanda che blocchi la fase 1. Più avanti, solo se l'avviso o i casi veri mostrano file con più documenti non notati: **se e quando fare la fase 2**.
