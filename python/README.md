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
  20 pagine per documento (`MAX_OCR_PAGES`), le altre restano come sono, con un avviso in
  `Document.warnings`. `Document.text_source` vale `pdf`, `ocr` o `mixed` (regola R86).
- tesserocr e pypdfium2 si installano solo su macOS (`sys_platform == 'darwin'`). Senza le due
  librerie o senza i dati della lingua nessun errore: le pagine restano senza testo e
  `text_source` è `pdf` (stato `senza-testo`). Il testo letto non finisce mai in messaggi o log.
- Test: `tests/test_ocr.py` usa un finto motore (`ocr.ENGINE_FACTORY`); le prove con il motore
  vero partono se `BOLLETTE_OCR_TEST_DATA` indica la cartella di `ita.traineddata` (o se i dati
  sono in `apps/desktop/src-tauri/resources/ocr-data/`), e con `REQUIRE_OCR=1` falliscono se il
  motore manca. Le pagine scansionate sintetiche le scrive `tests/make_scan.py`.

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
