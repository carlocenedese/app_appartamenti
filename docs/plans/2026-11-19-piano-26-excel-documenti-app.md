# Piano 26: Excel e moduli dall'app desktop

Decisione C1 di user1, terzo dei tre lavori di base prima delle schermate. Oggi gli Excel (conguaglio
degli inquilini, file dei proprietari, file del commercialista) e i moduli Word li scrivono solo
`pnpm excel` e `pnpm moduli`, con `node:fs`. `scripts/estratti.mjs` non scrive né `.xlsx` né `.docx`
(legge solo gli estratti XLSX con Python). Ramo `feat/excel-documenti-app`, da `feat/regole-decise`
(PR #83).

## Dove si costruiscono i byte

Già nel core, puri: `writeXlsx` con `buildConguaglioWorkbook`, `buildOwnersWorkbook`,
`buildTaxWorkbook`; `generateModule` (`fillDocx`, `zipStored`) e `starterDocx`; i percorsi
predefiniti `excelFilePath`, `ownersFilePath`, `taxFilePath`, `moduleFilePath`. Negli script resta
la parte dopo le opzioni che non è riga di comando: il controllo dei dati più nuovi
(`refuseNewerData`), il caricamento con i suoi rifiuti (`bad-periods`, `missing-tenant`,
`settlement-input`, i rifiuti dei moduli), il controllo del file dei valori e il corpo del
risultato. Questa parte va nel core, come nel piano 24 (R386), in `packages/core/src/commands/documents.ts`.

## Core (R402)

- `refuseNewerData(store)` spostata da `scripts/output-file.mjs`; lo `Stop` degli script diventa il
  `CommandStop` del core (stesso costruttore).
- `conguaglioExcelCommand(store, { apartmentId, periodLabel, owners? })` e
  `taxExcelCommand(store, { year })`: caricano e danno `{ path, build() }`, il percorso predefinito
  e la costruzione separata, perché la riga di comando controlla il percorso predefinito prima di
  costruire (l'ordine dei rifiuti non cambia, R386). `build()` dà `{ bytes, body }` o lancia
  `CommandStop`.
- `suppliedValues(value)`: il controllo dell'oggetto dei valori (`bad-values`).
- `moduleCommand(store, { kind, tenancyId, template, supplied, today, inflateRaw })`: dà
  `{ bytes, path, body }`; `path` è `undefined` quando dal nome dell'inquilino non si ricava una
  cartella (lo script rifiuta `no-tenant-folder`, come prima, dopo la costruzione).
- `inflateAhead(template, inflate)` in `docx.ts` (R404): gonfia prima, con una funzione asincrona,
  le voci compresse dello zip e dà l'`InflateRaw` sincrono che `readZip` vuole. `readZip` si divide
  in lettura dell'indice (`zipDirectory`) e gonfiaggio; i controlli e l'errore restano gli stessi.
- I messaggi restano negli script (R387): l'app restituisce solo i codici.

## Riga di comando

`excel.mjs` e `moduli.mjs` chiamano le funzioni del core; restano le opzioni, i percorsi `--uscita`,
`checkDefaultFolders`, `mkdirSync` e `writeNew` (file temporaneo e collegamento fisso). I test
`scripts/excel.test.mjs`, `scripts/moduli.test.mjs` e `scripts/ciclo-completo.test.mjs` passano senza
cambiare le attese. Impronte SHA-256 dell'uscita prese prima delle modifiche (19 novembre 2026):

| File                                      | SHA-256                                                            |
| ----------------------------------------- | ------------------------------------------------------------------ |
| conguaglio `apt-nord` 2026-27 (fixture)   | `41a4743cbd81e2a82f9f2ddd36e9327f9c1b2c68233e3e4f35b8eb4059f5ae70` |
| proprietari `apt-nord` 2026-27 (fixture)  | `4d6a3defadead27fbd27d2f6692644ed1f997e6c5607e44d21bb84da107ba555` |
| commercialista 2026 (fixture)             | `5e188fb9dbbb927fcccdbb78cf8ad180316d0ba0ac4ae5c897c593fbe4f94ce6` |
| modulo `promessa` (record di `moduli.test.mjs`) | `87139f3bb07240ef18d1b88a3eb72aa4f3d50a76f86e1443f5d2ee84e0ce126b` |

Le prime due sono già fissate nei test del core; le altre due si fissano nel test nuovo del core
(`documents-command.test.ts`) e in quello dell'app.

## App (R403, R405, R406)

- `FsBackend.writeNew(path, bytes)`: `writeFile(path, bytes, { createNew: true })` del plugin fs
  (apertura con `create_new`, verificato nel sorgente `fs-v2.7.1`): non sovrascrive mai. Serve il
  permesso `fs:allow-write-file` in `capabilities/default.json` (da approvare da user1).
- `TauriStore.newFileProblem(path)` e `TauriStore.writeNewFile(path, bytes)`: stessi percorsi NFC e
  `assertSafeRelPath` di `locate`; un collegamento o un file al posto di una cartella è
  `bad-default-folder` (dalle voci di `readDir`, senza permessi nuovi); un file che c'è già, anche in
  un'altra grafia NFC/NFD o un collegamento rotto, è `file-exists`.
- `apps/desktop/src/documents.ts`: `writeConguaglioExcel(store, { apartmentId, periodLabel,
  owners? })`, `writeTaxExcel(store, { year })`, `writeModulo(store, { kind, tenancyId,
  templatePath, values, today })`. Scrivono solo nel percorso predefinito dentro la cartella scelta
  e restituiscono `{ status: 'written', path, ...conteggi }` con il percorso relativo, oppure
  `{ status: 'rejected' | 'invalid', reason, ...campi }` o `{ status: 'failed', reason: 'failed' }`,
  senza `message`.
- Il modello `.docx` si legge con `store.readBytes` (stesso backend); la dimensione si controlla dopo
  la lettura (R407). Il gonfiaggio usa `DecompressionStream('deflate-raw')` della webview, con il
  limite di byte (R404).
- Nessun comando Rust: il plugin fs basta.
- Fuori: il modello vuoto (`--vuoto`) e un'uscita scelta dall'utente fuori dal percorso predefinito
  (le schermate non ci sono ancora).

## Test

- App, con `MemoryFs`: i byte delle impronte qui sopra; secondo scritto rifiutato, byte invariati;
  `schemaVersion: 999` → `newer-data`, niente scritto; nomi ripuliti (`Città: è Nord`, `con`);
  percorso del modello non ammesso; collegamento o file al posto di una cartella; gonfiaggio con
  limite.
- Core: `inflateAhead`, le funzioni dei comandi (copertura).

## Ordine dei commit

1. Questo piano e R402–R407.
2. Core: `documents.ts`, `inflateAhead`, script che li usano (uscita uguale).
3. App: backend, `TauriStore`, `documents.ts`, permesso, `disco-app.md`, test.

Alla fine `pnpm lint`, `pnpm typecheck`, `pnpm test`, `TZ=Pacific/Auckland pnpm test`,
`node scripts/check-personal-data.mjs`. Revisione distinta non fatta in questo lavoro (nessun
sotto-agente), come R388.
