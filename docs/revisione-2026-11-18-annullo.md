# Revisione del 18 novembre 2026: integrità dei riferimenti e annullo

Ramo `fix/revisione-annullo`: primo giro più un giro di correzioni dopo la revisione indipendente.

## Fatto

- **U1, U2, U7** (b05a9fc). Nuovo modulo `packages/core/src/references.ts`, con una sola tabella dei riferimenti fra record, ricontrollata sui tipi di main. Espone:
  - `recordDependents(store, targets)`: i record vivi che puntano ai bersagli. Non si chiama `dependentsOf`, perché quel nome esiste già in journal.ts.
  - `countByType`;
  - `referenceProblems(store)`.

  `undoBlockedBy` usa `undoDependents` al posto di `payablesRepeatedFrom` e `contactsUsing`. Si rifiuta quindi l'annullo della creazione di un appartamento, di una regola con classi vive nate da essa, di una presenza o di un pagamento elencati in un contratto scritto dopo, e di un conto con movimenti.

- **Note** (e174eab, 31f2393). Una regola sola: `recordDependents` non conta mai le note, perché una nota su un record che non c'è più non fa danni (U11). Vale per `undoBlockedBy`, `saveTenancy` e ogni altra guardia.
- **Estratti** (31f2393). La tabella dei riferimenti comprende `statement.transactionIds → transaction`.
- **U13** (d7a8eaf, 31f2393). `bedsConflictOf`: `saveApartment` rifiuta con `rooms-in-use` (posti e presenze) o con `beds-conflict`; aggiungere un posto è accettato. Lo stesso controllo vale per l'annullo di un `apartment.save` che rimette posti diversi.

  Il controllo guarda anche le presenze passate. Caso particolare: se si danno i `rooms` a un appartamento le cui presenze non indicano il posto, il rifiuto è `beds-conflict` con codice `unknown-room`; prima si indica il posto a ogni presenza.

- **U4** (91d29dd, e174eab). `saveTenancy` rifiuta con `tenancy-in-use` (`recordIds`) in due casi:
  - cambio di inquilino, se la presenza ha pagamenti o recuperi che resterebbero senza presenza;
  - cambio di appartamento: pagamenti, recuperi e anche i contratti che la elencano o la usano in un subentro.

  La correzione dell'inquilino sotto un contratto è accettata, e così la correzione delle date con pagamenti. Se cambiano i mesi vale `has-recoveries`, come in `endTenancy`.

## Da agganciare nella CLI (lo fa chi possiede estratti.mjs)

1. **`account.save` e `supply.link` in `RECONCILE_KINDS`**, così un appartamento creato per errore si può togliere: prima il conto e l'utenza, poi l'appartamento. `undoBlockedBy` ferma già l'annullo di un conto con movimenti, o di un'utenza con rate o contatti. Il ciclo end-to-end (`ciclo-completo.test.mjs`) oggi vede `apartment.save` fra gli annulli rifiutati: è proprio perché conto e utenza non hanno annullo.
2. **Comando di diagnosi `riferimenti`**: stampa `referenceProblems(store)`, solo `from.type`, `from.id`, `field`, `to.type`, `to.id` e nessun dato personale. Messaggio quando è vuoto: «Nessun riferimento pendente.» Per ogni riga: «{from.type} {from.id}: {field} punta a {to.type} {to.id}, che non c'è o è cancellato.»
3. **Messaggi dei codici nuovi**:
   - `rooms-in-use`: «Rifiutato: i posti {rooms} sono usati da presenze ({tenancyIds}), anche passate: aggiungere il posto nuovo, spostare le presenze, poi togliere il vecchio.»
   - `beds-conflict` da `saveApartment`: «Rifiutato: con questi posti le presenze non entrano più ({code}, dal mese {month}).» Con `unknown-room`: «Rifiutato: la presenza {tenancyIds} non indica un posto dell'appartamento: indicarlo prima di cambiare i posti.»
   - `tenancy-in-use`: «Rifiutato: la presenza ha pagamenti, recuperi o un contratto collegati ({recordIds}): per un altro inquilino o appartamento creare una presenza nuova.»
   - `has-dependents` da `annulla-riconciliazione` per una creazione (appartamento, regola, presenza, conto): oggi la CLI mostra `movement-has-dependents`, ed è il reperto U8. Messaggio proposto: «Rifiutato: dei record dipendono da ciò che questa operazione ha creato ({conteggi per tipo con `undoDependents` e `countByType`}): annullarli prima.»

## Arretrato

- **U6, aggancio a `checkConsistency` non messo**. Con la riga `problems.push(...(await referenceProblems(store)))` falliscono 206 test in 24 file, per fixture parziali nei test di altri scrittori. Inoltre `checkConsistency` blocca ogni scrittura, `ripara` passerebbe questi problemi a `repairDiverged`, e `assess` darebbe `behind`. Con l'aggancio provato, il ciclo end-to-end non mostra riferimenti pendenti. Per ora c'è il comando di diagnosi (punto 2). Per il blocco servono prima fixture complete e un filtro `reason === 'diverged'` in `ripara`.
- **U3** (altro scrittore): per un movimento ci sono `recoveriesUsing` e `taxPaymentsUsing`, oppure `recordDependents(store, [{ type: 'transaction', id }])`.
- **U10**: `removeSupply` resta senza guardia. Un test esistente vuole che scollegare un'utenza lasci com'erano le rate già registrate, quindi bloccare su `instalment.supplyId` cambierebbe un comportamento voluto. Lo decide user1; nel frattempo `referenceProblems` non segnala `instalment.supplyId` né `contact.supplyIds`.
- **U5** (payer, non provato), **U8** (estratti.mjs), **U9** (unificare `undoImport`, `undoBillImport` e `cancelAutomaticClass`: la semantica è diversa, non è una sostituzione sicura), **U12** (operazioni senza annullo, punto 1), **U14** (regola di calcolo, decide user1).
- **Domanda 12 del disegno** (riscrittura intera della presenza): da confermare con user1. Per ora vale il rifiuto prudente.
