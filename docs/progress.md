# Registro di avanzamento

Stato generale (13 novembre 2026), tutto in `main`:

- **Piano 1** (fondamenta del motore): Fase A completata (Task 1-6, 8, 10 e 11; tabella sotto); le
  decisioni delle fasi successive sono nelle sezioni «Fase C» e «Rilievi minori rimandati».
- **Piano 2a** (lettura dei PDF di testo): Fase A (Task 1-11) e Fase B (Task 12, PR #12-#17: profili
  dei fornitori, fixture, campione a mano 57 su 57, periodo dell'acqua, utenze della TARI) completate.
  Restano fuori le scansioni (OCR) e il condominio, nel piano 2b.
- **Piano 4** (utenze condivise e appartamento nuovo): disegno e piano approvati, sei task eseguiti
  (PR #18-#19, R80-R82). Restano il flusso «Documento n di N» e il collegamento reale di
  «Modifica», «Aggiungi nota» e «Rimuovi».
- **Prossimi:** piano 6 (primo avvio che copia i profili di `python/seed-profiles/` tra i dati
  dell'utente), poi il disegno del piano 2b.

Lo tiene l'orchestratore: il registro completo (stato, giri di revisione, rilievi, decisioni) stava
in `.superpowers/sdd/`, escluso da git; qui ne resta la sintesi. Ogni task ha avuto un esecutore
nuovo, una revisione di conformità e qualità e, dove servito, giri di correzione con nuova revisione.
Alla fine una revisione dell'intero ramo e un'ultima ondata di correzioni.

| Task | Titolo                                                 | Stato      | Giri | Commit           | Note                                                             |
| ---- | ------------------------------------------------------ | ---------- | ---- | ---------------- | ---------------------------------------------------------------- |
| 1    | Scaffold del repository, protezioni e CI di base       | completato | 1    | 90e8d93..fb308e5 | Vite fissato a 7 (Vite 8 porta lightningcss, MPL-2.0)            |
| 2    | Importi e date                                         | completato | 0    | 3cac548          | R2, R4                                                           |
| 3    | Modello dei dati e compatibilità di versione           | completato | 1    | c7aeb66..14670e0 | campi sconosciuti scartati in lettura; schemi in `docs/schemas`  |
| 4    | Archivio su cartella, tollerante agli errori           | completato | 0    | 9fecc4b          | R5                                                               |
| 5    | Registro delle operazioni e annullamento               | completato | 1    | e76eb7d..d9ee114 | R1, R6, R10-R14                                                  |
| 6    | Impronte dei documenti, degli addebiti e registrazione | completato | 0    | 0dcec6c          | R1                                                               |
| 8    | Abbinamento di bollette e rate agli addebiti del CSV   | completato | 1    | 86f5e1c..2c39277 | R3, R15-R22                                                      |
| 10   | Interessi sulla caparra e restituzione                 | completato | 0    | f3a1916          | R7                                                               |
| 11   | Scheletro dell'app desktop e installer in CI           | completato | 0    | b1fca1b          | R9, R23, R24; build mai eseguita (vedi `apps/desktop/README.md`) |
| —    | Revisione finale dell'intero ramo e correzioni         | completato | 1    | 7dcd05b..693cc03 | R25                                                              |

## Decisioni prese durante l'esecuzione (Ruling)

Ognuna con il costo se è sbagliata.

- **R1** Il generatore di `id` è un argomento: `commitChange(store, input, clock, newId)`,
  `undoOperation(store, opId, profileId, clock, newId, opts?)`,
  `registerBill(store, bill, bytes, profileId, clock, newId)` (vincolo globale sulla purezza del
  core). Costo: un parametro in più da togliere.
- **R2** `daysBetween(a, b)` restituisce a − b con segno (valore del test del piano). Costo: segno
  invertito nella finestra dell'abbinamento.
- **R3** `splitSharedDebit` usa `splitCents` (resti ai resti maggiori, a parità al primo): solo così
  escono 101,04 € e 84,96 €. Costo: differenze di 1 centesimo nella TARI comune.
- **R4** Etichetta del periodo `intero-contratto`: `AAAA-AA` dell'anno di inizio e di fine
  (Lovarini 2024-04..2029-03 → `2024-29`). Costo: rinominare un'etichetta.
- **R5** Cartelle dei record `_app/dati/<tipo>/` con tipi `apartment, contract, tenancy, bill,
payment, transaction, instalment, match, note`; `_app/workspace.json`. Costo: costanti di percorso.
- **R6** `commitChange` scrive con `expectedRev = before?.rev ?? null`; una cancellazione scrive
  `{...before, deleted: true}`. Costo: ritocco della semantica del registro.
- **R7** Interessi legali: contano i mesi di calendario interamente compresi tra `from` e `to`
  (dà 883 nell'esempio). Costo: comportamento dei mesi parziali.
- **R8** Nomi dei pacchetti `@bollette/core`, `@bollette/store-fs`, `desktop`. Costo: rinomina.
- **R9** Nessun Rust in locale: versioni Tauri fissate con `=`, nessun `Cargo.lock`, nessuna
  etichetta di prova spinta (i minuti macOS costano). Build degli installer e prova del `.msi` a
  user1 dopo il merge. Costo: problemi di `build.yml` scoperti dopo il merge.
- **R10** Nel registro `after` è esattamente ciò che si scrive sul disco (rev incrementata;
  cancellazione = `{...before, deleted: true}`). Costo: cambio di formato prima che esistano dati.
- **R11** `commitChange` controlla le rev sul disco prima di scrivere il registro e rifiuta con
  `StaleWriteError`. Costo: resta una piccola finestra di concorrenza, documentata.
- **R12** `dependentsOf` è transitiva e ignora le coppie operazione annullata / annullamento; si può
  annullare un annullamento (ripristino). Costo: casi limite dell'annullamento.
- **R13** (sostituita da R14) Spareggio a parità di istante per rev.
- **R14** Per ogni record l'ordine delle operazioni è la catena delle rev, poi l'orario, poi l'id:
  gli orologi dei due computer possono non coincidere. Costo: modifica di una funzione d'ordine.
- **R15** Abbinamento automatico solo dove una voce ha un solo addebito possibile e viceversa;
  niente deduzioni per esclusione. Costo: più voci da confermare a mano.
- **R16** `BillMatch.amount` ha il segno della voce (bolletta pagata = positivo); le quote di
  `splitSharedDebit` hanno il segno della voce. Costo: segno da invertire nel Task 9.
- **R17** Abbinamenti presunti: `transactionId` `assumed-<itemId>`, data = scadenza o fine periodo.
  `id` degli abbinamenti deterministici `m-<tipo>-<voce>-<parte>-<addebito>`. Costo: schema degli id.
- **R18** La nota TARI usa il formato importi dell'esempio della specifica («186,00 €»). Costo:
  testo.
- **R19** Accettate le interpretazioni dell'esecutore sul Task 8: le voci ambigue sono anche in
  attesa; una voce già coperta in parte non si riabbina da sola; senza estratti tutto è presunto;
  i record `deleted` sono ignorati. Costo: piccoli cambi di comportamento.
- **R20** Una riga è commissione solo se è un addebito con un solo altro addebito più grande con lo
  stesso codice disposizione, sullo stesso conto, entro 2 giorni; nessuna soglia d'importo. Costo:
  una commissione registrata più di 2 giorni dopo resta non abbinata (visibile).
- **R21** Gli abbinamenti presunti si ricalcolano a ogni esecuzione (sezione 42, R2). Costo:
  nessuno.
- **R22** La commissione di un avviso comune si divide per peso tra gli appartamenti (R7). Costo:
  centesimi tra Berchet e Lovarini.
- **R23 e R24** `deny.toml` ammette esattamente le licenze dei vincoli globali più MPL-2.0. Le
  licenze in più che servono quasi certamente all'albero Rust di Tauri (Unicode-3.0, probabilmente
  Zlib) sono una scelta di user1 (sezione 40), presa l'11 novembre 2026: R29. Costo: la prima
  build su etichetta si ferma a `cargo deny`.
- **R25** Dopo la revisione finale si correggono subito: `parseEuro` con spazi interni ambigui,
  avviso comune incompleto che bloccava l'abbinamento, id duplicati e file con nome diverso dall'id,
  annullamento su record non allineato al registro, nota MPL-2.0, `expectedDebit`, build macOS più
  leggera e `Cargo.lock` come artefatto. Restano a user1: fornitore nella causale per l'abbinamento
  esatto (sezione 42 R2 contro il Task 8, deciso l'11 novembre 2026: R27) e abbinamenti rifiutati
  che tornano (piani 3-4). Costo: fino alla decisione un addebito con importo uguale ma di un altro
  fornitore può essere abbinato.
- **R260** (17 novembre 2026, piano 15, task 1 e 3; correzioni della revisione) Stato «da rivedere» di un documento: record `pendingDocument` (`_app/dati/pendingDocument/`, `docs/schemas/pendingDocument.json`, id `doc-<id nuovo>`): `apartmentId`, `fileHash`, `pages?`, `documentKind`. Nessun campo dei codici: si ricalcolano a ogni lettura e una copia invecchierebbe (via più semplice scelta in revisione). Non contiene la lettura né la proposta (piano 4: la proposta si ricalcola; alla conferma si rilegge il PDF). Lo stato si deriva: «da rivedere» finché non c'è una bolletta o rata viva dello stesso file con **le stesse pagine** (`pendingDocuments`); una parte registrata di un file intero in attesa non lo risolve (resta da rivedere, nessuna scomparsa silenziosa). `importBill` (`bill-import.ts`): `checkConsistency`, appartamento vivo, contesto della proposta dal disco, `proposalFromExtraction`; modo `auto`: `registerProposal` automatico se `decideRegistration` dice `auto-register`, altrimenti il doppione che `registerProposal` darebbe (`findProposalDuplicate`, nuova in `confirmation.ts`: `duplicate` o `possible-duplicate`, nessun `pendingDocument`), altrimenti `da-rivedere` con un'operazione `document.review` (`Documento da rivedere`) o nulla se un `pendingDocument` vivo dello stesso file, pagine e appartamento c'è già (idempotente); modo `manual`: `registerProposal` manuale (`confermata`). I codici vengono da `decideRegistration`, che ora restituisce `codes` accanto a `reasons` (`profile`, `ocr`, `reading-status`, `field:<campo>`, i codici dei controlli non `ok`, `none`), più `apartment-codes-unknown`. `undoBillImport`: `checkConsistency`; **limite:** un file con più documenti (pagine distinte tra record vivi e documenti in attesa) si annulla un documento alla volta, con `pages` (`--pagine a-b` o `--pagine intero`), altrimenti `several-documents`; rifiuto `has-dependents` se un `match` o un `tenantRecovery` vivo usa un record da annullare (il registro vede solo i percorsi); poi `undoFile` (nuova opzione `only`), che porta via anche il `pendingDocument`; `records` conta i record annullati. `readSupplierProfile` e `fileDocumentOf` di `confirmation.ts` ora esportate.
- **R261** (17 novembre 2026, piano 15, task 3) `knownCodes` (POD, PDR, codice cliente dell'appartamento) è un argomento obbligatorio di `importBill`: nessun record li conserva. Con la lista vuota il controllo `apartment-codes` della proposta tace, quindi il modo `auto` non registra mai e dà `da-rivedere` con `apartment-codes-unknown` (domanda 4 di R265).
- **R262** (17 novembre 2026, piano 15, task 5) La soglia del controllo esistente `consumption-anomaly` è obbligatoria anche da riga di comando (`bolletta --soglia-consumi <percentuale>`), come `--entro` di `scadenze`: il 30 esiste solo nei test.
- **R263** (17 novembre 2026, piano 15, task 2) Confronto consumi, **provvisorio e non collegato** (`consumption.ts`, `compareConsumption`: nessuno lo chiama, né `importBill` né la riga di comando). Le sue definizioni non sono decise e restano domande (R265): oggi usa appartamento e categoria come il controllo esistente `consumption-anomaly` (`yearBeforeBill`, codice condiviso con `proposal.ts`, `scaled` ed `exceeds` spostati), la stessa unità quando la bolletta ha un consumo, la media sulle sole bollette interamente dentro gli `recentMonths` mesi prima del primo mese, per mese di competenza, il prezzo unitario come importo / consumo (quote fisse e imposte comprese), nessuna metrica con riferimento ≤ 0, le bollette senza consumo fuori dalla media quando la bolletta ha un consumo (anche per l'importo). Restituisce i due lati grezzi e la differenza in punti base (arrotondata alla metà lontana da zero, solo da mostrare); `over` solo con una soglia del chiamante, esatto sugli interi. `RangeError` per mesi o soglie non interi o negativi e per un periodo che finisce prima di cominciare.
- **R264** (17 novembre 2026, piano 15, task 4 e 5; correzioni della revisione) Cruscotto (`dashboard.ts`, `loadDashboard`; `pnpm estratti cruscotto [--oggi] [--entro] [--anno] [--periodo-conguaglio <app>:<etichetta>]`): per ogni appartamento vivo conteggi per codice (solo > 0): `documento-da-rivedere`, `movimento-senza-uso` (movimento contabilizzato senza uso in `movementUses`, sull'appartamento del conto), `scadenza:<stato>` e `scadenza-controllo:<check>`, `contratto:<codice>`, `caparra:<stato>`, `condominio:<stato>` e `condominio:recupero-oltre-spesa`, `tasse:<stato>` e `tasse:stima-mancante` (solo con l'anno), `conguaglio:voci-in-attesa`, `conguaglio:posti-vuoti`, `conguaglio:non-calcolabile` (periodi indicati dal chiamante). Non si contano gli stati «fatto» (`pagata`, `versata`, `in-linea`); `assunta` si conta, perché R204 domanda 7 è aperta. Un caricatore rifiutato rifiuta tutto. **Sovrapposizioni (nessuna regola decisa, scelte prudenti e deterministiche):** una rata di condominio o TARI compare sia in `scadenza:` sia in `condominio:` (due liste esistenti: le famiglie non vanno sommate); una riga delle tasse è per contribuente e si conta su ogni appartamento del contribuente; una caparra di un inquilino in due contratti dello stesso appartamento si conta una volta, e vince lo stato diverso da `versata`. Niente semaforo né gravità (R204, domanda 3); la quota dei posti vuoti è un importo, solo con `--dettagli`. `bolletta <pdf> --appartamento --lettura <json di bollette_pdf extract> --soglia-consumi [--codici] [--conferma]` e `annulla-bolletta <pdf> [--pagine a-b|intero]`: senza `--dettagli` solo stato, id generati dall'app, codici, gravità dei controlli e conteggi (`records` annullati, `dependents`: gli id dei record che bloccano solo con `--dettagli`); gli errori di `undoFile` danno `has-dependents-bill` o `journal-not-aligned` come `annulla-riconciliazione`.
- **R265** (17 novembre 2026, piano 15) Domande aperte per user1: (1) soglie dell'allarme consumi (consumo, importo, prezzo unitario), livelli giallo e rosso, per appartamento o no; (2) quanti mesi per la «media degli ultimi mesi» e se normalizzare per mese o per giorno; (3) finestra «in scadenza» e colori del cruscotto (R204, domande 1 e 3); (4) dove conservare POD, PDR e codice cliente dell'appartamento; (5) quale periodo di conguaglio mostra il cruscotto (oggi lo indica il chiamante); (6) spostamento del file in `Bollette/...` all'importazione e ritorno in `Da_smistare` all'annullamento (oggi nessun file si muove; il record porta il percorso proposto); (7) il confronto dei consumi è per **fornitore** (spec sezione 21) o per **categoria** (come il controllo esistente); (8) le definizioni provvisorie di R263, scelte da altri e non risposte: media solo delle bollette interamente nella finestra, prezzo unitario = importo / consumo con quote fisse e imposte, metrica assente con riferimento ≤ 0, bollette senza consumo fuori dalla media dell'importo; (9) un file intero in attesa registrato a parti: va mostrato come «parzialmente registrato»? Non fatti: bollette attese per cadenza, saldo di cassa sulla Home, «va bene così» sugli avvisi, conguaglio «da aggiornare».
