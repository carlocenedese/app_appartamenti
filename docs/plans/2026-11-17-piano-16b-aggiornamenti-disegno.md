# Piano 16b: aggiornamenti dentro l'app (disegno)

Stato: **proposta, implementata in questo ramo; il lato Rust è provato solo in CI** (17 novembre 2026). Piano: `docs/plans/2026-11-17-piano-16b-aggiornamenti.md`. Prima: piano 16 (`docs/plans/2026-11-17-piano-16-distribuzione-disegno.md`, R270-R275). Specifica: sezioni 28, 36, 37. Registro: R280-R285.

## Obiettivo

L'app controlla se esiste una versione nuova (`latest.json` dell'ultima release su GitHub), la mostra all'utente e la installa **solo dopo il suo clic** su «Installa e riavvia». La firma la verifica il plugin con la chiave pubblica di `tauri.conf.json`; con `requireSignedVersion: true` la firma lega anche il numero di versione. È l'unica chiamata di rete dell'app (sezione 28) e un interruttore la spegne. Nessuna installazione silenziosa.

## Scelte

- **Plugin ufficiali**: `tauri-plugin-updater` `=2.14.0` e `tauri-plugin-process` `=2.4.0` (Apache-2.0 OR MIT, entrambi per `tauri ^2.12`, pubblicati il 14 ottobre e il 26 settembre 2026, quindi da più di due settimane; la 2.14.0 è dello stesso giorno di `tauri-plugin-fs` 2.7.1 già in uso). Pacchetti npm con le stesse versioni (`@tauri-apps/plugin-updater` 2.14.0, `@tauri-apps/plugin-process` 2.4.0, MIT OR Apache-2.0): la CLI di Tauri si lamenta se crate e pacchetto npm non coincidono. Controllato nel sorgente della 2.14.0 (`src/config.rs`): `requireSignedVersion` esiste; `endpoints` può mancare (il repository non ne ha: l'indirizzo lo aggiunge `build.yml` con `--config`, R273); la chiave pubblica si legge solo alla verifica, non all'avvio, quindi le build di prova con il segnaposto partono (il controllo dà errore, mostrato in italiano). Registrazione: `tauri_plugin_updater::Builder::new().build()` e `tauri_plugin_process::init()`.
- **Permessi minimi** in `capabilities/default.json`: `updater:allow-check` e `updater:allow-download-and-install` (nomi verificati nel sorgente della 2.14.0; non `download` e `install` separati) e `process:allow-restart` (solo il riavvio, non `exit`). La richiesta di rete la fa Rust, non la pagina: la CSP resta com'è.
- **Interruttore** nelle impostazioni della macchina (`machine-settings.json`, campo `checkUpdates`): ogni computer decide per sé, e il file è già permesso dalle capabilities. Campo assente vuol dire **attivo** (domanda 1); file assente, illeggibile, non JSON o con un valore strano vuol dire **spento** (lettura grezza del solo campo, R286): al primissimo avvio non si controlla finché il primo avvio non ha scritto il file. Quando è spento non parte nessuna chiamata, né all'avvio né da «Controlla ora» (il pulsante è disattivato).
- **Frequenza**: un controllo all'avvio, più «Controlla ora» (domanda 2).
- **Interfaccia** (`apps/desktop/src/updates.ts`): pannello «Aggiornamenti» con markup semplice e classi neutre (`updates`, `updates-status`); la veste grafica la fa un'altra chat. Il codice parla con Tauri solo attraverso `UpdateBackend` (come `SettingsBackend` e `tauriFsBackend`), così i test girano con un backend finto. L'unico file che importa i plugin è `updates-tauri.ts`.
- **Versione uguale**: il plugin non propone una versione non più nuova; per prudenza il pannello ignora anche una risposta con la stessa versione di quella in uso.
- **Errori**: «Non è stato possibile controllare gli aggiornamenti. Controlla la connessione a internet e riprova più tardi.» e «Non è stato possibile installare l'aggiornamento. L'app resta com'era: riprova più tardi.» Il testo dell'errore non si mostra e non si registra (può contenere percorsi).
- **Riavvio**: su Windows l'installer NSIS chiude l'app da sé; su macOS il pannello chiama `relaunch()` dopo l'installazione.

## Divisione in due parti e `Cargo.lock`

Su questo computer non c'è Rust e `build.yml` usa `--locked`: una dipendenza Rust senza `Cargo.lock` aggiornato rompe la build. Le capabilities dei due plugin si risolvono solo con i crate presenti, quindi non possono precedere `Cargo.toml` e `lib.rs`.

- **Parte A** (provata qui, nessuna dipendenza nuova): disegno e piano, campo `checkUpdates`, `updates.ts` con logica, pannello e test, controllo delle capabilities nel preflight, workflow del lock, documenti.
- **Parte B** (ultimi commit del ramo, provata solo in CI): pacchetti npm e `pnpm-lock.yaml`, `updates-tauri.ts`, collegamento in `main.ts`, `Cargo.toml`, `lib.rs`, capabilities. Poi `Cargo.lock` dall'artifact, poi una build verde, poi l'unione.

`ci.yml` non compila Rust: resta verde a ogni commit. `build.yml` gira solo su etichetta o a mano.

**Workflow del lock** (`.github/workflows/cargo-lock.yml`): un `workflow_dispatch` nuovo non si può lanciare da un ramo finché il file non è su `main` (GitHub), quindi parte **da solo a ogni push che cambia `Cargo.toml` o `Cargo.lock`**, su qualsiasi ramo, oltre che a mano. Ubuntu, `contents: read`, azioni fissate per commit come in `build.yml`, nessun push: `cargo metadata` senza `--locked` aggiunge solo le voci mancanti (niente `cargo update`, che rimescolerebbe l'albero), poi `cargo deny --locked … check licenses`, poi carica `Cargo.lock` come artifact `cargo-lock` e **fallisce se il lock era vecchio**: rosso vuol dire «scarica l'artifact e committalo». Passi in `docs/distribuzione.md`, punto 3.

## Cosa non è provato qui

Che il crate compili con `tauri 2.12.5`, che le capabilities siano accettate, che `cargo deny` non trovi licenze nuove (per esempio `webpki-roots`, CDLA-Permissive-2.0, se entrasse: non dovrebbe, il plugin usa `rustls` con `ring` e il verificatore della piattaforma; se `cargo deny` la trova, decide user1, `deny.toml` non si tocca), e il giro completo controllo → scaricamento → firma → installazione → riavvio, che si vede solo alla prima release dopo questa.

## Domande per user1

1. **Interruttore attivo di default?** Oggi sì (campo assente = controllo attivo). Alternativa: spento finché l'utente non lo accende.
2. **Frequenza**: solo all'avvio (oggi) o anche una volta al giorno se l'app resta aperta?
3. **Dove sta l'interruttore**: impostazioni della macchina (oggi, ogni computer il suo) o del gruppo condiviso?
4. **Testi**: «È disponibile la versione X (in uso: Y).», «Installa e riavvia», i due messaggi d'errore sopra. Vanno bene? Serve mostrare le note della versione?
5. **«Controlla ora» con l'interruttore spento**: oggi è disattivato (nessuna rete). Va bene, o un clic esplicito deve funzionare comunque?
