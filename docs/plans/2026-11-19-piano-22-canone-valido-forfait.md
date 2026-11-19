# Piano 22: canone non incassato, «valido dal», forfait verificato

Decisioni di user1 del 19 novembre 2026. Ramo `feat/canone-valido-forfait` (da `feat/posti-vuoti-presenti`, PR #78). Formato dei dati 5 (autorizzato da user1 per i punti 2 e 3), alzato una volta sola.

## 1. Canone non incassato dopo una riapertura

Oggi: `canClosePeriod` dà `kind: 'rent'` per inquilino e mese (pagamenti `canone` confermati, prima all'affitto); `closePeriod` rifiuta (`cannot-close`), anche dopo una riapertura (R350, R357 a).

- `closePeriod`: con un periodo riaperto (`reopened`), l'affitto mancante non ferma più la chiusura; il risultato `closed` ha `rentMissing` (inquilino, mese, importo), l'avviso. Un periodo mai chiuso rifiuta come prima.
- L'importo non si salva nell'istantanea (nessun campo nuovo): si ricava dai pagamenti di oggi, che il controllo del periodo chiuso tiene fermi; un pagamento nuovo per quel mese lo toglie.
- `closingOf`: `ClosingRow.rentMissing` (riga «Canone non incassato»); fuori da `tenantBalance`, dal dovuto e dai saldi (l'affitto non è nel conguaglio, R4).
- Caparra (`closedPeriodLines`): riga «Canone non incassato <periodo>», trattenuta se la caparra è in mano, altrimenti in `toRequest` («da richiedere»), anche per il periodo d'uscita.
- Riga di comando: `chiudi-periodo` stampa l'avviso; `conguaglio-supplementare` il campo per inquilino (importi con `--dettagli`).
- Test: bonifico respinto per intero (R357 a): righe forfait e canone, nessun doppio conteggio; mai chiuso: rifiuto; caparra in mano e restituita.

## 2. «Valido dal» per posti e pesi della TARI

- Mesi interi: `YYYY-MM` (la presenza è a mesi interi).
- `Apartment.earlierBeds?: { to, posti, rooms? }[]`: i posti prima di un cambio, fino al mese `to` compreso; `posti`/`rooms` valgono dopo l'ultimo `to`. Un record senza voci vale da sempre. `bedsAt(apartment, month)` è l'unico punto di lettura (`bedsIn`, quindi conguaglio e `checkBeds`).
- `Supply.earlierApartments?: { to, apartments }[]`, stesse regole dei pesi (ogni appartamento una volta, somma 10000). `weightsAt(supply, month)`; la proposta di un avviso TARI usa i pesi del suo primo mese; un avviso a cavallo di un cambio non si propone (controllo `part-weights-changed`, domanda a user1).
- Scritture: `saveApartment` con `bedsValidFrom` e `saveSupply` con `validFrom`; riga di comando `appartamento --posti N [--posti-nomi …] --dal AAAA-MM --modifica` e `utenza --etichetta X --ripartizione … --dal AAAA-MM` (`--dal` come `contratto-canone`). Un mese non dopo l'ultimo cambio è rifiutato (`valid-from-order`); lo stesso mese dell'ultimo cambio corregge il valore nuovo.
- Controllo del periodo chiuso (`viewIn`): appartamento e utenza si confrontano con i valori in vigore nei mesi del periodo; un cambio dopo ogni periodo chiuso passa, uno retroattivo è rifiutato. `bedsConflictOf` e l'annullo (`bedsUndoBlockers`) controllano anche i mesi dei cambi.
- Test: conguaglio con cambio a metà periodo, guardia (passa / rifiutato), annullo, proposta TARI con pesi vecchi e nuovi, record vecchi.

## 3. Comando «forfait verificato»

- `markFlatChecked` (`period.flat-check`) su una chiusura viva: `periodClose.flatChecked[]` con inquilino, data, esito (`rimborso`, `credito`, `stessi-soldi`), importo (il «da verificare» di quel giorno) e movimento facoltativo. Copiato nella storia alla chiusura successiva e in `closeMarks`.
- Effetto, solo dove il nome dell'esito non lascia dubbi: `rimborso` e `stessi-soldi` tolgono l'importo da `toCheck` (azione, conteggio e righe «da verificare» della caparra); `remaining`, `mainRemaining`, supplementare e trattenuto non cambiano. `credito` si registra ma il forfait resta «da verificare» (dove va il credito è una domanda per user1).
- L'importo verificato vale fino a quanto è oggi in più: correggere il pagamento a mano resta possibile e non lascia crediti fantasma. Un saldo successivo salva `flatCollected` dal «da verificare» grezzo (R361 invariato).
- Rifiuti: `not-closed`, `unknown-tenant`, `unknown-movement`, `nothing-to-check`.
- Riga di comando: `forfait-verificato --appartamento --periodo --inquilino --data --esito rimborso|credito|stessi-soldi [--movimento <id>]`, annullabile con `annulla-riconciliazione`.
- Test: tre esiti, cap dopo una correzione, riapertura e nuova chiusura, annullo; test di modello con il comando.

## Chiusura

Formato 5 con `pnpm schemas:export` e impronta; regole R364 e seguenti in `docs/progress.md`; sezione 42 della specifica; `CLOSING_MODEL_SEEDS=500`; `node scripts/check-personal-data.mjs`.

## Seguito: risposte di user1 del 19 novembre 2026 e revisione

- Canone: ogni canone mancante del periodo riaperto; segno a mano `canone-non-incassato --esito richiesto|saldato|non-recuperabile` (`periodClose.rentMarks`), conteggio del cruscotto e prima riga dell'Excel.
- Pesi: avviso TARI diviso mese per mese con i pesi di ogni mese (anche A-B-A), una rata per appartamento e tratto; il controllo del dicembre (F4) legge i pesi dei mesi del periodo (reperto I1).
- Forfait verificato: `credito` va nel supplementare; `rimborso` è già rimborsato; ogni verifica è legata ai pagamenti dell'inquilino nel periodo (`payments`).
- Riferimenti `earlierApartments` e `transactionId` dei segni; test di modello con canone respinto e segni. Formato 5 invariato, impronta ricalcolata. R364–R369.
