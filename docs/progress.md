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

Rilievi minori rimandati dalla Fase C: azione `da-pagare` anche con differenza 0; avviso
`contratto-mensile` anche nei mesi con un posto vuoto e senza mese; `conguaglio.ts` lungo (circa
600 righe); `esercizioRange` facoltativo in `allocateInstalment`; rata negativa con
`quotaProprieta`; nel rapporto la colonna «Spese» non comprende la commissione; il conguaglio
supplementare non filtra i contratti di altri appartamenti.

## Da decidere con Carlo

1. Nota TARI: la data dell'avviso non c'è nell'esempio della specifica né nei dati in ingresso.

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
