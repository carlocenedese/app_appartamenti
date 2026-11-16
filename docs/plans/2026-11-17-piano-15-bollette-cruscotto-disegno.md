# Piano 15: flusso di importazione di una bolletta e cruscotto, parte di calcolo (disegno)

Stato: **disegno** (17 novembre 2026). Piano: `docs/plans/2026-11-17-piano-15-bollette-cruscotto.md`.
Solo core (`packages/core`) e riga di comando (`pnpm estratti`); **niente schermate, niente Python
nuovo**. Riferimenti: `docs/spec.md` sezioni 10, 21 (allarme consumi), 22, 30 e 42 (prevale);
`docs/progress.md` R73, R107, R204. Codice letto: `proposal.ts`, `confirmation.ts`, `dedupe.ts`,
`undo-file.ts`, `supply-store.ts`, `payables.ts`, `contract-store.ts`, `condo-store.ts`,
`tax-store.ts`, `excel-store.ts`, `conguaglio.ts`, `movements.ts`, `scripts/estratti.mjs`.

## Che cosa esiste già (non si duplica)

- Lettura: `python -I -m bollette_pdf extract` stampa un `ExtractionResult` (piano 2a/2b).
- Proposta: `proposalFromExtraction` (bolletta o rate TARI, controlli, confidenza, anomalia di
  consumo rispetto allo stesso periodo dell'anno prima con soglia data dal chiamante).
- Politica e scrittura: `decideRegistration`, `registerProposal` (doppioni prima della politica,
  una operazione del registro), `undoFile` (annulla tutto ciò che un file ha creato).

Manca: chi mette insieme i pezzi leggendo il contesto dal disco, uno **stato «da rivedere»**
persistente (una proposta non si conserva, piano 4; il cruscotto però deve contarle), il controllo di
coerenza prima di scrivere, un annullamento che non lasci abbinamenti appesi, la riga di comando.

## Obiettivo

1. **`importBill`** (`bill-import.ts`): `checkConsistency` → appartamento vivo → contesto della
   proposta dal disco (bollette, rate, permanenze, utenze) → `proposalFromExtraction` → in modo
   `auto` `decideRegistration`: se va a una persona si scrive (o resta) un record
   **`pendingDocument`** e l'esito è `da-rivedere` con i codici dei controlli; altrimenti
   `registerProposal`. In modo `manual` (l'utente conferma) `registerProposal` direttamente. Esiti:
   `registrata-automaticamente`, `confermata`, `da-rivedere`, `duplicate`, `possible-duplicate`,
   `rejected`, `refused`. Idempotente: lo stesso file dà `duplicate`; lo stesso «da rivedere» non
   riscrive nulla.
2. **`undoBillImport`**: `checkConsistency`, rifiuto se un abbinamento vivo (`match`) o un recupero
   vivo (`tenantRecovery`) usa un record del file, poi `undoFile`.
3. **Stato del documento**: `pendingDocument` vivo senza un record registrato dello stesso file e
   pagine = «da rivedere»; con il record = «confermata». Nessun aggiornamento a parte: lo stato si
   deriva.
4. **`compareConsumption`** (`consumption.ts`): per consumo, importo e prezzo unitario, il confronto
   con lo stesso periodo dell'anno prima e con la media dei mesi precedenti (finestra data dal
   chiamante). Restituisce i due lati grezzi e la differenza in punti base; con soglie passate dal
   chiamante segna `over`. **Nessun livello giallo/rosso, nessuna soglia predefinita.**
5. **`loadDashboard`** (`dashboard.ts`, sola lettura): compone i caricatori esistenti e restituisce,
   per appartamento, conteggi per codice: documenti da rivedere, movimenti senza uso
   (`movementUses`, la stessa definizione della riconciliazione), voci dello scadenziario per stato,
   controlli dei contratti, caparre non `versata`, rate di condominio per stato, righe delle tasse
   `discrepanza` o `da-verificare`, voci in attesa e quota dei posti vuoti dei periodi di conguaglio
   indicati dal chiamante. Niente semaforo, niente righe d'interfaccia.
6. **Riga di comando**: `bolletta <pdf>`, `annulla-bolletta <pdf>`, `cruscotto`. Senza `--dettagli`
   solo stati, codici, conteggi e id.

## Non obiettivi

- Schermate, semaforo, colori (R204 domanda 3), spostamento del file in `Bollette/...` e ritorno in
  `Da_smistare` (resta il percorso proposto nel record: compito dell'interfaccia o di un piano dei
  file), «va bene così» sugli avvisi, bollette attese per cadenza, saldo di cassa sulla Home
  (sezione 10), conguaglio «da aggiornare» (non esiste ancora uno stato del conguaglio).
- Qualsiasi soglia, finestra o regola di calcolo nuova.

## Decisioni (Ruling)

- **R260** stato «da rivedere» come record `pendingDocument` minimo (id `doc-<fileHash>` o
  `doc-<fileHash>-p<a>-<b>`): appartamento, impronta, pagine, tipo, codici dei controlli. Non contiene
  la lettura né la proposta: alla conferma si rilegge il PDF e la proposta si ricalcola (piano 4).
- **R261** `knownCodes` è un argomento obbligatorio (nessun luogo li conserva oggi); con lista vuota il
  modo `auto` non registra mai e dà `da-rivedere` con il codice `apartment-codes-unknown`.
- **R262** soglia dell'anomalia del controllo esistente: obbligatoria anche nella riga di comando
  (`--soglia-consumi`), come `--entro` di `scadenze`.
- **R263** confronto consumi: stesso appartamento e categoria (non fornitore: un cambio di fornitore non
  azzera lo storico), stessa unità; anno prima = bolletta con gli stessi mesi un anno prima (regola
  del controllo esistente, codice condiviso); media = bollette interamente dentro gli N mesi prima
  dell'inizio, normalizzata per mese di competenza; differenza in punti base arrotondata alla metà
  lontana da zero, solo da mostrare; il confronto con la soglia è esatto sugli interi.
- **R264** cruscotto: un caricatore rifiutato (`inconsistent-store`) rifiuta tutto il cruscotto.

## Domande per user1

1. Soglie dell'allarme consumi (consumo, importo, prezzo unitario), livelli giallo e rosso, e se
   diverse per appartamento (sezione 21 dice «di default semplici»): oggi solo parametri.
2. Finestra della media «degli ultimi mesi» (quanti mesi) e se normalizzare per mese o per giorno.
3. Finestra «in scadenza» del cruscotto (già R204 domanda 1) e gravità/colori (R204 domanda 3).
4. Dove conservare i codici dell'appartamento (POD, PDR, codice cliente) per il controllo
   `apartment-codes`.
5. Quale periodo di conguaglio il cruscotto mostra per appartamento (corrente? ultimo non chiuso?):
   oggi lo indica il chiamante.
6. Spostamento del file all'importazione e ritorno in `Da_smistare` all'annullamento: in questo piano
   o con l'interfaccia?
