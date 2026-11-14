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
  Carlo dopo il merge. Costo: problemi di `build.yml` scoperti dopo il merge.
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
  Zlib) sono una scelta di Carlo (sezione 40), presa l'11 novembre 2026: R29. Costo: la prima
  build su etichetta si ferma a `cargo deny`.
- **R25** Dopo la revisione finale si correggono subito: `parseEuro` con spazi interni ambigui,
  avviso comune incompleto che bloccava l'abbinamento, id duplicati e file con nome diverso dall'id,
  annullamento su record non allineato al registro, nota MPL-2.0, `expectedDebit`, build macOS più
  leggera e `Cargo.lock` come artefatto. Restano a Carlo: fornitore nella causale per l'abbinamento
  esatto (sezione 42 R2 contro il Task 8, deciso l'11 novembre 2026: R27) e abbinamenti rifiutati
  che tornano (piani 3-4). Costo: fino alla decisione un addebito con importo uguale ma di un altro
  fornitore può essere abbinato.
- **R26** Questo file lo scrive l'orchestratore, come dice il piano.
- **R27** (Carlo, 11 novembre 2026) Abbinamento esatto di una bolletta: serve anche il fornitore
  nella causale (sezione 42, R2). Se un solo addebito ha importo, finestra e conto giusti ma la
  causale non nomina il fornitore (confronto con `foldText`), l'abbinamento è una proposta
  (`confirmed: false`, `by: 'auto'`) da confermare a mano, non in `pending`. Rate e avvisi comuni
  non hanno un fornitore e restano confermati. Costo: se la regola è sbagliata, ogni addebito con
  causale generica chiede una conferma in più e, finché la voce non è confermata, la commissione di
  quell'addebito non la segue; tornare indietro vuol dire togliere il controllo in
  `matchToTransactions`.
- **R28** (Carlo, 11 novembre 2026) L'avviso TARI comune di Berchet e Lovarini resta ad abbinamento
  automatico quando l'addebito comune è uno solo, come fa il codice (Review Focus 16 del piano). La
  sezione 42, R3 è stata corretta di conseguenza (resti ai resti maggiori, come in R3 qui sopra).
  Costo: un addebito sbagliato ma dello stesso importo, sul conto di Berchet e nella finestra di
  date, verrebbe diviso tra i due appartamenti senza conferma.
- **R29** (Carlo, 11 novembre 2026) Ammesse anche le licenze Unicode-3.0 e Zlib, permissive e
  richieste dall'albero Rust di Tauri, in tutti i punti dove l'elenco è definito: `deny.toml`,
  `scripts/check-licenses.mjs` e il suo test, `CLAUDE.md`, i vincoli globali del piano 1 e la
  sezione 40 della specifica. Chiude la scelta lasciata a Carlo da R23 e R24. Costo: nessuno legale;
  `cargo deny` potrebbe ancora chiedere `Apache-2.0 WITH LLVM-exception`, da decidere alla prima
  esecuzione.
- **R30** (Carlo, 11 novembre 2026) Fase B, Task 7: resti di centesimo ai primi mesi e poi ai primi
  posti nell'ordine dell'Excel, scritto nel nuovo campo facoltativo `Apartment.rooms` (un nome per
  posto, unici); l'inquilino I di Berchet (ago-set 2025) ha pagato affitto e forfait;
  i 2.103,34 € del condominio Berchet 2024-25 sono la quota annua degli inquilini (controllo di fine
  esercizio del Task 9); il conguaglio condominiale 2023-24 di 1.302,68 € resta alla proprietà;
  finestra di abbinamento −5/+10 giorni dalla scadenza; tutte le differenze dall'Excel di
  `docs/rules/conguaglio-rules.md` sono `knownDeviations` accettate.
- **R31** (Carlo, 11 novembre 2026) La chiave privata degli aggiornamenti sta nella cartella iCloud
  di Carlo `Personale/App_appartamenti/chiave-firma-aggiornamenti/`, mai nel repository.
- Altre: `settlementPeriods` annuale rifiuta un inizio d'annualità diverso dal giorno 1; i commit
  degli esecutori riportano il modello che li ha scritti.

## Fase C (Task 9): decisioni dell'orchestratore

- **R32** Resti di centesimo: ogni mese la quota si divide sui `posti` nell'ordine di `Apartment.rooms`;
  senza `rooms`, prima gli inquilini presenti in ordine di `tenantId`, poi i posti vuoti.
- **R33** `byCategory` elenca solo le tipologie con un importo.
- **R34** `calcConguaglio` restituisce anche `warnings` (`contratto-mensile`: somma di affitti e
  forfait diversa da `contrattoMensile`), senza fermare il calcolo.
- **R35** Test dorato: se app ed Excel differiscono, `knownDeviations` non può essere vuoto; i
  motivi non sono legati riga per riga. `pnpm golden:report` scrive
  `reports/golden/<fixture>-differenze.md`, che si salva nel repository.
- **R36** Controllo di fine esercizio del condominio (passo 4b) generico, saltato finché nessuna
  fixture ha rate di condominio.
- **R37** La parte della proprietà si toglie solo dalle rate con `rata` diversa da 0; se supera la
  rata, la rata resta in sospeso con motivo «parte della proprietà maggiore della rata».
- **R38** Dati non calcolabili (stesso inquilino in due stanze nello stesso mese, due inquilini
  nello stesso posto, stanza sconosciuta, più inquilini dei posti, condominio con conguaglio senza
  inizio d'esercizio) danno `SettlementInputError` con un codice e un messaggio in italiano, prima
  di calcolare qualsiasi importo. La domanda della regola (c), «a chi assegnare il mese», si
  risolve correggendo le date dei contratti (piano 4).
- **R39** Nel conguaglio supplementare un inquilino senza contratti conta come uscito.

- **R40** (Carlo, 11 novembre 2026) La nota TARI scrive la data di emissione dell'avviso dopo il
  numero («Avviso 2026/1/89064 del 05/02/2026, periodo …»). Nuovo campo facoltativo
  `Instalment.issueDate` (la data di emissione, che gli Excel hanno già); `tariNote` la accetta come
  `avviso.issueDate` e, se manca, scrive il numero senza data come nell'esempio della specifica
  (sezione 42). La scadenza non sostituisce la data dell'avviso.

Rilievi minori rimandati dalla Fase C: azione `da-pagare` anche con differenza 0; avviso
`contratto-mensile` anche nei mesi con un posto vuoto e senza mese; `conguaglio.ts` lungo (circa
600 righe); `esercizioRange` facoltativo in `allocateInstalment`; rata negativa con
`quotaProprieta`; nel rapporto la colonna «Spese» non comprende la commissione; il conguaglio
supplementare non filtra i contratti di altri appartamenti.

## Da decidere con Carlo

Nessuna decisione aperta del piano 1; per il piano 2a vedi «Da confermare da Carlo» nella sezione del piano 2a, Fase A.

## Rilievi minori rimandati

Per fase in cui vanno affrontati.

- **Prima del Task 7:** file UTF-16 e fixture binarie (xlsx, pdf) non controllati da `data:check`;
  `.gitignore` senza png/heic/xlsm/docx/ods e senza estensioni maiuscole su Linux; `.gitattributes`
  normalizza i fine riga dei CSV futuri (`fixtures/** -text`); solo IBAN italiani riconosciuti.
- **Task 9 (golden:report):** la fixture di Berchet 2024-25 non contiene ancora gli importi dell'Excel
  per inquilino e per voce, che il rapporto delle differenze deve mostrare: aggiungerli allora.
- **Prima del Task 9:** `MatchResult` non dice quali abbinamenti esistenti ha scartato (chi li
  salva deve marcarli `deleted`); `coversFrom`/`coversTo` non confrontati con `rateCoverage`;
  `annualitaOf` con inizio 1 gennaio non va usato per etichettare l'anno TARI.
- **Prima del piano 4 (interfaccia):** abbinamenti rifiutati che tornano; nessuna registrazione
  forzata dopo un «possibile duplicato»; `registerBill` ignora i file di bolletta rotti nel
  controllo dei duplicati; chi rilegge e riscrive un record deve conservare i campi sconosciuti;
  nessun nuovo tentativo di `rename` su Windows.
- **Piano 6:** mai riparare da soli un record `diverged` (può essere solo la sincronizzazione in
  ritardo); file `.tmp-*` lasciati da scritture interrotte.
- Il resto (doppioni di piccole funzioni, lunghezza di `journal.ts`, avvisi di Rollup, `devCsp`)
  può aspettare.

## Piano 2a, Fase A (lettura dei PDF di testo, nessun dato reale)

Stato: **Fase A completata** (Task 1-11 di `docs/plans/2026-11-11-piano-2a-lettura-pdf.md`, ramo
`feat/piano-2a-fase-a`), con revisione finale dell'intero ramo e un'ondata di correzioni (R73). La
Fase B (Task 12: profili dei fornitori reali e fixture, con Carlo e PDF veri) è completata (R74-R81).
Il registro completo resta in `.superpowers/sdd/2026-11-11-piano-2a-lettura-pdf/`, escluso da git;
qui ne resta la sintesi.

| Task | Titolo                                               | Commit           | Decisioni          |
| ---- | ---------------------------------------------------- | ---------------- | ------------------ |
| 1    | Schemi del profilo e del risultato                   | bc612d4..ff1fd02 | R41, R44, R46      |
| 2    | Pacchetto Python, dipendenze, CI e controllo licenze | ff1fd02..ec7ea81 | R43, R45, R47, R48 |
| 3    | Importi, date e quantità all'italiana                | 3fd1337..ba04ef2 | R49, R50           |
| 4    | Lettura del PDF con coordinate                       | ba04ef2..4a2f614 | R51, R52           |
| 5    | Profili e estrazione dei campi                       | 4a2f614..717fb12 | R53-R58            |
| 6    | Risultato completo e riga di comando                 | 717fb12..652abaa | R59                |
| 7    | Costruzione di un profilo da una selezione           | 652abaa..9716f5b | R60-R62            |
| 8    | Proposta e controlli automatici (core)               | 9716f5b..aa21ea9 | R63-R65            |
| 9    | Politica di conferma e registrazione (core)          | aa21ea9..117eb70 | R66-R68            |
| 10   | Interprete Python incorporato nell'installer         | 117eb70..64d197d | R69-R71            |
| 11   | Prova di integrazione tra core e programma Python    | 64d197d..52753f0 | R72                |
| —    | Revisione finale e correzioni                        | 52753f0..        | R73                |

### Decisioni (Ruling) R41-R76

Ognuna: che cosa, perché, costo se è sbagliata.

- **R41** `valueType: 'quantity'` passa a `parse_quantity` il testo del gruppo scelto (`123,4 kWh`):
  un gruppo basta per numero e unità. Costo: i profili che mettono l'unità in un secondo gruppo
  vanno cambiati. (L'unità vuota è superata da R53.)
- **R42** Rata TARI dal mese della scadenza (1-5 → rata 1, 6-9 → rata 2, 10-12 → rata 3), esercizio
  = anno della scadenza; un periodo dichiarato diverso da quei 4 mesi dà l'avviso `tari-months`, così
  gli avvisi cumulativi vanno sempre in revisione. Costo: un terzo avviso in ritardo con scadenza a
  gennaio prende l'etichetta sbagliata, ma è segnalato e rivisto.
- **R43** Libreria PDF `pdfminer.six`, non `pdfplumber`, che porta Pillow (MIT-CMU, fuori elenco); la
  specifica dice solo «per esempio pdfplumber». Costo: nessuno.
- **R44** `ExtractionResult.status` ha anche `illeggibile` (PDF guasto o protetto): ogni PDF ha una
  risposta. Costo: uno stato in più per l'interfaccia.
- **R45** L'interprete Python (PSF-2.0) è accettato con la scelta di Python della specifica (sezione 8) ed elencato in `python/THIRD_PARTY.md`. Costo: una decisione di licenza che Carlo può rivedere.
- **R46** Le regole incrociate del profilo che JSON Schema non esprime (categoria e tipo, parti solo
  TARI, `validTo` ≥ `validFrom`, tipo di valore per campo, gruppi di cattura, niente gruppi con nome,
  lookbehind, flag in linea) stanno in `check_profile_rules` (Python), applicata da
  `validate('supplierProfile', …)`, e in Zod; i casi comuni sono in
  `python/tests/data/profile-cases.json`. Costo: regole doppie in due lingue, tenute allineate dai
  casi comuni.
- **R47** Python 3.13 invece di 3.12: con 3.12 `referencing` porta `typing-extensions` (PSF-2.0, fuori
  elenco). Costo: l'interprete incorporato deve essere una build 3.13.
- **R48** `cffi` resta a 2.0.0 perché 2.1.x dichiara MIT-0 (fuori elenco). Costo: un `cffi` più
  vecchio, senza problemi noti; da rivedere se Carlo ammette MIT-0.
- **R49** Date sempre giorno-mese-anno, mai indovinate; importi ambigui rifiutati (`1.234` senza due
  decimali, `1,5`, `1.234,5`): nel dubbio si rifiuta. Costo: un fornitore con importi a un decimale
  richiede un pattern che li normalizzi.
- **R50** `parse_euro` rifiuta un intero senza decimali (`100`): un intero preso per errore (consumo,
  pagina, codice) non deve diventare un importo. Costo: un `€ 100` senza decimali va in revisione
  (`missing`), mai con un valore sbagliato.
- **R51** (centro sostituito da R52) `all_texts=True` (il testo dentro i Form XObject non si perde);
  eccezioni concatenate con `from None` (nessun testo del documento nei log); il file si legge una
  volta sola, così l'impronta corrisponde ai byte letti. Costo: nessuno.
- **R52** Le righe si raggruppano sulla LINEA DI BASE (mediana di `page_height - matrix[5]` dei
  caratteri), tolleranza 2 pt, ordine pagina, base, x0; `top`/`bottom` restano il riquadro dei
  glifi. Costo: testi con matrici strane (ruotati) si raggruppano diversamente; le pagine ruotate
  sono rimandate.
- **R53** Un consumo letto senza unità non è un valore (`missing`): core e schema chiedono un'unità
  e senza unità non si confronta con l'anno prima; supera «unità vuota» di R41. Costo: una bolletta
  che stampa il consumo senza unità non ha il campo consumo (mai obbligatorio).
- **R54** ReDoS: i pattern vengono dal costruttore dell'app e dai profili rivisti; `re` non ha
  limite di tempo, quindi oltre al taglio a 400 caratteri del testo candidato chi chiama deve
  avviare `python -I -m bollette_pdf` con un limite di tempo e fermarlo (`runExtract` del Task 11 lo
  ha; il piano 4 lo usa). Costo: un profilo patologico blocca un'estrazione fino al limite; l'app
  resta reattiva.
- **R55** Se nessun profilo valido alla data legge tutti i campi obbligatori, il risultato è SEMPRE
  `da-confermare` (il ripiego non conta mai come riconosciuto). Costo: più revisioni.
- **R56** Profilo TARI con `parts`: nessuna parte trovata dà `parts-found` fallito, una coppia
  (etichetta, importo) ripetuta e fusa dà `parts-unique` fallito; entrambi portano a
  `da-confermare`. Costo: un avviso che ripete un'utenza su due pagine va sempre rivisto.
- **R57** `right` guarda solo la PRIMA riga a destra dell'etichetta (un valore mancante non si
  riempie con la colonna dopo); per `right` e `below` la confidenza è `high` solo se il valore
  occupa tutta la cella, a parte `€`, `EUR`, `euro`, parentesi, due punti e spazi. Costo: più
  revisioni per profili che catturano solo parte della cella.
- **R58** L'etichetta ignora la punteggiatura `: ; , .` ai bordi di ogni parola (`Totale da pagare`
  trova `Totale da pagare:`), sempre a parole intere. Costo: nessuno noto.
- **R59** (superata da R70 e R72) `python -I -m bollette_pdf` trova il pacchetto solo se installato
  nell'interprete. Costo: un passo d'installazione in più.
- **R60** `build_profile` tiene il parametro `now` (validato, non usato) e si verifica da solo:
  `extract` sullo stesso documento deve restituire i valori scelti con `high`, altrimenti
  `ValueError`. Costo: una selezione che non si rilegge è rifiutata invece di dare un profilo che va
  sempre in revisione.
- **R61** I pattern `same-line` del costruttore sono ancorati all'inizio del testo candidato
  (`^[\s:€]*(valore)`), con confine destro `(?![\d.,])` per numeri e date; il testo cattura
  esattamente le parole scelte. Un `1 234,56` con lo spazio come separatore diventa `missing`.
  Costo: qualche revisione in più.
- **R62** Le finestre d'etichetta con una parola che contiene cifre o si legge come importo, data o
  quantità sono scartate (cambiano da bolletta a bolletta); senza etichetta stabile, `ValueError`.
  I nomi di persona usati come etichetta non si riconoscono: il Task 12 rivede ogni etichetta prima
  del commit. Costo: un profilo nella cartella dati dell'utente può tenere un nome come etichetta.
- **R63** Un campo obbligatorio mancante dà una proposta `none` con un `fail` `missing-field` per
  campo, senza valori inventati (specifica §22). Costo: allargare la proposta nel Task 9 o nell'UI.
- **R64** Ratificati i controlli in più (rata duplicata `fail`, nome del file `warn`), l'esportazione
  di `MONTH_NAMES`, il `groupId` TARI da `newId()`, `includedInConguaglio`/`sharedWithTenants` veri
  per difetto, l'anomalia di consumo confrontata con l'id più piccolo tra i pari dell'anno prima.
  Costo: ritocchi locali.
- **R65** TARI condivisa (`ctx.supplies` non vuoto, ex `tariParts`) senza parti lette dà `fail` `missing-parts`
  (non tutto l'importo a un appartamento); lo stesso appartamento due volte in un avviso dà `fail`
  `duplicate-apartment`. Costo: più avvisi da confermare.
- **R66** `registerBill` tiene il tipo di operazione `register-bill` per difetto (test esistente);
  `registerProposal` passa i propri tipi. Costo: una riga e un test.
- **R67** Ratificati: id delle operazioni derivati (`op-<primo id>`, `profile-confirm-…`,
  `profile-auto-…`), controlli dei doppioni prima della politica automatica (`findBillDuplicate`
  pubblica), modo automatico più severo di «fail ⇒ rifiutato», `profileRev` diverso dal profilo ⇒
  revisione, tipo `instalment.register-auto`. Costo: ritocchi locali.
- **R68** Gli id delle operazioni derivati contengono l'istante del tentativo: un nuovo tentativo
  dopo una scrittura fallita non crea due file del registro con lo stesso id (che `readJournal`
  scarterebbe entrambi). Costo: id più lunghi.
- **R69** Tolti Tcl/Tk e tkinter dall'interprete incorporato (inutili, licenza TCL fuori elenco).
  bzip2 1.0.6 (stile BSD), SQLite (pubblico dominio) e `vcruntime140*.dll` (Microsoft Distributable
  Code) accettati come redistribuibili pur fuori elenco, elencati in `THIRD_PARTY.md` — da
  confermare da Carlo (vedi sotto). Costo: cambiare build dell'interprete o togliere moduli.
- **R70** Nel pacchetto dell'app `bollette_pdf` è copiato in site-packages invece di
  `pip install ./python` (pip vorrebbe setuptools non fissato; pip è tolto perché `certifi` è
  MPL-2.0); `python -I -m bollette_pdf` verificato. Costo: cambiare il passo di copia.
- **R71** Build «install only» non ridotta, come da piano (la ridotta pesa 22 MB contro 48 MB
  compressi); solo macOS aarch64 (niente Intel) — da confermare da Carlo. Costo: installer più
  grande; nessun Mac Intel.
- **R72** Sviluppo e CI usano `python/tools/dev_install.py` (file `.pth` verso `python/` del
  repository) invece di `pip install --no-deps ./python` (setuptools non fissato; `schemas.py`
  trova `docs/schemas` risalendo), solo in un virtualenv o con `CI=true`; il pacchetto dell'app
  (R70) copia pacchetto e schemi. Supera R59 per sviluppo e CI. Costo: cambiare il passo
  d'installazione.
- **R73** Un'unica ondata di correzioni dopo la revisione finale: `same-line` è `high` solo se prima
  del valore c'è solo rumore di cella e dopo non continua un numero; controllo `profile-unique`
  quando un altro profilo completo di fornitore, tipo o categoria diversi legge il documento;
  `registerProposal` in automatico legge il profilo dal negozio e applica `decideRegistration`;
  messaggi di `pdfminer` spenti; capture group controllati anche in Zod; il costruttore scarta
  etichette di solo rumore o con meno di 3 lettere. Costo: qualche revisione in più.
- **R74** (12 novembre 2026) Nell'app macOS `bin/python3` è l'unica copia dell'interprete:
  Tauri copia ogni collegamento simbolico come file intero (`python`, `python3`, `python3.13`
  erano tre copie da 18 MB, `.app` da 123 MB). `keepOneLauncher` in `bundle-python.mjs` toglie gli
  altri nomi e gli script `pydoc3*` e `*-config`, che nominavano `python3.13`. Primo giro su
  macOS: quarantena di Gatekeeper sul binario scaricato dal browser (`Killed: 9` finché non si
  toglie `com.apple.quarantine`); l'app firmata ad-hoc si apre con tasto destro, «Apri», ma la
  lettura dei PDF dall'app installata resta da provare. Costo: nessuno su Windows.
- **R75** (12 novembre 2026, Fase B, Task 12 parziale) Profili dei fornitori reali costruiti con Carlo presente, in
  sola lettura sulle cartelle di Dropbox (nessuna copia dei PDF; il rapporto stampa solo
  conteggi, le fixture contengono solo righe anonimizzate): Hera Comm (luce e gas),
  AcegasApsAmga (acqua e TARI Padova), Fastweb ed Enel Energia, in `python/seed-profiles/`, tutti
  `bozza`. Importo = «Totale da pagare» (decisione di Carlo, anche con «Altri servizi»;
  da confermare per il canone TV di Enel). Il riconoscimento non usa link (le fixture li cancellano)
  e `validFrom` è `2020-01-01` per i layout vecchi. Maggior tutela di Berchet, scansioni, `parts`
  della TARI condivisa e il campione di dieci PDF controllati a mano restano da fare. Costo:
  nessun profilo è approvato finché Carlo non rilegge `docs/rules/lettura-pdf.md`.
- **R76** (12 novembre 2026, Fase B) Dal controllo a mano di Carlo sul campione: il tipo `date-range`
  legge anche intervalli di mesi interi («Gennaio - Aprile 2024» è dal 1 gennaio al 30 aprile; con
  l'anno una volta sola, un primo mese dopo il secondo comincia nell'anno prima); nella posizione
  `below` le righe di un solo carattere (testo ruotato a margine) non contano per BELOW_ROWS;
  nuove regole per la nota di credito del gas («Totale fattura» negativo), il numero e il periodo
  di Enel 2020-23 (confidenza `medium`), il periodo e il numero della TARI e un profilo per la TARI
  2021-22. Decisione di Carlo: il periodo di una bolletta dell'acqua è l'unione dei periodi di
  consumo («rilevato» e «stimato»); non ancora implementata (il motore legge un solo intervallo
  per campo). Costo: i periodi a mesi interi sono una convenzione, da confermare.

### Da confermare da Carlo

- Licenze fuori elenco accettate da R69: bzip2 1.0.6 (stile BSD), SQLite (pubblico dominio),
  `vcruntime140*.dll` (Microsoft Distributable Code, redistribuibile con l'app Windows).
- PSF-2.0 dell'interprete Python (R45).
- Nessun interprete per Mac Intel: l'app macOS gira solo su Apple Silicon (R71).
- Archivio Windows dell'interprete non ridotto («install only», R71): installer più grande.

### Non verificato finché non gira `build.yml`

- Cartella d'installazione NSIS predefinita `%LOCALAPPDATA%\App Bollette`.
- I collegamenti simbolici `bin/` dell'interprete dentro l'app macOS universale di Tauri.
- MSI con circa 3000 file.
- Aumento di dimensione degli installer.

### Seguiti rimandati

- **R77** (12 novembre 2026, Fase B) Periodo dell'acqua come unione (decisione di Carlo, R76): un campo
  `period` può avere `combine: "span"`; allora tutte le regole si applicano a tutte le occorrenze
  delle loro àncore e il periodo va dal primo inizio all'ultima fine (`high` se ogni intervallo
  riempie la sua cella, altrimenti `medium`; ogni estremo ha la fonte della propria riga). Un
  intervallo non leggibile è saltato; senza `combine` vale ancora la prima regola. Schema, Zod e
  Python concordano (solo `period` accetta `combine`). Profili `acegas-acqua-2024` e `-2025`:
  «Consumo rilevato», «Consumo stimato», «relativi al periodo». Confermato da Carlo: con buchi o
  sovrapposizioni si prende comunque il minimo degli inizi e il massimo delle fini. Confidenza
  `medium` se un intervallo scritto non si legge o la stessa etichetta ha date diverse.
- **R78** (12 novembre 2026, Fase B) Carlo approva `docs/rules/lettura-pdf.md` e le fixture; il canone TV resta nel totale Enel; la TARI condivisa si ripartisce secondo la tabella in m² in fondo alla bolletta (da implementare con `parts`); maggior tutela senza profilo, in revisione a mano (decisione di Carlo). Campione a mano rifatto il 13 novembre 2026: 57 su 57 giusti.
- **R79** (13 novembre 2026, Fase B) TARI condivisa: i profili `acegas-tari-2024` e `-b` hanno `parts` (totale per utenza dalla tabella di pagina 2); regola di Carlo: l'importo da pagare si divide in proporzione ai totali delle utenze, TEFA dentro i totali; le perequative NON sono nei totali (tabella a parte, solo avviso di dicembre): la regola di Carlo di aggiungerle all'utenza non è ancora implementata. Fixture `acegas-tari-05` (due utenze, valori inventati) e utenza aggiunta alle 01, 02, 04.
- **R80** (13 novembre 2026) Record `supply` («utenza»): etichetta dell'utenza più `apartments: {apartmentId, weight}[]` (almeno uno, pesi in punti base (centesimi di punto percentuale), interi ≥ 1 con somma 10000, ogni appartamento una volta; cartella `_app/dati/supply/`). Sostituisce `ctx.tariParts` nella proposta: la parte letta si divide tra gli appartamenti dell'utenza in proporzione ai pesi, con `splitCents` (centesimi che non tornano: ai resti maggiori, a parità ai primi, la stessa regola di `splitSharedDebit`; **Ruling**: non quella dei posti letto R30 proposta a Carlo a voce, per coerenza con la ripartizione già in uso). Un'utenza di un solo appartamento ha peso 10000 e dà lo stesso risultato di prima. I pesi (punti base) li scrive l'utente. Controlli nuovi: `duplicate-supply` (due utenze con la stessa etichetta: nessuna proposta per entrambe), `part-share` (una quota arrotondata a zero: nessuna proposta per quell'utenza); le utenze cancellate o senza appartamenti non contano. **Approvata da Carlo (13 novembre 2026):** la ripartizione di una utenza tra più appartamenti per pesi, con i centesimi ai resti maggiori (la spec 42 R3 copre solo la divisione tra utenze). Schermata di collegamento e creazione dell'appartamento: piano 4. Da fare: sostituire `parts-total` con il confronto con «Totale dovuto» dell'avviso (non con la quota nuova).
- **R81** (13 novembre 2026, Fase B) `parts.add` (profilo, schema Zod e Python): secondo pattern con gli stessi due gruppi (etichetta, importo); l'importo si somma alla parte con la stessa etichetta. Usato per le perequative della TARI condivisa (decisione di Carlo). Il controllo `parts-total` è tolto (decisione di Carlo: confrontava la somma dei totali per utenza con la quota nuova e scattava sempre); resta `parts-found`. Schermate di collegamento utenze e appartamento nuovo: disegno a parte, piano 4.
- **R82** (13 novembre 2026, piano 4) Utenze e collegamento. Pesi di `supply.apartments` in punti base (10000 = 100%, somma 10000). `Apartment.address` e `Apartment.cadastre` (elenco di foglio, particella, subalterno); `Instalment.supplyId`; destinatario di nota `supply`; il profilo ha un pattern `parts.property` (5 gruppi: etichetta dell'utenza, indirizzo, foglio, particella, subalterno; imposta l'immobile della parte con quell'etichetta). `suggestApartments`: se c'è almeno una corrispondenza di catasto (esatta) restituisce solo quelle; altrimenti confronta l'indirizzo con il tipo di via nella chiave (Viale Roma 10 non è Via Roma 10; V., Gal., P.za, C.so sono abbreviazioni del tipo canonico); un indirizzo senza tipo corrisponde a uno con tipo. Pezzi del core: `newDraft` (una riga per suggerimento, 100% se unico, una riga vuota se nessuno), `draftFromSupply`, `linkSupply` (rifiuta un'etichetta già usata da un'utenza viva), `updateSupply`, `removeSupply` (cancellazione logica), `addSupplyNote`, `liveSupplies`. Schermate in `apps/desktop` senza framework (DOM puro, `happy-dom` 21.0.4 come devDependency solo dei test), viste sottili sul core; la demo con dati inventati è dietro `#utenze-demo` e solo nella build di sviluppo. **Ruling**: «Rimuovi» non chiede conferma, perché la cancellazione è logica e si annulla dal journal. Seguiti: flusso «Documento n di N»; PDF affiancato con evidenziazione; collegare Modifica, Aggiungi nota e Rimuovi nell'app vera; inserire indirizzo e catasto in Impostazioni, Appartamenti e nella procedura guidata; note del fornitore accanto alle rate; la sostituzione di `parts-total` è stata tolta (R81); suggerimento dal conto bancario; più immobili per utenza (si legge solo il primo).
- **R83** (13 novembre 2026, piano 6) Profili dei fornitori iniziali. L'installer porta i file di `python/seed-profiles/` (11) come risorsa `seed-profiles/` accanto a `python/` (`tauri.conf.json`; `scripts/bundle-python.mjs` li controlla con `checkSeedProfiles(…, 10)` e li copia in `resources/seed-profiles/`, non versionata). `seedProfiles` (core) va chiamata una sola volta, alla creazione della cartella di lavoro da parte del primo avvio (che non esiste ancora): scrive i profili mancanti in una sola operazione `profiles.seed`, annullabile, salta i non validi, gli id non sicuri e i già presenti. **Decisione di Carlo (13 novembre 2026):** dopo la creazione i profili non si aggiornano mai con l'app. Da fare: procedura guidata del primo avvio, che legge le risorse e chiama `seedProfiles`.
- **R84** (13 novembre 2026, piano 6) Primo avvio, come costruito. `apps/desktop/src/machine-settings.ts`: un file `machine-settings.json` nella cartella di configurazione dell'app (mai nella cartella condivisa), validato con Zod (`folder`, `userId`, `language`, `pendingWorkspace`); file mancante o non valido dà `{}`. `apps/desktop/src/first-run.ts`: «Crea gruppo» fissa gli id una volta, li salva in `pendingWorkspace` prima di `createWorkspace` e li riusa se si riprova con la stessa cartella; «Unisciti a un gruppo»; «Chi sei?» (scegliere o creare un utente) se l'utente della macchina non è nella cartella; messaggi di sola lettura; con sincronizzazione `behind` il pulsante «Ripara» chiama `repairDiverged` solo al clic; presenza scritta ogni minuto (finestra di 3 minuti, passati come argomenti, timer iniettato e fermabile) e avviso «<nome> sta lavorando». Un solo pulsante principale per schermata. Agganciato a `main.ts` solo con `#primo-avvio` in sviluppo. Il permesso `fs` per il file delle impostazioni è limitato a `$APPCONFIG/machine-settings.json` (lettura e scrittura) e a `mkdir` di `$APPCONFIG`.
  - **Ruling:** terzo plugin `tauri-plugin-persisted-scope` 2.4.2 accettato (è l'unico modo di tenere il permesso sulla cartella dopo un riavvio senza Rust proprio).
  - **Ruling:** nessun `fsync` prima del `rename`, e un `.tmp-*` rimasto dopo un `rename` fallito è accettato per ora (un'interruzione di corrente subito dopo una scrittura può lasciare un file vuoto o vecchio che Dropbox sincronizza; si riconosce come `malformed-json`, non passa inosservato).
  - **Ruling:** la sincronizzazione ha due stati, `'ok'` e `'behind'`. Un file del giornale illeggibile o di versione più nuova la porta a `behind`; una copia in conflitto di un file del giornale è solo un problema; `schema-mismatch` e `id-mismatch` di un file del giornale non bloccano.
  - **Ruling:** solo compatibilità, sincronizzazione `behind` e `workspace.json` non valido rendono la cartella di sola lettura.
  - **Ruling:** i file di presenza non sono record.
  - **Ruling:** lo spike è NON PROVATO nell'app vera finché una build in CI senza `--locked` non rigenera `Cargo.lock` (procedura nel README) e non si fa una prova a mano di scelta cartella, scrittura e riavvio, anche con nomi di cartella con `[ ] * ?` e accenti.
  - **Ruling:** l'app passa `CORE_SCHEMA_VERSION` a `checkCompat`/`assessWorkspace`.
  - **Da fare:** schermata «Documento n di N», aggiornamenti firmati, iCloud (regola dei nomi dei conflitti), la prova nell'app vera. I profili iniziali di `main.ts` ora si leggono con `import.meta.glob` da `python/seed-profiles/` a tempo di build (stessi file dell'installer, senza rete); da rivedere quando l'app vera leggerà `resources/seed-profiles/`.
  - **Ruling:** «Crea gruppo» rifiuta (decisione di Carlo, 13 novembre 2026) una cartella con `workspace.json` oppure con file in `_app/journal` o `_app/dati`, tranne la ripresa di una creazione interrotta dello stesso gruppo (tutte le operazioni del registro sono dello stesso `user.id`, nessun altro utente). Messaggio in italiano nella procedura.
  - **Ruling:** dopo un rifiuto `pendingWorkspace` si cancella: non è una creazione interrotta e la stessa cartella verrebbe rifiutata di nuovo.
  - **Ruling:** con `behind` dovuto solo a un file del registro troncato o più nuovo, la procedura non offre «Ripara» (non c'è niente da riparare) ma «Ricontrolla»; «Continua» in «Chi sei?» si disattiva durante l'operazione; una copia in conflitto di `workspace.json` compare tra i `problems` di `assessWorkspace`.
  - **Da fare PRIMA di rendere raggiungibile il wizard** (oltre a `Cargo.lock`): «sola lettura» non offre ancora l'apertura in sola lettura dei dati; i nomi della presenza si fissano all'apertura di «Gruppo pronto».
- **R85** (13 novembre 2026, piano 2b-1, Task 6) Profili dell'acqua scansionata, rapporto e prova in CI. **Numero fuori ordine:** R85 era riservato a questo task, R84 è del piano 6 (ramo del primo avvio): da rinumerare quando i rami si uniscono. **Fatto:** (1) due correzioni del Task 5: `_check_inflates` si ferma appena l'uscita supera i byte dichiarati (nessuna bomba di decompressione espansa per intero) e continua a chiedere senza ingresso finché zlib ha uscita in attesa e `unconsumed_tail` è vuoto (un PNG valido non risulta più guasto); (2) fixture sintetica `fixtures/pdf/acegas-acqua-ocr-01.json` (testo, importo 87,40, date e numero di fattura inventati, layout «due colonne» di `acegas-acqua-02`, `textSource` `ocr`, confidenza per parola 87-96, il `€` letto come `E`): il profilo `acegas-acqua-2025` la legge come `da-confermare`, importo, scadenza e numero giusti, nessun campo `high`; con la confidenza dell'importo a 40 il campo resta vuoto. **Nessun profilo cambiato:** i pattern già tollerano `€` come testo qualunque dopo il valore; un `€` letto come `E` _prima_ del numero non si leggerebbe, ma nei due layout dell'acqua il segno sta dopo, e non si allarga un pattern senza una scansione che lo mostri. `test_real_layouts.py` fissa il numero inventato (`INVENTED_NUMBERS`). (3) `pdf_report.py` conta per `textSource` e per avviso «OCR non disponibile» e accetta `--ocr-data`. (4) CI: `ci.yml`, solo macOS, scarica i dati con `scripts/ocr-data.mjs` (`fetchOcrData`, impronta controllata) in `$RUNNER_TEMP/ocr-data` e lancia `pnpm python:test` con `REQUIRE_OCR=1` e `BOLLETTE_OCR_TEST_DATA`; Ubuntu e Windows invariati (saltano le prove del motore); `build.yml` controlla che l'app macOS contenga `Contents/Resources/ocr-data/ita.traineddata`. Nessun workflow è stato eseguito. (5) Conteggi sulle scansioni reali in `docs/rules/lettura-pdf.md` (solo numeri). **Corretto il testo di R87:** la media della confidenza copre le parole della cella o della riga **senza l'ancora**. **Seguiti aperti:** OCR su Windows (rimandato, DLL LGPL); la ruota macOS di tesserocr copre una build `universal-apple-darwin`? (l'interprete incluso è solo arm64: da vedere alla prima esecuzione di `build.yml`); campione di dieci scansioni da controllare a mano con Carlo; **160 PDF con testo e qualche pagina solo immagine diventavano `mixed` e quindi `da-confermare`: risolto nel task 7 con la regola per campo di R87 (conteggi aggiornati in `docs/rules/lettura-pdf.md`); PNG con alfa o interlacciati sono `illeggibile`; JPEG solo a 8 bit; gli importi di `parts` e `items` non sono filtrati per confidenza (risolto nella revisione finale, vedi R87); messaggi di Leptonica sull'errore standard (risolti nel task 7).
- **R86** (13 novembre 2026, piano 2b-1, Task 3) Lettore OCR (`python/bollette_pdf/ocr.py`). Numero R86 perché R84 è riservato al piano 6 e R85 al Task 6 di questo piano. **Ruling** (scelte lasciate al costruttore): una pagina passa dall'OCR quando non ha testo oppure quando più del 30% dei suoi glifi sono `(cid:N)` (ogni `(cid:N)` conta un glifo; `CID_GLYPH_LIMIT = 0.3`); la pagina si disegna a 300 punti per pollice (`OCR_DPI`), in scala di grigi, sulla MediaBox (le coordinate di pdfminer), e le coordinate delle parole si convertono in punti dall'angolo in alto a sinistra: misurate su una pagina sintetica, scarto orizzontale entro 1,2 pt e linea di base entro 0,12 pt rispetto al testo dello stesso PDF; in verticale il riquadro OCR è quello dell'inchiostro, fino a 3,3 pt più stretto di quello del carattere (14 pt). Al massimo 20 pagine (`MAX_OCR_PAGES`), le altre restano come sono, con un avviso in italiano senza testo del documento. `Document.text_source`: `ocr` se nessuna pagina tiene testo del PDF, `mixed` se alcune lo tengono, `pdf` se nessuna pagina è passata dall'OCR; `Document.ocr_pages` elenca le pagine lette con l'OCR (task 7) (anche senza motore, senza dati o con un errore del motore, che non si segnala). Ogni parola OCR ha `confidence` 0-100, che `dump_document`/`load_dump` conservano insieme a `textSource` e `warnings` (facoltativi nei dump vecchi). Un solo thread (`OMP_THREAD_LIMIT=1` prima di caricare il motore; la ruota macOS di tesserocr 2.12.0 non usa OpenMP); i messaggi di Tesseract vanno a `os.devnull` e, dal task 7, il descrittore 2 va a `os.devnull` durante ogni chiamata al motore (costruzione e lettura), perché Leptonica scrive «box outside rectangle» direttamente lì. Da fare nel Task 4: `textSource` nello schema, stato e limite `medium`, l'avviso nel risultato. **Correzione della revisione finale (13 novembre 2026):** una pagina la cui MediaBox a 300 dpi supera i 30 megapixel (`MAX_PIXELS` di `images.py`, lo stesso tetto delle immagini) non va all'OCR e un errore (anche `MemoryError`) su una sola pagina salta solo quella pagina: le altre restano lette. La pagina saltata resta com'era (senza testo, o con il suo testo rovinato) e il documento porta l'avviso costante `OCR_PAGE_WARNING`, senza contenuto di pagina.
- **R87** (13 novembre 2026, piano 2b-1, Task 4) `textSource` e testo letto con l'OCR. Numero R87 perché R86 è del Task 3, R84 del piano 6 e R85 del Task 6. `ExtractionResult.textSource` (`pdf`, `ocr`, `mixed`) è obbligatorio nello schema Zod e nell'uscita di Python (dal `Document.text_source`; `pdf` anche per `illeggibile`). **Regola per campo (correzione del 13 novembre 2026, task 7; approvata nel disegno, «Obiettivi» 2):** il risultato porta anche `ocrPages` (numeri di pagina da 1, ordinati, quelli di `source.page`; vuoto con `pdf`), obbligatorio nello schema Zod e nell'uscita di Python (facoltativo solo in `load_dump` per i dump vecchi). Un campo con `source.page` in `ocrPages` ha confidenza al massimo `medium`; un campo senza fonte o letto da una pagina di testo tiene la sua confidenza (anche con `mixed`). Con `ocr` (scansione intera) nessun campo è `high`, compreso il fornitore del profilo (fonte nulla), e lo stato non è mai `riconosciuta`; con `mixed` lo stato è `da-confermare` solo se un campo con valore è stato letto da una pagina OCR, altrimenti vale come per un PDF di testo. Lo schema Zod rifiuta: `ocrPages` non vuoto con `pdf`; `ocr` con un campo `high` o `riconosciuta`; un campo `high` letto da una pagina OCR; `riconosciuta` con un campo con valore letto da una pagina OCR. **Questa regola ha sostituito il tetto su tutto il documento del task 4** (ogni campo `medium` e `da-confermare` con `mixed`), scritto perché lo schema rifiutava un campo `high` con qualunque OCR e l'estrattore non distingueva le pagine: la corsa sui PDF veri ha mostrato 160 PDF con testo e una pagina solo immagine (retro, codice a barre) declassati per intero, con le riconosciute scese da 103 a 28 (Berchet) e da 139 a 61 (Pulci), contro il disegno approvato. Un campo resta vuoto (`null`, `missing`, nessuna fonte) se il valore non passa il suo riconoscitore **oppure** se la confidenza media delle parole OCR del testo che lo contiene (la riga o la cella in cui si cerca il valore, con il valore ma **senza l'ancora**) è sotto `OCR_MIN_WORD_CONFIDENCE = 70` (0-100, `extract.py`); le parole di un testo del PDF non hanno confidenza e non si filtrano mai. `decideRegistration` dà `review` (motivo in italiano) per `ocr`, e per `mixed` solo se un campo con valore ha `source.page` in `ocrPages`; altrimenti decide come per un PDF di testo. `proposalFromExtraction` funziona come prima. `extract()` mette `doc.warnings` (OCR non disponibile, limite di pagine) dopo gli avvisi dei profili, senza ripetizioni, anche nei risultati `senza-testo` e `non-riconosciuta`. **Correzione della revisione finale (13 novembre 2026, regola comune a Python e Zod):** le `parts` (e le righe di `items` che formano la somma del controllo `items-sum`) lette da una pagina OCR passano per lo stesso filtro di un campo: se le parole della corrispondenza hanno confidenza media sotto `OCR_MIN_WORD_CONFIDENCE` la voce è esclusa con l'avviso di voce non leggibile; una voce tenuta che viene da una pagina OCR rende il risultato `da-confermare` (mai `riconosciuta`). Zod rifiuta `riconosciuta` con una `part` letta da una pagina in `ocrPages`; `decideRegistration` dà `review` (motivo OCR) se un campo **o una `part`** con valore viene da una pagina OCR di un `mixed`.
- **R88** (13 novembre 2026, piano 2b-1, Task 5) Immagini JPEG e PNG come ingresso, senza dipendenze nuove. `read_pdf` riconosce un'immagine dalle **prime byte** (JPEG `FF D8 FF`, PNG `89 50 4E 47 0D 0A 1A 0A`), mai dall'estensione (un PDF chiamato `.jpg` si legge come PDF, un PNG chiamato `.pdf` come immagine) e la legge come **una pagina** dallo stesso percorso OCR di un PDF scansionato (`textSource` `ocr`, tetto di confidenza e stato di R87); la riga di comando (`extract`, `build-profile`) accetta il percorso di un'immagine come quello di un PDF; l'hash è quello dei byte del file. **Risoluzione:** 300 punti per pollice; quella dell'EXIF (JPEG, `XResolution` con `ResolutionUnit`) o del blocco `pHYs` (PNG, in metri) se c'è ed è tra 72 e 1200, altrimenti 300; la pagina misura `pixel * 72 / dpi` punti, quindi le coordinate sono in punti come quelle di un PDF, e il motore disegna la pagina a quella stessa risoluzione (un pixel dell'immagine per pixel letto, nessun ricampionamento: una foto a 72 dpi non si ingrandisce di quattro volte). **Orientamento:** il valore EXIF 1-8 del JPEG (rotazioni e specchiature) è la matrice con cui l'immagine è disegnata sulla pagina, quindi una foto da telefono si legge dritta; nessuna correzione dell'inclinazione, e il PNG non ha orientamento. **Nessuna dipendenza:** `bollette_pdf/images.py` legge solo le intestazioni (firma, dimensioni, risoluzione, EXIF, struttura, CRC dei blocchi PNG, dati IDAT che si espandono alla dimensione dichiarata) e impacchetta i byte in un PDF di una pagina (il JPEG com'è con `DCTDecode`, il PNG con i suoi dati compressi e `FlateDecode` con predittore PNG); i pixel li decodifica pdfium quando disegna la pagina, e Pillow resta fuori. **Limiti:** oltre 30 megapixel (`larghezza * altezza > 30_000_000`), file corrotto o troncato (senza `FFD9`, CRC sbagliati, dati più corti del dichiarato), JPEG non 8 bit o non a 1 o 3 componenti (niente CMYK, niente lossless) e PNG con canale alfa o interlacciato danno `illeggibile` (un risultato, mai un'eccezione), con un messaggio italiano che non cita il file. Questi controlli non usano il motore e valgono su ogni piattaforma; senza motore (Windows) un'immagine valida dà `senza-testo` con l'avviso `OCR_UNAVAILABLE_WARNING`. Un PNG con alfa o interlacciato richiederebbe uno sfiltraggio PNG in Python puro (troppo lento a 30 megapixel) o una libreria: rimandato, da riprendere se serve.
- **Dalla rilettura finale:** una regola «stessa riga» scritta a mano con testo tra etichetta e
  valore (`Totale da pagare (IVA inclusa) 98,46`) dà `medium`: tenerne conto nei profili della
  Fase B. `registerProposal` legge il profilo prima dei controlli sui duplicati (un errore di I/O
  su quel file lancia invece di segnalare il duplicato). Mancano test su `readSupplierProfile` con
  JSON malformato, id non sicuri e id non corrispondente (verificati a mano, tutti rifiutati).

- **Fase B / piano 4:** il costruttore scrive `identifiers: []`, quindi il controllo dei codici
  dell'appartamento (`knownCodes` vuoti) manca o blocca sempre: decidere come il profilo impara gli
  identificativi (I6 della revisione finale).
- **Piano 4:** il limite di tempo dell'estrazione (R54) c'è solo nell'helper dei test
  (`runExtract`), non ancora in un esecutore di produzione; la riga di comando non dice quale campo
  ha impedito di costruire il profilo; Task 9 M1 (registrare di nuovo dopo un annullamento dà
  `StaleWriteError`), M3 (una scrittura TARI parziale risulta doppione al nuovo tentativo: prima
  `repairDiverged`/`checkConsistency`), M4 (`checkConsistency` non segnala lo stato di R68).
- **Task 12:** rivedere che nessuna etichetta dei profili sia un nome di persona (R62).
- **Lettura degli importi e delle date (`parse.py`):** `\d` → `[0-9]` e sequenze di cifre limitate
  (`{1,12}`); espressione dell'unità delle quantità troppo larga (`12 gennaio`); zeri iniziali delle
  quantità non normalizzati; test mancanti del Task 3 (`€ -63,00`, `€98,46`, NBSP, `29/02/24`,
  anno a 5 cifre, `00/00/2025`, separatori misti).
- **Lettore (`reader.py`):** `char_margin` 2.0 fonde etichetta e valore vicini; pagine ruotate;
  MediaBox invece di CropBox; `(cid:N)` e legature contano come testo; `except Exception` presenta
  errori del modulo come «file corrotto»; raggruppamento delle righe di `Layout` diverso da quello
  del lettore; un `€` da solo nella sua cella a sinistra del valore dà `missing`.
- **Riga di comando:** il file è letto due volte (impronta per `illeggibile`, poi `read_pdf`);
  `--help` ignora lo stdout passato; il risultato `illeggibile` perde gli avvisi dei profili.
- **Schemi:** gruppi atomici e quantificatori possessivi accettati da Python 3.11+ ma non da
  JavaScript; l'accoppiata `profileId`/`profileRev` non è imposta in Zod; `decideRegistration`
  ignora `profile.deleted` (`registerProposal` tratta un profilo cancellato come assente).
- **Pacchetto dell'interprete (`bundle-python.mjs`):** collegamenti simbolici che escono dalla
  cartella; un redirect https→http seguito (l'hash protegge); `include/` e `share/man` inutili
  inclusi; variabili `PIP_*` ereditate; `BOLLETTE_SCHEMAS_DIR` può cambiare gli schemi anche
  nell'app installata.
- **Proposta:** il controllo del numero doppione ignora spazi interni e varianti del nome del
  fornitore; `safeWord` perde le lettere non scomponibili.
- **Sviluppo:** il `.pth` di R72 mette tutta `python/` (anche test e strumenti) in `sys.path`.
- **R89** (13 novembre 2026, piano 2b-1, Task 8) Riconoscimento delle scansioni su testo normalizzato. **Approvata da Carlo il 13 novembre 2026** (normalizzazione e ancore); le 39 scansioni reali non erano riconosciute da nessun profilo perché le frasi di `recognise.allOf` (più parole) non sopravvivono all'OCR (a capo, punteggiatura, accenti). **Regola:** le righe delle pagine OCR (`Document.ocr_pages`) si confrontano con `normalize_ocr` (`profiles.py`): NFKD senza segni combinanti (accenti), minuscolo, ogni sequenza di caratteri che non sono lettere o cifre (punteggiatura, spazi, a capo) diventa uno spazio, bordi tolti; la stessa normalizzazione si applica alle frasi del profilo (`allOf` e `noneOf`). Le righe delle pagine di testo del PDF si confrontano come prima (`normalize`: NFC, minuscolo, spazi collassati): nessun cambio per i PDF di testo. Una condizione è soddisfatta se compare nel testo PDF normalizzato oppure nel testo OCR normalizzato (in un `mixed` ognuna delle due fonti vale per le sue pagine; una frase che riunisce righe di pagine di fonte diversa non esiste); una condizione fatta solo di punteggiatura non corrisponde mai nel testo OCR. Le frasi possono attraversare le righe (le righe si uniscono con un a capo, poi collassato). Solo Python valuta il riconoscimento (il core TypeScript non lo fa, e `profile-cases.json` prova solo la validità dei profili): nessun caso nuovo lì. **Non fatto, fermato per una decisione:** le ancore alternative a parola singola per fornitore (acqua, TARI, Enel, Hera, Acegas) richiedono un'alternativa in `recognise` (oggi solo `allOf` e `noneOf`, senza `anyOf`) e quindi un cambio dello schema (JSON Schema, Zod, Python), oppure profili separati che valgono anche per i PDF di testo (falsi positivi, escluso). Conteggi della seconda corsa in `docs/rules/lettura-pdf.md`.

- **R90** (13 novembre 2026, piano 2b-1, Task 9) Ancora alternativa per le scansioni: `recognise.ocrAnyOf`. **Approvata da Carlo il 13 novembre 2026** (campo opzionale, array di stringhe, in JSON Schema, Zod e Python). **Regola** (corretta dalla revisione finale, approvata da Carlo): un documento con `text_source` `ocr` (interamente OCR; mai un `mixed`) è riconosciuto da un profilo se soddisfa `allOf` oppure contiene, come parola o frase intera nel testo normalizzato con `normalize_ocr` (R89), almeno un testo di `ocrAnyOf`; `noneOf` esclude comunque (valutato per primo). Un PDF di testo e un `mixed` (pagine di testo e pagine OCR) ignorano `ocrAnyOf` del tutto, quindi nessun falso positivo; un profilo senza `ocrAnyOf` non cambia. Validità (Zod, `check_profile_rules`, casi in `profile-cases.json`): stringhe non vuote, con almeno una lettera o cifra una volta normalizzate, senza ripetizioni dopo la normalizzazione; l'elenco vuoto è valido. Profili seed, una parola **di fornitore** ciascuno: Acegas (acqua e TARI) «acegas», Enel «enel», Fastweb «fastweb», Hera (luce e gas) «hera»; mai la stessa per fornitori diversi (test); le parole di servizio («kwh», «smc», «idrico», «tari») sono state tolte perché attribuivano la scansione di un altro fornitore a Hera o Acegas. Profili dello stesso tipo che riconoscono lo stesso documento si risolvono come prima (R55: validità e completezza, poi `validFrom` più recente, poi `id`); tipi diversi restano segnalati da R73. **Tentativo unico e a tempo (Carlo: le scansioni sono un extra):** se le scansioni restano poco riconosciute si ripiega su «da rivedere» e inserimento a mano, senza altri ritocchi. Esito sulle 39 scansioni reali (solo conteggi, `recognition-round3.md`): 9 riconosciute (tutte `da-confermare`), 30 no, 0 ambigue; i campi quasi mai letti. Il futuro «parola chiesta nell'app» riempirà questo campo.
- **R91** (13 novembre 2026, revisione finale del piano 2b-1) Licenze e prova dell'OCR nel bundle. **Licenze (I4):** i testi di licenza delle librerie native di `tesserocr/.dylibs/` (Tesseract, Leptonica, libpng, libjpeg-turbo, libtiff, libwebp, liblzma, Zstandard; solo permissive) sono in `python/licenses/ocr-native-libraries.txt`, che `scripts/bundle-python.mjs` copia in `bollette_pdf/licenses/` nel bundle; la ruota non li porta (verificato). I testi vengono dai pacchetti locali delle stesse versioni (Tesseract dalla 5.5.2 invece della 5.5.3, stessa Apache-2.0; Leptonica dalla nota nelle intestazioni della 1.87.0): da riconfrontare con quelli a monte alla prima release. Una schermata «Licenze» nell'app resta un seguito per il piano dell'interfaccia. **Prova (I5):** `build.yml` controlla i testi nell'app costruita e lancia `python/tools/ocr_smoke.py` con l'interprete e i dati incorporati (pagina sintetica, motore vero: `OCR ok`). `tauri.conf.json` imposta `bundle.macOS.minimumSystemVersion` a 15.7: il modulo di tesserocr dichiara `minos 15.7` (R85, `ocr-licenze.md`), mentre 15.0-15.6 non sono verificati. Nessun workflow è stato eseguito.
- **R92** (14 novembre 2026, dopo il piano 2b-1) Nessun profilo seed dichiara `recognise.ocrAnyOf`. **Decisione di Carlo (14 novembre 2026), che modifica R90:** sul campione di dieci scansioni reali da lui controllate nessuna era una bolletta attuale (4 preventivi o rendiconti condominiali, 1 conferma di pagamento TARI, 4 note o scarti, 1 Enel del 2020 che non capiterà più); le parole di fornitore farebbero riconoscere come bollette conferme di pagamento e note del fornitore, che devono restare `non-riconosciuta`. Tolto `ocrAnyOf` da tutti gli 11 profili seed; **il meccanismo di R90 resta invariato** in JSON Schema, Zod e Python (campo opzionale, regola di valutazione, validità). I test che pretendevano una parola per ogni profilo seed e l'unicità tra fornitori sono sostituiti da un test che verifica che nessun profilo seed dichiara `ocrAnyOf`; il meccanismo si prova con profili sintetici (scansione riconosciuta, `mixed` e PDF di testo che lo ignorano, `noneOf` che esclude). Esito sulle 39 scansioni reali (solo conteggi): 39 scansioni (`textSource` `ocr`): 0 riconosciute, 0 da confermare, 39 `non-riconosciuta`; le altre origini non cambiano (`pdf` 89 riconosciute e 86 no, `mixed` 153 riconosciute, 1 da confermare, 6 no). La futura «parola chiesta nell'app» resta come meccanismo per l'utente: aggiungerà `ocrAnyOf` a un profilo scelto da lui, non ai seed.
- **R93** (14 novembre 2026, piano 2b-2, Task 1) La regola sul tipo di documento di `ExtractionResultSchema` accetta un `profileId` impostato con `kind` `null` (con `documentKind` `unknown`): Python non lo emette mai (con un profilo `kind` c'è sempre) e il test «bill senza kind» di `proposal.test.ts` lo richiede. Senza profilo `documentKind` è sempre `unknown`; con un profilo vale `kind`.
- **R94** (14 novembre 2026, piano 2b-2, Task 2; il brief diceva R93, già presa dal Task 1) Lettura di un intervallo di pagine. `reader.restrict(doc, first, last)` tiene righe e `ocr_pages` delle pagine dell'intervallo, lascia `pages` del file, ricalcola `has_text` (`MIN_TEXT_CHARS` sulle righe tenute) e `text_source` come in R86 sulle pagine tenute (`pdf` senza pagine OCR, `ocr` se tutte le pagine con testo sono OCR, altrimenti `mixed`), imposta `page_range`; `ValueError` fuori da `1 <= first <= last <= pages`. `extract` usa `page_range` per `pageRange` (anche per `senza-testo`). Avviso `WARNING_MANY_DOCUMENTS` («Il file potrebbe contenere più documenti.») quando, nel profilo scelto, `amount` o `number` sono letti dalla regola che dà il valore con valori diversi in occorrenze diverse (lo stesso confronto `agree` di `_read_field`, esposto senza cambiarne il risultato): valore, confidenza e stato non cambiano. `extract --pages a-b`: forma convalidata prima di leggere il file, `b <= pagine` dopo la lettura (codice 2 e `PAGES_ERROR` in entrambi i casi); un file illeggibile con `--pages` dà `illeggibile` come senza. Il file si rilegge a ogni chiamata. Prove con `tests/compose.py` (unisce i dump di `fixtures/pdf/`, pagine rinumerate di seguito, `fileHash` inventato).
- **R95** (14 novembre 2026, piano 2b-2, Task 3) Documenti di un file per intervallo di pagine. `Bill` e `Instalment` hanno il campo opzionale `fileDocument` (`pages` `[prima, ultima]`, `documentKind`); un record senza `fileDocument` copre tutto il file, quindi i record già scritti restano validi e `v` non cambia (nessuna migrazione: il campo è solo aggiunto). `registerProposal` lo scrive solo se `pageRange` non è `[1, pages]`. `samePages` confronta due record dello stesso file: stesso intervallo `same`, intervalli che si sovrappongono `overlap`, altrimenti `disjoint`; assente con assente `same`, assente con un intervallo `overlap`. Con lo stesso `fileHash` (e, per le rate, stesso appartamento e `rateIndex`): `same` dà `duplicate`, `overlap` dà `possible-duplicate` (anche un record vecchio senza intervallo contro uno parziale: mai un duplicato silenzioso né un secondo record silenzioso), `disjoint` passa alla regola sui dati (bolletta: appartamento, fornitore, numero, periodo, importo; rata: tipo, esercizio, `rateIndex`). `DocumentKindSchema` si sposta da `extraction.ts` a `model.ts` (evita il ciclo di importazioni; stessa esportazione dall'indice).
- **R96** (14 novembre 2026, piano 2b-2, Task 5) Il rapporto `pdf_report.py` conta i file con l'avviso «più documenti» (totale e per profilo, «(nessun profilo)» compreso) e legge in sola lettura le cartelle reali: 4 file su 460 (Lovarini 1, Pulci 1, Berchet 2), nessuno senza profilo; conteggi in `docs/rules/lettura-pdf.md`, i casi li guarda Carlo (l'avviso scatta anche su un documento con una tabella di storico). Le 18 fixture si leggono uguali con `restrict(1, pagine)`; la fixture OCR è un dump senza `ocrPages`, quindi il test lo completa come `compose` (artefatto del dump, non del motore).
- **R97** (14 novembre 2026, piano 2b-2, revisione finale; verifica libera) Due Ruling. **Rate TARI da intervalli disgiunti:** due rate dello stesso file con lo stesso esercizio e lo stesso `rateIndex`, anche se vengono da intervalli di pagine disgiunti, sono sempre `possible-duplicate` (la regola sui dati di R95 si applica anche quando gli intervalli sono disgiunti): lo conferma una persona, perché due avvisi dello stesso file con la stessa rata sono quasi sempre lo stesso avviso. **Limite OCR e `--pages` (ripristina il disegno approvato; decisione del controller):** il limite `MAX_OCR_PAGES` vale per chiamata e conta solo le pagine dell'intervallo: `read_pdf(page_range=...)` sceglie per l'OCR soltanto le pagine senza testo dell'intervallo, prima di applicare il limite; con `--pages 22-25` su una scansione di 25 pagine si leggono le pagine 22-25, con `--pages 1-1` una sola. Senza `--pages` il comportamento resta identico (R86-R88). Gli avvisi OCR riguardano solo le pagine dell'intervallo.
- **R99** (14 novembre 2026, piano 3a, Task 1) Modello di conti, profili della banca ed estratti. Tre record nuovi (`account`, `bankProfile`, `statement`; schemi in `docs/schemas/`) e tre campi opzionali di `BankTransaction` (`accountId`, `counterparty`, `booked`): i record già scritti restano validi, `v` non cambia. L'IBAN di un conto si salva normalizzato (senza spazi, maiuscolo, controllo mod-97 di `normaliseIban`); gli estratti non sono cifrati (decisione di Carlo, 14 novembre 2026). Il profilo `fixtures/bank/profilo-sintetico.json` è un'ipotesi inventata, non una banca reale. `PatternSchema` è ora esportato.
- **R100** (14 novembre 2026, piano 3a, Task 2) Il conto entra nell'identità del movimento e i periodi coperti dagli estratti sono per conto. **Impronta:** `transactionKey`/`keyTransactions` accettano `accountId` opzionale; con il conto le parti sono `['account', accountId, data, importo, foldText(descrizione)]` (l'appartamento non serve, il conto lo implica), senza restano quelle di prima, quindi le impronte dei movimenti già scritti non cambiano (valore fissato in un test). **Periodi:** `MatchInput.statementPeriods` è `{ apartmentId, from, to }[]`; un periodo copre solo le voci il cui conto pagante (`paidFromApartmentId`, altrimenti `apartmentId`) è `apartmentId`. Prima un estratto di Berchet lasciava «in attesa» anche le voci di Pulci, che dovevano essere «assunte». Nessuna regola di calcolo nuova.
- **R101** (14 novembre 2026, piano 3a, Task 3) Tabella dell'estratto e lettore CSV scritto a mano in `packages/core/src/statement-table.ts`. Le righe completamente vuote si saltano (`""` da sola è invece una riga con una cella vuota). Le virgolette si aprono solo a inizio campo; a metà di un campo non quotato sono un carattere normale (`5" tubo`). Dopo la virgoletta di chiusura può seguire solo un separatore o la fine della riga, altrimenti `CsvError('stray-quote', riga)`. La virgoletta non chiusa dà `CsvError('unclosed-quote', riga)` con la riga dove si è aperta; gli errori non contengono mai il valore della cella. Le righe si contano con CRLF, LF e CR isolato, dentro e fuori dalle virgolette. Si toglie un solo BOM: un secondo resta nella prima cella. I numeri sono testo decimale col punto, senza esponente. Il limite di dimensione del CSV spetta al chiamante. Rimandati: lo schema accetta `{t:'s',v:''}` e testi come `007`. Il task non esegue `accountPattern`/`periodPattern`: la protezione da ReDoS è nel Task 5. Nessuna regola di calcolo nuova.
- **R102** (14 novembre 2026, piano 3a, Task 5) Lettura delle righe dell'estratto col profilo (`packages/core/src/statement-read.ts`, `readStatementTable`). **Intestazione:** prima riga del primo foglio con tutte le etichette di `header.allOf` (confronto con `foldText`). **Importo:** cella `n` con `^-?[0-9]+(\.[0-9]{1,2})?$`; `n` con esattamente tre decimali (`1.234`) è `ambiguous-number` (non si indovina tra un euro e mille e duecento), ogni altra forma (`1e5`) è `bad-amount`; cella `s` con `parseEuro`. **Segno:** se la colonna «Segno» c'è e la cella è piena vale `signValues` (valore ignoto: `unknown-sign`); se la cella è vuota l'importo deve essere negativo, altrimenti `unknown-sign` (un importo positivo diventerebbe un accredito in silenzio). Con dare/avere: dare è negativo, avere positivo. **Stato:** una cella della colonna `pending` uguale (con `foldText`) a un valore di `pendingValues` dà `booked: false`. **dispCodePattern** è applicato al codice non vuoto: un codice che non lo rispetta è `bad-disp-code` (riga, mai il valore). **Righe di piede** (totale, saldo): una riga con data e importo entrambi vuoti si salta; una riga con testo nella cella data e un importo dà `bad-date` e il file si rifiuta (il profilo reale potrà dichiarare il piede in 3a-bis). **Numeri enormi:** una cella `n` oltre i numeri interi sicuri è `bad-amount`. **ReDoS:** i pattern del profilo (`periodPattern`, `accountPattern`, `dispCodePattern`, `counterparty.name/iban`) sono rifiutati con `unsafe-pattern` (riga 0: la colpa è del profilo, non di una riga) se hanno un gruppo ripetuto con `+`, `*` o `{n,}` che contiene un quantificatore (`(a+)+$`) o un'alternanza (`(a|aa)+$`), o più di un `.*`/`.+` (`.*.*x`); si eseguono solo su testi lunghi al più 300 caratteri (un testo più lungo si salta). È un'euristica: il tetto da solo non limita un pattern cattivo. La soluzione piena (RE2 o un worker con timeout) resta una decisione futura: i pattern vengono da un profilo scritto da noi, non da file ostili. Righe identiche nello stesso file restano due righe: i doppioni sono del Task 7. Il periodo e il conto si cercano nelle righe sopra l'intestazione; periodo invertito o con data inesistente è `bad-period`. Gli errori portano codice, riga e al più il nome del campo del profilo, mai il valore della cella. Nessuna regola di calcolo nuova.
