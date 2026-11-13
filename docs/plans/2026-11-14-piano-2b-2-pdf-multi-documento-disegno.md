# Piano 2b-2: PDF con più documenti (disegno)

Stato: **bozza da approvare da Carlo** (14 novembre 2026), comprese le «Mie scelte». Specifica di riferimento: `docs/spec.md` (sezioni 7, 22 e 42; la sezione 22 dice «PDF con più documenti (l'app propone di separarli e chiede conferma)»); piano 2a (`docs/plans/2026-11-11-piano-2a-lettura-pdf.md`) per la pipeline di lettura; disegno 2b-1 (`docs/plans/2026-11-13-piano-2b-ocr-disegno.md`) e regole R86-R90 di `docs/progress.md` per l'OCR; profili in `docs/rules/lettura-pdf.md`. Il piano 2b-3 (condominio) è indipendente da questo.

## Perché

Oggi un file è un documento: `read_pdf` legge tutte le pagine, `extract` sceglie un profilo per l'intero file e ogni campo prende la **prima** occorrenza della sua ancora nel file intero (`_read_field`). Se un PDF contiene due bollette, o una fattura seguita da un avviso o da un allegato, succede questo:

- si propone **una** bolletta sola; la seconda non entra mai nel conguaglio;
- l'importo, la scadenza e il numero vengono dalla prima bolletta, ma il controllo di concordanza guarda tutte le occorrenze: se le due bollette hanno importi diversi il campo scende a `medium`, se hanno lo stesso importo resta `high` e il documento può risultare `riconosciuta` con un solo record per due spese;
- il periodo `combine: span` (acqua) unisce gli intervalli di tutte le pagine: con due bollette dell'acqua nello stesso file il periodo copre entrambe, ed è sbagliato;
- la regola di duplicato del core (`findBillDuplicate`) considera `duplicate` ogni bolletta con lo stesso `fileHash`: anche se l'utente inserisse a mano la seconda bolletta dallo stesso file, verrebbe rifiutata.

Quanti PDF reali sono in questo caso non è noto (vedi «Aperto con Carlo»).

## Obiettivi

1. Da un file si ottengono **N proposte**, una per documento, ognuna con il suo intervallo di pagine, il suo profilo, i suoi campi e il suo stato. Un file con un solo documento dà esattamente il risultato di oggi (un insieme di uno).
2. La divisione è una **proposta**: l'app la mostra e chiede conferma (sezione 22). L'utente può spostare un confine, unire due documenti o dividerne uno a mano.
3. Ogni campo di un documento si legge **solo dalle sue pagine**: niente valore preso dalla bolletta accanto.
4. Ogni documento si registra, si scarta o si annulla per conto suo; il file resta uno, con impronta stabile.
5. Funziona con le pagine lette con l'OCR (`textSource`, `ocrPages`) senza cambiare R86-R90.

## Non obiettivi

- Niente condominio (2b-3): un rendiconto lungo con le spese di tutti i proprietari è **un** documento, non va diviso.
- Niente avviso TARI comune diviso per utenza: resta un documento con `parts` (R3, già fatto).
- Niente interfaccia (la schermata «Da rivedere» è del piano 4): qui solo il core, Python, gli schemi e i test; il disegno dice cosa l'interfaccia dovrà mostrare.
- Niente divisione fisica del file in PDF nuovi in questo piano (vedi «Mie scelte» 2 e la domanda 2).
- Niente riconoscimento di documenti mischiati pagina per pagina (pagine di due bollette alternate): solo documenti contigui.

## Vincoli

- **Un file, N proposte.** L'impronta resta quella dei byte del file (`fileHash`); l'identità di un documento è `(fileHash, firstPage, lastPage)`. Leggere di nuovo lo stesso file con gli stessi profili dà gli stessi intervalli e gli stessi risultati (nessuna casualità, nessun orologio in Python, R86).
- **Nessun dato inventato.** Un confine incerto non diventa mai un valore: un campo che non si legge dalle pagine del suo documento resta `null`/`missing`. Le pagine che non appartengono a nessun documento riconosciuto non spariscono: sono attaccate a un documento e dichiarate (vedi «Disegno»).
- **OCR.** `textSource` e `ocrPages` diventano per documento (sottoinsieme delle pagine del documento); R87 si applica a ogni documento come oggi al file. `ocrAnyOf` (R90) vale solo per un documento letto per intero con l'OCR, come oggi; il limite di 20 pagine OCR (`MAX_OCR_PAGES`) resta per file.
- **Configurazione, non codice.** Ciò che indica l'inizio di un documento per un fornitore sta nel profilo (sezione 7), non in regole nel codice.
- Nessuna regola di calcolo nuova: importi, periodi e riparto restano quelli della sezione 42, per documento.
- Nessun PDF reale e nessun dato personale nel repository; messaggi e avvisi in italiano generico, senza testo del documento.
- Python: nessuna dipendenza nuova (pdfminer.six e jsonschema bastano; pypdfium2 c'è solo su macOS).

## Come si decide dove finisce un documento

Segnali possibili, guardati pagina per pagina: le ancore di riconoscimento del profilo (`recognise.allOf`, `ocrAnyOf`); il numero di fattura letto (`fields.number`); il cambio di fornitore, tipo o categoria tra un profilo e l'altro; gli identificativi (POD, PDR; oggi vuoti in tutti i profili seed); le intestazioni di pagina («Pagina 1 di 4», «pag. 1/4») che ricominciano da 1.

### Approcci considerati

**A. Riconoscimento pagina per pagina.** Si applica `recognises` al testo di ogni pagina e si raggruppano le pagine consecutive riconosciute dallo stesso profilo; un nuovo gruppo comincia dove le ancore ricompaiono dopo una pagina già attribuita.
- Pro: nessun cambio ai profili; trova anche il cambio di fornitore.
- Contro: le ancore di `allOf` sono spesso nel piè di pagina di **ogni** pagina («Hera Comm», «kWh») e a volte sono divise su pagine diverse (una frase a pagina 1, un'altra a pagina 2): divide troppo o non riconosce nessuna pagina da sola. Due bollette consecutive dello stesso fornitore non si separano affatto (stesso profilo su tutte le pagine).

**B. Numero di fattura.** Si leggono i campi del profilo su ogni pagina; un confine cade dove compare un numero di fattura diverso dal precedente.
- Pro: segnale forte quando c'è; usa le regole già scritte nei profili.
- Contro: serve un profilo già scelto; il numero spesso compare solo a pagina 1 (le pagine senza numero vanno attribuite per vicinanza); le ancore generiche (`del`, `Data`, `docs/rules/lettura-pdf.md`) leggono numeri in tabelle di storico o in avvisi di pagamento; con l'OCR il numero spesso manca (R90: 9 scansioni su 9 senza numero). Una lettura sbagliata crea un confine sbagliato, cioè importi sbagliati.

**C. Inizio documento dichiarato nel profilo (raccomandato).** Il profilo dichiara, come configurazione, i testi che stanno solo sulla prima pagina di un suo documento (nuovo campo opzionale `split.startAnyOf`, per esempio l'intestazione «Bolletta n.» del riepilogo o «Pagina 1 di»). Una pagina che contiene uno di quei testi, dopo la pagina 1, apre un nuovo documento. B e il cambio di fornitore restano **controlli**: non creano confini, ma segnalano un dubbio.
- Pro: deterministico, verificabile con fixture, coerente con «profili come configurazione» (sezione 7); un profilo senza `split` si comporta come oggi, quindi nessun cambio per i PDF già letti; si può aggiungere dal costruttore di profili (selezione col mouse) in un piano successivo.
- Contro: funziona solo per i fornitori il cui profilo ha `split`; un fornitore nuovo o un allegato di un altro mittente non si divide da solo (resta la divisione a mano); serve sapere quali testi sono davvero solo di pagina 1 (da controllare sui PDF reali con i soli conteggi).

**D. Solo a mano.** L'app non divide mai; nella revisione l'utente indica le pagine di ogni documento.
- Pro: nessun errore automatico; nessun cambio ai profili.
- Contro: costo per l'utente a ogni file, e un file con più bollette **non viene notato** se l'utente non guarda le pagine: il problema di oggi (una spesa persa) resta.

### Raccomandazione

**C come regola dei confini, B e il cambio di fornitore come controlli, D come correzione sempre disponibile.** In pratica:

1. Si sceglie il profilo sul file intero come oggi (R55, R73), poi si cercano le pagine di inizio con lo `split.startAnyOf` di **tutti** i profili che riconoscono almeno una pagina (così un secondo documento di un altro fornitore apre comunque un confine, se il suo profilo ha `split`).
2. Ogni intervallo tra due inizi è un documento; le pagine prima del primo inizio appartengono al primo documento. Su ogni intervallo si rifanno riconoscimento, scelta del profilo ed estrazione **solo con le sue pagine**.
3. Un intervallo che nessun profilo riconosce (un allegato, un avviso) resta un documento `non-riconosciuta` con le sue pagine, mai scartato in silenzio (scelta da confermare, domanda 3).
4. Controlli del file, per documento: `split-number` (lo stesso numero di fattura letto in due documenti: forse un confine di troppo), `split-supplier` (un documento con pagine riconosciute da fornitori diversi: forse un confine mancante). Un controllo fallito rende il documento `da-confermare`.
5. Senza nessun inizio dopo la pagina 1, un documento solo: il risultato di oggi.

## Cosa cambia nei dati

### Python e riga di comando

- `extract` stampa un **insieme** (`ExtractionSet`, nuovo schema JSON esportato in `docs/schemas/extractionSet.json`): `v`, `engineVersion`, `fileHash`, `fileName`, `pages` (del file), `textSource` e `ocrPages` del file, `documents` (uno o più `ExtractionResult`, in ordine di pagina), `warnings` del file. Sempre un solo JSON su stdout, come oggi; un file `senza-testo` o `illeggibile` è un insieme di un documento con quello stato.
- `ExtractionResult` resta quello di oggi più `pageRange: [firstPage, lastPage]` (da 1, inclusi). `source.page` resta il numero di pagina **del file**, così la revisione evidenzia la pagina giusta. `textSource` e `ocrPages` diventano quelli delle sole pagine del documento; `fileHash` e `fileName` restano quelli del file.
- `Document` (reader) non cambia; si aggiunge una vista ristretta a un intervallo di pagine (righe filtrate, stesso `ocr_pages` filtrato) che `Layout`, `matching_profiles` ed `extract` usano senza saperlo.
- Profilo: campo opzionale `split: { startAnyOf: string[] }` in JSON Schema, Zod e `check_profile_rules`, con le stesse regole di validità di `ocrAnyOf` (stringhe non vuote, senza ripetizioni). Sulle pagine OCR si confronta con `normalize_ocr` (R89), sulle pagine di testo con `normalize`. I casi comuni a Python e Zod vanno in `python/tests/data/profile-cases.json`.

### Zod e core

- `ExtractionSetSchema` in `packages/core/src/extraction.ts`, con le refine: intervalli contigui, senza buchi né sovrapposizioni, da 1 a `pages`; ogni `source.page` e ogni `part.source.page` dentro il `pageRange` del suo documento; `ocrPages` di un documento dentro il suo intervallo; quelle di tutti i documenti uniscono quelle del file. Le refine di oggi su `ExtractionResult` restano per documento.
- `proposalFromExtraction`, `decideRegistration` e `registerProposal` lavorano su un `ExtractionResult` come oggi: si chiamano una volta per documento.
- `Bill` (e gli altri record che hanno già `fileHash`, come le rate TARI): campo opzionale `pages: [first, last]`; assente vale «file intero», quindi i record già scritti restano validi senza migrazione.
- Duplicati (`findBillDuplicate`, `findInstalmentDuplicate`): stesso `fileHash` **e** stesso intervallo è `duplicate`; stesso `fileHash` con intervalli che si sovrappongono è `possible-duplicate` (decide una persona); stesso `fileHash` con intervalli disgiunti non è un duplicato. La regola sui dati (fornitore, numero, periodo, importo) resta.

## Revisione e registrazione

- **Un file, N proposte separate.** «Da rivedere» mostra il file una volta, con l'elenco dei documenti proposti (pagine, fornitore, importo, stato di ciascuno) e i comandi per spostare un confine, unire o dividere. Ogni documento ha la sua schermata di conferma (PDF a sinistra, aperto sulle sue pagine; dati a destra), con i colori di oggi.
- **Stato per documento** (`riconosciuta`, `da-confermare`, `non-riconosciuta`, `senza-testo`) e uno stato del file derivato: «diviso, da confermare» finché la divisione non è confermata, poi «N di M registrati».
- Cambiare un confine a mano rilegge i documenti toccati con lo stesso estrattore e un intervallo imposto (argomento `--pages` della riga di comando): nessun valore viene copiato da una lettura precedente.
- **Registrazione per documento**, ognuna con la sua operazione nel registro, annullabile da sola. Il file si sposta e si rinomina (sezione 22, punto 6, piano futuro) solo quando ogni documento è registrato o scartato; finché uno è aperto resta in `Da_smistare`.
- **Annullamento:** annullare un documento lascia gli altri registrati; il file torna in `Da_smistare` solo se nessun documento resta registrato (scelta da confermare, domanda 4).

## Rischi

- **Documento spezzato male = importi sbagliati.** Un confine di troppo divide una bolletta in due (la seconda metà senza importo o con l'importo di una tabella interna); un confine mancante unisce due bollette (un importo solo, l'altro perso). Per questo **resta sempre `da-confermare`**:
  - ogni documento di un file diviso in due o più, anche se tutti i controlli passano, e mai registrato da solo con la politica di conferma automatica (sezione 22) finché Carlo non decide diversamente (domanda 5);
  - ogni documento con un controllo `split-number` o `split-supplier` fallito;
  - ogni documento `non-riconosciuta` nato da una divisione (un allegato);
  - ogni documento con un campo obbligatorio mancante, come oggi.
- **Falsi inizi.** Un testo di `startAnyOf` che compare anche nelle pagine interne (un rimando «vedi pagina 1») spezza il documento. Mitigazione: i testi si scelgono con i conteggi sui PDF reali e una fixture per ogni profilo con `split` prova che un suo documento di più pagine resta intero.
- **Regressione sui file di un documento.** Un profilo senza `split` non cambia nulla; il test di non regressione rilegge tutte le fixture di `fixtures/pdf/` e confronta i campi con quelli attesi di oggi.
- **Rilettura con profili nuovi.** Se un profilo aggiornato sposta un confine, gli intervalli registrati non coincidono più: la sovrapposizione dà `possible-duplicate`, mai una seconda registrazione silenziosa.
- **OCR.** Su una scansione intera i testi di inizio possono non sopravvivere all'OCR (come le frasi di `allOf`, R89): la scansione resta un documento solo e si divide a mano.

## Test (solo fixture sintetiche o anonimizzate)

- **Python, unità:** vista ristretta di un `Document` (righe, pagine, `ocr_pages`); ricerca degli inizi con `normalize` e `normalize_ocr`; una sola pagina di inizio, nessuna, inizio a pagina 1, due inizi consecutivi (documento di una pagina).
- **Python, documenti composti:** dump sintetici fatti unendo due o tre fixture di `fixtures/pdf/` (già anonimizzate, con numeri inventati) e rinumerando le pagine: due bollette dello stesso fornitore; due fornitori diversi; bolletta più allegato non riconosciuto; bolletta più scansione (`mixed`, con `ocrPages` per documento e R87 per documento); due bollette con lo stesso importo (oggi `high` per errore, poi due documenti); acqua con due periodi (oggi uniti, poi separati). Per ognuno: intervalli attesi, campi attesi per documento, stato atteso.
- **Falsi positivi:** un testo di inizio dentro una pagina interna; lo stesso numero di fattura in due documenti (`split-number`); un documento con pagine di due fornitori senza inizio (`split-supplier`).
- **Non regressione:** le 17 fixture di oggi danno un insieme di un documento con gli stessi valori, confidenze e stati.
- **Riga di comando:** `extract` su un PDF sintetico di più pagine generato nei test (testo inventato) stampa un `ExtractionSet` valido per JSON Schema; `--pages` rilegge un intervallo; stessa corsa due volte, stessi byte in uscita.
- **Zod e JSON Schema:** casi comuni in un file di casi (come `profile-cases.json`) per `ExtractionSet`: intervalli con buchi, sovrapposti, fuori dal file, `source.page` fuori dal suo intervallo, `ocrPages` incoerenti.
- **Core:** duplicati con lo stesso `fileHash` e intervalli uguali, sovrapposti, disgiunti, assenti; registrazione di due documenti dello stesso file; annullamento di uno dei due; politica di conferma che non registra da sola un documento di un file diviso. Tutto anche con `TZ=Pacific/Auckland` e `TZ=America/Los_Angeles`; copertura del core almeno 90%.
- **PDF reali:** solo conteggi con `python/tools/pdf_report.py` (numero di file con più documenti proposti, per fornitore), nessun testo copiato; poi un campione controllato a mano da Carlo.

## Mie scelte (da controllare)

Le decido io per poter scrivere il piano; Carlo può correggerle.

1. **Approccio C** (inizio dichiarato nel profilo), con B e il cambio di fornitore come controlli e la divisione a mano sempre possibile. Nessuna regola generica nel codice: anche «Pagina 1 di» si usa solo se un profilo lo dichiara.
2. **Divisione virtuale.** Il file resta uno e i record portano l'intervallo di pagine; nessun PDF nuovo. Motivi: l'impronta resta quella del file ricevuto, nessuna dipendenza per scrivere PDF (pypdfium2 c'è solo su macOS), annullamento semplice. Se Carlo vuole file separati (domanda 2), cambiano nome dei file, impronte e annullamento.
3. **Allegato non riconosciuto = documento a parte** `non-riconosciuta`, che l'utente scarta o registra a mano; non viene attaccato in silenzio alla bolletta prima.
4. **Lo schema dei profili cambia in modo compatibile** (`split` opzionale): i profili seed non lo hanno finché i conteggi sui PDF reali non dicono quali fornitori ne hanno bisogno.
5. **`ExtractionResult` resta `v: 1`** con `pageRange` obbligatorio: non è un record salvato, e Python e Zod cambiano insieme. `ExtractionSet` nasce con `v: 1`.
6. **Limite:** al massimo 30 documenti per file (parametro); oltre, un documento solo e l'avviso «troppi documenti, dividere a mano».

## Lasciato al costruttore

Il nome esatto dei controlli e degli avvisi; la forma della vista ristretta del `Document`; il formato dell'argomento `--pages`; il nome del file di casi comuni per `ExtractionSet`.

## Non verificato

- Quanti PDF reali contengono più documenti e di che tipo: nessun PDF reale è stato aperto per questo disegno. Il conteggio si fa dopo, con `pdf_report.py` e i soli numeri, in sola lettura (domanda 1).
- Quali testi stanno davvero solo sulla prima pagina dei documenti di ciascun fornitore.
- Se le bollette arrivano anche come file con pagine di due appartamenti diversi (in quel caso conta anche la verifica dell'appartamento per documento, sezione 22, punto 3).

## Aperto con Carlo

Solo le domande che cambiano il disegno.

1. **Quanti e quali?** Conosci file reali con più documenti? Di che tipo: più bollette dello stesso fornitore, fornitori diversi, bolletta più avviso o allegato? Posso contarli con il rapporto in sola lettura (solo numeri) sulle cartelle in Dropbox? Se sono pochi o nessuno, basta la divisione a mano (approccio D) e il piano si riduce molto.
2. **Divisione virtuale o file separati?** La sezione 22 dice «propone di separarli»: ti basta che il file resti uno con N registrazioni (intervallo di pagine), o vuoi N PDF in `Bollette/<Tipo>/<anno>/`, ognuno col suo nome? La seconda strada richiede una libreria per scrivere PDF anche su Windows (licenza da verificare).
3. **Allegati:** un avviso o un allegato non riconosciuto va proposto come documento a parte da scartare (mia scelta 3), o attaccato alla bolletta che lo precede?
4. **Annullamento:** annullare un documento di un file diviso deve annullare solo quello (mia scelta) o tutto il file?
5. **Conferma:** un documento di un file diviso va sempre confermato a mano, anche quando il fornitore è già confermato e tutti i controlli passano (mia proposta), o dopo la prima conferma di una divisione può registrarsi da solo come le bollette normali? È una regola della politica di conferma: la decidi tu.
