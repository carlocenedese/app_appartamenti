# Distribuzione e aggiornamenti: cosa fa user1

Come arriva l'app sul computer di user2 senza che user1 debba toccarlo né consegnare chiavi. Disegno: `docs/plans/2026-11-17-piano-16-distribuzione-disegno.md`.

## In breve

- L'installer si scarica dalla pagina **Releases** del repository su GitHub. Contiene già Python e tutto il resto: user2 non installa nient'altro.
- Gli aggiornamenti li firma GitHub Actions con la chiave privata salvata come _secret_ del repository. L'app installata li riconosce con la chiave pubblica scritta nell'app.
- La chiave privata resta sul computer di user1 e nei secrets di GitHub: mai nel repository, mai in una chat.

## Una volta sola

### 1. Mettere la chiave nei secrets (un comando)

Serve la GitHub CLI con l'accesso fatto (`gh auth status` deve dire «Logged in»). Dalla cartella del repository, sul proprio Mac:

```sh
node scripts/setup-updater.mjs "$HOME/Library/Mobile Documents/com~apple~CloudDocs/Personale/App_appartamenti/chiave-firma-aggiornamenti"
```

Il comando:

- trova nella cartella la coppia di chiavi già creata l'11 novembre 2026 (un file `….key` e il suo `….key.pub`; non ne crea di nuove);
- manda la chiave privata a GitHub come secret `TAURI_SIGNING_PRIVATE_KEY` (non la mostra e non la scrive altrove);
- scrive la chiave pubblica in `apps/desktop/src-tauri/tauri.conf.json`.

Se dice «Fatto», resta solo da committare `tauri.conf.json` (la chiave pubblica non è un segreto): basta dire a un agente «chiave pubblica scritta, committala».

Se la cartella contiene altri file `.key`, il comando si ferma: deve esserci una sola coppia.

### 2. Il plugin di aggiornamento nell'app (lo fanno gli agenti)

Piano 16b: plugin nell'app e `Cargo.lock` rigenerato con una build a mano su GitHub. Finché non c'è, un'etichetta di versione **si ferma da sola** prima della build con un messaggio chiaro: è voluto, perché un installer senza aggiornamenti costringerebbe a reinstallare a mano sul computer di user2.

## A ogni versione

1. La versione nuova (per esempio `0.2.0`) va scritta uguale in quattro file: `apps/desktop/src-tauri/tauri.conf.json`, `apps/desktop/src-tauri/Cargo.toml`, `package.json`, `apps/desktop/package.json` (lo può fare un agente).
2. Etichetta e invio:

   ```sh
   git tag v0.2.0
   git push origin v0.2.0
   ```

3. GitHub Actions (circa 30 minuti) controlla versioni, chiave e plugin, costruisce Windows e macOS, firma i file di aggiornamento e pubblica la release con `latest.json`. Le app già installate la vedono al primo controllo.

Per una prova senza pubblicare: su GitHub, Actions, Build, «Run workflow». Gli installer di prova restano negli artifact dell'esecuzione e non si aggiornano da soli.

## Cosa fa user2 (da mandargli)

1. Aprire il link della pagina della release e scaricare `App-Bollette_<versione>_x64-setup.exe`.
2. Aprirlo. Windows mostra «Windows ha protetto il PC»: scegliere **«Maggiori informazioni»**, poi **«Esegui comunque»**. Succede solo alla prima installazione (l'app non ha un certificato di firma, decisione del 6 novembre 2026).
3. L'installazione non chiede la password di amministratore.
4. Al primo avvio: «Unisciti a un gruppo», scegliere la cartella Dropbox condivisa «App Bollette» (in Dropbox deve essere «Disponibile offline» / «sempre su questo dispositivo»), poi il proprio profilo. Non ci sono account né password.
5. Quando esce una versione nuova l'app propone di installarla: basta accettare.

Il link da mandare è quello della pagina Releases del repository, `https://github.com/<proprietario>/<repository>/releases/latest`.

## Se qualcosa non va

- **La build si ferma su «Check that the version can be published»**: il messaggio dice cosa manca (versione diversa in uno dei quattro file, chiave pubblica segnaposto, plugin assente, secret mancante).
- **Se la firma non funziona** (errore sulla chiave nella build): la coppia potrebbe essere di quelle difettose della CLI di Tauri tra 2.9.3 e 2.10.0. Si crea una coppia nuova in una cartella vuota, `pnpm --filter desktop tauri signer generate --ci -w "<cartella nuova>/app-bollette.key"`, si rimette il segnaposto in `tauri.conf.json` (o lo si chiede a un agente) e si rilancia il comando del punto 1 con la cartella nuova. Si può fare solo **prima** di dare un installer a user2: dopo, una chiave nuova vuol dire reinstallare a mano.
- **La chiave privata va persa**: le app installate non accetteranno più aggiornamenti; serve una reinstallazione a mano. Conservarne una copia anche fuori da iCloud.
- **Mac**: l'app non è notarizzata. Si apre con il tasto destro, «Apri»; da macOS 15 poi Impostazioni di Sistema, «Privacy e sicurezza», «Apri comunque». Python funziona solo sui Mac Apple Silicon.
