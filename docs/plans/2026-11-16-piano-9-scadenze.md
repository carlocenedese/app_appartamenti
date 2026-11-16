# App Bollette: Piano 9, scadenze e pagamenti del proprietario (core e riga di comando)

Disegno: `docs/plans/2026-11-16-piano-9-scadenze-disegno.md` (bozza da approvare da user1). Regole in
vigore: `docs/spec.md` sezione 42. Numeri delle regole del registro da **R200**.

## Metodo di esecuzione

Un ramo (`feat/piano-9-scadenze`), un task alla volta: test che fallisce, codice, `pnpm lint`,
`pnpm typecheck`, `pnpm exec vitest run <file toccati>`, Prettier, `node scripts/check-personal-data.mjs`,
commit. Alla fine `pnpm lint && pnpm typecheck && pnpm test` e i test del core toccati con
`TZ=Pacific/Auckland` e `TZ=America/Los_Angeles`.

## Vincoli globali

- `packages/core` puro: `today` è un argomento, mai `Date.now()` o `new Date()`; date come testo e
  `daysBetween` in interi.
- Nessuna scadenza, importo o termine di legge nel codice; nessuna regola non decisa (finestra «in
  scadenza», ripetizione annuale, colori del cruscotto): argomenti espliciti o fuori dal piano.
- Riga di comando: importi, date e nomi solo con `--dettagli`; messaggi costanti.
- Solo dati inventati (`user1`, `user2`, locatori fittizi).

## Task 1: record `payable`

Test: `model.test.ts` (record valido, `id` senza `scad-`, importo non positivo, elenco dei tipi),
`scripts/export-schemas.test.mjs` (`payable.json`). Codice: `PayableKindSchema`, `PayableSchema` in
`model.ts`, `recordSchemas.payable`, `docs/schemas/payable.json` rigenerato.

## Task 2: scadenziario puro e lettura dall'archivio

Test `packages/core/test/payables.test.ts`: IMU pagata, da riconciliare (resta da pagare con `check`),
senza data; rata di condominio pagata, importo diverso, avviso comune; voce a mano pagata a mano e con
un movimento cancellato; stati al giorno della scadenza e al giorno dopo; `soonDays`; ordine;
intestatari; fine dei contratti. Codice `payables.ts`: `scadenzario`, `loadScadenzario`.

## Task 3: scritture delle voci a mano

Test `packages/core/test/payable-store.test.ts`: `savePayable` crea, aggiorna tenendo `paid`,
`unchanged`, rifiuti; `repeatPayable` (`not-repeating`, `already-repeated`); `setPayablePaid` con data,
con movimento classificato a mano, rifiuti (`transaction-not-classified` per classe automatica o
assente, `transaction-used` per classe con `imu` o movimento già collegato, `already-paid`);
annullamento con `undoOperation`; `assignImuF24` rifiuta un movimento collegato (`payable-linked`);
`undoBlockedBy` blocca l'annullamento della classe collegata. Codice `payable-store.ts`, `imu-store.ts`,
`movements.ts`.

## Task 4: riga di comando

Test in `scripts/estratti.test.mjs`: `scadenza-nuova`, `scadenze` con e senza `--dettagli`, filtri,
`--stato in-scadenza` senza `--entro` (2), `scadenza-pagata` e il suo annullamento,
`scadenza-ripeti`, opzioni di altri comandi (2). Codice `scripts/estratti.mjs`.

## Task 5: registro, glossario, verifica finale

R200 e seguenti in `docs/progress.md`, voci del glossario, verifica completa.

## Autoverifica

- Ogni stato viene da dati scritti o dall'argomento `today`; nessuna data calcolata dal codice.
- Le domande del disegno restano aperte e nessuna è decisa nel codice.
