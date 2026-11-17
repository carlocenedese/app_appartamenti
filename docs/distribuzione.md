# Distribuzione e aggiornamenti: cosa fa user1

Come arriva l'app sul computer di user2 senza che user1 debba toccarlo né consegnare chiavi. Disegno: `docs/plans/2026-11-17-piano-16-distribuzione-disegno.md`.

## In breve

- L'installer si scarica dalla pagina **Releases** del repository su GitHub. Contiene già Python e tutto il resto: user2 non installa nient'altro.
- Gli aggiornamenti li firma GitHub Actions con la chiave privata salvata come _secret_ dell'environment `release`: la vede solo il passo che firma, e solo dopo che user1 ha cliccato «Approve» su GitHub. Chi ha soltanto il permesso di push non può firmare né pubblicare. L'app installata riconosce gli aggiornamenti con la chiave pubblica scritta nell'app.
- La chiave privata resta sul computer di user1 e nei secrets di GitHub: mai nel repository, mai in una chat.
- Limite: chi usa l'accesso GitHub di user1 (anche un agente sul suo computer, con la sua `gh`) per GitHub **è** user1. La protezione vale contro chiunque abbia solo il push o un token limitato; il clic di approvazione resta un gesto di user1.

## Una volta sola

Serve la GitHub CLI con l'accesso fatto (`gh auth status` deve dire «Logged in») e una copia del repository. Tutti i comandi si danno dalla cartella del repository, sul proprio Mac.

### 0. Prova della build prima dell'unione

Prima di unire il ramo del piano 16 in `main` (il ramo deve essere su GitHub):

```sh
gh workflow run build.yml --ref feat/piano-16-distribuzione
gh run watch
```

Deve finire in verde: è la prova che le due build (Windows e macOS) funzionano con la configurazione nuova. Non pubblica nulla.

### 1. Environment `release` e protezione delle etichette (un blocco da incollare)

Crea l'environment `release`, che aspetta l'approvazione di user1 e accetta solo le etichette `v*`, e una regola per cui solo gli amministratori del repository possono creare, spostare o cancellare un'etichetta `v*`:

```sh
repo=$(gh repo view --json nameWithOwner -q .nameWithOwner)
me=$(gh api user -q .id)
gh api -X PUT "repos/$repo/environments/release" --input - <<EOF
{"reviewers":[{"type":"User","id":$me}],"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}
EOF
gh api -X POST "repos/$repo/environments/release/deployment-branch-policies" -f name='v*' -f type=tag
gh api -X POST "repos/$repo/rulesets" --input - <<'EOF'
{"name":"Etichette di versione","target":"tag","enforcement":"active","conditions":{"ref_name":{"include":["refs/tags/v*"],"exclude":[]}},"rules":[{"type":"creation"},{"type":"update"},{"type":"deletion"}],"bypass_actors":[{"actor_id":5,"actor_type":"RepositoryRole","bypass_mode":"always"}]}
EOF
```

(`actor_id` 5 è il ruolo «Admin» del repository.) Si controlla su GitHub in Settings, Environments, `release` (revisore user1, «Deployment branches and tags»: `v*`) e Settings, Rules, Rulesets. Gli stessi passi si possono fare a mano da quelle pagine.

### 2. Mettere la chiave nell'environment (un comando)

Lo script c'è dopo l'unione del piano 16 in `main` (`git pull`):

```sh
node scripts/setup-updater.mjs "$HOME/Library/Mobile Documents/com~apple~CloudDocs/Personale/App_appartamenti/chiave-firma-aggiornamenti"
```

Il comando:

- trova nella cartella la coppia di chiavi già creata l'11 novembre 2026 (un file `….key` e il suo `….key.pub`; non ne crea di nuove);
- mostra il repository (letto da `git remote get-url origin`) e manda la chiave privata a GitHub come secret `TAURI_SIGNING_PRIVATE_KEY` dell'environment `release` (non la mostra e non la scrive altrove; se l'environment non c'è, `gh` si ferma: prima il punto 1);
- scrive la chiave pubblica in `apps/desktop/src-tauri/tauri.conf.json`.

Se dice «Fatto», resta solo da committare `tauri.conf.json` di quella stessa copia (la chiave pubblica non è un segreto): basta dire a un agente «chiave pubblica scritta, committala».

Se la cartella contiene altri file `.key`, il comando si ferma: deve esserci una sola coppia.

### 3. Il plugin di aggiornamento nell'app (lo fanno gli agenti)

Piano 16b: plugin nell'app e `Cargo.lock` rigenerato con una build a mano su GitHub. Finché non c'è, un'etichetta di versione **si ferma da sola** prima della build con un messaggio chiaro: è voluto, perché un installer senza aggiornamenti costringerebbe a reinstallare a mano sul computer di user2.

## A ogni versione

1. La versione nuova (per esempio `0.2.0`) va scritta uguale in cinque file: `apps/desktop/src-tauri/tauri.conf.json`, `apps/desktop/src-tauri/Cargo.toml`, `apps/desktop/src-tauri/Cargo.lock` (la riga `version` sotto `name = "app-bollette"`), `package.json`, `apps/desktop/package.json` (lo può fare un agente).
2. Etichetta e invio:

   ```sh
   git tag v0.2.0
   git push origin v0.2.0
   ```

3. GitHub Actions controlla versioni, chiave e plugin e costruisce Windows e macOS (circa 30 minuti), senza chiave.
4. Poi si ferma su «sign» in attesa: GitHub manda una notifica. Si apre l'esecuzione (Actions, Build) e si sceglie **«Review deployments»**, `release`, **«Approve and deploy»**. Solo allora i due file di aggiornamento vengono firmati; il passo dopo verifica le firme con la chiave pubblica e pubblica la release con `latest.json`. Le app già installate la vedono al primo controllo.

Per una prova senza pubblicare: su GitHub, Actions, Build, «Run workflow» (o `gh workflow run build.yml`). Non pubblica mai, nemmeno su un'etichetta: gli installer di prova restano negli artifact dell'esecuzione.

## Cosa fa user2 (da mandargli)

1. Aprire il link della pagina della release e scaricare `App-Bollette_<versione>_x64-setup.exe`.
2. Aprirlo. Windows mostra «Windows ha protetto il PC»: scegliere **«Maggiori informazioni»**, poi **«Esegui comunque»**. Succede solo alla prima installazione (l'app non ha un certificato di firma, decisione del 6 novembre 2026).
3. L'installazione non chiede la password di amministratore.
4. Al primo avvio: «Unisciti a un gruppo», scegliere la cartella Dropbox condivisa «App Bollette» (in Dropbox deve essere «Disponibile offline» / «sempre su questo dispositivo»), poi il proprio profilo. Non ci sono account né password.
5. Quando esce una versione nuova l'app propone di installarla: basta accettare (da verificare alla prima versione: se Windows mostra di nuovo SmartScreen, stessi due clic).

Chi vuole controllare un file scaricato: nella stessa pagina c'è `SHA256SUMS`; con i file nella stessa cartella, `shasum -a 256 -c SHA256SUMS --ignore-missing` (Mac) deve dire «OK».

Il link da mandare è quello della pagina Releases del repository, `https://github.com/<proprietario>/<repository>/releases/latest`.

## Se qualcosa non va

- **La build si ferma su «Check that the version can be published»**: il messaggio dice cosa manca (versione diversa in uno dei cinque file, chiave pubblica segnaposto, `requireSignedVersion` assente, plugin assente in `Cargo.toml` o `lib.rs`).
- **Si ferma su «Sign the update files» con «Manca il secret»**: il punto 2 non è stato fatto, o la chiave è stata messa nei secrets del repository invece che nell'environment `release`.
- **Si ferma su «Write the update manifest»**: una firma non corrisponde alla chiave pubblica di `tauri.conf.json` (chiave privata e pubblica di coppie diverse): non si pubblica nulla.
- **Se la firma non funziona** (errore sulla chiave nel passo «Sign the update files»): la coppia potrebbe essere di quelle difettose della CLI di Tauri tra 2.9.3 e 2.10.0. Si crea una coppia nuova in una cartella vuota, `pnpm --filter desktop tauri signer generate --ci -w "<cartella nuova>/app-bollette.key"`, si rimette il segnaposto in `tauri.conf.json` (o lo si chiede a un agente) e si rilancia il comando del punto 2 con la cartella nuova. Si può fare solo **prima** di dare un installer a user2: dopo, una chiave nuova vuol dire reinstallare a mano.
- **La chiave privata va persa**: le app installate non accetteranno più aggiornamenti; serve una reinstallazione a mano. Conservarne una copia anche fuori da iCloud.
- **Mac**: l'app non è notarizzata. Si apre con il tasto destro, «Apri»; da macOS 15 poi Impostazioni di Sistema, «Privacy e sicurezza», «Apri comunque». Python funziona solo sui Mac Apple Silicon.
