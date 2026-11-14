# bollette_pdf

Pacchetto Python che legge le bollette in PDF di testo e produce un `ExtractionResult` secondo gli
schemi esportati dal core TypeScript (`docs/schemas/`), e costruisce i profili dei fornitori dalle
selezioni fatte sul PDF. Fa parte del piano 2a. L'app lo avvia come programma a riga di comando
(`python -I -m bollette_pdf`), con un limite di tempo (decisione R54).

## Riga di comando

```bash
python -I -m bollette_pdf extract --pdf <file.pdf> --profiles <cartella> --at <data ISO>
python -I -m bollette_pdf build-profile --pdf <file.pdf> --spec <file.json> --at <data ISO>
python -I -m bollette_pdf --version
```

- `extract` legge il PDF con i profili `*.json` della cartella `--profiles` (quelli rotti o non
  validi diventano avvisi con il solo nome del file) e scrive un `ExtractionResult` validato.
- `extract --pages a-b` legge solo le pagine `a..b` (interi, `1 <= a <= b <= pagine del file`, un
  solo intervallo): il risultato ha `pageRange [a, b]`, e `textSource`, `ocrPages` e «senza testo»
  valgono per quelle pagine. Un intervallo non valido, o oltre l'ultima pagina, dà codice `2` e
  `Intervallo di pagine non valido: nessun output.`. Il file si rilegge a ogni chiamata. Con
  due valori diversi per importo o numero, l'avviso «Il file potrebbe contenere
  più documenti.» (il valore e la confidenza non cambiano; decisione R94).
- `build-profile` legge il PDF e il file `--spec` (formato qui sotto; `box` è
  `[x0, top, x1, bottom]` in punti dall'angolo in alto a sinistra della pagina) e scrive il
  `supplierProfile` costruito (in `bozza`), solo se rilegge i valori scelti con confidenza `high` (decisione R60).
- `--at` è la data o data-ora ISO di riferimento: il programma non legge l'orologio.

Il file `--spec`:

```json
{
  "profileId": "…",
  "supplier": "…",
  "kind": "bill",
  "category": "elettricita",
  "validFrom": "2026-01-01",
  "recognise": [{ "page": 1, "box": [72, 50, 200, 62] }],
  "fields": { "amount": { "page": 1, "box": [300, 110, 360, 122] } }
}
```

Stdout contiene SOLO un documento JSON e un a capo, in UTF-8 con `\n`. Codici d'uscita: `0` per
ogni risultato valido (anche `non-riconosciuta`, `senza-testo` e `illeggibile`); `2` per argomenti
sbagliati, un percorso illeggibile, una specifica o una selezione non valida, un risultato che non
supera lo schema o un errore interno, con stdout vuoto. I messaggi su stderr sono frasi italiane
generiche che non riportano mai testo del PDF, dei profili o dei percorsi; i messaggi di
`pdfminer` sono spenti.

## OCR (solo macOS)

Le pagine senza testo utile si leggono con l'OCR quando si passa `--ocr-data <cartella>` (a
`extract` e `build-profile`; in Python `read_pdf(percorso, ocr_data=cartella)`), la cartella che
contiene `ita.traineddata` (nell'app `resources/ocr-data/`, preparata da `scripts/ocr-data.mjs`).
Il percorso è sempre un argomento, mai una variabile d'ambiente.

- `bollette_pdf/ocr.py`: pypdfium2 disegna la pagina (MediaBox, scala di grigi, 300 punti per
  pollice) e tesserocr ne legge le parole con riquadro e confidenza (0-100), con un solo thread;
  le coordinate sono quelle del lettore di testo (punti dall'angolo in alto a sinistra).
- Una pagina passa dall'OCR se non ha testo o se più del 30% dei glifi sono `(cid:N)`; al massimo
  20 pagine per chiamata (`MAX_OCR_PAGES`; con `--pages` si contano solo le pagine dell'intervallo), le altre restano come sono, con un avviso in
  `Document.warnings`. `Document.text_source` vale `pdf`, `ocr` o `mixed` (regola R86).
- tesserocr e pypdfium2 si installano solo su macOS (`sys_platform == 'darwin'`). Senza le due
  librerie o senza i dati della lingua nessun errore: le pagine restano senza testo e
  `text_source` è `pdf` (stato `senza-testo`). Il testo letto non finisce mai in messaggi o log.
- Test: `tests/test_ocr.py` usa un finto motore (`ocr.ENGINE_FACTORY`); le prove con il motore
  vero partono se `BOLLETTE_OCR_TEST_DATA` indica la cartella di `ita.traineddata` (o se i dati
  sono in `apps/desktop/src-tauri/resources/ocr-data/`), e con `REQUIRE_OCR=1` falliscono se il
  motore manca. Le pagine scansionate sintetiche le scrive `tests/make_scan.py`.

### Immagini JPEG e PNG

`read_pdf` (e quindi `extract` e `build-profile`) accetta anche un file JPEG o PNG, riconosciuto
dalle prime byte e non dall'estensione, e lo legge come **una pagina** con lo stesso percorso OCR
di un PDF scansionato (`text_source` `ocr`). Regola R88, nessuna dipendenza nuova.

- `bollette_pdf/images.py` legge solo le intestazioni e impacchetta l'immagine in un PDF di una
  pagina; i pixel li decodifica pdfium quando disegna la pagina.
- Risoluzione: 300 punti per pollice, o quella dell'EXIF (JPEG) / del blocco `pHYs` (PNG) se è tra
  72 e 1200. La pagina misura `pixel * 72 / dpi` punti: le coordinate sono in punti come nei PDF.
- Orientamento: il valore EXIF 1-8 del JPEG si applica (la foto di un telefono si legge dritta);
  nessuna correzione dell'inclinazione.
- `illeggibile` (mai un'eccezione, messaggio senza il contenuto del file): oltre 30 megapixel, file
  corrotto o troncato, JPEG non a 8 bit / 1 o 3 componenti, PNG con canale alfa o interlacciato.
  Valgono anche senza il motore; senza motore un'immagine valida dà `senza-testo`.
- Test: `tests/test_images.py` (intestazioni, senza motore), `tests/test_ocr.py` (finto motore e,
  con i dati della lingua, motore vero); le immagini sintetiche le scrive `tests/make_image.py`.

```bash
BOLLETTE_OCR_TEST_DATA=<cartella> REQUIRE_OCR=1 PYTHON=<venv>/bin/python pnpm python:test
```

## Regole del pacchetto

- Nessuna rete e nessun orologio: la data e l'ora arrivano come argomenti.
- Importi solo con `Decimal`, mai `float`.
- Stdout in UTF-8; i messaggi per l'utente sono in italiano, nomi e commenti in inglese.
- Unica libreria PDF: `pdfminer.six` (non `pdfplumber`, che porta Pillow, con licenza non ammessa).
- Unica altra dipendenza: `jsonschema`, più tesserocr e pypdfium2 solo su macOS (OCR). Solo
  licenze dell'elenco del progetto (`CLAUDE.md`).

## Comandi (dalla radice del repository)

```bash
python3 -m venv .venv-python && .venv-python/bin/pip install --require-hashes -r python/requirements.txt
PYTHON=.venv-python/bin/python pnpm python:test       # test (unittest della libreria standard)
PYTHON=.venv-python/bin/python pnpm python:licenses   # licenze dei pacchetti di requirements.txt
```

`PYTHON` è facoltativa: senza, si usa `python3` (`python` su Windows).

### Prova di integrazione con il core

`packages/core/test/extract-integration.test.ts` avvia `python -I -m bollette_pdf extract` su PDF
sintetici scritti da `tests/make_sample.py`. Con `-I` il pacchetto va installato nell'interprete:
`pnpm python:dev-install` (`tools/dev_install.py`) scrive in site-packages un file `.pth` che punta
a questa cartella, senza setuptools (decisione R72), e rifiuta il Python di sistema (solo virtualenv
o `CI=true`). Senza Python il test si salta; con `REQUIRE_PYTHON=1` (come in CI) fallisce.

```bash
PYTHON=.venv-python/bin/python pnpm python:dev-install
PYTHON=.venv-python/bin/python REQUIRE_PYTHON=1 pnpm test
```

### Strumenti (`tools/`)

- `tools/dump_text.py <file.pdf>`: stampa il testo di un PDF come documento JSON (`dump_document`), da rileggere con `load_dump`.
- `tools/pdf_report.py --profiles <cartella> --at AAAA-MM-GG <cartelle-di-pdf>...`: legge i PDF delle cartelle (anche annidate, senza scrivere nulla) e stampa solo conteggi per stato e fornitore, i campi letti con confidenza `high` (escluso `supplier`, sempre `high`), le cartelle non leggibili e i profili ignorati, mai nomi, percorsi o testo.
- `tools/xlsx_structure.py [--json] [--header-row N] [--known-labels "a,b"] [--code-columns "Cod Disp.,Segno"] <file.xlsx>`: stampa la sola STRUTTURA di un estratto conto XLSX, sicura per costruzione (R98). Solo libreria standard (nessun import da `bollette_pdf`: gira con il `python3 -I` di sistema, senza venv), file in sola lettura. Dal file esce solo: le etichette di colonna che, normalizzate (minuscole, senza accenti né punteggiatura), stanno nell'allowlist `KNOWN_LABELS` (data, descrizione, importo, causale, `cod disp`, ...; si estende con `--known-labels`); ogni altra etichetta diventa `(colonna N, testo di K caratteri)`; i fogli sono `Foglio N` (mai il nome), i fogli nascosti sono saltati e contati; del formato si stampa solo la classe (generale, numero, percentuale, data, ora, testo); per colonna tipo prevalente, non vuoti, distinti (solo il conteggio), fascia di lunghezza del testo (`<=10`, `<=30`, `>30`), prima e ultima data come `AAAA-MM` (base 1900 o 1904; date non valide contate senza valore). L'elenco dei valori solo per le colonne di `--code-columns` (default `Cod Disp.`, `Cod. Disp.`, `Segno`, `Valuta`) con al più 12 distinti, tutti di al più 12 lettere o cifre. Sopra l'intestazione solo tipi di cella e mesi (`AAAA-MM`, `AAAA-MM..AAAA-MM`). File non zip, corrotto, oltre 10 MB (100 MB decompressi, 50000 righe, 256 colonne), con membri non UTF-8 o con DOCTYPE/ENTITY: `File non valido o troppo grande: nessun output.` e codice `2`. Uso: `python3 -I python/tools/xlsx_structure.py "/percorso/Lista_Operazioni_X.xlsx"`.

## Dipendenze

`requirements.in` elenca le dipendenze dirette con versione esatta; `requirements.txt` ha tutte le
dipendenze con gli hash di ogni ruota (Linux, Windows, macOS) ed è generato con `pip-compile`
(strumento solo di sviluppo, non incluso):

```bash
pip install pip-tools
pip-compile --generate-hashes --allow-unsafe --strip-extras --output-file python/requirements.txt python/requirements.in
```

Compilare e provare con Python 3.13. Ogni versione deve essere stata pubblicata almeno due
settimane prima. Elenco e licenze: `THIRD_PARTY.md`.

## Schemi

`bollette_pdf.schemas.validate(kind, documento)` restituisce l'elenco dei messaggi d'errore (vuoto
se valido). Cerca `<kind>.json` in `BOLLETTE_SCHEMAS_DIR`, poi in `schemas/` dentro il pacchetto,
poi in `docs/schemas/` risalendo fino alla radice del repository. Per `supplierProfile` aggiunge le
regole che JSON Schema non esprime (`check_profile_rules`); gli esempi validi e non validi sono in
`tests/data/profile-cases.json`, letti anche da `packages/core/test/profile-cases.test.ts`.
