# App Bollette: Piano 8, documenti del condominio, differenza di consuntivo, controllo delle spese e recuperi

> **Per gli agenti che eseguono:** SOTTO-SKILL OBBLIGATORIA: usare superpowers:executing-plans per eseguire il piano task per task. I passi usano la sintassi con casella `- [ ]`.

**Obiettivo:** documenti del condominio (preventivo, consuntivo) per appartamento ed esercizio, l'impostazione `condoDifferenceTo` chiesta alla creazione dell'appartamento, la differenza di consuntivo mostrata come proposta, il controllo delle spese condominiali dei proprietari (sezione 12) nella riga di comando e nel file dei proprietari, e i recuperi dagli inquilini per un intervento causato da loro.

**Architettura:** campo opzionale su `ApartmentSchema`, record nuovi `condoDocument` e `tenantRecovery`; funzioni pure in `condominio.ts` (`condoCheck`, `condoDifferences`, `documentQuotaConduttore`); scritture in `apartment-store.ts`, `condo-store.ts` (`saveCondoDocument`, `saveTenantRecovery`, `loadCondo`); `conguaglio.ts` riceve l'impostazione e i recuperi opzionali; `pnpm estratti` aggiunge `appartamento`, `condominio-documento`, `condominio`, `recupero`.

**Stack tecnologico:** TypeScript strict, Zod 4, Vitest; nessuna dipendenza nuova, nessun Python.

**Specifica:** il disegno `docs/plans/2026-11-16-piano-8-condominio-disegno.md` (decisioni 1-7, «Mie scelte» 1-5, **domande 1-15 aperte**: nessuna blocca un task, ognuna è fuori dal piano o trattata come scritto nel task); `docs/spec.md` sezioni 6, 12, 15, 16, 24, 32, 42.

## Metodo di esecuzione

- Ramo `feat/piano-8-condominio`, mai su `main`. Per ogni task: test che falliscono, codice, `pnpm lint`, `pnpm typecheck`, `pnpm exec vitest run <file toccati>`, prettier, `node scripts/check-personal-data.mjs`, commit. Alla fine `pnpm lint && pnpm typecheck && pnpm test` e `TZ=Pacific/Auckland` sui test del core toccati.
- Regole nuove in `docs/progress.md` da **R190**; voci del glossario per i termini nuovi.
- Le regole di calcolo e di confidenza non si decidono da soli: le domande del disegno restano aperte.

## Vincoli globali

- Importi in `Cents`, date `YYYY-MM-DD`, confronti tra interi; core puro (`clock`, `newId`, `asOf` argomenti).
- Record con `id`, `v: 1`, `rev`, mai cancellati dal disco; schemi rigenerati (`pnpm schemas:export`), elenchi di `model.test.ts` e `export-schemas.test.mjs` aggiornati.
- Ogni scrittura: `checkConsistency` vuoto o `inconsistent-store`; la stessa richiesta sullo stesso stato è `unchanged`; nessun importo o nome nei `summary`.
- **Identità:** senza `condoDifferenceTo` (o con `tenants`) e senza recuperi, `calcConguaglio`, i due Excel e le dorate danno esattamente gli stessi risultati.

## Gruppo A

### Task 1: modello

- [ ] Test rossi in `model.test.ts`: `condoDifferenceTo` accetta `tenants`/`owner`, rifiuta altro; `condoDocument` valido, `id` diverso da `condoc-<apartmentId>-<esercizio>-<kind>` rifiutato, voci con somma diversa dal totale rifiutate; elenchi dei tipi.
- [ ] `ApartmentSchema.condoDifferenceTo`, `CondoDocumentSchema` in `recordSchemas`; schemi esportati; R190.

### Task 2: creazione e aggiornamento dell'appartamento

- [ ] Test rossi in `apartment-store.test.ts`: creazione con tutti i campi (operazione `apartment.save`), `missing-fields` senza `condoDifferenceTo`, aggiornamento che lascia gli altri campi, `unchanged`, `inconsistent-store`, `invalid-apartment`.
- [ ] `saveApartment`; comando `appartamento --id --nome --locatore --posti --annualita MM-GG [--esercizio-condominio MM-GG] --differenza-condominio inquilini|proprietario`; `apartment.save` annullabile con `annulla-riconciliazione`; R191.

### Task 3: documenti del condominio

- [ ] Test rossi: `saveCondoDocument` crea `condoc-…`, rifiuta `unknown-apartment`, `invalid-document`, `unchanged`; `documentQuotaConduttore` (campo, somma delle voci, nessuna).
- [ ] Comando `condominio-documento --appartamento --esercizio --tipo preventivo|consuntivo --totale <euro> [--quota-conduttore <euro>]`; operazione `condo.document`; R192.

### Task 4: impostazione `owner` nel conguaglio

- [ ] Test rossi: `allocateInstalment` con `owner` non ripartisce `conguaglioPrec`; `calcConguaglio` con `owner` toglie il conguaglio dell'anno prima agli inquilini e non chiede `condominioStart`; con `tenants` e senza impostazione risultato identico; Excel degli inquilini coerente (somme); file dei proprietari: quota proprietà + `conguaglioPrec` con `owner`.
- [ ] Codice in `conguaglio.ts`, `excel.ts`, `excel-owners.ts`; R193.

### Task 5: controllo, differenze e riga di comando `condominio`

- [ ] Test rossi `condominio.test.ts`: ogni stato di `condoCheck`, confine `asOf` = scadenza (`in-programma`) e giorno dopo (`senza-addebito`), straordinarie incluse, ordine; `condoDifferences`; `balances.test.ts`: una straordinaria pagata dal conto di un altro appartamento entra come `rata`.
- [ ] `loadCondo(store, { apartmentId?, esercizio?, asOf })`; comando `condominio`; R194.

### Task 6: `duplicato` nel file dei proprietari

- [ ] Test rosso: due addebiti veri sulla stessa rata danno `duplicato`, contato tra le voci in attesa; hash della fixture invariato.
- [ ] `ownersItems` usa lo stato di `condoCheck` senza data; R195.

## Gruppo B: intervento causato da un inquilino

### Task 7: record e scrittura del recupero

- [ ] Test rossi: schema `tenantRecovery` (quote distinte e positive, somma = importo); `saveTenantRecovery` con i rifiuti del disegno e `unchanged`; `equalShares` (resti ai primi).
- [ ] Record, scrittura (operazione `recovery.save`), comando `recupero --id --appartamento --voce <rata> --importo <euro> --inquilini a,b [--quote x;y] [--periodo <etichetta>] [--stato da-recuperare|recuperata|non-recuperabile]`; R196.

### Task 8: recupero nel conguaglio

- [ ] Test rossi: `calcConguaglio` con `recoveries` aggiunge `recupero` e `due`; `non-recuperabile`, altro periodo o altro appartamento non contano; dorate identiche; `recovery-tenant-absent`; `loadExcelInput` rifiuta `recoveries-not-supported`; `condominio` elenca i recuperi.
- [ ] Codice; R197; glossario.
