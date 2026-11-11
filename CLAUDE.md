# App Bollette: istruzioni per gli agenti

Specifica: `docs/spec.md` (le regole di calcolo in vigore sono nella sezione 42 e prevalgono). Piano: `docs/plans/`. Glossario: `docs/glossary.md`. Registro: `docs/progress.md`.

- Importi in centesimi interi (`Cents`, tipo con marchio), mai decimali; date `YYYY-MM-DD`, mesi `YYYY-MM`; calcoli sulle date solo con interi e UTC. Formato `€ 1.234,56`, negativi `- € 63,00`.
- `packages/core` è puro: niente rete, niente `node:*`, niente `Date.now()`, `new Date()` senza argomenti, `Math.random()`, `crypto.randomUUID()`; orologio e generatore di `id` sono argomenti. `node:fs` solo in `packages/store-fs`.
- Percorsi in NFC; nei nomi dei file generati niente `:`, caratteri vietati da Windows o nomi riservati.
- Nessuna aliquota, tasso o regola fiscale nel codice: arrivano dalla configurazione. Periodi di conguaglio ed esercizi condominiali sono impostazioni dell'appartamento.
- Solo licenze MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, 0BSD, CC0-1.0, Unlicense, BlueOak-1.0.0, Unicode-3.0, Zlib (`pnpm licenses:check`); mai GPL, AGPL, LGPL.
- Mai dati reali nel repository, solo fixture anonimizzate (`pnpm data:check`); nessun dato personale nei log.
- Dati: un file JSON per record in `_app/dati/<tipo>/<id>.json`, un file per operazione in `_app/journal/`; ogni record ha `id`, `v`, `rev`, e non si cancella mai dal disco (`deleted`).
- Qualità: TypeScript strict, ESLint, Prettier, `tsc --noEmit`, copertura almeno 90% sulle righe di `packages/core/src`; i test passano anche con `TZ=Pacific/Auckland` e `TZ=America/Los_Angeles`.
- Python (`python/`, pacchetto `bollette_pdf`, Python 3.13): comandi `pnpm python:test` e `pnpm python:licenses` (con `PYTHON=<interprete>` per usare un virtualenv; installare prima con `pip install --require-hashes -r python/requirements.txt`, mai nel Python di sistema). Regole del pacchetto: nessuna rete, nessun orologio (data e ora sono argomenti), importi solo `Decimal`, stdout in UTF-8, unica libreria PDF `pdfminer.six` (mai `pdfplumber`), unica altra dipendenza `jsonschema`. Dipendenze con versione esatta e hash in `python/requirements.txt` (generato con `pip-compile` da `requirements.in`, pubblicate da almeno due settimane), stesso elenco di licenze, `python/THIRD_PARTY.md`. I casi di profilo comuni a Python e Zod sono in `python/tests/data/profile-cases.json`.
- Nomi nel codice e commenti in inglese; interfaccia, messaggi, documenti ed Excel in italiano.

## Metodo di esecuzione

- Un ramo per esecuzione, mai su `main`. Per ogni task: test che falliscono, codice, `pnpm lint`, `pnpm typecheck` e `pnpm test`, commit; poi un revisore distinto (piano, specifica, qualità) e correzioni, fino a 5 giri.
- Dubbi minori: decidere e annotare «Ruling» in `docs/progress.md`. Le regole di calcolo non si decidono da soli: fermarsi e chiedere a Carlo.
- Nessun task parte se un prerequisito non ha superato la revisione interna.
