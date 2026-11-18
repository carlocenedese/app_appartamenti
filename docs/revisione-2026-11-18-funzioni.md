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
  - Scrive il record `periodClose` con l'istantanea: per inquilino spese, rata del condominio e commissione, più la quota dei posti vuoti.
  - Per riaprire si annulla la chiusura con `annulla-riconciliazione`.
- **`conguaglio-supplementare --appartamento --periodo [--dettagli]`.**
  - Usa `calcConguaglioSupplementare` sul calcolo di oggi contro l'istantanea.
  - Per ogni inquilino dà se è partito e l'azione: `da-pagare`, `da-rimborsare` o `da-trattenere-o-richiedere`. La differenza solo con `--dettagli`.
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

## Schemi cambiati

Per la costante di formato dei dati:

- **nuovo** `docs/schemas/workspaceSettings.json` (record `workspaceSettings`, id `impostazioni`);
- **nuovo** `docs/schemas/periodClose.json` (record `periodClose`, id `chiusura-<appartamento>-<periodo>`).

Nessuno schema esistente è cambiato: `instalment` e `supply` sono come prima. Le liste dei test sono aggiornate in `model.test.ts` (record validi ed elenco dei tipi) e in `export-schemas.test.mjs`.

Operazioni nuove del registro, tutte annullabili con `annulla-riconciliazione`: `condo.instalment`, `settings.save` e `period.close`. `supply.link` esisteva già: ora la scrive anche la CLI.

## Test esistenti cambiati, e perché

- `core/test/imu.test.ts`: `IMU_TOLERANCE_PERCENT` (1) diventa `DEFAULT_IMU_TOLERANCE_BP` (100). Il valore è lo stesso, in punti base.
- `core/test/balances.test.ts`: `withExtra` tipizzato sui campi lista dell'esempio, perché l'ingresso del saldo ha ora un campo numerico facoltativo (`imuToleranceBp`).
- `scripts/ciclo-completo.test.mjs`: vedi sopra. Il test «dopo gli annulli restano solo…» diventa «ogni operazione è annullata».

## Domande per il proprietario

1. **Conguaglio «inviato» (R5).** L'app non sa quando hai mandato il conguaglio agli inquilini. Oggi lanciare `chiudi-periodo` vuol dire «l'ho inviato». Va bene così?
2. **Excel dopo la chiusura.** A chiusura ad A toccavano 120,00 € di spese. Poi arriva una bolletta della luce da 90,00 € per luglio–settembre. L'Excel deve mostrare 210,00 € (il calcolo di oggi, con l'avviso del supplementare, come fa ora) oppure 120,00 € come all'invio, con i 90,00 € a parte?
3. **Riapertura con storico (sezione 6).** Oggi l'unico modo di riaprire è annullare la chiusura, e l'istantanea si perde. Vuoi un comando `riapri-periodo` che tenga l'istantanea e registri data e motivo? E se poi chiudi di nuovo, l'istantanea nuova sostituisce la prima?
4. **Berchet dopo la TARI di dicembre (R3).** Se l'avviso TARI di dicembre non è ancora registrato, l'app non sa che manca e lascia chiudere l'annualità 2025-26. Vuoi che un'annualità ottobre–settembre si chiuda solo dopo un avviso TARI di dicembre dello stesso anno solare (per 2025-26: dicembre 2026)?
5. **Debito di un inquilino partito (R5).** Il supplementare dice «da trattenere o richiedere», ma non lo toglie da solo dal prospetto della caparra. Esempio: D è partito ad agosto, gli tocca un supplementare di 12,00 € e la caparra è ancora in mano. Lo tolgo da solo dalla caparra, o lo segno e decidi tu?
6. **Codici POD e PDR (lotto 6).** Hai detto «nell'utenza dell'appartamento». Oggi sono nell'appartamento (`appartamento --codici`). Il comando nuovo `utenza` serve alle utenze dell'avviso TARI comune, e i codici non li ho spostati. Vuoi i codici di luce e gas su un'utenza per fornitura (per esempio «POD IT001E…» → Appartamento A) o vanno bene nell'appartamento?
7. **Quota della proprietà diversa tra le rate.** Rata 1 con 18,00 € l'anno, rata 2 con 24,00 €. Oggi la rata 2 è salvata con un avviso e il conguaglio si ferma finché non correggi (vedi anche la domanda 6 di `revisione-2026-11-18-soldi.md`). Deve invece rifiutare subito la rata 2?
8. **E13, avviso TARI e nome del PDF.** Oggi il PDF dell'avviso TARI resta in Da_smistare. Un PDF annullato torna con il nome dato dall'app (`2025-11-28_Gas_…pdf`), non con quello originale (`gas-a.pdf`). Vuoi archiviare anche l'avviso TARI e riavere il nome originale?
9. **E16, cedolare con una stima sola.** Lo stesso contribuente ha A con una stima di 300,00 € e B senza stima. Oggi la riga dice «stima mancante» e non mostra i 300,00 €. Vuoi la stima parziale (300,00 €) con l'avviso «manca la stima di B»?
10. **E17, presenza senza fine in un contratto.** Una presenza senza mese di uscita, in un contratto da ottobre 2025 a settembre 2026, oggi dà «presenza fuori dal contratto». Deve valere fino alla fine del contratto?
11. **E18, movimento privato.** Un prelievo privato di 20,00 € dal conto: un motivo di esclusione nuovo, «privato», oppure un'uscita «altro» della proprietà?
12. **Finestre di commissione e giroconto.** `COMMISSION_MAX_DAYS` è 2 giorni: una commissione si lega al suo addebito se arriva entro 2 giorni. `TRANSFER_LEG_DAYS` è 5 giorni: le due gambe di un giroconto distano al massimo 5 giorni. Le hanno decise gli agenti. Le vuoi modificabili come la tolleranza IMU, o vanno bene fisse?

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
- **Firma dei commit.** Ho usato la riga `Co-Authored-By` del compito.
