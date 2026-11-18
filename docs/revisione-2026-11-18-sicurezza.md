# Revisione di sicurezza del 18 novembre 2026: correzioni e azioni aperte

Ramo `fix/revisione-sicurezza`. Gli ID (S1-S14) sono quelli del rapporto della revisione 5 (sicurezza, privacy e catena di rilascio). Questo file sostituisce, per questo giro, le note di `docs/progress.md`, che altri stanno modificando.

## Corretto nel codice

- **S2, S8:** `node scripts/release.mjs environment <proprietario/nome>` legge con `gh api` (solo GET) l'environment `release` e lo rifiuta se non esiste, se non ha almeno un revisore obbligatorio o se non ammette solo le etichette `v*`. Ogni errore di lettura conta come rifiuto. Lo chiamano `setup-updater.mjs`, prima di leggere la chiave, e il job `guard` di `build.yml`, che gira fuori da ogni environment prima di `sign`. Così GitHub non crea da solo un `release` senza regole. Il controllo verifica le impostazioni, non le sostituisce: chi può cambiare il workflow può anche toglierlo.
- **S1 (parte di codice):** `check-personal-data.mjs` conosce i nomi reali solo come impronte SHA-256 salate (ogni parola in minuscolo e in NFC). I test usano nomi inventati e i file dello script vengono controllati anch'essi per i nomi. Nuovo tipo «private path»: la cartella di iCloud Drive del Mac e le cartelle home di un account reale (`/Users/<nome>`, `/home/<nome>`, `C:\Users\<nome>`), segnaposto esclusi. Il percorso iCloud della chiave è stato tolto da `docs/distribuzione.md` (ora `<cartella della chiave>`). L'impronta tiene i nomi fuori dal testo in chiaro, ma tre nomi comuni si indovinano facilmente: non è un segreto.
- **S14:** riga 3 di `README.md` riscritta in modo neutro.
- **S5:** job `audit` in `ci.yml`, bloccante:
  - `pnpm audit --prod --audit-level high`;
  - `pip-audit` 2.10.1 (Apache-2.0), in un virtualenv del job e mai nel pacchetto, sui requisiti con hash. Blocca su qualsiasi avviso noto, perché non ha un filtro di gravità.

  Job `rust`, su Windows, sulle PR che toccano l'app Rust, i file Cargo o `deny.toml`, e ogni notte: `cargo check --locked` e `cargo deny check licenses advisories`. In `deny.toml`, `[advisories]` dà errore solo per le vulnerabilità, non per i crate non mantenuti. Dependabot anche per `cargo` e `pip`. Per silenziare un falso positivo vedi il commento del job `audit`: sempre nel repository, con un motivo scritto, mai togliendo il passo.

- **Qualità CI (richiesta del coordinatore):** nel job `check`, `pnpm --filter desktop build` (vite build) e `pnpm tools:test` (non su Windows, dove `python3` non c'è).
- **S9:** l'app rifiuta, alla creazione e all'apertura (anche della cartella salvata), una radice (`/`, `C:\`, `~`), una cartella home e la cartella che contiene le home (`isTooBroadFolder`).
- **S13:** CSP con `base-uri 'none'; object-src 'none'; form-action 'none'`. L'app non ha `<form>`, `<base>` né `<object>`. `frame-ancestors` non è stato aggiunto, perché in una CSP data come meta viene ignorato.
- **S11:** `scripts/python.mjs` avvia l'interprete con la cartella di lavoro nella radice del repository. `PYTHON` resta il modo per indicare un interprete preciso.
- **S7:** `read_pdf` rifiuta un file oltre 50 MB, letto con un tetto e mai per intero, e un documento oltre 200 pagine. Non viene mai troncato.

## Ruling

- **Limiti dei PDF (S7):** 50 MB e 200 pagine invece dei 20 MB e 50 pagine suggeriti. Le fixture arrivano a 10 pagine, ma un PDF scansionato con più bollette, letto per intervalli di pagine, può superare 50 pagine e 20 MB. I limiti fermano comunque il caso delle 100 000 pagine.
- **Segnaposto dei percorsi:** sono accettati `user`, `user1`, `user2`, …, una sola lettera (`C:/Users/x.json`) e ciò che non comincia con una lettera o una cifra (`<nome>`, `…`).

## Non fatto, e perché

- **CLI `estratti` (S9 e S11):** il controllo della cartella e la ricerca di `python` stanno in `scripts/estratti.mjs`, che in questo giro non si poteva toccare.
- **S9, ambito già concesso:** la finestra di scelta aggiunge la cartella all'ambito (che persisted-scope ricorda) prima che l'app la rifiuti. Per toglierla serve un comando Rust.
- **S7, bomba FlateDecode:** `pdfminer.six` non permette di limitare i byte decompressi. Il contratto del futuro comando Rust che avvierà Python (timeout con kill, tetto su stdout, ambiente ripulito) resta da scrivere quando il Python verrà collegato all'app.
- **S6, S10:** sono regole da decidere (vedi le domande sotto).

## Non verificato

- Il job `guard` con il `GITHUB_TOKEN` (permessi `actions`, `deployments` e `contents` in lettura). La documentazione dice «chiunque abbia accesso in lettura», ma non nomina i permessi del token. Se risponde 403, soprattutto con il repository privato, la build si ferma senza firmare (fallimento chiuso). Verificato in locale: con l'account di user1, oggi `release.mjs environment` rifiuta, perché l'environment non esiste.
- Il job `rust` e `cargo deny check advisories`: Rust non c'è su questo Mac. Il primo giro può essere rosso, sia per un avviso vero sia perché `tauri-build` non accetta le cartelle delle risorse con il solo file segnaposto.
- La CSP nuova non è stata provata nell'app compilata.

## Nomi delle vie e della città (decisione del proprietario, non toccati)

I nomi delle tre vie compaiono in 60 file tracciati (`git grep -l -i -E 'berchet|lovarini|pulci'`): 24 in `packages/core/test`, 15 in `docs/plans` e poi `docs/glossary.md`, `docs/progress.md`, `docs/spec.md`, `docs/rules/conguaglio-rules.md`, `docs/rules/lettura-pdf.md`, `fixtures/README.md`, `fixtures/contracts/due-appartamenti.json`, `fixtures/golden/berchet-2024-25.json`, `fixtures/reconcile/tre-conti.json`, `packages/core/src/{accounts,conguaglio,match,split,tari-note}.ts`, `reports/golden/berchet-2024-25-differenze.md`, `scripts/{check-personal-data,golden-report}.mjs` e i loro test, `scripts/estratti.test.mjs`, `tools/README.md`. La città compare in `docs/README.md`, `docs/progress.md`, `docs/spec.md`, `docs/rules/lettura-pdf.md` e `fixtures/pdf/acegas-tari-0{1..5}.json`. Insieme ai nomi delle vie, identifica gli immobili.

## Azioni e domande per user1

Da incollare dalla cartella del repository. Nessuno di questi comandi è stato eseguito.

```sh
repo=$(gh repo view --json nameWithOwner -q .nameWithOwner)

# S1: repository privato (sezioni 37 e 40 della specifica)
gh repo edit "$repo" --visibility private --accept-visibility-change-consequences

# S2: environment release e ruleset delle etichette: il blocco del punto 1 di
# docs/distribuzione.md, PRIMA di setup-updater. Poi la verifica:
node scripts/release.mjs environment "$repo"

# S2, S4: main protetto, con PR e controlli obbligatori, senza force push né cancellazione
# (l'Admin può aggirarlo solo tramite PR)
gh api -X POST "repos/$repo/rulesets" --input - <<'EOF'
{"name":"main protetto","target":"branch","enforcement":"active",
 "conditions":{"ref_name":{"include":["~DEFAULT_BRANCH"],"exclude":[]}},
 "rules":[{"type":"deletion"},{"type":"non_fast_forward"},
  {"type":"pull_request","parameters":{"required_approving_review_count":0,"dismiss_stale_reviews_on_push":false,"require_code_owner_review":false,"require_last_push_approval":false,"required_review_thread_resolution":false}},
  {"type":"required_status_checks","parameters":{"strict_required_status_checks_policy":false,"required_status_checks":[
    {"context":"check (ubuntu-latest)"},{"context":"check (windows-latest)"},{"context":"check (macos-latest)"},
    {"context":"audit"},{"context":"rust"}]}}],
 "bypass_actors":[{"actor_id":5,"actor_type":"RepositoryRole","bypass_mode":"pull_request"}]}
EOF

# S5, S12: avvisi e aggiornamenti di sicurezza, secret scanning con push protection,
# segnalazione privata, obbligo di fissare le action per SHA
gh api -X PUT "repos/$repo/vulnerability-alerts"
gh api -X PUT "repos/$repo/automated-security-fixes"
gh api -X PUT "repos/$repo/private-vulnerability-reporting"
gh api -X PATCH "repos/$repo" --input - <<'EOF'
{"security_and_analysis":{"secret_scanning":{"status":"enabled"},"secret_scanning_push_protection":{"status":"enabled"}}}
EOF
gh api -X PUT "repos/$repo/actions/permissions" -F enabled=true -f allowed_actions=all -F sha_pinning_required=true
```

Se il repository resta privato, secret scanning e CodeQL possono richiedere GitHub Advanced Security. In quel caso i due comandi relativi rispondono con un errore, senza danni.

Domande:

1. **S1:** repository privato, oppure pubblico con la cronologia riscritta (`git filter-repo`, push forzato, richiesta al supporto per `refs/pull/*`)? Senza uno dei due, la pulizia del commit `c533240` non ha effetto. I nomi delle vie e della città restano così (vedi l'elenco sopra)?
2. **S3:** spostare la chiave privata fuori da iCloud e dalle cartelle in cui lavorano gli agenti? Aggiungere una password (secret `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, due righe in `build.yml`)? Come revisore di `release`, un account o un dispositivo che gli agenti non usano?
3. **S4:** la regola «Unione PR autonoma» va ristretta alle PR il cui ramo e autore sono di user1 e che non toccano `.github/`, `scripts/release.mjs`, `scripts/bundle-python.mjs`, `tauri.conf.json`, `capabilities/` e i file di lock? Le PR di Dependabot non si uniscono mai in automatico? Serve un `CODEOWNERS` su quei percorsi?
4. **S6:** nel journal, per le carte degli inquilini, salvare solo i nomi dei campi cambiati, e prevedere un comando «cancella i dati personali di un inquilino»? Tocca la regola «non si cancella mai».
5. **S10:** nell'Excel per gli inquilini, i nomi dei coinquilini restano come sono o diventano «Posto 1…5»?
6. **S12:** quale recapito mettere in un `SECURITY.md`?
