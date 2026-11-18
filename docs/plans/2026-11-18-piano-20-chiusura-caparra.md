# Piano 20: chiusura, riapertura, invio, saldo e caparra (piano)

Decisioni di user1 del 18 novembre 2026: F1, F2, F3, F5, F11, B4 e F10 (`docs/revisione-2026-11-18-funzioni.md`,
domande 1, 2, 3, 5, 13 e 15). Ogni task: test che falliscono, codice, `pnpm lint`, `pnpm typecheck`,
test toccati, commit. Formato dei dati da 3 a 4, autorizzato da user1 («Sì, alza a 4»): solo campi
facoltativi nuovi in `periodClose`.

1. **Schema e formato.** `PeriodCloseSchema` (`model.ts`) con i campi facoltativi `sentOn`
   (data), `settled` (`{ tenantId, on, transactionId? }[]`), `reopened` (`{ on, reason }`) e
   `history` (le chiusure precedenti, ciascuna con `closedAt`, `engineVersion`, `snapshot`,
   `sentOn?`, `settled?`, `reopened`). `DATA_FORMAT = 4`, impronta 4 in `data-format.test.ts`,
   `docs/schemas` rigenerati. Test in `model.test.ts`.
2. **Invio, saldo e riapertura (F1, F3).** In `period-close.ts`:
   `markPeriodSent(store, query & { on }, profileId, clock, newId)`,
   `markTenantSettled(store, query & { tenantId, on, transactionId? }, …)`,
   `reopenPeriod(store, query & { on, reason }, …)`; operazioni `period.send`, `period.settle`,
   `period.reopen`. Una chiusura è viva se non è cancellata né riaperta; `closePeriod` dopo una
   riapertura mette la chiusura precedente in `history` e scrive l'istantanea nuova.
   `loadPeriodClosing` dà anche `reopened` (confronto con l'ultima istantanea). Test in
   `period-close.test.ts`: «reopen keeps the old snapshot in history», «a second close takes a new
   snapshot», «settled is per tenant and never automatic».
3. **Scritture in un periodo chiuso (F5).** `closed-period-guard.ts`:
   `refuseClosedPeriodChanges(store, operations, changes)` e `ClosedPeriodError`, chiamati da
   `commitChange` (unico punto di scrittura, anche per l'annullo) e da `undoOperation` prima di
   scrivere (nessun annullo a metà). Rifiuta la modifica, la cancellazione e l'annullo di ciò che
   esisteva alla chiusura e tocca il periodo: presenze, contratti, bollette, rate, pagamenti,
   abbinamenti, recuperi; un record nuovo passa (salvo presenze e contratti nuovi nel periodo).
   Anche `undoFile` controlla prima del primo annullo. Test in `closed-period-guard.test.ts`.
4. **Forfait nel supplementare (F11).** `closingOf` dà per inquilino `forfaitDelta` (forfait
   incassato alla chiusura meno quello di oggi), una riga a sé; `dataChanged` non guarda più il
   forfait. Test in `period-close.test.ts` (fatto insieme al task 2).
5. **Caparra (B4, F10).** `loadDepositReturn` aggiunge una riga per ogni periodo chiuso con il
   conguaglio non saldato («Conguaglio <periodo> non saldato»), per il supplementare
   («Conguaglio supplementare <periodo>») e per il forfait («Forfait non incassato <periodo>»);
   caparra già restituita: `already-returned` con le righe `toRequest` («da richiedere»).
   Test in `deposit-closed.test.ts`.
6. **Riga di comando, Excel, cruscotto.** Comandi `invia-conguaglio`, `conguaglio-saldato`,
   `riapri-periodo`; stato in `conguaglio-supplementare`, nel cruscotto (`chiuso`, `inviato`,
   `saldato`) e nella prima riga dell'Excel e del file dei proprietari; `ClosedPeriodError` →
   `closed-period`. Test in `scripts/estratti-funzioni.test.mjs` e `period-close.test.ts` (Excel,
   cruscotto e F2: l'Excel dopo la chiusura mostra il calcolo di oggi).
7. **Registro e specifica.** Sezione 42 (R5), una riga «Ruling» per decisione in
   `docs/progress.md`.
