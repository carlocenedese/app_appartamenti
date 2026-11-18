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

## Quinto giro: un solo invariante (ramo `fix/biforcazioni-invariante`)

Il rilevamento per `rev` massimo e le sue eccezioni sono sostituiti da un invariante, in `stateOf` (`journal.ts`).

- **Grafo.** Per ogni record ogni modifica del registro è un arco dalle versioni che sostituisce al suo `after`. Una versione è il record intero, `rev` compreso (JSON canonico). L'annullo è un arco come gli altri, dalla versione sul disco a quella ripristinata.
- **Teste.** Sono le versioni che nessun'altra modifica sostituisce.
  - Pulito: una testa, e il disco uguale a lei.
  - `forked`: più teste. `forkVersions` le offre tutte, una operazione per testa.
  - `diverged`: una testa e il disco diverso. «Ripara» scrive solo se il disco è un antenato della testa (oppure manca o è troncato).
  - Da completare: più teste mentre manca un file del registro, cioè un `before` o un `supersedes` che nessuna operazione presente spiega. Vale `diverged`, perché la sincronizzazione non è finita, e non `forked`. «Ripara» e la scelta rifiutano.
- **`supersedes`.** È un campo facoltativo di ogni modifica, con gli id delle operazioni il cui `after` la modifica sostituisce oltre al `before`.
  - `fork.resolve` vi elenca tutte le teste che ha fuso. Un ramo arrivato dopo la scelta (B2) resta una testa, quindi è di nuovo una biforcazione.
  - La ripresa di una scrittura fallita dallo stesso Store vi mette l'operazione fallita. Nient'altro scrive «sopra».
  - Una versione smette di essere una testa per `supersedes` solo se tutte le operazioni che l'hanno lasciata sono sostituite: lo stesso contenuto lasciato da un altro computer resta una testa.
- **Il `before` registrato è il record sul disco**, non quello passato dal chiamante, che `commitChange` controlla solo per `rev`. Nelle prove dell'intera suite i due coincidono sempre, tranne nei casi rifiutati con `NewerDataError`.
- **`resolveFork`** scrive la versione scelta con un `rev` sopra tutte le teste. Il `before` è la testa sul disco se c'è, altrimenti la versione scelta. Rifiuta ancora se sul disco c'è un `rev` più alto di tutte le teste.

### Che cosa cambia su disco e compatibilità

- **Operazioni.** Il formato cambia solo per `supersedes`, scritto soltanto da `fork.resolve` e dalla ripresa di una scrittura fallita. Le altre operazioni restano come prima.
- **Operazioni vecchie** (senza il campo). Si leggono dalla loro forma; sono le uniche due che scrivevano sopra più del `before`:
  - una `fork.resolve` sostituisce tutte le versioni al `rev` sotto il suo;
  - un salto di `rev` (`after.rev` > `before.rev` + 1) sostituisce le operazioni dello stesso profilo, con lo stesso `rev` di partenza e un `rev` in mezzo.
  - Test in `review-regressions.test.ts`, «operations written before `supersedes`».
- **App più vecchie.** Un'app più vecchia legge un'operazione con `supersedes` e la segnala come `unknown-fields`. Il desktop va quindi in sola lettura (`newer-data`, «aggiorna l'app») appena qualcuno fa una scelta o una ripresa con l'app nuova. La CLI vecchia non guarda quel motivo: continua a usare il suo rilevamento per `rev` massimo, che vede la scelta nuova come pulita (il suo `rev` è sopra tutte le teste).
- **`docs/schemas/operation.json`** ha il campo nuovo. L'impronta degli schemi include le operazioni, quindi `DATA_FORMAT` va alzato; in questo ramo non è alzato (vedi «Ruling»).

### Cancello: property test modello

- **Test.** `packages/core/test/journal-model.property.test.ts`, con un generatore con seme fisso. Ha 1-3 computer, ciascuno con il suo store in memoria, e una «nuvola» che sincronizza un file alla volta; per i record vince l'ultimo caricamento, anche il più vecchio.
- **Storie casuali:**
  - salvataggi su uno o due record, rilanci identici (anche da un altro computer), cancellazioni e ricreazioni;
  - scritture fallite e riprese, annulli (anche in cascata) e annulli di annulli;
  - «Ripara», scelte e loro annulli;
  - sincronizzazioni parziali in ordine casuale, orologi sfasati fino a 10 minuti, lo stesso utente o utenti diversi.
- **Oracolo.** Non usa `journal.ts`: segue le versioni che ogni scrittura mette sul disco.
  - Dopo la sincronizzazione completa, su ogni computer, ogni operazione confermata è contenuta nel record sul disco, oppure il record è `forked` o `diverged`, e tutti i computer riportano lo stesso.
  - Dopo scelte, riparazioni e un'altra sincronizzazione tutto è pulito ovunque e nessun file del registro manca.
  - Nelle storie in cui ogni record è modificato da un solo computer, `forked` non compare mai, a nessun passo.
- **Esito.** Il codice di prima fallisce subito (seme 5: modifica persa; seme 1000042: falso `forked`). In CI girano 150 semi per modo, in pochi secondi; `JOURNAL_MODEL_SEEDS=<n>` e `JOURNAL_MODEL_FIRST=<seme>` servono per la corsa lunga e per ripetere un seme.

### Test cambiati

- S2, «S2 con annullo» e B2 non sono più attesi in errore.
- «La corsa durante una ripresa»: la modifica di A e la ripresa di B partono dallo stesso dato, quindi ora sono una biforcazione e «Ripara» la rifiuta come tale. Prima era un `diverged` con riparazione rifiutata («not a state»). Il test controlla anche `forked`.
- `damagedJournalFiles`, «una operazione successiva parte da quella danneggiata»: senza l'operazione danneggiata il record ha due teste e un vuoto, quindi oltre a `broken-chain` c'è anche `records-differ`. `safeToSetAside` resta falso.

## Limiti noti

- **Operazioni vecchie.** Una `fork.resolve` scritta prima di `supersedes` ha fuso tutte le versioni al suo `rev - 1`, anche quelle arrivate dopo la scelta (B2 nei dati vecchi resta invisibile). Una vecchia ripresa sostituisce anche un'altra modifica dello stesso profilo che partiva dallo stesso `rev` ed è arrivata dopo.
- **Un file del registro perso per sempre** lascia il record «da completare» (`diverged`) se ha più teste: non si sceglie finché il file non torna, per esempio dalla cronologia di Dropbox.
- **Stesso contenuto, stesso `rev`.** Due computer che fanno la stessa identica modifica dallo stesso dato non sono una biforcazione, per scelta: è la stessa versione. Se lo stesso contenuto ha `rev` diversi (per esempio la stessa creazione, una volta con ripresa), è una biforcazione.
- **Il modello** non simula le copie di conflitto di Dropbox (G2 le blocca a parte), i file troncati né gli errori di lettura.

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
- (Quinto giro) Una biforcazione è un record con più teste, qualunque sia il `rev`: sostituisce la regola del `rev` massimo.
- (Quinto giro) `supersedes` cambia `docs/schemas/operation.json`, che fa parte dell'impronta degli schemi. Questo ramo non alza `DATA_FORMAT`, perché lo alza un altro ramo: finché non lo si alza con l'impronta nuova, il test dell'impronta in `data-format.test.ts` fallisce. Chi unisce i due rami ricalcola un'unica impronta per il numero nuovo.
- `raiseDataFormat` scrive `workspace.json` fuori dal registro, come fa `createWorkspace`. Due computer che lo alzano insieme scrivono lo stesso contenuto. Se Dropbox crea comunque una copia di conflitto, quella blocca la cartella (G2) finché non la si toglie.
- Anche le letture (Excel, cruscotto) rifiutano con una copia di conflitto, perché fanno già il controllo `checkConsistency`.
- Il ciclo end-to-end ha un fallimento in più rispetto al rapporto del revisore: l'annullo di `apartment.save` è rifiutato con `has-dependents`. Viene dalla #69 (riferimenti), non da questo ramo. Gli altri 6 fallimenti erano già su main.
- Riallineamento dopo una scrittura fallita (corretto nella seconda revisione).
  - Il primo giro riconosceva la scrittura fallita dallo stesso `profileId`, e così perdeva in silenzio una modifica riuscita sull'altro computer della stessa persona.
  - Ora vale solo per le operazioni che quello stesso Store ha visto fallire in questa sessione. Una ripresa in un altro processo passa da `ripara`, che applica l'operazione rimasta a metà.
  - I flussi di ripresa coperti dai test (conferma delle bollette, ripresa dell'importazione, creazione del gruppo) usano lo stesso Store e passano senza modifiche.
- `repairDiverged` scrive solo se il record sul disco è un antenato dell'unica testa, seguendo `before` e `supersedes`; mancante e troncato valgono come «da completare».
  - Così, se durante una ripresa arriva la modifica concorrente di un altro computer, «Ripara» non la sovrascrive: rifiuta e serve una persona.
  - Dal quinto giro questo caso è `forked`.
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
