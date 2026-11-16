# App Bollette: Piano 13, seguito di Tasse e stime

**Obiettivo:** applicare le risposte di user1 alle domande 3 (prima parte), 10, 11, 12 del piano 10.
Disegno: `docs/plans/2026-11-16-piano-13-tasse-seguito-disegno.md`. Regole nuove da **R240**.

**Metodo:** ramo `feat/piano-13-tasse-seguito`; per ogni task test rossi, codice, `pnpm lint`,
`pnpm typecheck`, `pnpm test`, commit; niente push.

### Task 1: contribuente e TARI

- [ ] Test rossi in `taxes.test.ts`: la riga TARI senza `rule-undecided`, in linea o discrepanza.
- [ ] `taxes.ts`; commenti; R240 (contribuente), R241 (TARI).

### Task 2: anno di riferimento delle scadenze

- [ ] Test rossi: `model.test.ts` (`taxYear` intero 1-9999), `payable-store.test.ts` (salvato,
      cambiato, tolto, non copiato da `repeatPayable`), `estratti.test.mjs`
      (`--anno-riferimento`, valore non intero → 2).
- [ ] `model.ts`, `payable-store.ts`, `scripts/estratti.mjs`, schema `payable.json`; R242.

### Task 3: adattatore verso l'ancora previsto

- [ ] Test rossi: `payableExpectedItems` (solo cedolare e registro non pagate), `taxTable`
      (`expected-amount-missing`, `no-expected-source` per voce senza anno), `loadTaxTable` senza
      scadenze in linea.
- [ ] `payables.ts`, `taxes.ts`, `tax-store.ts`; R243.

### Task 4: IMU con il solo totale annuo

- [ ] Test rossi: pagato così com'è, `imu-year-open` prima dell'ultima rata, `annualDifference` e
      soglia dopo, F24 non contabilizzato ancora `imu-to-check`.
- [ ] `taxes.ts`, `scripts/estratti.mjs` (`annualDifference` con `--dettagli`); R244.

### Task 5: chiusura

- [ ] R216 e disegno del piano 10 senza le domande risposte, R245 domande aperte, glossario;
      verifiche con `TZ=Pacific/Auckland` e `TZ=America/Los_Angeles`, `pnpm data:check`.
