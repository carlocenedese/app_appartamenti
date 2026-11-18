# Revisione del 18 novembre 2026: funzioni mancanti

Ramo `feat/revisione-funzioni-mancanti`. Fonti dei reperti:

- revisione 2, ciclo completo: E4, E5, E11, E13-E19;
- revisione 3, regole di calcolo: I2, I3, I9;
- revisione 6, qualità: Q9 (nessun aiuto della riga di comando);
- `docs/revisione-2026-11-18-annullo.md`, sezione «Da agganciare nella CLI».

Nessuna regola di calcolo nuova. Dove serviva una scelta del proprietario, il codice è prudente e la domanda è in fondo.

## Fatto, un commit per punto

| Punto             | Commit  | Cosa                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Annullo (punto 4) | 7aaf0bc | `account.save`, `supply.link`, `tenant.save` e `bank-profile.save` tra le operazioni di `annulla-riconciliazione`. Un annullo bloccato da record che puntano a ciò che l'operazione ha creato dà `has-dependents` con `counts` per tipo (U8). Comando `riferimenti` (solo tipi, id e campo). Messaggi di `rooms-in-use`, `beds-conflict` di `appartamento` (con `unknown-room` a parte) e `tenancy-in-use`, con gli id. E19: `appartamento --posti-nomi a,b,c`.                                         |
| E5                | b74001c | `utenza --etichetta <codice> --appartamento <id>` (100%) oppure `--ripartizione apt-a:60;apt-b:40`. `saveSupply` nel core: stessa etichetta e stessi appartamenti = `unchanged`, altrimenti `label-in-use`. Si annulla con `annulla-riconciliazione`.                                                                                                                                                                                                                                                   |
| I3, E4            | 90a4635 | `rata-condominio --id --appartamento --esercizio --rata n/N --scadenza --importo [--quota-proprieta] [--conguaglio-prec] [--straordinaria]`. Mesi della rata da `condominioStart` (R3). Esercizio `AAAA-AA`, nella stessa forma degli altri documenti e rate (R310). Una rata con abbinamenti o recuperi non si cambia (`instalment-in-use`). Una quota della proprietà diversa nello stesso esercizio è salvata con l'avviso `owner-share-differs` e gli id: il conguaglio la rifiuta come prima (I5). |
| Punto 7           | e074c4f | Solo un test: i movimenti di un estratto annullato non sono candidati della voce del buco (C1). Non serviva una correzione.                                                                                                                                                                                                                                                                                                                                                                             |
| I9                | 1f71f41 | Tolleranza IMU come impostazione (`impostazioni --tolleranza-imu 1,5`, oppure `predefinita`), annullabile. Predefinito 100 punti base, cioè l'1% di prima, con la stessa formula a interi. La leggono `imu`, `scadenze`, `tasse`, `saldi` e il cruscotto.                                                                                                                                                                                                                                               |
| I2, R5            | eb49850 | `chiudi-periodo` e `conguaglio-supplementare`, vedi sotto.                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Q9                | e88c34c | `pnpm estratti --help`, `pnpm estratti <comando> --help` e `aiuto [comando]`: comandi con una riga di descrizione e opzioni del comando. Un comando sconosciuto rimanda all'aiuto. `pnpm excel --help` e `pnpm moduli --help`: una riga per opzione. Due test falliscono se manca una descrizione: per i comandi e per le opzioni di excel e moduli.                                                                                                                                                    |

### Chiusura del periodo (I2, R5)

- **`chiudi-periodo --appartamento --periodo`.**
  - Usa `loadExcelInput`, `calcConguaglio` e `canClosePeriod`. Chiude solo se sono incassati tutti gli affitti e i forfait e non c'è nessuna voce in attesa.
  - Altrimenti rifiuta con `cannot-close` e l'elenco di ciò che manca: inquilino, mese, tipo, oppure voce. Gli importi solo con `--dettagli`.
  - Scrive il record `periodClose` con l'istantanea: per inquilino spese, rata del condominio, commissione e recupero (i costi), forfait incassato e conguaglio dell'anno prima (i dati da controllare), più la quota dei posti vuoti.
  - Per riaprire si annulla la chiusura con `annulla-riconciliazione`. **Rifiuto prudente:**
    - se dopo la chiusura sono cambiati i costi o gli altri dati dell'istantanea, l'annullo è rifiutato (`closing-changed`): una seconda chiusura prenderebbe la bolletta tardiva nell'istantanea nuova, e il supplementare non si vedrebbe più. Il messaggio indica due vie: tenere la chiusura e usare `conguaglio-supplementare`, oppure annullare prima le operazioni fatte dopo;
    - se il conguaglio non si calcola, l'annullo è rifiutato con `closing-unknown`.
- **`conguaglio-supplementare --appartamento --periodo [--dettagli]`.**
  - Usa `calcConguaglioSupplementare` sul calcolo di oggi contro l'istantanea.
  - Per ogni inquilino dà se è partito e l'azione: `nessuna`, `da-pagare`, `da-rimborsare` o `da-trattenere-o-richiedere`; e `dataChanged`. La differenza solo con `--dettagli`.
- **Excel degli inquilini e file dei proprietari.**
  - La prima riga dice «Conguaglio chiuso il GG/MM/AAAA» se il periodo è chiuso senza voci in attesa.
  - Se dopo la chiusura i costi sono cambiati, aggiunge «dopo la chiusura c'è un conguaglio supplementare».
  - Negli altri casi resta «Conguaglio provvisorio: voci in attesa N» (R171). Il numero di righe non cambia.
- **Cruscotto.** `state` vale `chiuso` o `provvisorio` per periodo. Il codice `conguaglio:supplementare` compare quando un periodo chiuso è cambiato (la notifica «Da rivedere» di R5).

### Ciclo completo

`scripts/ciclo-completo.test.mjs` usa ora i comandi:

- `utenza` per le utenze della TARI comune;
- `rata-condominio` per la rata, al posto del seme di prova `test.seed`;
- `impostazioni`;
- `chiudi-periodo`: rifiutato, perché A ha voci in attesa; le voci rifiutate sono quelle del conguaglio;
- `conguaglio-supplementare`: periodo aperto;
- `riferimenti`: vuoto a fine ciclo.

Il conguaglio, l'Excel e il file dei proprietari restano al centesimo.

**E11 è un `it` normale.** Dopo gli annulli in ordine inverso lo stato finale è quello iniziale. Anche `apartment.save` si annulla. Resta fuori solo `statement.resolve` (`decidi`), che va via con il suo estratto (`annulla --estratto`).

La sonda E1 «TARI registrata prima della correzione» usa ancora `linkSupply` del core, perché imita dati vecchi.

Il ciclo prova `chiudi-periodo` solo come rifiuto e `impostazioni` solo come lettura. Non prova `--posti-nomi` né l'aiuto. Le strade riuscite e i loro annulli sono in `scripts/estratti-funzioni.test.mjs`.

### Secondo giro (revisione indipendente)

1. L'annullo di una chiusura è rifiutato anche quando il conguaglio non si calcola (`closing-unknown`).
2. L'istantanea e il confronto contano anche `recupero`, che è un costo. Il forfait incassato e il conguaglio dell'anno prima non sono costi: se cambiano dopo la chiusura, si avvisa con «dati cambiati dopo la chiusura» in Excel, nel file dei proprietari e nel cruscotto (`conguaglio:dati-cambiati`), e l'annullo della chiusura è rifiutato. Test con un recupero entrato dopo la chiusura e con un pagamento cancellato.
3. R3: `chiudi-periodo` rifiuta con `tari-december-missing` (e il mese) se l'appartamento ha un'utenza dell'avviso TARI comune e la rata TARI di dicembre dell'anno di fine periodo non è addebitata, cioè non ha un abbinamento vero (non «assunto»). La domanda 4 resta sul «come».
4. Differenza 0: l'azione è `nessuna`, mai `da-pagare`.
5. Il file dei proprietari dice «supplementare» quando i costi sono cambiati.
6. Una scrittura della CLI che cambia un periodo già chiuso lo dice nell'esito: `closedPeriods` e il messaggio «serve un conguaglio supplementare». Non c'è nessun rifiuto (domanda 13). Si confronta lo stato di ogni periodo chiuso prima e dopo il comando.
7. Il messaggio di `closing-changed` indica la via d'uscita.
8. Una rata con esercizio `2026` dà `esercizio-format`, con un messaggio sulla forma `2026-27` (domanda 14).
9. `impostazioni --tolleranza-imu 0` vuol dire nessuna tolleranza, come permette lo schema.

## Schemi cambiati

Per la costante di formato dei dati:

- **nuovo** `docs/schemas/workspaceSettings.json` (record `workspaceSettings`, id `impostazioni`);
- **nuovo** `docs/schemas/periodClose.json` (record `periodClose`, id `chiusura-<appartamento>-<periodo>`).

Nessuno schema esistente è cambiato: `instalment` e `supply` sono come prima. Le liste dei test sono aggiornate in `model.test.ts` (record validi ed elenco dei tipi) e in `export-schemas.test.mjs`.

**`DATA_FORMAT` da 1 a 2** (`packages/core/src/version.ts`), con l'impronta del formato 2 in `packages/core/test/data-format.test.ts` (quella del formato 1 resta). I cambi sono solo additivi: due tipi di record nuovi. L'istantanea di `periodClose` ha, per inquilino, `spese`, `rata`, `commissione`, `recupero`, `forfaitIncassato` e `conguaglioPrec`.

**Il buco del formato nella CLI, chiuso così.**

- `estratti.mjs` apre la cartella con `CliStore`. È un `FsStore` che, prima della prima scrittura di un record o di un'operazione, legge `workspace.json`.
- Se dichiara un formato più vecchio, chiama `raiseDataFormat`. La chiamata è idempotente: la seconda volta dice `unchanged`.
- L'esito del comando dice `dataFormat: "raised"`. È il «registrato»: `raiseDataFormat` scrive fuori dal registro, come documentato in `revisione-2026-11-18-dati.md`.
- Un comando che solo legge non alza nulla.
- Una cartella di formato più nuovo è rifiutata da `commitChange` con `newer-data` («aggiornare l'app»), e non scrive nulla.
- Una cartella senza `workspace.json`, come quelle dei test, resta com'è.
- Ho scelto di alzare invece di rifiutare con un comando `aggiorna-formato`: è la stessa via del desktop dopo il consenso, ed è sicura perché i cambi sono additivi.
- Test su una cartella del formato precedente e su una di formato più nuovo, in `scripts/estratti-funzioni.test.mjs`.
- `excel.mjs` e `moduli.mjs` scrivono solo file Excel e Word, non record: non alzano il formato.

Operazioni nuove del registro, tutte annullabili con `annulla-riconciliazione`: `condo.instalment`, `settings.save` e `period.close`. `supply.link` esisteva già: ora la scrive anche la CLI.

## Test esistenti cambiati, e perché

- `core/test/imu.test.ts`: `IMU_TOLERANCE_PERCENT` (1) diventa `DEFAULT_IMU_TOLERANCE_BP` (100). Il valore è lo stesso, in punti base.
- `core/test/balances.test.ts`: `withExtra` tipizzato sui campi lista dell'esempio, perché l'ingresso del saldo ha ora un campo numerico facoltativo (`imuToleranceBp`).
- `scripts/ciclo-completo.test.mjs`: vedi sopra. Il test «dopo gli annulli restano solo…» diventa «ogni operazione è annullata».

## Domande per il proprietario

1. **Conguaglio «inviato» (R5).** L'app non sa quando hai mandato il conguaglio agli inquilini. Oggi lanciare `chiudi-periodo` vuol dire «l'ho inviato». Va bene così?
2. **Excel dopo la chiusura.** A chiusura ad A toccavano 120,00 € di spese. Poi arriva una bolletta della luce da 90,00 € per luglio–settembre. L'Excel deve mostrare 210,00 € (il calcolo di oggi, con l'avviso del supplementare, come fa ora) oppure 120,00 € come all'invio, con i 90,00 € a parte?
3. **Riapertura con storico (sezione 6).** Oggi l'unico modo di riaprire è annullare la chiusura, e l'istantanea si perde. Per questo l'annullo è rifiutato quando c'è un supplementare. Vuoi un comando `riapri-periodo` che tenga l'istantanea e registri data e motivo? E se poi chiudi di nuovo, l'istantanea nuova sostituisce la prima?
4. **Chiusura dopo la TARI di dicembre (R3), il «come».** La regola è nella spec, quindi oggi `chiudi-periodo` rifiuta (`tari-december-missing`) se l'appartamento ha un'utenza dell'avviso TARI comune e la rata TARI che finisce a dicembre dell'anno in cui finisce il periodo non è addebitata. Per Appartamento A, annualità 2025-26: serve l'addebito della rata TARI di dicembre 2026. Restano da decidere due cose:
   - Vale per tutti gli appartamenti dell'avviso comune o solo per uno?
   - Se il periodo finisce in un altro mese (per esempio a marzo), quale avviso bisogna aspettare?
5. **Debito di un inquilino partito (R5).** Il supplementare dice «da trattenere o richiedere», ma non lo toglie da solo dal prospetto della caparra. Esempio: D è partito ad agosto, gli tocca un supplementare di 12,00 € e la caparra è ancora in mano. Lo tolgo da solo dalla caparra, o lo segno e decidi tu?
6. **Codici POD e PDR (lotto 6).** Hai detto «nell'utenza dell'appartamento». Oggi sono nell'appartamento (`appartamento --codici`). Il comando nuovo `utenza` serve alle utenze dell'avviso TARI comune, e i codici non li ho spostati. Vuoi i codici di luce e gas su un'utenza per fornitura (per esempio «POD IT001E…» → Appartamento A) o vanno bene nell'appartamento?
7. **Quota della proprietà diversa tra le rate.** Rata 1 con 18,00 € l'anno, rata 2 con 24,00 €. Oggi la rata 2 è salvata con un avviso e il conguaglio si ferma finché non correggi (vedi anche la domanda 6 di `revisione-2026-11-18-soldi.md`). Deve invece rifiutare subito la rata 2?
8. **E13, avviso TARI e nome del PDF.** Oggi il PDF dell'avviso TARI resta in Da_smistare. Un PDF annullato torna con il nome dato dall'app (`2025-11-28_Gas_…pdf`), non con quello originale (`gas-a.pdf`). Vuoi archiviare anche l'avviso TARI e riavere il nome originale?
9. **E16, cedolare con una stima sola.** Lo stesso contribuente ha A con una stima di 300,00 € e B senza stima. Oggi la riga dice «stima mancante» e non mostra i 300,00 €. Vuoi la stima parziale (300,00 €) con l'avviso «manca la stima di B»?
10. **E17, presenza senza fine in un contratto.** Una presenza senza mese di uscita, in un contratto da ottobre 2025 a settembre 2026, oggi dà «presenza fuori dal contratto». Deve valere fino alla fine del contratto?
11. **E18, movimento privato.** Un prelievo privato di 20,00 € dal conto: un motivo di esclusione nuovo, «privato», oppure un'uscita «altro» della proprietà?
12. **Finestre di commissione e giroconto.** `COMMISSION_MAX_DAYS` è 2 giorni: una commissione si lega al suo addebito se arriva entro 2 giorni. `TRANSFER_LEG_DAYS` è 5 giorni: le due gambe di un giroconto distano al massimo 5 giorni. Le hanno decise gli agenti. Le vuoi modificabili come la tolleranza IMU, o vanno bene fisse?
13. **Scritture in un periodo chiuso (punto 6).** Oggi una presenza, un canone, un pagamento, una bolletta o una rata che cambiano un periodo già chiuso si registrano. L'esito avvisa: «il periodo è chiuso: serve un conguaglio supplementare» (`closedPeriods`). Esempio: annualità 2025-26 chiusa, poi `fine-presenza` di un inquilino ad agosto. Va bene l'avviso, o vuoi una conferma esplicita prima di scrivere?
14. **Esercizio nella forma `2026` per le rate.** Una rata con esercizio `2026` è rifiutata (`esercizio-format`): il conguaglio divide solo la forma `2026-27`. Esempio: un condominio con esercizio da gennaio a dicembre e documenti «2026». Serve gestire anche questa forma? Si può scrivere `2026-27` con l'esercizio che comincia a gennaio.
15. **Dati cambiati dopo la chiusura.** Se dopo la chiusura cambia il forfait incassato (per esempio un pagamento di gennaio annullato), il conguaglio supplementare non lo conta: per R5 il forfait è tutto incassato alla chiusura. Excel, file dei proprietari e cruscotto dicono «dati cambiati dopo la chiusura, da controllare», e l'annullo della chiusura è rifiutato. Va bene così, o la differenza di forfait va chiesta all'inquilino nel supplementare?

## Arretrato (non fatto) e motivo

- **I9, il resto.**
  - `COMMISSION_MAX_DAYS` e `TRANSFER_LEG_DAYS` restano costanti: vedi la domanda 12. Portarle nelle impostazioni vuol dire passarle da `runReconciliation` a `commission.ts` e `transfers.ts`.
  - `TAX_DISCREPANCY_TOLERANCE` (0,10 €) segue lo stesso schema delle altre impostazioni, ma non era richiesto.
- **R5, il resto.**
  - `riapri-periodo` con storico: domanda 3.
  - Scadenze: la notifica di R5 c'è solo nel cruscotto (`conguaglio:supplementare`), non nell'elenco di `scadenze`.
  - Il debito di chi è partito non va da solo nel prospetto della caparra: domanda 5.
  - `chiudi-periodo` non chiede durata e tipo del contratto successivo (R1).
- **Rata dal piano rate del preventivo.** Ho scelto il comando diretto `rata-condominio`. Leggere la quota dal preventivo è la domanda 6 del documento «soldi». La formula del lotto 7 per il conguaglio dentro il preventivo è da chiarire con un esempio.
- **Utenza.** Non ci sono comandi per cambiarla o scollegarla: l'app desktop ha `updateSupply` e `removeSupply`. Per cambiarla dalla CLI, prima si annulla il collegamento.
- **`decidi` (`statement.resolve`).** Non si annulla da solo: si annulla con il suo estratto (R116).
- **E13, E16, E17, E18.** Domande 8-11: sono scelte del proprietario.
- **E14, E15.** Erano già corretti su main.
- **App desktop.** Nessuna schermata per i comandi nuovi: rata, utenza da CLI, impostazioni e chiusura.
- **Esercizio della rata.** `rata-condominio` accetta solo la forma `AAAA-AA`, perché il conguaglio sa dividere solo quella (`annualitaRange`). Un appartamento i cui documenti usano la forma `2026` non può avere rate: il rifiuto è `esercizio-format`.
- **Elenco dei comandi spostato.** In `estratti.mjs` l'elenco dei comandi accettati è uscito da `main` ed è diventato `COMMAND_NAMES`, esportato. Un comando nuovo dell'altro ramo (per esempio `scegli-versione`) darà un conflitto lì. Si risolve aggiungendo il comando a `COMMAND_NAMES` e una riga in `COMMAND_HELP` (`scripts/estratti-aiuto.mjs`). Se manca, il test dell'aiuto fallisce.
- **Unione con main.** Sono entrate #69, #70 e #71. Ho risolto il conflitto dell'elenco dei comandi aggiungendo `scegli-versione` a `COMMAND_NAMES` e a `COMMAND_HELP`. I caricatori e gli scrittori nuovi usano `writesBlocked` come gli altri. `loadAll` rigoroso dà `UnreadableRecordsError`, che la CLI traduce già in `unreadable-records`.
- **Firma dei commit.** Ho usato la riga `Co-Authored-By` del compito.
