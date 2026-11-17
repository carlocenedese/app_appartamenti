# Piano 16: distribuzione e Python in produzione (disegno)

Stato: **proposta, parte sicura implementata; scelte aperte in «Domande per user1» e R275** (17 novembre 2026). Piano: `docs/plans/2026-11-17-piano-16-distribuzione.md`. Specifica: sezioni 2, 28, 36, 37 e 40.

## Obiettivo (parole di user1)

«Non posso darti le chiavi né l'accesso al computer di user2. Deve funzionare come una qualsiasi app che fa download e poi si fa login e tutto è ok.» Quindi: user2 scarica un installer da una pagina pubblica, lo installa, apre l'app e funziona, Python compreso; gli aggiornamenti arrivano da soli; user1 non consegna chiavi e non tocca il computer di user2.

## Stato attuale (17 novembre 2026, `origin/main` ec67f9d)

- **Python incluso: c'è già.** `scripts/bundle-python.mjs` scarica l'interprete _python-build-standalone_ di `python/runtime.json` (Windows x86_64 e macOS Apple Silicon), ne verifica lo SHA-256 prima di estrarlo, installa `python/requirements.txt` con `--require-hashes --no-deps --only-binary :all:`, toglie pip, Tcl/Tk e tkinter (licenze fuori elenco), copia `bollette_pdf` e i testi di licenza delle librerie OCR. `tauri.conf.json` lo porta tra le risorse (`python/`, `seed-profiles/`, `ocr-data/`). L'utente non installa nulla. Non è un sidecar Tauri (`externalBin`) ma una risorsa avviata con `python -I -m bollette_pdf`: va bene così, un sidecar vorrebbe un unico eseguibile (PyInstaller o simili), con licenze e dimensioni peggiori.
- **Build: c'è già.** `.github/workflows/build.yml`, su etichetta `v*` o a mano: Windows (`.msi`, `.exe` NSIS) e macOS universale (`.dmg`, `.app`); controlla Python e OCR nell'app costruita; carica gli installer come artifact dell'esecuzione (visibili solo a chi ha accesso al repository, scadono).
- **Pubblicazione: manca.** Nessuna release, nessuna pagina di download.
- **Aggiornamenti: mancano.** Né `tauri-plugin-updater` in `Cargo.toml`, né configurazione, né firma degli artifact. La coppia di chiavi esiste già (R31: generata l'11 novembre 2026, senza password, nella cartella iCloud di user1; mai nel repository).
- **Rust in locale: assente** su questa macchina. `build.yml` usa `cargo … --locked`: aggiungere una dipendenza Rust senza rigenerare `Cargo.lock` rompe la build.
- **Il repository è PUBBLICO** (`gh repo view`: `visibility: PUBLIC`), mentre le sezioni 37 e 40 dicono «sorgente in un repository privato, versioni in un repository pubblico». Vedi la domanda 1.

## Opzioni e scelta

### (a) Python incluso

1. **Risorsa con interprete standalone verificato per hash** (esistente). Scelta: nessun cambiamento.
2. Sidecar unico con PyInstaller/Nuitka: un file solo, ma licenze del bootloader da verificare, avvio più lento, falsi positivi degli antivirus su Windows. Scartata.
3. Python embeddable ufficiale di python.org per Windows: solo Windows, niente pip; non serve, l'opzione 1 copre già entrambi i sistemi.

Limite noto: su Mac Intel l'app universale parte ma Python no (interprete solo Apple Silicon). Domanda 5.

### (b) Pubblicazione

1. **GitHub Releases dello stesso repository** (oggi pubblico): basta il `GITHUB_TOKEN` del workflow, nessun token personale. Scelta per ora.
2. Repository pubblico separato solo per le versioni (come dice la sezione 37): serve un token con permesso di scrittura su quel repository, salvato come secret, cioè un secondo passo manuale di user1. Da fare solo se il sorgente torna privato (domanda 1).

Contenuto della release: per Windows **solo** l'installer NSIS `.exe` (installazione per l'utente, senza permessi di amministratore; è quello che `build.yml` già prova); per macOS il `.dmg` e l'archivio di aggiornamento `.app.tar.gz`; le firme `.sig`; `latest.json`; `SHA256SUMS`. Nessun dato personale: solo binari costruiti dal repository e file generati. L'indirizzo dell'aggiornamento si costruisce in CI da `github.repository`: il nome dell'account non entra in nessun file del repository.

### (c) Aggiornamento automatico firmato

- Tauri updater (`tauri-plugin-updater`, MIT o Apache-2.0): l'app legge `https://github.com/<proprietario>/<repository>/releases/latest/download/latest.json`, scarica l'installer della piattaforma e ne verifica la firma minisign con la **chiave pubblica** in `tauri.conf.json` (`plugins.updater.pubkey`). Con `requireSignedVersion: true` (già in `tauri.conf.json`, preteso dal preflight) la firma lega anche il numero di versione (`tauri signer sign --app-version`). **Deviazione dalla sezione 37:** la spec dice «il manifest è firmato»; con Tauri `latest.json` **non** è firmato, sono firmati i singoli file, e `requireSignedVersion` impedisce di abbinare un numero di versione a un file di un'altra versione. Resta possibile, a chi controlla la pagina delle release, ripresentare una versione vecchia firmata con il suo numero (domanda 8).
- La **chiave privata** non passa mai da questa chat né dal repository. user1 esegue in locale **un solo comando**, `node scripts/setup-updater.mjs <cartella della chiave>`, che: trova la coppia `*.key` / `*.key.pub` già esistente (non ne genera una nuova se c'è), mostra il repository (da `git remote get-url origin`) e manda la privata a `gh secret set TAURI_SIGNING_PRIVATE_KEY --env release --repo <repository>` **su stdin** (mai come argomento, mai stampata), scrive la pubblica al posto del segnaposto in `tauri.conf.json`. La pubblica non è un segreto: si committa.
- **Chi può firmare (revisione, I1 e I2):** la chiave è un secret dell'**environment `release`**, non del repository: lo vede solo il job `sign`, che parte solo da un'etichetta `v*` spinta (non da «Run workflow») e aspetta l'approvazione di user1 (revisore obbligatorio, solo etichette `v*`; una regola riserva le etichette `v*` agli amministratori). Le build girano **senza chiave**; il job `sign` è corto: installa solo la CLI di Tauri, poi `tauri signer sign --app-version` sui due file (installer NSIS e archivio `.app.tar.gz`). Il job `publish` (unico con permesso di scrittura, senza chiave) verifica ogni `.sig` con la chiave pubblica di `tauri.conf.json` (minisign, Ed25519, in `release.mjs`) prima di pubblicare. Chi ha solo il push non arriva alla chiave. Limite: chi usa le credenziali GitHub di user1 è user1.
- Chiave senza password (R31): la CLI di Tauri 2.12 assume la password vuota quando non è un terminale; nessun secret per la password. Attenzione: le chiavi senza password generate con la CLI tra 2.9.3 e 2.10.0 erano difettose (CHANGELOG della CLI); se la prima build firmata fallisce sulla firma, si rigenera la coppia in locale (`docs/distribuzione.md`, «Se la firma non funziona») e si rilancia lo stesso comando.
- **Guardia contro l'installer senza uscita:** un installer pubblicato senza plugin o con la chiave pubblica sbagliata non si aggiornerà mai, e user1 dovrebbe tornare sul computer di user2. Per questo, su un'etichetta `v*`, `build.yml` si ferma **prima** della build se manca una qualsiasi di: chiave pubblica vera, `requireSignedVersion: true`, plugin in `Cargo.toml` e registrato in `lib.rs`, versione dell'etichetta uguale a quella di `tauri.conf.json`, `Cargo.toml`, `Cargo.lock`, `package.json` e `apps/desktop/package.json` (`node scripts/release.mjs preflight`). Oggi quindi nessuna etichetta pubblica nulla, ed è voluto. Il secret di firma lo controlla il job `sign` (un secret di environment non è visibile alla build). La build a mano (Run workflow) non pubblica mai, nemmeno lanciata su un'etichetta: installer di prova negli artifact, senza firma di aggiornamento. **Non provato:** che l'installer NSIS costruito senza `createUpdaterArtifacts` sia identico a quello che Tauri firmerebbe da sé (il bundler marca il tipo di pacchetto nel binario in ogni caso, da confermare alla prima release) e che l'archivio `.app.tar.gz` fatto con `tar` sia accettato dal plugin come quello di Tauri (stessa struttura: l'app alla radice).
- **Parte non fatta in questo ramo (manca Rust):** registrare il plugin in `lib.rs`, aggiungerlo a `Cargo.toml` e `apps/desktop/package.json` (`@tauri-apps/plugin-updater`, più `tauri-plugin-process` per il riavvio), permessi in `capabilities/default.json`, rigenerare `Cargo.lock` (in CI, procedura del `apps/desktop/README.md`, «Punti aperti»), la richiesta all'utente «È disponibile la versione X, installarla?» e l'interruttore per disattivare il controllo (sezione 28). Domanda 4 per dove sta l'interruttore.

### (d) Cosa vede user2

1. Apre la pagina della release (link mandato da user1), scarica `App-Bollette_<versione>_x64-setup.exe`.
2. **SmartScreen** (nessun certificato, decisione del 6 novembre 2026): «Windows ha protetto il PC» → «Maggiori informazioni» → «Esegui comunque». Una volta sola per installer.
3. Installazione senza permessi di amministratore in `%LOCALAPPDATA%\App Bollette`; WebView2 c'è già in Windows 10 e 11 aggiornati.
4. Primo avvio guidato (sezione 36, piano 6): **non c'è login con password**. «Login» per user2 vuol dire: scegliere «Unisciti a un gruppo», indicare la cartella Dropbox condivisa «App Bollette» (deve essere «sempre su questo dispositivo») e scegliere il proprio profilo (user2). È tutto locale; nessun account, nessun server. Domanda 2 per la conferma.
5. Gli aggiornamenti: all'avvio l'app chiede a GitHub `latest.json` (l'unica chiamata di rete, sezione 28, nessun dato inviato), propone la versione nuova, la scarica, verifica la firma e si riavvia. SmartScreen non dovrebbe ricomparire per gli aggiornamenti installati dall'app (scaricati dall'app, non dal browser: niente «Mark of the Web»); **da verificare** alla prima versione.
6. macOS (user1): il `.dmg` non è notarizzato; «Apri» dal menu contestuale, poi da macOS 15 «Privacy e sicurezza» → «Apri comunque» (già nel `apps/desktop/README.md`).

## Cosa deve fare user1 a mano

Una volta: (0) «Run workflow» del ramo prima dell'unione (`gh workflow run build.yml --ref feat/piano-16-distribuzione`, 2 comandi con `gh run watch`); (1) environment `release` e regola sulle etichette (un blocco di 7 righe `gh api` da incollare); (2) `node scripts/setup-updater.mjs "<cartella della chiave>"` (un comando: secret dell'environment + chiave pubblica nel file); (3) committare `tauri.conf.json` con la chiave pubblica (può farlo un agente). Poi il piano 16b (plugin, `Cargo.lock` dalla CI) lo fanno gli agenti. A ogni versione: alzare la versione nei cinque file (agente), `git tag vX.Y.Z && git push origin vX.Y.Z`, poi un clic «Approve and deploy» su GitHub. Dettagli in `docs/distribuzione.md`.

## Domande per user1

1. **Il repository è pubblico.** Le sezioni 37 e 40 dicono sorgente privato e versioni in un repository pubblico a parte. È voluto? Se sì, le release stanno nello stesso repository (nessun token in più). Se torna privato, serve un repository pubblico per le versioni e un token con scrittura su quello (un passo in più per user1).
2. **«Login»** = primo avvio della sezione 36 («Unisciti a un gruppo», cartella Dropbox condivisa, scelta del profilo), senza account né password. Confermi? Oppure intendevi altro (per esempio un PIN locale)?
3. **Approvazione:** oggi la release parte dopo il clic «Approve and deploy» di user1 sul job `sign` e poi si pubblica subito (non in bozza). Va bene un clic per versione?
4. **Interruttore degli aggiornamenti** (sezione 28): nelle impostazioni della macchina (`machine-settings.json`, ogni computer il suo) o del gruppo? E il controllo: a ogni avvio, o una volta al giorno?
5. **Mac Intel:** l'aggiornamento è pubblicato solo per Mac Apple Silicon (su Intel Python non parte). Serve anche Intel (secondo interprete, app non universale)?
6. **Pagina pubblica:** la pagina delle release mostra il nome dell'account GitHub. Va bene, o serve un account o un'organizzazione neutri?
7. **Firma macOS ad hoc** (`signingIdentity: "-"`): si attiva solo se l'app su Apple Silicon si rifiuta di partire, o subito?
8. **Manifest non firmato** (sezione 37 dice «manifest firmato»): con Tauri si firmano i file e, con `requireSignedVersion`, la loro versione; `latest.json` no. Basta così, o serve un manifest firmato a parte (un controllo in più nell'app, piano 16b)?
