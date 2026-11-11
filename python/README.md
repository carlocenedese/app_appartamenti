# bollette_pdf

Pacchetto Python che legge le bollette in PDF di testo e produce un `ExtractionResult` secondo gli
schemi esportati dal core TypeScript (`docs/schemas/`). Fa parte del piano 2a; questo è lo
scheletro: versione, validazione degli schemi e controllo delle licenze.

## Regole del pacchetto

- Nessuna rete e nessun orologio: la data e l'ora arrivano come argomenti.
- Importi solo con `Decimal`, mai `float`.
- Stdout in UTF-8; i messaggi per l'utente sono in italiano, nomi e commenti in inglese.
- Unica libreria PDF: `pdfminer.six` (non `pdfplumber`, che porta Pillow, con licenza non ammessa).
- Unica altra dipendenza: `jsonschema`. Solo licenze dell'elenco del progetto (`CLAUDE.md`).

## Comandi (dalla radice del repository)

```bash
python3 -m venv .venv-python && .venv-python/bin/pip install --require-hashes -r python/requirements.txt
PYTHON=.venv-python/bin/python pnpm python:test       # test (unittest della libreria standard)
PYTHON=.venv-python/bin/python pnpm python:licenses   # controllo delle licenze installate
```

`PYTHON` è facoltativa: senza, si usa `python3` (`python` su Windows).

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
