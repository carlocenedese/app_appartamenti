# Piano 15: flusso di importazione di una bolletta e cruscotto (piano)

Disegno: `docs/plans/2026-11-17-piano-15-bollette-cruscotto-disegno.md`. Ramo
`feat/piano-15-bollette-cruscotto`. Per ogni task: test che falliscono, codice, `pnpm lint`,
`pnpm typecheck`, `pnpm test`, commit.

## Task 1: record `pendingDocument`

`model.ts` (`PendingDocumentSchema`, id `doc-...`, in `recordSchemas`), `docs/schemas/pendingDocument.json`
rigenerato (`pnpm schemas:export`), lista di `scripts/export-schemas.test.mjs`, test in `model.test.ts`.

## Task 2: confronto dei consumi

`consumption.ts`: helper esatti su interi (`scaled`, `exceeds`) e ricerca dell'anno prima spostati da
`proposal.ts` e riusati; `compareConsumption(bill, bills, { recentMonths, thresholds? })`. I test di
`proposal.test.ts` passano senza modifiche.

## Task 3: importazione e annullamento

`bill-import.ts`: `importBill`, `undoBillImport`, `pendingDocuments` (stato derivato). Test: auto
registrata, da rivedere (record scritto una volta sola), conferma manuale, doppione, annulla, rifiuto con
abbinamento vivo, archivio incoerente.

## Task 4: cruscotto

`dashboard.ts`: `loadDashboard(store, { today, asOf, soonDays?, taxYear?, settlements? })`, conteggi
per appartamento e codice.

## Task 5: riga di comando

`scripts/estratti.mjs`: `bolletta`, `annulla-bolletta`, `cruscotto`; test in `scripts/estratti.test.mjs`.

## Task 6: registro

`docs/progress.md`: R260-R264, domande per user1.
