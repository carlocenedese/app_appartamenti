# Revisione del 18 novembre 2026: affidabilità dei dati

Correzioni dei reperti della revisione 4 («modi di guasto e compatibilità»), ramo `fix/revisione-integrita-dati`. Un commit per reperto. Le prove T1-T14 della revisione sono diventate test di regressione (elenco sotto).

## Fatto

| Reperto | Correzione                                                                                                                                                                                                                                                                                                                                                                                                                                           | Test                                                                                                   |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| G1      | `checkConsistency` dà `forked` quando due operazioni lasciano lo stesso `rev` massimo con contenuto diverso. `repairDiverged` rifiuta una biforcazione, e rifiuta anche quando il `rev` sul disco è uguale o superiore a quello del registro (prima solo superiore). `forkVersions` elenca le versioni e `resolveFork` scrive la scelta della persona come operazione `fork.resolve`, annullabile. L'annullo è bloccato finché c'è una biforcazione. | `journal.test.ts`, «forks» (T2, T3, T12)                                                               |
| G2      | Le copie di conflitto (Dropbox in inglese e in italiano, Case Conflict, Selective Sync Conflict, iCloud « 2.json») in `_app/dati`, `_app/journal` e accanto a `workspace.json` sono riportate da `checkConsistency`, quindi ogni store e l'annullo rifiutano di scrivere. `DEFAULT_CONFLICT_RULES` vale per tutti. Non c'è nessuna fusione automatica.                                                                                               | `assess.test.ts`, «conflict copies of the review» (T3b, T8)                                            |
| G3      | Un record con campi sconosciuti (a ogni profondità) è letto e riportato come `unknown-fields`. `commitChange` rifiuta con `NewerDataError` di scrivere sopra un record con `v` > 1 o con campi sconosciuti, anche in annullo, e dentro una cartella con formato più nuovo. `DATA_FORMAT` (ex `CORE_SCHEMA_VERSION`) è il formato dei dati, separato dalla versione dell'app, e `raiseDataFormat` lo alza nella cartella.                             | `data-format.test.ts`, `data-format-raise.test.ts` (T6, T7)                                            |
| G4      | `assessWorkspace` dà `damaged-journal` con il nome del file. `damagedJournalFiles` dice se il file si può mettere da parte in `_app/journal-danneggiati/`. Lo si può fare solo se nessun record è diverso o biforcato, se ogni record è spiegato da un'operazione leggibile e se nessuna catena di `rev` o di annulli parte da quel file. `FsStore` fa anche l'fsync della cartella.                                                                 | `journal.test.ts`, «damaged operation files» (T4, T4b, T4c); `fs-store.test.ts` (messa da parte reale) |
| G5      | `FileAccessError` (percorso relativo, codice, suggerimento in italiano). `loadAll` e `checkConsistency` danno `unreadable`, `assessWorkspace` dà `unreadable-files` invece di fallire.                                                                                                                                                                                                                                                               | `fs-store.test.ts`, `tauri-store.test.ts`, `journal.test.ts` (T5b, senza `chmod`)                      |
| G6      | `loadAll` lancia `UnreadableRecordsError` (tipo, id, percorso, motivo) se un file del tipo non dà un record utilizzabile. `tolerant: true` vale solo per `assessWorkspace`. Tutti i circa 230 punti che leggevano i `records` ignorando i `problems` ora rifiutano.                                                                                                                                                                                  | `unreadable-records.test.ts` (T13 e tutti i tipi contro Excel, cruscotto, tasse, scadenzario e saldi)  |
| G7      | Un'operazione di un'app più nuova dà `newer-data` («aggiorna l'app») e non più «sincronizzazione in corso».                                                                                                                                                                                                                                                                                                                                          | `assess.test.ts`                                                                                       |
| G8      | Il rename del file temporaneo si ritenta 5 volte, per circa un secondo: `FsStore` su EBUSY, EPERM ed EACCES, `TauriStore` su ogni errore. Poi lancia `FileAccessError`.                                                                                                                                                                                                                                                                              | `fs-store.test.ts`, `tauri-store.test.ts` (T14)                                                        |
| G11     | `saveApartment` rifiuta con `invalid-apartment` gli id riservati di Windows (`CON`) e gli id che differiscono da uno esistente solo per le maiuscole.                                                                                                                                                                                                                                                                                                | `apartment-store.test.ts` (T9)                                                                         |

`assessWorkspace` ha ora `reasons`, cioè un elenco di `{ code, paths }` in un ordine fisso. `readOnlyMessage(code)` dà il testo in italiano. `writable` è vero solo se `reasons` è vuoto.

## Regola per chi aggiunge o cambia campi (G3)

1. Ogni cambio di struttura di `docs/schemas` alza `DATA_FORMAT` di uno, in `packages/core/src/version.ts`. Sono cambi di struttura: un campo in più o in meno, un valore di enum, un limite, un pattern. L'impronta nuova va aggiunta in `packages/core/test/data-format.test.ts`, tenendo le vecchie. Il test fallisce finché non lo si fa. Le sole descrizioni non contano.
2. Sono ammessi solo cambi additivi: campi facoltativi o valori nuovi. Un'app più vecchia continua a leggere, va in sola lettura e non riscrive mai i record con campi che non conosce.
3. Rinominare, togliere o rendere obbligatorio un campo richiede una migrazione con backup (sezione 36). Non esiste ancora e non va inventata.
4. La `v` dei record resta 1. `v` > 1 vuol dire una forma nuova, che la vecchia app non scrive mai.
5. Limite: l'impronta vede solo ciò che sta nel JSON Schema. Una regola `.refine` nuova di Zod va valutata a mano.

## Secondo giro (revisione indipendente)

- **Biforcazione con via d'uscita.** `pnpm estratti scegli-versione --file <percorso relativo del record>` elenca le versioni: id dell'operazione, data e id dell'utente, e il contenuto solo con `--dettagli`. Con `--operazione <id>` chiama `resolveFork`, e la scelta si può annullare. L'opzione è `--operazione` e non `--tieni`, perché `--tieni` è già un'opzione booleana di `decidi`.
- **Una biforcazione blocca solo il suo record.**
  - Gli store usano `writesBlocked`, che ignora `forked`.
  - `commitChange` rifiuta le scritture sul record biforcato (`InconsistentRecordError`).
  - `loadAll` rifiuta (`UnreadableRecordsError`, motivo `forked`) solo i calcoli che leggono quel tipo di record. Gli altri calcoli continuano.
  - Il desktop resta in sola lettura e indica il comando.
- **`ripara`** ripara i `diverged` che può e riporta il resto in `left`: biforcazioni, rev uguali o superiori, copie di conflitto. Non si ferma al primo rifiuto.
- **Nessuna biforcazione creata in casa.** `commitChange` controlla che il record sul disco sia come dice l'ultima operazione del registro.
  - La nuova modifica va sopra il rev dell'operazione più avanti solo se è un'operazione che lo stesso Store ha visto fallire in questa sessione, e il record è ancora come quell'operazione l'aveva trovato.
  - In ogni altro caso rifiuta (`diverged`), anche per la stessa persona su un altro computer o per il profilo `cli`. La via d'uscita è `ripara`, che applica dal registro la modifica mancante senza perdere nulla.
  - Vale per tutti gli scrittori, anche quelli senza controllo preliminare.
- **`resolveFork`** parte dalla versione sul disco, se è una delle biforcate, altrimenti dalla versione scelta. Il rev nuovo sta sopra tutte le versioni, anche con il file troncato o mancante.
- **Record inutilizzabili.** Troncati, di forma diversa, con nome diverso dall'id o con id doppi senza originale danno `unreadable-files` in `assessWorkspace`: mai più `writable: true` seguito da un'eccezione.
  - Via d'uscita manuale per un record rotto: ripristinarlo dalla cronologia delle versioni di Dropbox.
  - Una copia fatta a mano (per esempio `x - Copia.json`) va spostata fuori da `_app`.
  - Un file con un nome diverso dal suo id va riportato al nome `<id>.json`, se non esiste già un altro file con quel nome.
  - L'app non sposta e non cancella questi file da sola.
- **Desktop.** `showReadOnly` mostra `readOnlyMessage` e i percorsi di ogni `reasons`. «Aggiorna i dati della cartella» chiama `raiseDataFormat`, e un test fallisce se l'aggancio sparisce. I messaggi di `FileAccessError` e `UnreadableRecordsError` non diventano più «Cartella non raggiungibile».
- **CLI.** `NewerDataError`, `UnreadableRecordsError`, `FileAccessError` e `InconsistentRecordError` danno l'esito `rejected` (codice 1), con il motivo e i percorsi relativi.
- **Varie.** `FileAccessError` non porta più la causa con il percorso assoluto. `TauriStore` distingue un testo non UTF-8 (file rovinato) da un file inaccessibile. L'impronta degli schemi toglie `description` solo quando è un testo; l'impronta del formato 1 è stata ricalcolata. I messaggi indicano solo azioni che esistono.

## Terzo giro

- **Rifiuto della scelta.** `resolveFork` rifiuta («attendere la sincronizzazione») se sul disco c'è un rev più alto delle versioni da scegliere, cioè il salvataggio di un terzo computer il cui registro non è ancora arrivato.
- **Messaggi.**
  - `forked` dice che il desktop resta in sola lettura e indica il comando `scegli-versione`; la schermata arriverà.
  - `repair-refused` e il pulsante «Ripara» non dicono più «più recente del registro».
  - La CLI, per `unreadable-records`, mostra il messaggio del core, che nomina `scegli-versione`.

## Quarto giro

- **Ritirato il rilevamento per rami del terzo giro.** Segnalava S2, ma non segnalava più un annullo fatto su un altro computer insieme a una modifica (tornava `diverged`, e il record più nuovo arrivato da Dropbox lo cancellava in silenzio). Il rilevamento delle biforcazioni è tornato quello del secondo giro: stesso `rev` massimo, contenuto diverso. Restano del terzo giro i messaggi e il rifiuto di `resolveFork` con un rev più alto sul disco.
- **Prove.** Storie legittime casuali (300 semi, due computer, riprese, annulli, sincronizzazioni parziali, «Ripara»): nessun falso `forked`. Annullo contro modifica e ripristino contro modifica, nei due ordini: `forked` su tutti e due i computer (test in `review-regressions.test.ts`). S2 e B2 restano test attesi in errore.
- **Su main** le stesse prove perdono S2 e B2 in silenzio, e anche le biforcazioni allo stesso rev: main non ha ancora `forked`.

## Limiti noti

- **S2: un ramo più corto dell'altro.** A salva due volte senza rete, C una volta, partendo dallo stesso dato. Quando i registri si incontrano, la modifica di C sta sotto il rev più alto di A e non si vede come biforcazione: C vede `diverged` con «Ripara» rifiutato, e quando arriva il file del record di A la modifica di C sparisce senza avviso. Lo stesso succede se C, invece di modificare, annulla. Come su main.
- **B2: tre computer, la scelta fatta troppo presto.** A, C e D modificano lo stesso dato. A vede la biforcazione con C e sceglie. Poi arriva il registro di D: la scelta l'ha già superata, e la modifica di D si perde senza avviso. Su main si perde anche lei: lì non c'è una scelta, vince l'orologio più recente e le altre modifiche spariscono senza avviso.
- Fino al ridisegno: chi lavora senza rete su più computer controlla a mano, dopo la sincronizzazione, i dati modificati in più posti.

## Ridisegno previsto

- **Un solo invariante.** Per ogni record le operazioni si collegano `before` → `after` in un grafo. Lo stato è pulito solo se il grafo ha una sola testa e il disco coincide con quella testa; altrimenti è biforcato (più teste) o da completare (una testa, disco indietro).
- **L'annullo è un arco normale**: va dalla testa che annulla al nuovo stato, senza regole a parte.
- **`fork.resolve` registra le teste che ha fuso.** Un ramo che la scelta non ha visto (B2) resta una testa, e quindi una biforcazione.
- **Cancello: un property test modello.** Storie casuali su più computer (salvataggi, annulli, riprese, sincronizzazioni parziali) confrontate con un modello semplice delle teste: nessun falso `forked`, nessuna modifica persa senza avviso. Il ridisegno entra solo quando questo test passa, S2 e B2 compresi.

## Da agganciare (passo successivo)

- **Desktop.**
  - Una scelta della versione nella finestra, al posto del comando CLI.
  - Per `damaged-journal`, un pulsante «Metti da parte» quando `damagedJournalFiles` dice `safeToSetAside` (rename senza sovrascrittura).
  - Per `conflict-copies`, un confronto «tieni questa / tieni l'altra».
- **Tauri/Rust.** Il plugin dei file non ha fsync: serve un comando con `sync_all` sul file temporaneo prima del rename, e un rename senza sovrascrittura. I codici di errore di `TauriStore` si riconoscono dal testo «os error 5/13/32/33»: va verificato su Windows.
- **CLI.** `damagedJournalFiles` non è ancora esposto.
  - La CLI non guarda il formato della cartella: `older-format` non la mette in sola lettura (quindi non serve un comando `aggiorna-formato` per uscirne), ma dopo un aumento di `DATA_FORMAT` scriverebbe dati nuovi in una cartella che le app più vecchie credono del loro formato. Da decidere: chiamare `raiseDataFormat` prima della prima scrittura, o rifiutare come il desktop.
- **Release (`scripts/release.mjs`, non toccato).** `CORE_VERSION` resta ferma a 0.1.0 e `minAppVersion` non sale mai. La protezione ora passa da `DATA_FORMAT`. Resta da decidere se `release.mjs` debba allineare `CORE_VERSION` al tag.

## Ruling

- Un record con lo stesso `rev` del registro ma un contenuto diverso non si ripara più in automatico. Un crash tra registro e record lascia sempre il record a un `rev` più basso, mancante o troncato.
- Una biforcazione si segnala solo sul `rev` massimo. Se dopo la biforcazione qualcuno ha già scritto un `rev` più alto, la biforcazione resta nella storia e non blocca (vedi «Limiti noti»: S2 e B2).
- `raiseDataFormat` scrive `workspace.json` fuori dal registro, come fa `createWorkspace`. Due computer che lo alzano insieme scrivono lo stesso contenuto. Se Dropbox crea comunque una copia di conflitto, quella blocca la cartella (G2) finché non la si toglie.
- Anche le letture (Excel, cruscotto) rifiutano con una copia di conflitto, perché fanno già il controllo `checkConsistency`.
- Il ciclo end-to-end ha un fallimento in più rispetto al rapporto del revisore: l'annullo di `apartment.save` è rifiutato con `has-dependents`. Viene dalla #69 (riferimenti), non da questo ramo. Gli altri 6 fallimenti erano già su main.
- Riallineamento dopo una scrittura fallita (corretto nella seconda revisione).
  - Il primo giro riconosceva la scrittura fallita dallo stesso `profileId`, e così perdeva in silenzio una modifica riuscita sull'altro computer della stessa persona.
  - Ora vale solo per le operazioni che quello stesso Store ha visto fallire in questa sessione. Una ripresa in un altro processo passa da `ripara`, che applica l'operazione rimasta a metà.
  - I flussi di ripresa coperti dai test (conferma delle bollette, ripresa dell'importazione, creazione del gruppo) usano lo stesso Store e passano senza modifiche.
- `repairDiverged` scrive solo se il record sul disco è uno stato su cui l'ultima operazione si appoggia, seguendo la catena dei `before`; mancante e troncato valgono come «da completare».
  - Così, se durante una ripresa arriva la modifica concorrente di un altro computer, «Ripara» non la sovrascrive: rifiuta e serve una persona.
  - Limite: questo caso ristretto appare come `diverged` con riparazione rifiutata, non come `forked`.
- `loadAll` conosce le biforcazioni dall'ultimo `checkConsistency` fatto su quello store (scorciatoia annotata in `load.ts`). Ogni store e ogni calcolo lo chiamano per primo. Un chiamante che non lo fa può non vedere una biforcazione nata dopo.
- La regola di iCloud (« 2.json») non tocca i nomi che l'app scrive: id e file del registro non hanno spazi.

## Arretrato

- L'annullo di una scelta (`fork.resolve`) rimette la versione che c'era sul disco, non la biforcazione: l'altra versione resta nel registro.
- Gli scrittori senza `checkConsistency` preliminare (supply-store, statement-import, accounts, confirmation, dedupe, users, notes) leggono con `loadAll`. Con uno Store appena creato, `loadAll` non conosce ancora le biforcazioni. La scrittura sul record biforcato la rifiuta comunque `commitChange`; resta il rischio di decisioni prese leggendo un record biforcato. Da far passare per `writesBlocked` come gli altri.

- **G9.** Gli orologi sfasati nell'avviso di presenza. Va scelto tra l'ora di modifica del file e una tolleranza simmetrica più ampia, che però cambia i test di presenza. È una decisione di prodotto.
- **G10.** Le impostazioni della macchina non sono scritte in modo atomico (`machine-settings.ts`). Serve lo scope Tauri per il file temporaneo.
- **G12.** Due nomi uguali in NFC e NFD vengono deduplicati in silenzio in `list`. Il rischio è basso con gli id ASCII.
- **G13.** `moveFileNoOverwrite`: se si interrompe tra link e unlink, al nuovo tentativo vanno confrontate le impronte.
- **G14.** `TauriStore` non toglie i `.tmp-*`.
- **G15.** Manca un controllo della lunghezza dei percorsi su Windows.
- **G16.** Manca la scrittura dei file binari, con il messaggio «chiudi il file in Excel» (non esiste ancora).
- I nomi italiani di Case Conflict e Selective Sync Conflict di Dropbox non sono noti: vanno verificati su un Dropbox reale.
- Non provabile qui: EBUSY, EPERM e la violazione di condivisione su Windows reale, i messaggi del plugin Tauri e il comportamento di Dropbox e iCloud reali.
