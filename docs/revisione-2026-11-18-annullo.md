# Revisione del 18 novembre 2026: integrità dei riferimenti e annullo

Ramo `fix/revisione-annullo`. Lavoro interrotto per il limite d'uso: qui sotto ciò che è fatto e ciò che manca.

## Fatto

- **U1, U2, U7** (commit b05a9fc). Nuovo modulo `packages/core/src/references.ts`, con una sola tabella dei riferimenti fra record. Espone:
  - `recordDependents(store, targets)`: i record vivi che puntano ai bersagli. Non si chiama `dependentsOf`, perché quel nome esiste già in journal.ts.
  - `countByType`;
  - `referenceProblems(store)`.

  `undoBlockedBy` usa `undoDependents` al posto di `payablesRepeatedFrom` e `contactsUsing`. Si rifiuta quindi l'annullo della creazione di un appartamento, di una regola con classi vive nate da essa, di una presenza o di un pagamento elencati in un contratto scritto dopo.

- **U13** (d7a8eaf). `bedsConflictOf`: `saveApartment` rifiuta con `rooms-in-use` (posti e presenze) o con `beds-conflict`. Lo stesso controllo vale per l'annullo di un `apartment.save` che rimette posti diversi.
- **U4** (91d29dd). `saveTenancy` rifiuta con `tenancy-in-use` (`recordIds`) quando si cambia inquilino o appartamento di una presenza con pagamenti, recuperi o contratti. Rifiuta con `has-recoveries` quando cambia i mesi come `endTenancy`.
- **Test**: il core è verde (2695 test), e così `scripts/estratti.test.mjs`.

## Codici nuovi da agganciare nella CLI (messaggi italiani)

- `rooms-in-use`: «Rifiutato: i posti {rooms} sono usati da presenze vive ({tenancyIds}): chiudere o spostare prima quelle presenze.»
- `beds-conflict` (da `saveApartment`): «Rifiutato: con questi posti le presenze vive non entrano più ({code}, dal mese {month}).»
- `tenancy-in-use`: «Rifiutato: la presenza ha pagamenti, recuperi o contratti collegati ({recordIds}): per un altro inquilino o appartamento creare una presenza nuova.»
- `has-dependents` da `annulla-riconciliazione` per creazioni (appartamento, regola, presenza): oggi la CLI mostra `movement-has-dependents`, che è il reperto U8 in estratti.mjs. Messaggio proposto: «Rifiutato: dei record dipendono da ciò che questa operazione ha creato ({conteggi per tipo da `undoDependents` + `countByType`}): annullarli prima.»

## Non fatto / Arretrato

- **U6, aggancio a `checkConsistency` NON messo**. L'ho misurato: con la riga `problems.push(...(await referenceProblems(store)))` falliscono 206 test in 24 file, per fixture parziali nei test di altri scrittori (`bankProfileId`, `tenantId`, `accountId` mancanti). Inoltre `checkConsistency` blocca ogni scrittura, `ripara` passerebbe questi problemi a `repairDiverged`, e `assess` darebbe `behind`.

  Il ciclo end-to-end (`ciclo-completo.test.mjs`, eseguito con l'aggancio) non mostra alcun riferimento pendente. Proposta: un comando di diagnosi che chiami `referenceProblems`. Se invece si vuole il blocco, servono prima le fixture complete e un filtro `reason === 'diverged'` in `ripara`. Decisione del coordinatore.

- **e2e**: `ciclo-completo.test.mjs` ora vede `apartment.save` fra gli annulli rifiutati. È voluto, per U1: il conto e l'utenza dell'appartamento non hanno annullo (U12). Va aggiunto all'elenco atteso.
- **U3** (altro scrittore): per un movimento ci sono `recoveriesUsing` e `taxPaymentsUsing`, oppure `recordDependents(store, [{ type: 'transaction', id }])`.
- **U5** (payer, non provato), **U8** (estratti.mjs), **U9** (unificare `undoImport`, `undoBillImport` e `cancelAutomaticClass`: non è una sostituzione sicura, la semantica è diversa), **U10** (`removeSupply` senza controlli), **U11** (note), **U12**, **U14** (regola di calcolo, decide Carlo).
- **Domanda 12 del disegno** (riscrittura intera della presenza) resta da confermare con Carlo. Per ora vale il rifiuto prudente.
