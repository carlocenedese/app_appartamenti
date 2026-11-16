# App Bollette: Piano 11, arrivo, subentro e uscita di un inquilino (core e riga di comando)

Disegno: `docs/plans/2026-11-16-piano-11-subentro-disegno.md` (bozza da approvare da user1). Regole in
vigore: `docs/spec.md` sezione 42. Numeri delle regole del registro da **R220**.

## Metodo di esecuzione

Un ramo (`feat/piano-11-subentro`), un task alla volta: test che fallisce, codice, `pnpm lint`,
`pnpm typecheck`, `pnpm test`, commit. Alla fine i test del core con `TZ=Pacific/Auckland` e
`TZ=America/Los_Angeles`.

## Vincoli globali

- `packages/core` puro: `asOf` e l'orologio sono argomenti.
- Nessun importo di caparra, tasso o termine nel codice: caparra attesa, tassi, date degli interessi e
  conguaglio sono dati di user1.
- Riga di comando: importi, nomi e `id` di presenze, inquilini e pagamenti solo con `--dettagli`.
- Solo dati inventati.

## Task 1: schemi

Test `model.test.ts`: `Tenancy.expectedDeposit` (> 0), `Contract.takeovers` (mesi non decrescenti,
presenze non ripetute). Codice `model.ts`; `docs/schemas/tenancy.json` e `contract.json` rigenerati.
`saveContract` conserva `takeovers` e rifiuta un ingresso che lo contiene (test in
`contract-store.test.ts`).

## Task 2: scritture delle presenze

Test `packages/core/test/tenancy-store.test.ts`: `saveTenancy` (crea, collega al contratto,
`unchanged`, rifiuti in ordine, `beds-conflict` per i quattro codici, conflitto vecchio fuori dai mesi
non blocca), `endTenancy`, `recordTakeover` (esempio del disegno, `unchanged`, rifiuti), annullamento
con `undoOperation`, `undoBlockedBy` con un versamento dell'inquilino. Codice `tenancy-store.ts`,
`conguaglio.ts` (`checkBeds` esportato da `bedsIn` e `checkTenantOverlaps`), `movements.ts`.

## Task 3: caparre

Test `packages/core/test/deposit.test.ts`: `depositChecks` (quattro stati, restituzione negativa,
rinnovo, pagamenti non confermati o cancellati ignorati); `loadDepositReturn` (esempio, `no-deposit`,
`already-returned`, `missing-rate`); `loadContractStatus` (stati delle presenze, subentri, caparre,
controlli). Codice `deposit.ts`.

## Task 4: riga di comando

Test in `scripts/estratti.test.mjs`: `presenza`, `fine-presenza`, `subentro`, `stato-contratti` con e
senza `--dettagli`, `caparra-restituzione`, annullamento con `annulla-riconciliazione`, opzioni di
altri comandi (2), `scanText` vuoto. Codice `scripts/estratti.mjs`.

## Task 5: registro e verifica finale

R220 e seguenti in `docs/progress.md` (Ruling e domande per user1), glossario, verifica completa.
