# Piano 6 (parte «primo avvio e sincronizzazione»): disegno

Stato: **approvato da user1 il 13 novembre 2026**, comprese le «Mie scelte». Specifica di riferimento: `docs/spec.md` (sezioni 2, 9, 20, 28, 36, 40 e 41). Prima parte già fatta: `docs/plans/2026-11-13-piano-6-profili-disegno.md` (i profili dei fornitori arrivano con l'app). Fuori da questo disegno: aggiornamenti firmati, Scadenze e pagamenti, Tasse e stime.

## Perché

L'app installata non può ancora né creare né aprire una cartella di lavoro: il core sa leggere e scrivere i record, ma `apps/desktop` ha solo una finestra con la versione e nessun accesso al disco. Serve la procedura che crea il gruppo di lavoro (o ci si unisce a uno esistente) e che dice con chiarezza che cosa succede se Dropbox ha sincronizzato solo a metà o se un altro sta lavorando.

## Decisioni di user1 (13 novembre 2026)

1. **Modifiche insieme: avviso di presenza.** Ogni utente scrive un piccolo file di presenza con un segnale periodico; se un altro è attivo, l'app mostra un avviso e basta. Nessun blocco dei file (la sezione 36 prevale sulla 9).
2. **Cartella sincronizzata a metà: sola lettura più un clic.** L'app dice «sincronizzazione in corso» e apre in sola lettura finché registro e record tornano coerenti. La riparazione parte solo con un clic e solo se il record è davvero indietro.
3. **Servizi: solo Dropbox adesso, ma impostato in modo che un utente possa usarne altri in futuro.** I nomi delle copie in conflitto sono un elenco di regole per servizio, non scritti nel controllo.

## Obiettivi

1. Creare una cartella di lavoro: utente, profili iniziali (`seedProfiles`), poi `_app/workspace.json` per ultimo (fa da marcatore di fine); se si interrompe, la ripresa non sovrascrive nulla.
2. «Unisciti a un gruppo»: scegliere una cartella con `_app/workspace.json` valido e compatibile, poi scegliere o creare il proprio profilo utente.
3. All'apertura valutare la cartella: compatibilità (`ok`, sola lettura, serve aggiornare), sincronizzazione (`ok`, `behind`) e problemi, con un messaggio chiaro per ognuno.
4. L'avviso di presenza di altri utenti.
5. L'app desktop può leggere e scrivere la cartella scelta, con i permessi minimi.

## Non obiettivi

- Niente blocco dei file, niente riparazione automatica, niente sincronizzazione scritta da noi (la fa Dropbox).
- Niente supporto di iCloud o altri servizi in questa versione, ma nessuna scelta di codice che lo impedisca (vedi «Approcci»).
- Niente migrazione né backup: `schemaVersion` è 1.
- Niente password: i profili degli utenti non sono account.

## Vincoli

- `packages/core` resta puro: orologio e generatore di `id` sono argomenti, niente `node:*`. L'accesso al disco dell'app sta dietro l'interfaccia `Store` già esistente.
- Nessun dato reale nel repository, nessun dato personale nei log. Nomi di file senza `:` e senza caratteri vietati da Windows.
- Una cartella più nuova dell'app si apre in sola lettura (`checkCompat`), mai in scrittura.

## Approcci considerati e scelte mie (da controllare)

- **Dove stanno i profili utente.** Scelgo un record `_app/dati/user/<id>.json` nel registro (annullabile, un conflitto resta confinato a un solo file, leggibile dal telefono). Scartato: un elenco dentro `workspace.json` (un solo file caldo per i conflitti). «Chi sono io» e la lingua stanno solo sulla macchina, non nella cartella condivisa.
- **Accesso al disco dall'app.** Scelgo i plugin ufficiali di Tauri per file e finestre di dialogo, chiamati dalla vista, con permessi ristretti alla cartella scelta: si prova in TypeScript senza Rust locale. Scartato: comandi Rust propri (più stretti ma provabili solo in CI). **Da verificare** che la cartella scelta nel dialogo entri nei permessi del plugin dei file e che i plugin abbiano licenza ammessa.
- **Servizi.** Un elenco di regole `ConflictNameRule` per servizio (Dropbox ora), in un solo punto; aggiungere iCloud significa aggiungere una regola e le sue prove, non toccare il controllo.
- **Avviso di presenza.** Un file `_app/presenza/<utente>.json` per utente con l'ora dell'ultimo segnale; una funzione pura `othersActive(now, entries, windowMinutes)` con la finestra come impostazione, non nel codice.
- **Cartella a metà.** `assessWorkspace` distingue un record che manca davvero da un file non ancora arrivato; la riparazione dei record (`repairDiverged`) si lancia solo con un clic e rifiuta se il record su disco è più nuovo.

## Disegno

- `User` (record `user`): `name`, id sicuro come nome di file; funzione `createUser`, operazione `users.create`.
- `createWorkspace(store, {workspaceId, name, user: {id, name}}, seeds, clock, newId)`: rifiuta se esiste `workspace.json` o se `_app/journal` e `_app/dati` contengono file che non sono di una creazione interrotta dello stesso gruppo (stesso `user.id`; decisione di user1, 13 novembre 2026); scrive utente, `seedProfiles`, poi `workspace.json` (con `schemaVersion`, `minAppVersion` dell'app, `createdAt`).
- `assessWorkspace(store, app, conflictRules)`: `{compat, sync: 'ok' | 'behind', writable, problems}`.
- `TauriStore implements Store` con scrittura atomica (file temporaneo e rinomina), le impostazioni per macchina nella cartella di configurazione dell'app, il selettore di cartelle.
- `othersActive(now, entries, windowMinutes)` e scrittura periodica del file di presenza.
- Procedura guidata (`apps/desktop/src/first-run.ts`): «Crea gruppo», «Unisciti», profilo, avvisi di sola lettura, di sincronizzazione e di presenza.

## Mie scelte dopo la lettura di un revisore (da controllare)

Un revisore indipendente ha trovato questi punti; li decido io, user1 può correggerli.

1. **Due stati di sincronizzazione, non tre.** Non c'è modo di distinguere, senza orologio né altri segnali, un record che manca perché Dropbox non l'ha ancora scaricato da uno che manca davvero. Quindi `sync` vale `'ok'` oppure `'behind'` (almeno un record è diverso da come dice l'ultima operazione del registro, o manca): sola lettura, messaggio «sincronizzazione in corso o incompleta». Con il clic dell'utente si usa `repairDiverged`, che oggi scrive il record come dice il registro e rifiuta se il record su disco ha una `rev` più alta; non cambia.
2. **Quando si scrive.** Si apre in sola lettura se la compatibilità non è `ok`, se `sync` è `'behind'` o se `workspace.json` non è valido. Le copie in conflitto e gli `id` doppi restano avvisi in un elenco di problemi e non bloccano.
3. **Ripresa di `createWorkspace`.** La procedura fissa una volta sola gli `id` dell'utente e della cartella (nelle impostazioni della macchina) e li riusa a ogni nuovo tentativo; `createUser` e `seedProfiles` saltano ciò che esiste già; `workspace.json` per ultimo. La ripresa parte da sola quando l'utente rilancia «Crea gruppo» con la stessa cartella. Un tentativo con una cartella diversa è un nuovo gruppo.
4. **«Chi sono io».** A ogni apertura si controlla che l'utente scelto esista in `_app/dati/user` e non sia cancellato; altrimenti la procedura propone di sceglierne o crearne un altro. La lingua è una impostazione della macchina.
5. **Presenza.** I file di `_app/presenza/` non sono record: stanno fuori da `_app/dati/`, senza `id`, `v`, `rev` né registro, e non li legge `loadAll`. Segnale ogni minuto e finestra di tre minuti, tutte e due impostazioni. L'ora scritta è quella della macchina che scrive; si confronta con l'ora locale con una tolleranza di un minuto. Lo stesso utente su due macchine non è «un altro».
6. **Verifica dei permessi di Tauri come primo task.** Il primo task è una prova (spike): scegliere una cartella nel dialogo, scriverci con il plugin dei file, riaprirla dopo un riavvio. Se non regge, il ripiego già concordato è un insieme di comandi Rust propri limitati alla cartella scelta (provabile solo in CI). La licenza dei plugin lato Rust si controlla con lo strumento che il progetto già usa per Cargo; `pnpm licenses:check` copre solo npm.
7. **Regole dei nomi dei conflitti.** Si ricava dal rilevamento esistente di `loadAll`/`loadDir` una lista di regole con Dropbox come predefinita, passata come parametro facoltativo: nessuna firma esistente cambia per i chiamanti dei piani 1-5.
8. **Versioni alla creazione.** `schemaVersion` è quello del core; `minAppVersion` è la versione corrente del core (`CORE_VERSION`), che resta l'unico riferimento di compatibilità; la versione dell'app Tauri non entra nel controllo.

## Lasciato al costruttore

Il nome esatto dei file di presenza e della finestra predefinita (come impostazione); il testo dei messaggi; il modo preciso di dare al plugin il permesso sulla cartella scelta.

## Aperto con user1

Nessuna domanda aperta; due verifiche tecniche sono nell'elenco «Approcci» (permessi e licenza dei plugin).
