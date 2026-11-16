# App Bollette: Piano 12, moduli e documenti generati (core e riga di comando)

Disegno: `docs/plans/2026-11-16-piano-12-moduli-disegno.md` (bozza da approvare da user1). Regole in
vigore: `docs/spec.md` sezione 42. Numeri delle regole del registro da **R230**.

## Metodo di esecuzione

Un ramo (`feat/piano-12-moduli`), un task alla volta: test che fallisce, codice, `pnpm lint`,
`pnpm typecheck`, `pnpm test`, commit. Alla fine i test del core anche con `TZ=Pacific/Auckland` e
`TZ=America/Los_Angeles`, `pnpm data:check`, `pnpm licenses:check`, copertura del core.

## Vincoli globali

- `packages/core` puro: `today` e `inflateRaw` sono argomenti; niente `node:zlib` nel core.
- Nessun testo legale, clausola, importo o termine della sezione 26 nel codice o nei modelli di prova.
- Nessun record nuovo; nessuna scrittura nell'archivio.
- Riga di comando: solo stato, conteggi, `id` e nomi dei campi; mai percorsi, nomi o valori.
- Nessun `.docx` binario nel repository: i test costruiscono i modelli.

## Task 1: lettura e riempimento di un `.docx`

Test `packages/core/test/docx.test.ts`: `readZip` di uno zip stored e deflate (deflate costruito nel
test con `node:zlib`), CRC sbagliato, cifrato, non uno zip; `docxPlaceholders`; `fillDocx` con un
segnaposto spezzato in tre run, intestazione e piè di pagina, valori con `&`, `<` e a capo, voci non
toccate uguali, stessi byte due volte; rifiuti `missing-fields`, `bad-placeholder`,
`unclosed-placeholder`, `bad-value`, `bad-template`. Codice `docx.ts`.

## Task 2: campi, valori e modelli di prova

Test `packages/core/test/modules.test.ts`: `moduleValues` (campi dell'app, formati, IBAN unico,
durata residua dell'esempio della sezione 26, campi assenti), `generateModule` (rifiuti
`unknown-fields`, `field-from-app`, `missing-fields`; documento compilato), `starterDocx` (si riapre e
ha tutti i campi del modulo), `moduleFilePath`. Codice `modules.ts`.

## Task 3: lettura dall'archivio

Test `packages/core/test/module-store.test.ts`: `loadModuleData` con contratto, senza contratto,
rifiuti. Codice `module-store.ts`, esportazioni in `index.ts`.

## Task 4: riga di comando

`scripts/output-file.mjs` con le funzioni di scrittura di `excel.mjs` (i test di `excel.test.mjs`
restano verdi). Test `scripts/moduli.test.mjs`: generazione nel percorso predefinito e in
`--uscita`, `file-exists`, rifiuti con i nomi dei campi, argomenti non validi, `--vuoto`, uscita
senza nomi né valori. Codice `scripts/moduli.mjs`, `pnpm moduli` in `package.json`.

## Task 5: registro, glossario, verifica finale

R230 e seguenti in `docs/progress.md`, voci del glossario, verifica completa.

## Autoverifica

- Nessun testo dei moduli reali, nessun importo della sezione 26 nel codice.
- Le domande del disegno restano aperte e nessuna è decisa nel codice.
