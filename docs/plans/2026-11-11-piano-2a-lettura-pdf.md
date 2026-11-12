# App Bollette: Piano 2a, lettura delle bollette in PDF di testo

> **Per gli agenti che eseguono:** SOTTO-SKILL OBBLIGATORIA: usare superpowers:subagent-driven-development (consigliata) oppure superpowers:executing-plans per eseguire il piano task per task. I passi usano la sintassi con casella `- [ ]`.

**Obiettivo:** dato il PDF di una bolletta con testo, proporre un record (importo, periodo, scadenza, numero, data di emissione, consumo) con la sicurezza di ogni campo, applicare i controlli e la politica di conferma, e registrarlo con annullamento; il tutto verificato sulle bollette reali di Hera, Enel, Fastweb e TARI.

**Architettura:** un programma Python a riga di comando (un PDF per volta, JSON su stdout) legge il testo con le coordinate e lo confronta con i profili dei fornitori, che sono record JSON di configurazione. Il core TypeScript (puro, come nel piano 1) definisce gli schemi di profilo e risultato, costruisce la proposta, esegue i controlli, decide se registrare da solo e registra con il registro delle operazioni. Python viene incorporato nell'installer come interprete autonomo.

**Stack tecnologico:** TypeScript strict, Vitest, Zod 4 (come il piano 1); Python 3.13 con pdfminer.six (MIT) e jsonschema (MIT), test con `unittest`; interprete autonomo *python-build-standalone* incorporato in Tauri; GitHub Actions.

**Specifica:** `docs/spec.md` (sezioni 7, 8, 22, 28, 30, 40 e 42) e il disegno approvato `docs/plans/2026-11-11-piano-2a-disegno.md`. Fuori da questo piano: OCR, condominio, PDF con più documenti (piano 2b), la schermata «Da rivedere» (piano 4), lo spostamento e il nome del file, l'osservazione della cartella `Da_smistare`.

## Metodo di esecuzione

- Il repository è `carlocenedese/app_appartamenti`; si lavora su un ramo per fase, mai su `main`, con pull request a fine fase e la CI completa (Ubuntu, Windows, macOS). Il clone sta fuori da Dropbox e da iCloud.
- Si segue superpowers:subagent-driven-development, come nel piano 1: un agente nuovo per task, un revisore per task, correzioni fino a 5 giri, revisione finale del ramo; registro in `.superpowers/sdd/` (escluso da git) e riassunto in `docs/progress.md`. Le decisioni dell'orchestratore sono «Ruling» numerati (si continua da R40).
- **Fase A:** Task 1-11, nessun dato reale. **Fase B:** Task 12, con Carlo presente: legge i PDF reali sul posto, approva profili e fixture. Il Task 12 non parte se le PR della Fase A non sono unite.
- I file reali (PDF, Excel, estratti conto) non entrano mai nel repository: si leggono sul posto dalle cartelle Bollette di Dropbox (sola lettura, nessuna copia); gli output di lavoro vanno nella cartella temporanea della sessione.
- Le regole di lettura che nessun documento decide non si inventano: se manca un caso, l'esecutore si ferma con NEEDS_CONTEXT e l'orchestratore decide o chiede a Carlo.

## Vincoli globali

- Valgono tutti i vincoli globali del piano 1 (centesimi interi con `Cents`; date `YYYY-MM-DD`, mesi `YYYY-MM`; core puro senza rete, `node:*`, orologio, `Math.random()`; calcoli sulle date con interi e UTC; percorsi in NFC e nomi di file validi su Windows; nessuna regola fiscale scritta nel codice; nomi in inglese, interfaccia e messaggi in italiano; TypeScript strict, ESLint, Prettier, copertura del core almeno al 90 %; tre fusi orari; dati reali mai nel repository; nessun dato personale nei log).
- **Python senza rete e senza orologio:** nessun `socket`, `urllib`, `http`, `requests`; l'ora si passa con `--at <data-ora ISO>`; nessun `random`, `uuid`, `datetime.now()`. Un test lo verifica bloccando `socket` durante un'estrazione.
- **Importi in Python:** solo `decimal.Decimal` e interi in centesimi, mai `float`.
- **Python e librerie:** Python 3.13; solo pdfminer.six e jsonschema con le loro dipendenze (tutte con licenza dell'elenco del piano 1: pdfplumber non si usa perché porta Pillow, con licenza MIT-CMU, che non è nell'elenco). Versioni esatte con hash in `python/requirements.txt`, scelte tra quelle pubblicate da almeno due settimane. L'interprete incorporato (PSF-2.0) è ammesso dalla scelta di Python nella sezione 8; il suo elenco di licenze sta in `python/THIRD_PARTY.md`.
- **Programma Python:** si lancia sempre con `python -I -m bollette_pdf`; l'uscita su stdout è un solo documento JSON in UTF-8 (anche su Windows), gli errori vanno su stderr con codice 2 e non contengono mai testo letto dai PDF.
- **Un PDF dà sempre una risposta:** guasto, protetto, senza testo o sconosciuto produce un risultato con il suo `status`, non un'eccezione; mai un valore inventato.
- **Espressioni regolari dei profili:** sottoinsieme comune a Python `re` e a JavaScript: gruppi con numero (mai con nome), niente lookbehind, niente flag in linea.
- I profili e le fixture del repository non contengono codici cliente, POD, PDR, indirizzi, nomi né link: i profili riconoscono per parole chiave; `pnpm data:check` copre anche `python/` e `fixtures/pdf/`.

## Review Focus

1. Importi e date all'italiana: `1.234,56`, `98,46`, `€ 98,46`, `- € 63,00` (nota di credito), `01/09/25`, `1 settembre 2025`; `1,234.56` e date ambigue rifiutate, mai una somma sbagliata in silenzio. Task 3.
2. PDF guasto, protetto da password, vuoto o con una sola pagina bianca: risposta `illeggibile` o `senza-testo`, nessuna eccezione. Task 4 e 6.
3. Un'etichetta che compare più volte con valori diversi (per esempio due «Totale» in pagine diverse): il campo è `medium`, mai `high`; un'etichetta assente dà `missing`, non un valore preso da un altro punto. Task 5.
4. Layout cambiato: se un campo obbligatorio manca o un controllo fallisce, lo stato è `da-confermare` e la registrazione automatica non scatta; con due profili dello stesso fornitore vale quello valido alla data della bolletta. Task 5 e 9.
5. Una bolletta già registrata (stesso numero, stesso file, stesso file riscaricato) non si registra due volte, neanche in automatico. Task 8 e 9.
6. Windows: percorsi con spazi e accenti (NFC e NFD), uscita in UTF-8, ritorni a capo; stessi risultati su Ubuntu, Windows e macOS. Task 4, 6 e 11.
7. Registrazione automatica sempre annullabile e distinguibile nel registro; un fornitore con «conferma sempre» non si registra mai da solo. Task 9.
8. Avviso TARI condiviso: le quote per utenza si leggono e arrivano a `splitSharedDebit` senza che una utenza si perda o si legga due volte. Task 5, 8 e 9.
9. Nessun dato personale: né i log, né i messaggi di errore, né le fixture contengono testo dei PDF. Task 6 e 12.

---

## Struttura dei file

| Percorso | Responsabilità |
| --- | --- |
| `packages/core/src/model.ts` | si aggiungono il record `supplierProfile` e il campo `Bill.consumption` |
| `packages/core/src/extraction.ts` | schema del risultato dell'estrazione (`ExtractionResult`) |
| `packages/core/src/proposal.ts` | dal risultato alla proposta di bolletta o rate TARI, con i controlli e il nome del file |
| `packages/core/src/confirmation.ts` | politica di conferma, conferma del profilo, registrazione e registro |
| `python/bollette_pdf/` | `parse.py`, `reader.py`, `profiles.py`, `extract.py`, `checks.py`, `builder.py`, `__main__.py` |
| `python/tests/`, `python/tools/` | test `unittest`, generatore di PDF sintetici, controllo licenze, rapporto sui PDF reali |
| `python/seed-profiles/` | profili dei fornitori consegnati con l'app (Task 12) |
| `scripts/bundle-python.mjs`, `python/runtime.json` | scarica, verifica e prepara l'interprete incorporato |
| `fixtures/pdf/` | testi estratti dai PDF reali, anonimizzati (Task 12) |

### Task 1: Schemi del profilo e del risultato

**Files:**
- Modify: `packages/core/src/model.ts`, `packages/core/src/schemas-json.ts`, `packages/core/src/index.ts`, `docs/schemas/` (rigenerati con `pnpm schemas:export`), `fixtures/README.md`
- Create: `packages/core/src/extraction.ts`
- Test: `packages/core/test/model.test.ts`, `packages/core/test/extraction.test.ts`, `packages/core/test/schemas-export.test.ts`

**Interfaces:**
- Consumes: `RecordBaseSchema`, `NonEmptyString`, `ISODateSchema`, `CentsSchema`, `BillSchema`, `recordSchemas` (piano 1).
- Produces: `SupplierProfileSchema` (record `supplierProfile`, cartella `_app/dati/supplierProfile/`): `supplier`; `kind: 'bill' | 'tari'`; `category` (le categorie di `Bill`, obbligatoria con `kind: 'bill'`, vietata con `'tari'`); `status: 'bozza' | 'confermato'`; `autoRegister: boolean`; `validFrom: ISODate`, `validTo?: ISODate` (non prima di `validFrom`); `recognise: {allOf: string[] (almeno 1), noneOf: string[]}`; `fields`: mappa parziale con chiavi `number | issueDate | dueDate | period | amount | consumption`, ciascuna `{required: boolean; rules: Rule[] (almeno 1)}`, con `Rule = {anchor: string; position: 'same-line' | 'right' | 'below'; pattern: string; valueType: 'euro' | 'date' | 'date-range' | 'text' | 'quantity'; group: number (intero ≥ 0, predefinito 1)}` (`date-range` solo per `period`, `euro` per `amount`, `quantity` per `consumption`, `date` per le due date); `identifiers: {kind: 'pod' | 'pdr' | 'customer'; pattern: string}[]`; `parts?: {pattern: string}` (gruppo 1 etichetta, gruppo 2 importo; solo con `kind: 'tari'`); `items?: {pattern: string}` (gruppo 1 importo di una voce). Ogni `pattern` deve compilare come espressione regolare JavaScript e rispettare il sottoinsieme dei vincoli globali.
- Produces: `Bill.consumption?: {quantity: string; unit: string}` (quantità decimale come testo con il punto, per esempio `"123.4"`).
- Produces: `ExtractionResultSchema` (esportato come `extractionResult` da `exportJsonSchemas`) con `v: 1`, `engineVersion`, `fileHash` (SHA-256 esadecimale, 64 caratteri), `fileName`, `pages`, `status: 'riconosciuta' | 'da-confermare' | 'non-riconosciuta' | 'senza-testo' | 'illeggibile'`, `profileId` e `profileRev` (o `null`), `kind` e `category` (o `null`), `fields` con un campo facoltativo per ciascuno di `supplier`, `number` (valore: testo), `issueDate`, `dueDate`, `periodStart`, `periodEnd` (valore: `ISODate`), `amount` (valore: `Cents`) e `consumption` (valore: `{quantity: string; unit: string}`); ogni campo è `ExtractedField<T> = {value: T | null; confidence: 'high' | 'medium' | 'missing'; source: {page: number; box: [number, number, number, number]; text: string} | null}`, `parts: {label: string; amount: Cents; source}[]`, `identifiers: {kind: 'pod' | 'pdr' | 'customer'; value: string}[]`, `checks: {code: string; ok: boolean; message: string}[]`, `warnings: string[]`. Tipi esportati: `SupplierProfile`, `ExtractionResult`, `ExtractedField`.

- [ ] **Step 1: Test.** Un profilo valido di bolletta e uno di TARI si leggono; `kind: 'bill'` senza `category`, `kind: 'tari'` con `category`, `validTo` prima di `validFrom`, `allOf` vuoto, un `pattern` che non compila, un `pattern` con gruppo con nome o lookbehind, `valueType` incoerente con il campo (`euro` su `dueDate`), `parts` con `kind: 'bill'` e un campo `fields.unknown` sono rifiutati. `BillSchema` accetta `consumption` e il vecchio JSON senza il campo. Un `ExtractionResult` completo, uno `senza-testo` con `fields: {}` e uno con `value: null` e `confidence: 'missing'` sono validi; un `fileHash` di 63 caratteri, un `status` sconosciuto e un campo `amount` non intero sono rifiutati. `recordSchemas` contiene `supplierProfile`; `exportJsonSchemas()` contiene `supplierProfile` ed `extractionResult`; i file in `docs/schemas/` sono quelli generati (il test esistente li confronta byte per byte).
- [ ] **Step 2: Eseguire**, verificare il fallimento.
- [ ] **Step 3: Implementare** gli schemi nei file indicati (profilo e `consumption` in `model.ts`, risultato in `extraction.ts`); regola di compilazione dei `pattern` come `refine` con `new RegExp`; `z.partialRecord` per `fields`; rigenerare `docs/schemas/`; aggiungere a `fixtures/README.md` una nota su `fixtures/pdf/` e `python/seed-profiles/`.
- [ ] **Step 4: Eseguire** `pnpm lint && pnpm typecheck && pnpm test`, atteso verde.
- [ ] **Step 5: Commit** `feat(core): schemi del profilo fornitore e del risultato di estrazione`.

### Task 2: Pacchetto Python, dipendenze, CI e controllo licenze

**Files:**
- Create: `python/pyproject.toml`, `python/requirements.txt`, `python/bollette_pdf/__init__.py`, `python/bollette_pdf/schemas.py`, `python/tools/check_licenses.py`, `python/README.md`, `python/THIRD_PARTY.md`
- Modify: `.github/workflows/ci.yml`, `package.json` (script `python:test` e `python:licenses`), `CLAUDE.md`
- Test: `python/tests/test_schemas.py`, `python/tests/test_check_licenses.py`

**Interfaces:**
- Consumes: i file di `docs/schemas/` (Task 1), `tools/anonymise.py`.
- Produces: `bollette_pdf.__version__: str` (`"0.1.0"`); `bollette_pdf.schemas.validate(kind: str, document: object) -> list[str]` (elenco di messaggi d'errore, vuoto se valido; `kind` è il nome del file senza `.json`; cerca `<kind>.json` nell'ordine in: `BOLLETTE_SCHEMAS_DIR`, la cartella `schemas/` dentro il pacchetto (così com'è nell'installer, Task 10), `docs/schemas/` risalendo dal pacchetto fino alla radice del repository); `python/tools/check_licenses.py` (legge i metadati delle distribuzioni installate con `importlib.metadata` e fallisce se una licenza non è nell'elenco del piano 1; stampa solo nomi e licenze dei pacchetti).

- [ ] **Step 1: Test.** `validate('supplierProfile', profilo_valido)` restituisce `[]`; con un campo mancante restituisce almeno un messaggio che nomina il campo; `validate('extractionResult', …)` idem; un `kind` sconosciuto lancia `KeyError`. `check_licenses` con distribuzioni finte: una MIT passa, una GPL e una senza licenza falliscono, `Apache-2.0 OR BSD-3-Clause` passa se almeno un'alternativa è ammessa.
- [ ] **Step 2: Eseguire** `python3 -I -m unittest discover -s python/tests`, verificare il fallimento.
- [ ] **Step 3: Implementare.** `pyproject.toml` con `requires-python = ">=3.13"` e le due dipendenze; `requirements.txt` con versioni esatte e hash (generato con `pip-compile --generate-hashes`, strumento solo di sviluppo, non incorporato); `ci.yml`: passo per installare Python 3.13 (azione fissata per SHA come le altre), `pip install --require-hashes -r python/requirements.txt`, `pnpm python:test` e `pnpm python:licenses` su tutti i sistemi dove gira la CI; `CLAUDE.md`: elenco dei comandi Python e delle regole del pacchetto.
- [ ] **Step 4: Eseguire** i test Python e `pnpm lint && pnpm test`, atteso verde; il job Windows della CI verde.
- [ ] **Step 5: Commit** `feat(python): pacchetto bollette_pdf, dipendenze fissate, CI e controllo licenze`.

### Task 3: Lettura di importi, date e quantità all'italiana

**Files:**
- Create: `python/bollette_pdf/parse.py`
- Test: `python/tests/test_parse.py`

**Interfaces:**
- Produces: `parse_euro(text: str) -> int` (centesimi; accetta `1.234,56`, `98,46`, `€ 98,46`, `- € 63,00`, `-63,00`, `98.46` con esattamente due decimali e senza altri separatori; rifiuta `1,234.56`, `12,3`, `1.2.3`, il vuoto e testo con altre cifre: `ValueError`); `parse_date(text: str) -> str` (ISO; accetta `01/09/2025`, `1/9/25`, `01.09.2025`, `01-09-2025`, `1 settembre 2025`, `1 set 2025`, `1° settembre 2025`; l'anno a due cifre vale 2000+; giorno e mese impossibili o ordine ambiguo con un solo numero ≤ 12 per parte e anno a due cifre non vengono indovinati: il formato è sempre giorno-mese-anno; `ValueError` se la data non esiste); `parse_date_range(text: str) -> tuple[str, str]` (accetta `dal 01/09/2025 al 31/10/2025`, `01/09/2025 - 31/10/2025`, `01.09.2025/31.10.2025`; `ValueError` se la fine precede l'inizio); `parse_quantity(text: str) -> tuple[str, str | None]` (`"123,4 kWh"` → `("123.4", "kWh")`, `"1.234 Smc"` → `("1234", "Smc")`; quantità come testo con il punto).

- [ ] **Step 1: Test** con tabelle di casi: tutti i formati sopra con il loro risultato, `parse_euro('- € 63,00') == -6300`, `parse_euro('1,234.56')` e `parse_euro('12,3')` lanciano `ValueError`, `parse_date('31/02/2026')` lancia, `parse_date('29/02/2024') == '2024-02-29'`, `parse_date_range('dal 31/10/2025 al 01/09/2025')` lancia, nessun risultato è `float` (controllo sul tipo).
- [ ] **Step 2: Eseguire**, verificare il fallimento.
- [ ] **Step 3: Implementare** con `decimal.Decimal` ed espressioni regolari; mesi in italiano completi e abbreviati a tre lettere, senza dipendere dalla lingua del sistema.
- [ ] **Step 4: Eseguire** `python3 -I -m unittest discover -s python/tests`, atteso verde.
- [ ] **Step 5: Commit** `feat(python): lettura di importi, date e quantità all'italiana`.

### Task 4: Lettura del PDF: testo con coordinate, scansioni e PDF guasti

**Files:**
- Create: `python/bollette_pdf/reader.py`, `python/tests/pdfmaker.py`
- Test: `python/tests/test_reader.py`

**Interfaces:**
- Consumes: pdfminer.six.
- Produces: `@dataclass(frozen=True) Word(text: str, page: int, x0: float, top: float, x1: float, bottom: float)` (coordinate in punti dall'angolo in alto a sinistra); `Line(page: int, text: str, words: tuple[Word, ...], x0: float, top: float, x1: float, bottom: float)`; `Document(file_hash: str, file_name: str, pages: int, lines: tuple[Line, ...], has_text: bool)` con `text` (proprietà: tutte le righe unite da `\n`, in NFC); `MIN_TEXT_CHARS = 80`; `class PdfReadError(Exception)`; `read_pdf(path: Path) -> Document` (SHA-256 del file; `has_text` è falso sotto `MIN_TEXT_CHARS` caratteri non bianchi; `PdfReadError` per file non PDF, guasto o protetto da password; il messaggio non contiene testo del file); `dump_document(doc: Document) -> dict` e `load_dump(data: dict) -> Document` (rappresentazione JSON usata dalle fixture del Task 12: righe e parole con coordinate, senza il nome del file); `pdfmaker.make_pdf(path: Path, pages: list[list[tuple[float, float, str]]]) -> None` (scrive un PDF minimo con testo Helvetica nelle posizioni `(x, y, testo)` in punti dall'alto, senza dipendenze; usato da tutti i test e dai PDF sintetici).

- [ ] **Step 1: Test.** Un PDF sintetico con due righe in colonne diverse dà `Word` con le coordinate attese (±1 punto), le righe nell'ordine di lettura e `has_text` vero; un PDF con 20 caratteri dà `has_text` falso; un PDF vuoto (una pagina senza testo) idem; un file di testo rinominato `.pdf` e un PDF troncato lanciano `PdfReadError` con un messaggio che non contiene il contenuto; un PDF cifrato con password (costruito con `pdfmaker`) lancia `PdfReadError`; `dump_document` poi `load_dump` restituisce un `Document` uguale (tranne `file_name`); percorso con spazi e con una lettera accentata (NFC e NFD) legge lo stesso file; due letture dello stesso file danno lo stesso `file_hash`.
- [ ] **Step 2: Eseguire**, verificare il fallimento.
- [ ] **Step 3: Implementare** con `pdfminer.high_level.extract_pages` e le classi di layout (`LTTextLine`, `LTChar`); le coordinate si convertono dall'origine in basso a sinistra a quella in alto a sinistra; le parole si ricavano separando i caratteri sugli spazi.
- [ ] **Step 4: Eseguire** i test Python, atteso verde; su Windows e macOS nella CI.
- [ ] **Step 5: Commit** `feat(python): lettura del PDF con coordinate, scansioni e file guasti`.

### Task 5: Profili e estrazione dei campi

**Files:**
- Create: `python/bollette_pdf/profiles.py`, `python/bollette_pdf/extract.py`, `python/bollette_pdf/checks.py`
- Test: `python/tests/test_profiles.py`, `python/tests/test_extract.py`

**Interfaces:**
- Consumes: `Document` (Task 4), `parse_*` (Task 3), `validate` (Task 2).
- Produces: `load_profiles(directory: Path) -> tuple[list[dict], list[str]]` (legge `*.json`, scarta i record `deleted`, valida ogni profilo con `validate('supplierProfile', …)`; i file rotti o non validi non fermano la lettura: finiscono come avvisi con il solo nome del file); `matching_profiles(doc: Document, profiles: list[dict]) -> list[dict]` (tutte le parole di `allOf` presenti nel testo, nessuna di `noneOf`, senza distinguere maiuscole e spazi ripetuti; dal profilo con `validFrom` più recente al più vecchio); `extract(doc: Document, profiles: list[dict], at: str) -> dict` (un `ExtractionResult` completo tranne `engineVersion` e `fileName`, che aggiunge la riga di comando del Task 6); `run_checks(fields: dict, items_sum: int | None) -> list[dict]` in `checks.py` con i controlli `period-order` (inizio non dopo la fine), `due-after-issue` (scadenza non prima dell'emissione) e `items-sum` (somma delle voci uguale all'importo); ogni controllo ha `code`, `ok` e un `message` in italiano.
- Regole: **ancora** = testo cercato nelle righe, senza distinguere maiuscole né spazi ripetuti. **Posizione** `same-line`: il testo della riga dopo l'ancora; `right`: le parole nella stessa fascia verticale (differenza di `top` minore della metà dell'altezza) a destra dell'ancora, anche di caselle diverse; `below`: la prima riga non vuota sotto l'ancora (al massimo tre righe di distanza) la cui estensione orizzontale si sovrappone a quella dell'ancora. Il `pattern` si applica con `re.search` al testo candidato e `group` sceglie il gruppo; il valore si legge con il `valueType` (`parse_euro`, `parse_date`, `parse_date_range`, testo, `parse_quantity`; per `quantity` il testo del gruppo scelto, per esempio `123,4 kWh`, va a `parse_quantity`, che separa quantità e unità). **Sicurezza:** `high` se la prima regola che dà un valore valido lo dà e ogni altra occorrenza della stessa ancora dà lo stesso valore (o non ce n'è altre); `medium` se le occorrenze danno valori diversi (vale la prima) o il valore viene da una regola successiva alla prima; `missing` se nessuna regola dà un valore valido (`value: null`, `source: null`). **Profilo scelto:** tra i profili che riconoscono il documento, il primo (dal più recente) il cui periodo di validità contiene la data di emissione letta, o `at` se la data non si legge, e che dà tutti i campi obbligatori; se nessuno li dà tutti, `da-confermare` con il profilo più recente. **Stato:** `senza-testo` se `has_text` è falso; `non-riconosciuta` se nessun profilo riconosce il documento; `da-confermare` se manca un campo obbligatorio o un controllo non è `ok`; altrimenti `riconosciuta`. `period` riempie `periodStart` e `periodEnd`; `supplier` è sempre il nome del profilo con sicurezza `high`; `identifiers` e `parts` (TARI) si leggono con le espressioni del profilo su tutto il testo; `items` si somma con `parse_euro`.

- [ ] **Step 1: Test** con PDF sintetici costruiti con `pdfmaker` (importi e date inventati). Un profilo di luce con ancore «Totale da pagare», «Scadenza», «Periodo di fornitura» e «Consumo» legge importo, scadenza, periodo (separato in inizio e fine) e consumo, tutti `high` e con la `source` giusta (pagina e riquadro). `right` legge un valore in una colonna lontana; `below` legge il valore sotto l'etichetta. Due «Totale da pagare» con importi diversi: `amount` è `medium` con il primo valore. Etichetta assente: `missing`, e con il campo obbligatorio lo stato è `da-confermare`. Due profili dello stesso fornitore con `validFrom` diversi: una bolletta del 2025 usa quello del 2025, una del 2023 quello vecchio; senza data di emissione vale `at`. Documento senza `allOf` in comune: `non-riconosciuta`; un PDF con testo breve: `senza-testo` e nessun campo. Voci `items` che sommano all'importo: controllo `items-sum` ok; se non sommano: `da-confermare`. Un profilo di TARI con `parts` legge due utenze `(etichetta, importo)` e nessuna si perde né si legge due volte (Review Focus 8). `load_profiles` salta un file rotto e un profilo non valido senza fermarsi, con un avviso che non cita il contenuto, e salta un profilo con `deleted: true`. Il risultato valida contro `extractionResult` (con i campi del Task 6 aggiunti nel test).
- [ ] **Step 2: Eseguire**, verificare il fallimento.
- [ ] **Step 3: Implementare** le firme e le regole sopra. Il campo `value` di `amount` è l'intero in centesimi; `consumption` è `{quantity, unit}` con unità vuota se manca.
- [ ] **Step 4: Eseguire** i test Python, atteso verde.
- [ ] **Step 5: Commit** `feat(python): profili dei fornitori, estrazione dei campi, sicurezza e controlli`.

### Task 6: Risultato completo e riga di comando

**Files:**
- Create: `python/bollette_pdf/__main__.py`
- Test: `python/tests/test_cli.py`

**Interfaces:**
- Consumes: `read_pdf`, `load_profiles`, `extract`, `validate`.
- Produces: `python -I -m bollette_pdf extract --pdf <file> --profiles <cartella> --at <data-ora ISO>`: stampa su stdout un solo `ExtractionResult` completo (con `v`, `engineVersion` = `__version__`, `fileName` = solo nome del file, `fileHash`, `pages`) validato prima di stamparlo contro `extractionResult` (se non è valido: codice 2, nessun JSON); `python -I -m bollette_pdf --version` stampa la versione. Codici di uscita: 0 per ogni risultato (anche `non-riconosciuta`, `senza-testo`, `illeggibile`); 2 per argomenti mancanti o errati, cartella dei profili inesistente o file PDF inesistente. `status: 'illeggibile'` per un PDF che lancia `PdfReadError`, con `fields: {}` e un avviso in italiano senza contenuto del file.

- [ ] **Step 1: Test** avviando il programma con `subprocess` e `sys.executable -I`: un PDF riconosciuto dà JSON valido, codice 0, stderr vuoto, stdout con un solo documento (`json.loads` su tutto lo stdout); lo stesso con una cartella di profili con un file rotto: risultato valido e il file rotto negli `warnings`; PDF guasto: `illeggibile`, codice 0; `--pdf` inesistente: codice 2 e stderr senza testo di PDF; `--at` non ISO: codice 2; l'uscita è UTF-8 anche con `PYTHONIOENCODING=cp1252` e `PYTHONUTF8=0` (la lettera accentata di un nome fornitore non si rompe); durante un'estrazione `socket.socket` bloccato con una finestra di test non viene mai chiamato; due esecuzioni danno lo stesso JSON byte per byte.
- [ ] **Step 2: Eseguire**, verificare il fallimento.
- [ ] **Step 3: Implementare** con `argparse`; `sys.stdout.reconfigure(encoding='utf-8', newline='\n')` all'avvio; nessun testo dei PDF in `stderr`.
- [ ] **Step 4: Eseguire** i test Python su tutti i sistemi, atteso verde.
- [ ] **Step 5: Commit** `feat(python): riga di comando bollette_pdf con risultato validato`.

### Task 7: Costruzione di un profilo da una selezione di testo

**Files:**
- Create: `python/bollette_pdf/builder.py`
- Modify: `python/bollette_pdf/__main__.py` (sottocomando `build-profile`)
- Test: `python/tests/test_builder.py`

**Interfaces:**
- Consumes: `Document`, `extract`, `validate`.
- Produces: `@dataclass(frozen=True) Selection(page: int, box: tuple[float, float, float, float])`; `build_profile(doc: Document, *, profile_id: str, supplier: str, kind: str, category: str | None, valid_from: str, recognise: list[Selection], fields: dict[str, Selection], now: str) -> dict` (un record `supplierProfile` valido: `status: 'bozza'`, `autoRegister: true`, `rev: 1`; `recognise.allOf` = il testo in minuscolo di ogni selezione di riconoscimento, almeno 3 caratteri; per ogni campo l'ancora è il testo più vicino a sinistra sulla stessa riga (fino a 4 parole) o, se non c'è, la riga sopra con estensione sovrapposta, con la posizione `same-line`, `right` o `below` che riproduce quel rapporto; il `pattern` generalizza la forma del testo selezionato: importo `(-?\s?\d[\d.]*,\d{2})`, data `(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4})`, intervallo di date con i due formati, testo `(\S+(?: \S+)*)` limitato alla riga; `ValueError` se la selezione non contiene testo o non è leggibile con il tipo del campo); sottocomando `python -I -m bollette_pdf build-profile --pdf <file> --spec <file.json> --at <data-ora>`: il file `--spec` è `{"profileId": string, "supplier": string, "kind": "bill" | "tari", "category": string | null, "validFrom": ISODate, "recognise": [{"page": number, "box": [x0, top, x1, bottom]}], "fields": {"<campo>": {"page": number, "box": [...]}}}`; stampa il profilo.

- [ ] **Step 1: Test.** Da un PDF sintetico con «Totale da pagare: 98,46 €», «Scadenza: 10/11/2026», «Periodo: dal 01/09/2026 al 31/10/2026» e il nome del fornitore in testata, `build_profile` con le quattro selezioni dà un profilo valido contro lo schema; `extract` dello stesso PDF con quel profilo restituisce gli stessi valori con `high`; un secondo PDF sintetico con lo stesso layout e valori diversi dà i valori nuovi (il profilo generalizza, non memorizza); una selezione senza testo e una selezione su una data non valida lanciano `ValueError`; il sottocomando stampa un JSON valido e non scrive file.
- [ ] **Step 2: Eseguire**, verificare il fallimento.
- [ ] **Step 3: Implementare** `build_profile`, `shape_pattern(text: str, value_type: str) -> str` e il sottocomando; l'`id` e l'ora arrivano come argomenti.
- [ ] **Step 4: Eseguire** i test Python, atteso verde.
- [ ] **Step 5: Commit** `feat(python): costruzione del profilo da una selezione di testo`.

### Task 8: Proposta e controlli automatici (core)

**Files:**
- Create: `packages/core/src/proposal.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/proposal.test.ts`

**Interfaces:**
- Consumes: `ExtractionResult` (Task 1), `Bill`, `Instalment`, `Tenancy`, `monthsInPeriod`, `splitSharedDebit` (piano 1).
- Produces: `type ProposalCheck = {code: string; severity: 'ok' | 'warn' | 'fail'; message: string}` (messaggi in italiano); `type Proposal = {kind: 'bill'; bill: Omit<Bill, 'fileHash' | 'rev' | 'v'>; checks: ProposalCheck[]; confidence: Record<string, 'high' | 'medium' | 'missing'>} | {kind: 'tari'; instalments: Omit<Instalment, 'fileHash' | 'rev' | 'v'>[]; checks: ProposalCheck[]; confidence: Record<string, 'high' | 'medium' | 'missing'>} | {kind: 'none'; checks: ProposalCheck[]; confidence: Record<string, never>}` (`none` per `non-riconosciuta`, `senza-testo`, `illeggibile`).
- Produces: `proposalFromExtraction(result: ExtractionResult, ctx: ProposalContext, newId: () => string): Proposal` con `ProposalContext = {apartment: {id: string; knownCodes: string[]}; bills: Bill[]; instalments: Instalment[]; tenancies: Tenancy[]; thresholds: {consumptionAnomalyPercent: number}; tariParts?: Record<string, {apartmentId: string}>}` (`tariParts` collega l'etichetta di ogni utenza all'appartamento; la soglia viene dalla configurazione dell'utente, mai dal codice). Controlli: `duplicate-number` (`fail` se esiste una bolletta non cancellata dello stesso appartamento, fornitore e numero), `period-tenancies` (`warn` se un mese del periodo non ha inquilini), `consumption-anomaly` (`warn` se il consumo supera di più della soglia quello della bolletta della stessa categoria che copre gli stessi mesi dell'anno prima; nessun controllo senza storico), `apartment-codes` (`warn` se `knownCodes` non è vuoto e nessun identificatore del risultato coincide), più un controllo `extraction:<code>` per ogni controllo del risultato non `ok` (`fail`); un campo `missing` obbligatorio per il record (`amount`, `periodStart`, `periodEnd`, `supplier`) dà `fail` `missing-field`. Per la TARI condivisa: un `Instalment` per ogni utenza con `shared: {groupId, groupTotal, weight}`, `rateCount` 3, `esercizio` = anno della data di scadenza e `rateIndex` dal mese della scadenza (mesi 1-5: rata 1, `coversFrom/coversTo` gennaio-aprile; 6-9: rata 2, maggio-agosto; 10-12: rata 3, settembre-dicembre), cioè i 4 mesi nuovi dell'avviso come nella sezione 42 R3; se il periodo dichiarato dall'avviso non è esattamente quei 4 mesi (per esempio un periodo cumulativo gennaio-dicembre) si segnala `warn` `tari-months`, quindi un avviso così non si registra mai da solo; la somma dei pesi può non coincidere con il totale (`warn` `parts-total`).
- Produces: `suggestedFilePath(input: {category: string; supplier: string; issueDate: ISODate; periodStart: ISODate; periodEnd: ISODate}): string` (`Bollette/<Tipo>/<anno di emissione>/AAAA-MM-GG_Tipo_Fornitore_Periodo.pdf` come nella sezione 22, in NFC, senza `:` né caratteri vietati da Windows né nomi riservati; il periodo è `AAAAMMGG-AAAAMMGG`).

- [ ] **Step 1: Test.** Una bolletta riconosciuta con tutto ok dà `kind: 'bill'` con importo, date e `consumption` corretti, `confidence` `high` e nessun `fail`. Stesso numero già presente: `duplicate-number` `fail`. Un mese del periodo senza inquilini: `period-tenancies` `warn` (e i mesi con inquilini no). Consumo di +40 % con soglia 30 %: `consumption-anomaly` `warn`; di +10 %: ok; senza storico: nessun controllo. `knownCodes` con un POD che non compare: `apartment-codes` `warn`; con un POD che compare: ok. Un `amount` `missing`: `fail` `missing-field`. `non-riconosciuta`, `senza-testo` e `illeggibile` danno `kind: 'none'`. Un avviso TARI con due utenze (Berchet e Lovarini) dà due `Instalment` con lo stesso `groupId`, `groupTotal` uguale al totale e `weight` per utenza, e le rate si passano a `splitSharedDebit` senza errore; con `tariParts` mancante per un'etichetta: `fail` `unknown-part` (Review Focus 8). `suggestedFilePath` con un fornitore con apostrofo, accento e due punti non produce caratteri vietati e sta in NFC; il risultato non cambia con `TZ` diversi.
- [ ] **Step 2: Eseguire**, verificare il fallimento.
- [ ] **Step 3: Implementare** le firme sopra; `newId` genera gli `id` dei record; nessun orologio.
- [ ] **Step 4: Eseguire** `pnpm lint && pnpm typecheck && pnpm test`, atteso verde.
- [ ] **Step 5: Commit** `feat(core): proposta di bolletta e rate TARI con controlli automatici`.

### Task 9: Politica di conferma e registrazione (core)

**Files:**
- Create: `packages/core/src/confirmation.ts`
- Modify: `packages/core/src/index.ts`, `packages/core/src/dedupe.ts`
- Test: `packages/core/test/confirmation.test.ts`, `packages/core/test/dedupe.test.ts`

**Interfaces:**
- Consumes: `Proposal` (Task 8), `SupplierProfile`, `ExtractionResult`, `registerBill`, `commitChange`, `undoOperation`, `Store`, `recordPath` (piano 1).
- Produces: `decideRegistration(input: {proposal: Proposal; result: ExtractionResult; profile: SupplierProfile | undefined}): {action: 'auto-register' | 'review'; reasons: string[]}` (`auto-register` solo se `profile.status === 'confermato'`, `profile.autoRegister` è vero, `result.status === 'riconosciuta'`, ogni campo è `high` e nessun controllo è `warn` o `fail`; negli altri casi `review` con i motivi in italiano; `kind: 'none'` è sempre `review`).
- Modifica `registerBill` (piano 1, `packages/core/src/dedupe.ts`): un ultimo parametro facoltativo `opts?: {kind?: string}` (predefinito `'bill.register'`) per il `kind` dell'operazione, e `operationId` nel risultato `registered`; i test esistenti non cambiano.
- Produces: `registerProposal(store: Store, input: {proposal: Proposal; result: ExtractionResult; bytes: Uint8Array; profileId: string; mode: 'manual' | 'auto'}, clock: () => string): Promise<{status: 'registered'; ids: string[]; operationId: string} | {status: 'duplicate'; existingId: string} | {status: 'possible-duplicate'; existingId: string} | {status: 'rejected'; reason: string}>` (una bolletta passa da `registerBill`; l'avviso TARI scrive una rata per utenza in una sola operazione con `kind` `'instalment.register'`, e rifiuta come `duplicate` se esiste già una rata con stesso `fileHash`, appartamento e `rateIndex`; l'operazione ha `kind` `'bill.register'` o, con `mode: 'auto'`, `'bill.register-auto'`; con `kind: 'none'` o un `fail` nei controlli e `mode: 'auto'` restituisce `rejected`).
- Produces: `confirmProfile(store: Store, profile: SupplierProfile, profileId: string, clock: () => string): Promise<SupplierProfile>` (porta `status` a `confermato` con `commitChange`, `kind: 'profile.confirm'`; senza effetto se già confermato), `setProfileAutoRegister(store: Store, profile: SupplierProfile, autoRegister: boolean, profileId: string, clock: () => string): Promise<SupplierProfile>` («conferma sempre» per fornitore).

- [ ] **Step 1: Test.** Profilo `bozza`, e profilo `confermato` con `autoRegister` falso: sempre `review` (Review Focus 7). Profilo `confermato` con tutto `high` e controlli `ok`: `auto-register`. Un solo campo `medium` o un controllo `warn`: `review` con il motivo. `registerProposal` con una bolletta registra un record e una operazione `bill.register-auto` nel registro; `undoOperation` la annulla e il record resta `deleted` (la registrazione automatica è sempre annullabile). Lo stesso PDF registrato due volte: `duplicate` e un solo record; lo stesso PDF riscaricato (byte diversi, stessi dati): `possible-duplicate` e nessuna registrazione, anche in modalità automatica (Review Focus 5). Un avviso TARI condiviso scrive due rate (una per appartamento) con una sola operazione e `undoOperation` le annulla entrambe; registrare di nuovo lo stesso avviso: `duplicate`. `confirmProfile` cambia lo stato e scrive una operazione; chiamato due volte non ne scrive un'altra. Una proposta `none` o con `fail` in modalità `auto`: `rejected`.
- [ ] **Step 2: Eseguire**, verificare il fallimento.
- [ ] **Step 3: Implementare** le firme sopra riusando `registerBill` e `commitChange`; nessun orologio, nessun `id` generato dentro la funzione (arrivano dalla proposta).
- [ ] **Step 4: Eseguire** `pnpm lint && pnpm typecheck && pnpm test`, atteso verde con copertura ≥ 90 %.
- [ ] **Step 5: Commit** `feat(core): politica di conferma, conferma del profilo e registrazione di bollette e rate TARI`.

### Task 10: Interprete Python incorporato nell'installer

**Files:**
- Create: `scripts/bundle-python.mjs`, `python/runtime.json`
- Modify: `apps/desktop/src-tauri/tauri.conf.json` (risorse), `.github/workflows/build.yml`, `.gitignore`, `apps/desktop/README.md`, `python/THIRD_PARTY.md`
- Test: `scripts/bundle-python.test.mjs`

**Interfaces:**
- Consumes: `python/requirements.txt` (Task 2).
- Produces: `python/runtime.json`: per ogni sistema che costruisce l'installer (`windows-x86_64`, `macos-aarch64`) `{url, sha256, pythonVersion}` di una distribuzione *python-build-standalone* «install only» per Python 3.13, con l'indirizzo e l'impronta presi dalla pagina delle release del progetto al momento dell'esecuzione (una release pubblicata da almeno due settimane). `scripts/bundle-python.mjs` esporta `pickRuntime(manifest: object, platform: string, arch: string): {url: string; sha256: string}` (lancia se il sistema non c'è), `verifySha256(bytes: Uint8Array, expected: string): void` (lancia se non corrisponde) e `main(): Promise<void>`: scarica nella cartella temporanea, verifica l'impronta prima di estrarre (mai estrarre un file non verificato), estrae in `apps/desktop/src-tauri/resources/python/`, installa `python/requirements.txt` con `--require-hashes --no-deps --target` nella cartella delle librerie, copia `python/bollette_pdf/` e, dentro la copia, `schemas/` con `supplierProfile.json` ed `extractionResult.json` presi da `docs/schemas/`, stampa la dimensione finale. `tauri.conf.json` incorpora `resources/python/` nel pacchetto. `build.yml` esegue lo script prima della build Tauri e, dopo, avvia dall'installazione costruita `python -I -m bollette_pdf --version`; su Windows lo esegue con un percorso con spazi.

- [ ] **Step 1: Test** (`node:test` o Vitest, come gli altri script): `pickRuntime` sceglie per sistema e lancia per uno sconosciuto; `verifySha256` accetta l'impronta giusta e lancia con una sbagliata o con un file vuoto; `main` non estrae nulla se l'impronta non corrisponde (con un finto download); nessun passo di rete nei test.
- [ ] **Step 2: Eseguire**, verificare il fallimento.
- [ ] **Step 3: Implementare** lo script senza dipendenze npm (solo moduli di Node), compilare `runtime.json` con gli indirizzi e le impronte reali, aggiungere a `python/THIRD_PARTY.md` l'elenco delle licenze dell'interprete e dei suoi componenti incorporati, aggiungere `apps/desktop/src-tauri/resources/python/` a `.gitignore`.
- [ ] **Step 4: Eseguire** i test dello script e lanciare `build.yml` a mano (workflow_dispatch) su Windows e macOS: atteso verde, con la dimensione aggiunta all'installer riportata nella pull request.
- [ ] **Step 5: Commit** `feat(desktop): interprete Python incorporato e verificato nell'installer`.

### Task 11: Prova di integrazione tra core e programma Python

**Files:**
- Create: `python/tests/make_sample.py`, `packages/core/test/helpers/python-extract.ts`, `packages/core/test/extract-integration.test.ts`
- Modify: `.github/workflows/ci.yml`, `package.json`
- Test: `packages/core/test/extract-integration.test.ts`

**Interfaces:**
- Consumes: il programma Python (Task 6), `ExtractionResultSchema`, `proposalFromExtraction`, `decideRegistration`, `registerProposal`, `Store` di prova (piano 1).
- Produces: `python/tests/make_sample.py <cartella>` (scrive in `<cartella>` un PDF sintetico di bolletta e un profilo valido, con importi e date inventati); `runExtract(input: {pdf: string; profiles: string; at: string}): Promise<ExtractionResult>` in `helpers/python-extract.ts` (avvia `python -I -m bollette_pdf extract …` con `node:child_process`, usando `python` su Windows e `python3` altrove, o la variabile `PYTHON` se c'è; legge tutto lo stdout, lo valida con `ExtractionResultSchema`; senza Python il test si salta, tranne con `REQUIRE_PYTHON=1`, dove fallisce con un messaggio chiaro; la CI imposta `REQUIRE_PYTHON=1`).

- [ ] **Step 1: Test.** Percorso completo su PDF sintetici in una cartella temporanea: estrazione con il programma Python → `proposalFromExtraction` → `decideRegistration` con profilo `bozza` dà `review`; dopo `confirmProfile` la stessa bolletta con numero nuovo dà `auto-register` e `registerProposal` registra e scrive il registro; l'annullamento ripristina; lo stesso PDF una seconda volta è `duplicate`. Un PDF guasto e uno senza testo dànno `kind: 'none'` e `review`. Un percorso con spazi e accenti funziona. Il risultato non cambia con `TZ=Pacific/Auckland` e `TZ=America/Los_Angeles`.
- [ ] **Step 2: Eseguire**, verificare il fallimento.
- [ ] **Step 3: Implementare** `make_sample.py` (con `pdfmaker`) e l'aiuto di avvio; `ci.yml` installa Python per i test del core e imposta `REQUIRE_PYTHON=1` su tutti i sistemi.
- [ ] **Step 4: Eseguire** `pnpm lint && pnpm typecheck && pnpm test` in locale e la CI su tre sistemi, atteso verde.
- [ ] **Step 5: Commit** `test: integrazione tra il core e il programma Python di lettura dei PDF`.

### Task 12: Profili dei fornitori reali e fixture (Fase B, con Carlo)

Questo task richiede Carlo: servono le bollette vere. Parte solo dopo che le pull request della Fase A sono unite.

**Files:**
- Create: `python/seed-profiles/<fornitore>-<AAAA>.json`, `python/tools/dump_text.py`, `python/tools/pdf_report.py`, `fixtures/pdf/<fornitore>-<NN>.json`, `docs/rules/lettura-pdf.md`
- Test: `python/tests/test_real_layouts.py`

**Interfaces:**
- Consumes: `read_pdf`, `dump_document`, `build_profile`, `extract`, `tools/anonymise.py`.
- Produces: `dump_text.py <file.pdf>` (stampa su stdout `dump_document` in JSON; serve a costruire le fixture); `pdf_report.py --profiles <cartella> <cartella-di-pdf>...` (legge sul posto, ricorsivamente, e stampa solo conteggi per fornitore e stato: `riconosciuta`, `da-confermare`, `non-riconosciuta`, `senza-testo`, `illeggibile`, e per i riconosciuti quanti campi sono `high`; nessun nome di file, importo o testo). `docs/rules/lettura-pdf.md`: per ogni fornitore, il profilo, le etichette usate, i layout visti e i casi dubbi.

- [ ] **Step 1: Raccolta.** Carlo conferma le cartelle (le cartelle Bollette dei tre appartamenti in Dropbox, già individuate); si lavora sul posto, in sola lettura, senza copiare i PDF. Per ogni fornitore (Hera, Enel, Fastweb e l'avviso TARI, compresa la TARI condivisa tra Berchet e Lovarini) si scelgono tre PDF di anni diversi per cogliere i cambi di layout.
- [ ] **Step 2: Profili.** Con `dump_text.py` e `build_profile` si costruisce il profilo di ogni fornitore e lo si rifinisce a mano; ogni profilo ha `status: 'bozza'`, una data di inizio validità per layout e nessun codice cliente, POD, PDR o indirizzo. Per la TARI condivisa il profilo legge le utenze con `parts`.
- [ ] **Step 3: Rapporto sul posto.** `pdf_report.py` sulle cartelle reali: per ogni fornitore e per ogni stato quanti PDF; obiettivo concordato con Carlo: di ogni fornitore, su un campione di dieci PDF controllati a mano, importo, scadenza e periodo letti giusti o segnalati `da-confermare`, mai sbagliati senza avviso. Le differenze finiscono in `docs/rules/lettura-pdf.md` con il motivo; le regole non ricavabili dai PDF si chiedono a Carlo.
- [ ] **Step 4: Fixture.** Per ogni layout si salva `fixtures/pdf/<fornitore>-<NN>.json` con `dump_text.py` e `tools/anonymise.py` (mappa fuori dal repository: nomi, codici cliente, POD/PDR, IBAN, indirizzi, link); `pnpm data:check` deve passare.
- [ ] **Step 5: Test** `test_real_layouts.py`: per ogni fixture, `load_dump` + `extract` con i profili di `python/seed-profiles/` dà lo stato e i valori attesi scritti accanto alla fixture (importo, scadenza, periodo, numero, consumo), compresi due layout dello stesso fornitore e un cambio di layout che porta a `da-confermare`. Nessuna fixture contiene stringhe da IBAN, codice fiscale o POD.
- [ ] **Step 6: Approvazione.** Carlo rilegge `docs/rules/lettura-pdf.md` e i valori attesi delle fixture e li approva; senza approvazione il piano 2a non si chiude.
- [ ] **Step 7: Commit** `docs: profili dei fornitori e fixture di lettura dei PDF`.

## Criteri di completamento del piano 2a

- Tutti i test (TypeScript e Python) verdi su Ubuntu, Windows e macOS, con tre fusi orari; copertura del core almeno al 90 %; lint e tipi puliti; controllo delle licenze verde anche per i pacchetti Python.
- Gli schemi di profilo e risultato sono esportati in `docs/schemas/` e aggiornati.
- Un installer Windows e uno macOS costruiti dalla CI contengono l'interprete Python, e `python -I -m bollette_pdf --version` parte dall'installazione (anche con spazi nel percorso).
- I profili di Hera, Enel, Fastweb e TARI sono approvati da Carlo, con il rapporto sui PDF reali (solo conteggi) e le fixture anonimizzate; nessun PDF e nessun dato personale nel repository (anche nella cronologia).
- Il percorso completo (estrazione, proposta, controlli, conferma del profilo, registrazione automatica e annullamento) è provato in integrazione su PDF sintetici.

## Piani successivi collegati

- **Piano 2b:** scansioni con OCR (acqua), condominio (tabella di ripartizione), PDF con più documenti.
- **Piano 4:** schermata «Da rivedere» e costruzione dei profili col mouse, che usa `build_profile`.
- **Piano 6:** primo avvio che copia i profili di `python/seed-profiles/` tra i dati dell'utente.

## Autocontrollo

- Copertura della specifica: sezione 7 (profili come configurazione, OCR escluso in 2a, creazione dei profili) nei Task 1, 5, 7 e 12; sezione 22 (lettura, riconoscimento, controlli, conferma, nome del file, registrazione, annullamento) nei Task 5, 8 e 9; sezione 30 (apprendimento supervisionato, consumi anomali) nei Task 8 e 9; sezione 8 e 40 (Python incorporato, licenze) nei Task 2 e 10; condominio, OCR e PDF con più documenti esplicitamente al piano 2b.
- Le firme dei Task 8 e 9 usano i tipi del Task 1 e le funzioni del piano 1 (`registerBill`, `commitChange`, `undoOperation`, `splitSharedDebit`); `ExtractionResult` e `SupplierProfile` hanno lo stesso nome in tutti i task.
- Il piano 2a introduce il campo `Bill.consumption` e il record `supplierProfile` (Task 1): il resto del core non cambia.
