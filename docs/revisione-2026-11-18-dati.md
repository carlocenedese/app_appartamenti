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

## Da agganciare (passo successivo)

- **Desktop (`first-run.ts`).**
  - `showReadOnly` deve mostrare `readOnlyMessage(r.code)` e i `paths` di ogni elemento di `assessment.reasons`. Oggi, per tutto ciò che non è `diverged` o un formato, mostra «sincronizzazione in corso».
  - Per `forked` serve una scelta: `forkVersions`, poi `resolveFork`. Il ciclo di «Ripara» non vede le biforcazioni.
  - Per `damaged-journal`: `damagedJournalFiles` e, se `safeToSetAside`, un pulsante «Metti da parte» che rinomina il file in `setAsideTo`, mai sopra un file esistente. Altrimenti, istruzioni per ripristinarlo dalla cronologia di Dropbox.
  - Per `conflict-copies`: un confronto tra la copia e l'originale, con «tieni questa / tieni l'altra». La copia va poi spostata fuori da `_app`.
  - Per `older-format`: chiedere e chiamare `raiseDataFormat`, poi valutare di nuovo.
  - Catturare `NewerDataError`, `UnreadableRecordsError` e `FileAccessError` e mostrarne il `message`, che è in italiano e senza dati personali.
- **Tauri/Rust.** Il plugin dei file non ha fsync: serve un comando con `sync_all` sul file temporaneo prima del rename. Per «Metti da parte» serve un rename senza sovrascrittura. I codici di errore di `TauriStore` si riconoscono dal testo «os error 5/13/32/33»: va verificato su Windows.
- **CLI (`scripts/estratti.mjs`, non toccato).**
  - `ripara` deve trattare il rifiuto di `repairDiverged` sulle biforcazioni e sul `rev` uguale, e mostrare `reasons`.
  - Il test `estratti.test.mjs` «un registro non coerente rifiuta e ripara si ripara» oggi fallisce. Modifica a mano un pagamento lasciando lo stesso `rev`, e ora la riparazione lo rifiuta di proposito: è proprio il caso di G1, perché potrebbe essere la modifica di un altro computer il cui file del registro non è ancora arrivato. Il test va cambiato: il record troncato, oppure un `rev` più basso.
  - Le eccezioni nuove vanno tradotte in esito `rejected`.
- **Release (`scripts/release.mjs`, non toccato).** `CORE_VERSION` resta ferma a 0.1.0 e `minAppVersion` non sale mai. La protezione ora passa da `DATA_FORMAT`. Resta da decidere se `release.mjs` debba allineare `CORE_VERSION` al tag.

## Ruling

- Un record con lo stesso `rev` del registro ma un contenuto diverso non si ripara più in automatico. Un crash tra registro e record lascia sempre il record a un `rev` più basso, mancante o troncato.
- Una biforcazione si segnala solo sul `rev` massimo. Se dopo la biforcazione qualcuno ha già scritto un `rev` più alto, la biforcazione resta nella storia e non blocca.
- `raiseDataFormat` scrive `workspace.json` fuori dal registro, come fa `createWorkspace`. Due computer che lo alzano insieme scrivono lo stesso contenuto. Se Dropbox crea comunque una copia di conflitto, quella blocca la cartella (G2) finché non la si toglie.
- Anche le letture (Excel, cruscotto) rifiutano con una copia di conflitto, perché fanno già il controllo `checkConsistency`.
- La regola di iCloud (« 2.json») non tocca i nomi che l'app scrive: id e file del registro non hanno spazi.

## Arretrato

- **G9.** Gli orologi sfasati nell'avviso di presenza. Va scelto tra l'ora di modifica del file e una tolleranza simmetrica più ampia, che però cambia i test di presenza. È una decisione di prodotto.
- **G10.** Le impostazioni della macchina non sono scritte in modo atomico (`machine-settings.ts`). Serve lo scope Tauri per il file temporaneo.
- **G12.** Due nomi uguali in NFC e NFD vengono deduplicati in silenzio in `list`. Il rischio è basso con gli id ASCII.
- **G13.** `moveFileNoOverwrite`: se si interrompe tra link e unlink, al nuovo tentativo vanno confrontate le impronte.
- **G14.** `TauriStore` non toglie i `.tmp-*`.
- **G15.** Manca un controllo della lunghezza dei percorsi su Windows.
- **G16.** Manca la scrittura dei file binari, con il messaggio «chiudi il file in Excel» (non esiste ancora).
- I nomi italiani di Case Conflict e Selective Sync Conflict di Dropbox non sono noti: vanno verificati su un Dropbox reale.
- Non provabile qui: EBUSY, EPERM e la violazione di condivisione su Windows reale, i messaggi del plugin Tauri e il comportamento di Dropbox e iCloud reali.
