# Piano 6 (parte «profili»): i profili dei fornitori arrivano con l'app (disegno)

Stato: **bozza in attesa dell'approvazione di Carlo** (13 novembre 2026). Specifica di riferimento: `docs/spec.md` (sezioni 7 e 34); è la parte «profili» del piano 6 della tabella del piano 1 (il resto del piano 6, cioè primo avvio guidato, sincronizzazione, aggiornamenti firmati, Scadenze, Tasse e stime, resta fuori).

## Perché

I profili di `python/seed-profiles/` (11 file, tutti `bozza`, senza codici) sono scritti e provati, ma l'app installata non li ha: il lettore legge i profili da `_app/dati/supplierProfile/`. Senza un passo che li copi lì, nessun fornitore è riconosciuto.

## Decisione di Carlo (13 novembre 2026)

I profili si copiano **solo alla creazione dell'area di lavoro, mai dopo**. Un layout nuovo arriva come profilo nuovo con la sua data di validità (come già nel piano 2a), mai correggendo un profilo che Carlo ha già confermato o cambiato.

## Obiettivi

1. Una funzione del core, `seedProfiles(store, seeds, profileId, clock, newId)`, scrive ogni profilo valido come record in `_app/dati/supplierProfile/<id>.json`, in **una sola operazione** del registro (`profiles.seed`), così si annulla in un colpo e si vede nella storia.
2. L'installer porta con sé i file di `python/seed-profiles/` (risorse di Tauri, accanto a quelle di Python).
3. Il primo avvio, quando esisterà, chiama la funzione con i profili letti dalle risorse; questo piano non costruisce il primo avvio.

## Non obiettivi

- Nessun aggiornamento dei profili dopo la creazione dell'area di lavoro, nessun confronto con quelli esistenti (opzioni 2 e 3 scartate da Carlo).
- Nessuna schermata, nessun editor dei profili, nessuna procedura guidata.
- Nessun codice cliente, POD, PDR o indirizzo nei profili (già vietato; i codici si imparano dopo la prima conferma).

## Vincoli

- `packages/core` resta puro: i profili arrivano come argomento (già letti e interpretati dall'app), orologio e generatore di `id` sono argomenti; niente `node:*` nel core.
- Un profilo che non passa `SupplierProfileSchema` si salta e si segnala in `warnings` (senza citare il contenuto); gli altri si scrivono comunque.
- Se la funzione viene chiamata due volte (ripresa dopo un'interruzione), non sovrascrive mai un record che esiste già con quell'`id`: lo salta e lo segnala. Così un secondo giro non può cancellare una conferma.
- Nessun dato reale: i test usano i profili del repository (già senza dati personali) e `pnpm data:check` li copre.

## Approccio

Una sola via sensata: funzione del core con la sua operazione nel registro e risorse di Tauri per il file. Scartato: copiare i file dal programma Python (il core scrive tutti i record, il Python solo legge) e farlo a mano dall'app senza registro (perderebbe l'annulla e la storia).

## Disegno

- `seedProfiles(store: Store, seeds: unknown[], profileId: string, clock: () => string, newId: () => string): Promise<{written: SupplierProfile[]; skipped: {id: string; reason: 'invalid' | 'exists'}[]}>`, con `commitChange`; nessuna scrittura se ogni profilo è saltato.
- L'operazione ha `kind: 'profiles.seed'`, un riassunto in italiano («Profili dei fornitori iniziali: 11») e un cambio per profilo (`before` assente).
- Test del core con uno store in memoria: scrive 11 profili validi in un'operazione; ne salta uno non valido; non sovrascrive un `id` che esiste e lo segnala `exists`; con ogni profilo saltato non scrive nulla; l'operazione si annulla (`undoOperation`) e i record risultano cancellati.
- Una prova di integrazione che prende i veri `python/seed-profiles/*.json` e verifica che tutti passino `SupplierProfileSchema` (già in parte nei test Python: qui anche per Zod).
- Tauri: aggiungere `python/seed-profiles/` alle risorse di `apps/desktop/src-tauri/tauri.conf.json` (come `resources/python/`), con un controllo nello script di costruzione dell'installer che i 11 file ci siano.

## Lasciato al costruttore

Il nome della cartella delle risorse e il modo in cui lo script di costruzione le copia; il testo esatto dei riassunti dell'operazione.
