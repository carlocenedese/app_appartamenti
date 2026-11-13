# Registro di avanzamento

Stato: **Fase A completata** (piano 1, Task 1-6, 8, 10 e 11; nessun dato reale), in attesa di
revisione nella pull request verso `main`. Le Fasi B (Task 7, con Carlo presente) e C (Task 9, dopo
l'approvazione di regole e fixture) non sono iniziate.

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
Fase B (Task 12: profili dei fornitori reali e fixture, con Carlo e PDF veri) comincia dopo il merge.
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
- **R79** (13 novembre 2026, Fase B) TARI condivisa: i profili `acegas-tari-2024` e `-b` hanno `parts` (totale per utenza dalla tabella di pagina 2); regola di Carlo: l'importo da pagare si divide in proporzione ai totali delle utenze, perequative e TEFA già dentro. Fixture `acegas-tari-05` (due utenze, valori inventati) e utenza aggiunta alle 01, 02, 04.
- **R80** (13 novembre 2026) Record `supply` («utenza»): etichetta dell'utenza più `apartments: {apartmentId, weight}[]` (almeno uno, pesi interi ≥ 1, ogni appartamento una volta; cartella `_app/dati/supply/`). Sostituisce `ctx.tariParts` nella proposta: la parte letta si divide tra gli appartamenti dell'utenza in proporzione ai pesi, con `splitCents` (centesimi che non tornano: ai resti maggiori, a parità ai primi, la stessa regola di `splitSharedDebit`; **Ruling**: non quella dei posti letto R30 proposta a Carlo a voce, per coerenza con la ripartizione già in uso). Un'utenza di un solo appartamento ha peso 1 e dà lo stesso risultato di prima. I pesi li scrive l'utente. Controlli nuovi: `duplicate-supply` (due utenze con la stessa etichetta: nessuna proposta per entrambe), `part-share` (una quota arrotondata a zero: nessuna proposta per quell'utenza); le utenze cancellate o senza appartamenti non contano. **Approvata da Carlo (13 novembre 2026):** la ripartizione di una utenza tra più appartamenti per pesi, con i centesimi ai resti maggiori (la spec 42 R3 copre solo la divisione tra utenze). Schermata di collegamento e creazione dell'appartamento: piano 4. Da fare: sostituire `parts-total` con il confronto con «Totale dovuto» dell'avviso (non con la quota nuova).
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
