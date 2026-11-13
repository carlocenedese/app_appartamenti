# Piano 2b-2: PDF con più documenti (disegno)

Stato: **approvato da Carlo il 14 novembre 2026 nelle risposte alle domande aperte; il disegno resta da rileggere nel suo insieme.** Priorità **bassa**: quasi tutti i PDF reali contengono una sola bolletta. Specifica di riferimento: `docs/spec.md` (sezioni 7, 22 e 42; la sezione 22 dice «PDF con più documenti (l'app propone di separarli e chiede conferma)»); piano 2a (`docs/plans/2026-11-11-piano-2a-lettura-pdf.md`) per la pipeline di lettura; disegno 2b-1 (`docs/plans/2026-11-13-piano-2b-ocr-disegno.md`) e regole R86-R90 di `docs/progress.md` per l'OCR; profili in `docs/rules/lettura-pdf.md`. Il piano 2b-3 (condominio) è indipendente da questo.

## Perché

Oggi un file è un documento: `read_pdf` legge tutte le pagine, `extract` sceglie un profilo per l'intero file e ogni campo prende la **prima** occorrenza della sua ancora nel file intero (`_read_field`). Se un PDF contiene due bollette, o una fattura seguita da un avviso o da un allegato, succede questo:

- si propone **una** bolletta sola; la seconda non entra mai nel conguaglio;
- l'importo, la scadenza e il numero vengono dalla prima bolletta, ma il controllo di concordanza guarda tutte le occorrenze: se le due bollette hanno importi diversi il campo scende a `medium`, se hanno lo stesso importo resta `high` e il documento può risultare `riconosciuta` con un solo record per due spese;
- il periodo `combine: span` (acqua) unisce gli intervalli di tutte le pagine: con due bollette dell'acqua nello stesso file il periodo copre entrambe, ed è sbagliato;
- la regola di duplicato del core (`findBillDuplicate`) considera `duplicate` ogni bolletta con lo stesso `fileHash`: anche se l'utente inserisse a mano la seconda bolletta dallo stesso file, verrebbe rifiutata.

Il caso è raro (decisione 1): per questo il piano è diviso in due fasi e la seconda si fa solo se i casi veri la richiedono.

## Decisioni di Carlo (14 novembre 2026)

1. **Caso raro, priorità bassa.** Quasi tutti i PDF reali sono associati a una sola bolletta. Primo passo: **divisione a mano** e modello dati (fase 1). La divisione automatica con `split.startAnyOf` (approccio C) resta la scelta per la **fase 2**, da fare solo se i casi veri lo richiedono.
2. **Un solo file con N registrazioni per intervallo di pagine.** Nessun PDF separato, quindi nessuna libreria per scrivere PDF.
3. **Allegato non riconosciuto:** si propone come documento a parte, con una domanda di revisione per quel documento con cui Carlo dice che cosa è.
4. **Annullamento:** l'app offre entrambe le opzioni, «annulla solo questo documento» e «annulla tutto il file».
5. **Registrazione automatica:** un documento di un file diviso **può registrarsi da solo** se ha alta confidenza, con la politica di conferma di oggi (sezione 22). Restano `da-confermare` i documenti con un controllo fallito, con confidenza non alta o non riconosciuti. Ogni documento registrato da un file diviso porta una **nota** che lo dice e una **proprietà intrinseca, il tipo di documento** (`documentKind`), con cui filtrare nella barra di ricerca.

## Obiettivi

1. Da un file si ottengono **N proposte**, una per documento, ognuna con il suo intervallo di pagine, il suo profilo, i suoi campi e il suo stato. Un file con un solo documento dà esattamente il risultato di oggi (un insieme di uno).
2. **Fase 1:** l'utente divide il file a mano nella revisione (indica le pagine di ogni documento); ogni documento si rilegge solo con le sue pagine. **Fase 2 (solo se serve):** l'app propone la divisione da sola e chiede conferma (sezione 22); l'utente può spostare un confine, unire o dividere.
3. Ogni campo di un documento si legge **solo dalle sue pagine**: niente valore preso dalla bolletta accanto.
4. Ogni documento si registra, si scarta o si annulla per conto suo, oppure si annulla tutto il file; il file resta uno, con impronta stabile.
5. Ogni documento ha un tipo (`documentKind`) e, se viene da un file diviso, una nota automatica; il tipo si può usare come filtro nella ricerca.
6. Funziona con le pagine lette con l'OCR (`textSource`, `ocrPages`) senza cambiare R86-R90.

## Non obiettivi

- Niente condominio (2b-3): un rendiconto lungo con le spese di tutti i proprietari è **un** documento, non va diviso.
- Niente avviso TARI comune diviso per utenza: resta un documento con `parts` (R3, già fatto).
- Niente interfaccia (la schermata «Da rivedere» e la barra di ricerca sono di un piano futuro dell'interfaccia): qui solo il core, Python, gli schemi e i test; il disegno scrive i requisiti per l'interfaccia.
- Niente divisione fisica del file in PDF nuovi (decisione 2).
- Niente riconoscimento di documenti mischiati pagina per pagina (pagine di due bollette alternate): solo documenti contigui.
- Fase 2 non inclusa nel primo piano di esecuzione.

## Vincoli

- **Un file, N proposte.** L'impronta resta quella dei byte del file (`fileHash`); l'identità di un documento è `(fileHash, firstPage, lastPage)`. Leggere di nuovo lo stesso file con gli stessi intervalli e gli stessi profili dà gli stessi risultati (nessuna casualità, nessun orologio in Python, R86).
- **Nessun dato inventato.** Un campo che non si legge dalle pagine del suo documento resta `null`/`missing`. Le pagine che non appartengono a nessun documento riconosciuto non spariscono: formano un documento di tipo `unknown` (decisione 3).
- **OCR.** `textSource` e `ocrPages` diventano per documento (sottoinsieme delle pagine del documento); R87 si applica a ogni documento come oggi al file. `ocrAnyOf` (R90) vale solo per un documento letto per intero con l'OCR, come oggi; il limite di 20 pagine OCR (`MAX_OCR_PAGES`) resta per file.
- **Configurazione, non codice.** Ciò che indica l'inizio di un documento per un fornitore (fase 2) sta nel profilo (sezione 7), non in regole nel codice.
- Nessuna regola di calcolo nuova: importi, periodi e riparto restano quelli della sezione 42, per documento.
- Nessun PDF reale e nessun dato personale nel repository; messaggi, avvisi e note in italiano generico, senza testo del documento.
- Python: nessuna dipendenza nuova (pdfminer.six e jsonschema bastano).

## Come si decide dove finisce un documento

Segnali possibili, guardati pagina per pagina: le ancore di riconoscimento del profilo (`recognise.allOf`, `ocrAnyOf`); il numero di fattura letto (`fields.number`); il cambio di fornitore, tipo o categoria tra un profilo e l'altro; gli identificativi (POD, PDR; oggi vuoti in tutti i profili seed); le intestazioni di pagina («Pagina 1 di 4», «pag. 1/4») che ricominciano da 1.

### Approcci considerati

**A. Riconoscimento pagina per pagina.** Si applica `recognises` al testo di ogni pagina e si raggruppano le pagine consecutive riconosciute dallo stesso profilo; un nuovo gruppo comincia dove le ancore ricompaiono dopo una pagina già attribuita.

- Pro: nessun cambio ai profili; trova anche il cambio di fornitore.
- Contro: le ancore di `allOf` sono spesso nel piè di pagina di **ogni** pagina («Hera Comm», «kWh») e a volte sono divise su pagine diverse: divide troppo o non riconosce nessuna pagina da sola. Due bollette consecutive dello stesso fornitore non si separano affatto.

**B. Numero di fattura.** Si leggono i campi del profilo su ogni pagina; un confine cade dove compare un numero di fattura diverso dal precedente.

- Pro: segnale forte quando c'è; usa le regole già scritte nei profili.
- Contro: serve un profilo già scelto; il numero spesso compare solo a pagina 1; le ancore generiche (`del`, `Data`) leggono numeri in tabelle di storico o in avvisi di pagamento; con l'OCR il numero spesso manca (R90: 9 scansioni su 9 senza numero). Una lettura sbagliata crea un confine sbagliato, cioè importi sbagliati.

**C. Inizio documento dichiarato nel profilo.** Il profilo dichiara, come configurazione, i testi che stanno solo sulla prima pagina di un suo documento (campo opzionale `split.startAnyOf`). Una pagina che contiene uno di quei testi, dopo la pagina 1, apre un nuovo documento. B e il cambio di fornitore restano **controlli**: non creano confini, ma segnalano un dubbio.

- Pro: deterministico, verificabile con fixture, coerente con «profili come configurazione» (sezione 7); un profilo senza `split` si comporta come oggi.
- Contro: funziona solo per i fornitori il cui profilo ha `split`; serve sapere quali testi sono davvero solo di pagina 1 (da contare sui PDF reali).

**D. Solo a mano.** L'app non divide mai da sola; nella revisione l'utente indica le pagine di ogni documento.

- Pro: nessun errore automatico; nessun cambio ai profili; poco codice.
- Contro: un file con più bollette **non viene notato** se nessuno guarda le pagine (resta il rischio di una spesa persa); costo per l'utente a ogni file diviso.

### Scelta: D in fase 1, C in fase 2

Con un caso raro (decisione 1) il costo di D è basso, e il modello dati che D richiede (intervalli di pagine, insieme di risultati, duplicati per intervallo) è lo stesso che serve a C. Quindi:

- **Fase 1 (questo piano):** D. La riga di comando accetta un intervallo imposto (`--pages`); la divisione la fa l'utente, la lettura è automatica su ogni intervallo.
- **Fase 2 (solo se i casi veri la richiedono):** C come regola dei confini, B e il cambio di fornitore come controlli (`split-number`, `split-supplier`), D sempre disponibile per correggere. Procedura: si sceglie il profilo sul file intero come oggi (R55, R73); si cercano le pagine di inizio con lo `split.startAnyOf` di tutti i profili che riconoscono almeno una pagina; ogni intervallo tra due inizi è un documento (le pagine prima del primo inizio vanno nel primo); su ogni intervallo si rifanno riconoscimento, scelta del profilo ed estrazione solo con le sue pagine; senza inizi dopo la pagina 1, un documento solo. Il campo `split` si aggiunge ai profili solo per i fornitori dei casi veri.

**Aiuto per notare un file con più documenti già in fase 1 (senza dividere):** quando le occorrenze dell'ancora di importo o di numero portano valori diversi, oggi il campo scende già a `medium` e il documento va in revisione; in fase 1 si aggiunge l'avviso costante «il file potrebbe contenere più documenti» in quel caso, così la revisione lo mostra. Non cambia stato né confidenza (lo fa già la regola di oggi).

## Cosa cambia nei dati (fase 1)

### Python e riga di comando

- `extract` stampa un **insieme** (`ExtractionSet`, nuovo schema JSON esportato in `docs/schemas/extractionSet.json`): `v`, `engineVersion`, `fileHash`, `fileName`, `pages` (del file), `textSource` e `ocrPages` del file, `documents` (uno o più `ExtractionResult`, in ordine di pagina), `warnings` del file. Sempre un solo JSON su stdout, come oggi. Senza `--pages` l'insieme ha un documento che copre tutto il file; un file `senza-testo` o `illeggibile` è un insieme di un documento con quello stato.
- `--pages 1-2,3-4,5` (intervalli contigui da 1 all'ultima pagina, senza buchi) legge ogni intervallo come documento a sé: riconoscimento, scelta del profilo ed estrazione solo con le sue pagine. Il file si legge una volta sola (anche l'OCR).
- `ExtractionResult` resta quello di oggi più `pageRange: [firstPage, lastPage]` (da 1, inclusi) e `documentKind` (sotto). `source.page` resta il numero di pagina **del file**, così la revisione evidenzia la pagina giusta. `textSource` e `ocrPages` diventano quelli delle sole pagine del documento; `fileHash` e `fileName` restano quelli del file.
- `Document` (reader) non cambia; si aggiunge una vista ristretta a un intervallo di pagine (righe filtrate, `ocr_pages` filtrato) che `Layout`, `matching_profiles` ed `extract` usano senza saperlo.
- Fase 2: campo opzionale del profilo `split: { startAnyOf: string[] }` in JSON Schema, Zod e `check_profile_rules`, con le regole di validità di `ocrAnyOf`; confronto con `normalize_ocr` (R89) sulle pagine OCR e `normalize` sulle pagine di testo; casi comuni in `python/tests/data/profile-cases.json`.

### Tipo di documento (`documentKind`)

- **Valori:** `bill` (bolletta), `tari` (avviso TARI), `unknown` (sconosciuto). Nell'interfaccia: «bolletta», «avviso TARI», «sconosciuto». Il codice usa i nomi inglesi come `kind` dei profili; un tipo nuovo (per esempio quelli del condominio, piano 2b-3) si aggiunge all'elenco.
- **Come si valorizza:** dal `kind` del profilo che riconosce il documento (`bill` o `tari`); `unknown` quando nessun profilo lo riconosce (`non-riconosciuta`, `senza-testo`, `illeggibile`). Quando Carlo risponde alla domanda di revisione di un documento `unknown` e lo registra a mano come bolletta o rata TARI, il record prende il tipo scelto.
- **Dove vive:** nell'`ExtractionResult` di ogni documento (sempre presente) e nei record registrati da un documento, nel nuovo campo opzionale `fileDocument` di `Bill` e delle rate TARI (`Instalment`):
  `fileDocument: { pages: [first, last], documentCount, documentKind }`. Assente vale «file intero, un solo documento», quindi i record già scritti restano validi senza migrazione. È una proprietà intrinseca del record: non si ricalcola, si scrive alla registrazione.
- **Ricerca (requisito per il piano dell'interfaccia):** la barra di ricerca deve permettere di filtrare per tipo di documento (`documentKind`) e per «da un file con più documenti» (`documentCount` maggiore di 1), anche insieme agli altri filtri; i documenti `unknown` ancora in «Da rivedere» compaiono con il filtro «sconosciuto». Il core espone una funzione pura che filtra i record per questi due criteri, così l'interfaccia non deve conoscere la forma del campo.

### Nota automatica sul record

Come la nota dell'avviso TARI (`tari-note.ts`), è un testo generato dal core e non un record `note` (che è scritto da una persona; Carlo può comunque aggiungerne una). Si genera per ogni record con `fileDocument` e `documentCount` maggiore di 1, dai campi del record e dagli altri documenti dello stesso file (stesso `fileHash`). Esempio (inventato): «Documento 2 di 3 dello stesso file, pagine 3-4. Nel file anche: bolletta, pagine 1-2; sconosciuto, pagina 5.» Compare dove compare la nota TARI (revisione, dettaglio del record).

### Zod e core

- `ExtractionSetSchema` in `packages/core/src/extraction.ts`, con le refine: intervalli contigui, senza buchi né sovrapposizioni, da 1 a `pages`; ogni `source.page` e ogni `part.source.page` dentro il `pageRange` del suo documento; `ocrPages` di un documento dentro il suo intervallo, e quelle di tutti i documenti uniscono quelle del file; `documentKind` `unknown` se e solo se nessun profilo è scelto. Le refine di oggi su `ExtractionResult` restano per documento.
- `proposalFromExtraction`, `decideRegistration` e `registerProposal` lavorano su un `ExtractionResult` come oggi: si chiamano una volta per documento, e scrivono `fileDocument` nel record quando l'insieme ha più di un documento.
- Duplicati (`findBillDuplicate`, `findInstalmentDuplicate`): stesso `fileHash` **e** stesso intervallo è `duplicate`; stesso `fileHash` con intervalli che si sovrappongono è `possible-duplicate` (decide una persona); stesso `fileHash` con intervalli disgiunti non è un duplicato. Un record senza `fileDocument` copre tutto il file. La regola sui dati (fornitore, numero, periodo, importo) resta.

## Revisione e registrazione

- **Un file, N proposte separate.** «Da rivedere» mostra il file una volta, con l'elenco dei documenti (pagine, tipo, fornitore, importo, stato di ciascuno) e i comandi per dividere, spostare un confine o unire (fase 1: solo a mano). Cambiare la divisione rilegge i documenti toccati con `--pages`: nessun valore viene copiato da una lettura precedente. Ogni documento ha la sua schermata di conferma (PDF a sinistra, aperto sulle sue pagine; dati a destra), con i colori di oggi.
- **Stato per documento** (`riconosciuta`, `da-confermare`, `non-riconosciuta`, `senza-testo`, `illeggibile`) e uno stato del file derivato: «N di M documenti registrati».
- **Registrazione per documento** con la politica di conferma di oggi (decisione 5): un documento `riconosciuta` con tutti i campi ad alta confidenza e i controlli superati si registra da solo, come una bolletta di un file normale; gli altri vanno in revisione. Ogni registrazione è un'operazione a sé nel registro.
- **Documento sconosciuto** (decisione 3): una domanda di revisione per quel documento, «Che cosa è questo documento (pagine x-y)?», con le risposte: bolletta o avviso TARI da inserire a mano (il record prende quel tipo), oppure allegato del documento accanto senza spesa da registrare. Nel secondo caso non nasce nessun record; la risposta resta nel registro delle operazioni e il documento compare come «sconosciuto, allegato» nella nota automatica degli altri documenti del file.
- **Spostamento e nome del file** (sezione 22, punto 6, piano futuro): il file si sposta solo quando ogni documento è registrato o risolto; finché uno è aperto resta in `Da_smistare`.
- **Annullamento** (decisione 4): due comandi. «Annulla solo questo documento» annulla l'operazione di quel documento e lascia gli altri registrati; «annulla tutto il file» annulla le operazioni di tutti i documenti del file (stesso `fileHash`), una per una con `undoOperation`, e rimette il file in `Da_smistare`. Il file torna in `Da_smistare` anche quando l'ultimo documento registrato viene annullato da solo.

## Rischi

- **Documento spezzato male = importi sbagliati.** Un confine di troppo divide una bolletta in due (la seconda metà senza importo o con l'importo di una tabella interna); un confine mancante unisce due bollette (un importo solo, l'altro perso). Con la registrazione automatica dei documenti ad alta confidenza (decisione 5) la difesa sta nei controlli. Resta **sempre `da-confermare`**:
  - ogni documento con un campo non `high` o un campo obbligatorio mancante, come oggi (la metà spezzata di una bolletta di solito non ha l'importo, o lo ha da un'ancora diversa e quindi `medium`);
  - ogni documento con un controllo fallito, compresi in fase 2 `split-number` e `split-supplier`;
  - ogni documento `unknown`, che ha in più la domanda di revisione.
- **Rischio residuo da tenere presente:** un confine sbagliato che lascia da entrambe le parti campi letti `high` registra due record senza revisione. In fase 1 i confini li mette una persona, quindi il rischio nasce solo in fase 2; la fase 2 deve avere una fixture per ogni profilo con `split` che prova che un suo documento di più pagine resta intero.
- **Bollette perse in fase 1.** Senza divisione automatica, un file con due bollette dello stesso importo resta un documento solo `high` e può registrarsi da solo con una bolletta sola (come oggi). L'avviso «il file potrebbe contenere più documenti» copre solo il caso di valori discordanti. Caso raro (decisione 1); se compare nei fatti, è il motivo per fare la fase 2.
- **Regressione sui file di un documento.** Senza `--pages` (e, in fase 2, senza `split` nel profilo) nulla cambia; il test di non regressione rilegge tutte le fixture di `fixtures/pdf/` e confronta i campi con quelli attesi di oggi.
- **Rilettura con profili nuovi.** Se una nuova divisione sposta un confine, gli intervalli registrati non coincidono più: la sovrapposizione dà `possible-duplicate`, mai una seconda registrazione silenziosa.
- **OCR.** Su una scansione intera i testi di inizio (fase 2) possono non sopravvivere all'OCR (come le frasi di `allOf`, R89): la scansione resta un documento solo e si divide a mano.

## Test (solo fixture sintetiche o anonimizzate)

Fase 1:

- **Python, unità:** vista ristretta di un `Document` (righe, pagine, `ocr_pages`); `--pages` con intervalli validi e non validi (buchi, sovrapposizioni, fuori dal file, ordine sbagliato: codice 2 e messaggio costante).
- **Python, documenti composti:** dump sintetici fatti unendo due o tre fixture di `fixtures/pdf/` (già anonimizzate, con numeri inventati) e rinumerando le pagine, letti con gli intervalli giusti: due bollette dello stesso fornitore; due fornitori diversi; bolletta più allegato non riconosciuto (`documentKind` `unknown`); bolletta più scansione (`mixed`, `ocrPages` per documento e R87 per documento); due bollette con lo stesso importo (letto per intero è `high` e un documento solo; diviso, due documenti); acqua con due periodi (uniti per intero, separati divisi). Per ognuno: campi, stato e `documentKind` attesi per documento; per la lettura senza divisione, l'avviso «più documenti» dove i valori discordano.
- **Non regressione:** le 17 fixture di oggi danno un insieme di un documento con gli stessi valori, confidenze e stati.
- **Riga di comando:** `extract` su un PDF sintetico di più pagine generato nei test (testo inventato) stampa un `ExtractionSet` valido per JSON Schema, con e senza `--pages`; stessa corsa due volte, stessi byte in uscita.
- **Zod e JSON Schema:** casi comuni in un file di casi (come `profile-cases.json`) per `ExtractionSet`: intervalli con buchi, sovrapposti, fuori dal file, `source.page` fuori dal suo intervallo, `ocrPages` incoerenti, `documentKind` incoerente col profilo.
- **Core:** duplicati con lo stesso `fileHash` e intervalli uguali, sovrapposti, disgiunti, assenti; registrazione di due documenti dello stesso file, uno da solo (alta confidenza) e uno in revisione; `fileDocument` scritto solo con più documenti; nota automatica (testo atteso, documento sconosciuto risolto come allegato); filtro per `documentKind` e per file con più documenti; «annulla solo questo documento» e «annulla tutto il file», e il ritorno del file in `Da_smistare` quando non resta nessun documento registrato. Tutto anche con `TZ=Pacific/Auckland` e `TZ=America/Los_Angeles`; copertura del core almeno 90%.

Fase 2 (se si fa): ricerca degli inizi con `normalize` e `normalize_ocr`; inizio a pagina 1, nessuno, due consecutivi; falsi positivi (testo di inizio in una pagina interna, stesso numero in due documenti, due fornitori senza inizio); per ogni profilo con `split` una fixture di più pagine che resta intera.

**PDF reali:** solo conteggi con `python/tools/pdf_report.py` (per esempio il numero di file con l'avviso «più documenti», per fornitore), nessun testo copiato; un campione lo controlla a mano Carlo.

## Mie scelte (da controllare)

Le decido io per poter scrivere il piano; Carlo può correggerle.

1. **Nessuna regola generica nel codice per gli inizi**, nemmeno «Pagina 1 di»: in fase 2 si usa solo se un profilo lo dichiara.
2. **Nome e valori del tipo:** `documentKind` con `bill`, `tari`, `unknown`, e il campo `fileDocument` sui record (sezione «Tipo di documento»).
3. **Allegato risolto senza spesa:** nessun record nuovo; resta nel registro delle operazioni e nella nota automatica degli altri documenti del file.
4. **Avviso «più documenti» in fase 1** solo quando le occorrenze di importo o numero discordano; non cambia stato né confidenza.
5. **`ExtractionResult` resta `v: 1`** con `pageRange` e `documentKind` obbligatori: non è un record salvato, e Python e Zod cambiano insieme. `ExtractionSet` nasce con `v: 1`.
6. **Limite:** al massimo 30 documenti per file (parametro); oltre, `--pages` è rifiutato con un messaggio costante.

## Lasciato al costruttore

Il nome esatto dei controlli e degli avvisi; la forma della vista ristretta del `Document`; il formato preciso di `--pages`; il nome del file di casi comuni per `ExtractionSet`; il testo esatto della nota automatica e della domanda di revisione.

## Non verificato

- Quanti PDF reali contengono più documenti e di che tipo: Carlo dice che sono rari (decisione 1); nessun PDF reale è stato aperto per questo disegno. Un conteggio con l'avviso «più documenti» si può fare dopo la fase 1, con i soli numeri.
- Quali testi stanno davvero solo sulla prima pagina dei documenti di ciascun fornitore (serve solo per la fase 2).
- Se esistono file con pagine di due appartamenti diversi (in quel caso conta anche la verifica dell'appartamento per documento, sezione 22, punto 3).

## Aperto con Carlo

Nessuna domanda che blocchi la fase 1. Da decidere più avanti, solo se la fase 1 mostra file con più documenti non notati: **se e quando fare la fase 2** (divisione automatica con `split.startAnyOf`).
