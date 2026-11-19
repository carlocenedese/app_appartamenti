# Piano 24: la logica dei comandi nel core

Decisione C1 di user1: l'app desktop avrà le schermate più avanti. Oggi la logica che usa la riga di
comando sta in `scripts/estratti.mjs` (solo Node); l'app usa solo `packages/core` (puro) con i suoi
`Store`. Questo piano sposta nel core la parte dei comandi che non è riga di comando, senza
riscriverla. Ramo `refactor/logica-nel-core`, da `feat/canone-valido-forfait` (PR #81).

## Regola del confine (R386)

- **Resta nello script:** `parseArgs`, `OPTIONS`, la tabella `only` delle opzioni per comando,
  `COMMAND_NAMES`, l'aiuto; il passaggio dal testo di un'opzione a un valore tipato (`euro`,
  `month`, `day`, `basisPoints`, `parseRate`, `parsePart`, `parseMatchPart`, `parseTaxPart`,
  `idList`, `metricThresholds`, `yearStart`, ...) e ogni controllo `bad-arguments` sulle opzioni;
  la lettura dei file (`readBytes`, `statSync`), Python (`xlsxTable`), lo spostamento dei PDF
  (`moveFileNoOverwrite`, `node:path`), `CliStore` (un `FsStore`), l'orologio e `randomUUID`, i
  codici di uscita e la stampa.
- **Va nel core** (`packages/core/src/commands/`): tutto dalla prima chiamata allo `Store` in poi
  (caricamento dei dati, decisioni, rifiuti con il loro motivo e i campi in più, risultato con i
  messaggi in italiano, filtro di `--dettagli`), più il controllo del contenuto già letto di un file
  (il JSON del profilo, i valori della scheda riservata, la lettura di una bolletta, la tabella CSV).
- Le funzioni del core prendono lo `Store`, l'input già tipato, il contesto `{ who, clock, newId }`
  e le opzioni (`details`); restituiscono il corpo JSON oppure lanciano `CommandStop` (stato,
  motivo, campi in più): la stessa `Stop` di prima, spostata, così le righe `throw` restano uguali.
- L'ordine dei rifiuti non cambia: un controllo che oggi sta prima o dopo una lettura dello `Store`
  o di un file resta da quel lato.

## Fuori da `command()`

| Pezzo                                                              | Dove va | Perché                                                                                     |
| ------------------------------------------------------------------ | ------- | ------------------------------------------------------------------------------------------ |
| `MESSAGES`, `SWAP_MESSAGES`                                        | core    | messaggi in italiano dei risultati; lo script riesporta `MESSAGES` (test)                  |
| `Stop`                                                             | core    | `CommandStop`: i corpi spostati lo lanciano come prima                                     |
| `RECONCILE_KINDS`                                                  | core    | decide quali operazioni `annulla-riconciliazione` annulla                                  |
| `closedStates` e l'avviso del periodo chiuso cambiato              | core    | caricamento e confronto dei periodi chiusi (`closedPeriodStates`, `changedClosedPeriods`)  |
| la mappa degli errori tipati del core nel `catch` di `main`        | core    | `commandRefusal(error)`: motivo, percorsi e messaggio; il codice di uscita resta nello script |
| `CliStore` (alza il formato prima della prima scrittura)           | script  | estende `FsStore` (Node); usa già `findWorkspace` e `raiseDataFormat` del core             |
| `csvTable`                                                         | core    | `statementCsvTable`: decodifica UTF-8 e `parseCsv`, puro                                   |
| `readBytes`, `xlsxTable`, `moveSafely`                             | script  | file, processo Python, spostamento sul disco                                               |
| `negativeValues`, `OPTIONS`, `only`, `COMMAND_NAMES`, l'aiuto      | script  | riga di comando                                                                            |

## Comandi

Per ogni comando: nello script restano i controlli delle opzioni e la costruzione dell'input; nel
core la chiamata, i rifiuti e il risultato. «Solo Node» indica la parte che resta per forza.

| Comando                                                   | Funzione del core                                              | Resta nello script (oltre alle opzioni)                         |
| --------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------- |
| `profilo`                                                 | `saveBankProfileCommand` (testo JSON del file)                  | lettura del file                                                |
| `conto`                                                   | `saveAccountCommand`                                           |                                                                 |
| `importa`                                                 | `importTargetOf`, `statementCsvTable`, `importStatementCommand` | lettura del file, XLSX con Python e confronto dei byte          |
| `decidi`                                                  | `resolveHeldCommand`                                           |                                                                 |
| `annulla`                                                 | `undoImportCommand`                                            |                                                                 |
| `inquilino`                                               | `saveTenantCommand`                                            |                                                                 |
| `scheda-inquilino`                                        | `saveTenantCardCommand` (testo JSON dei valori)                | lettura del file                                                |
| `soglie-consumi`                                          | `saveConsumptionSettingsCommand`                               |                                                                 |
| `consumi`                                                 | `consumptionCommand`                                           |                                                                 |
| `riconcilia`                                              | `reconcileCommand`                                             |                                                                 |
| `conferma`                                                | `confirmIncomeCommand`                                         |                                                                 |
| `abbina`                                                  | `confirmMatchCommand`                                          |                                                                 |
| `escludi`                                                 | `excludeMovementCommand`                                       |                                                                 |
| `annulla-pagamento`                                       | `cancelPaymentCommand`                                         |                                                                 |
| `uscita`, `annulla-uscita`, `uscita-inquilino`            | `confirmOutgoingCommand`, `cancelOutgoingCommand`, `confirmTenantOutgoingCommand` |                                              |
| `giroconto`, `giroconto-manuale`                          | `confirmTransferCommand`, `manualTransferCommand`              |                                                                 |
| `saldi`                                                   | `balancesCommand`                                              |                                                                 |
| `annulla-riconciliazione`, `annulla-incassi`              | `undoOperationCommand`                                         |                                                                 |
| `ripara`, `scegli-versione`                               | `repairCommand`, `chooseVersionCommand`                        |                                                                 |
| `riferimenti`                                             | `referencesCommand`                                            |                                                                 |
| `imu-atteso`, `imu-f24`, `imu`                            | `setImuYearCommand`, `assignImuF24Command`, `imuRatesCommand`  |                                                                 |
| `tasse-stima`, `tasse-copia`, `tasse-assegna`, `tasse-conferma`, `tasse` | `setTaxEstimateCommand`, `copyTaxYearCommand`, `assignTaxCommand`, `confirmTaxCommand`, `taxTableCommand` | |
| `scadenze`, `scadenza-nuova`, `scadenza-ripeti`, `scadenza-pagata` | `payablesCommand`, `savePayableCommand`, `repeatPayableCommand`, `payablePaidCommand` | |
| `contratto`, `contratto-canone`, `affitti-anno`, `contratti` | `saveContractCommand`, `setContractRentCommand`, `setRentYearCommand`, `contractsCommand` | |
| `presenza`, `fine-presenza`, `subentro`, `scambio-camera` | `saveTenancyCommand`, `endTenancyCommand`, `takeoverCommand`, `roomSwapCommand` | |
| `stato-contratti`, `tasso-legale`, `caparra-restituzione` | `contractStatusCommand`, `saveLegalRateCommand`, `depositReturnCommand` | |
| `appartamento`, `condominio-documento`, `recupero`        | `saveApartmentCommand`, `saveCondoDocumentCommand`, `saveRecoveryCommand` | |
| `condominio`, `condominio-stima`, `contatto`, `contatti`  | `condoCommand`, `condoEstimateCommand`, `saveContactCommand`, `contactsCommand` | |
| `rata-condominio`, `utenza`, `impostazioni`               | `saveCondoInstalmentCommand`, `saveSupplyCommand`, `settingsCommand` | |
| `bolletta`                                                | `billReadingOf`, `registeredBillId`, `importBillCommand`       | lettura dei file, percorso dentro la cartella, spostamento del PDF |
| `annulla-bolletta`                                        | `undoBillCommand`                                              | lettura del file, confronto del percorso, spostamento del PDF   |
| `cruscotto`                                               | `dashboardCommand`                                             |                                                                 |
| `chiudi-periodo`, `conguaglio-supplementare`              | `closePeriodCommand`, `periodClosingCommand`                   |                                                                 |
| `invia-conguaglio`, `conguaglio-saldato`, `riapri-periodo` | `markPeriodSentCommand`, `markTenantSettledCommand`, `reopenPeriodCommand` |                                         |
| `forfait-verificato`, `canone-non-incassato`              | `markFlatCheckedCommand`, `markRentMissingCommand`             |                                                                 |
| `aiuto`                                                   | (nessuna)                                                      | solo riga di comando                                            |

## Ordine dei commit

1. Questo piano e R386.
2. Pezzi comuni: `CommandStop`, messaggi, `RECONCILE_KINDS`, mappa degli errori, periodi chiusi.
3. Estratti e inquilini: `profilo`, `conto`, `importa`, `decidi`, `annulla`, `inquilino`,
   `scheda-inquilino`.
4. Riconciliazione: `riconcilia`, `conferma`, `abbina`, `escludi`, uscite, giroconti, `saldi`,
   annullamenti, `ripara`, `scegli-versione`, `riferimenti`.
5. IMU, tasse, scadenze.
6. Contratti, presenze, caparra.
7. Appartamento, condominio, rubrica.
8. Bollette, consumi, cruscotto.
9. Periodi di conguaglio, `utenza`, `rata-condominio`, `impostazioni` (le parti toccate dalla PR
   #81, per ultime).

Dopo ogni commit: `scripts/estratti.test.mjs`, `scripts/estratti-funzioni.test.mjs`,
`scripts/ciclo-completo.test.mjs` senza cambiare le attese. Alla fine `pnpm lint`,
`pnpm typecheck`, `pnpm test`, `TZ=Pacific/Auckland pnpm test`, `node scripts/check-personal-data.mjs`.
