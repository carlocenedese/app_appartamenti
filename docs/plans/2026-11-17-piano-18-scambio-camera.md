# App Bollette: Piano 18, scambio di camera (core e riga di comando)

Disegno: `docs/plans/2026-11-17-piano-18-scambio-camera-disegno.md` (bozza da approvare da user1).
Regole del registro da **R310**. Ramo `feat/piano-18-scambio-camera`.

## Metodo di esecuzione

Un task alla volta: test che fallisce, codice, `pnpm lint`, `pnpm typecheck`, `pnpm test`, commit.

## Vincoli

- Nessun record nuovo né campo nuovo: schemi invariati.
- Non toccare `deposit.ts` (piano 17 in corso): la caparra resta per inquilino e appartamento.
- Riga di comando: solo `id` di presenze e codici, mai nomi né importi.

## Task 1: `recordRoomSwap` (core)

Test `packages/core/test/tenancy-store.test.ts`: scambio dell'esempio (due presenze chiuse a `M-1`, due
nuove dal mese `M` con posti scambiati, `to`, forfait e caparra attesa propri, contratto collegato,
storico del canone intatto), canoni dati, avviso `swap-rent-unchanged`, `unchanged` alla stessa
richiesta, rifiuti in ordine, annullo con `undoOperation`, `undoBlockedBy` vuoto e bloccato da un terzo
inquilino nel posto. Fine a fine: `loadExcelInput`, `calcConguaglio`, `collectedForfait` e cartella di
lavoro su un periodo che contiene `M`; `depositChecks` uguale prima e dopo. Codice `tenancy-store.ts`.

## Task 2: riga di comando

Test `scripts/estratti.test.mjs`: `scambio-camera` salvato con avviso, `unchanged`, rifiuti (`tenancy-exists`, `same-tenant`, argomenti), annullo e nuovo scambio con i canoni.
Codice `scripts/estratti.mjs` (`RECONCILE_KINDS`, messaggi, intestazione).
