# Glossario italiano-inglese

Interfaccia, messaggi, documenti ed Excel generati sono in italiano; nomi nel codice e commenti
interni sono in inglese (decisione del 10 novembre 2026). Questa tabella fissa la traduzione dei
termini del dominio: va aggiornata quando ne compare uno nuovo, prima di usarlo nel codice.

## Contratti e periodi

| Italiano                             | Inglese                                      | Note                                                                         |
| ------------------------------------ | -------------------------------------------- | ---------------------------------------------------------------------------- |
| appartamento                         | apartment                                    |                                                                              |
| inquilino                            | tenant                                       |                                                                              |
| locatore                             | landlord                                     | chi intesta il contratto e gli adempimenti fiscali                           |
| contratto                            | contract                                     | transitorio 12 mesi, 3+2, ...                                                |
| canone                               | rent                                         | affitto mensile, senza forfait                                               |
| canone concordato                    | agreed rent (`agreedRent`)                   | dato del contratto                                                           |
| contratto per studenti               | student contract (`forStudents`)             | dato del contratto                                                           |
| durata                               | duration (`durationMonths`)                  | scritta nel contratto, non ricavata dalle date                               |
| data di firma                        | signing date (`signedOn`)                    | separata dalla data di registrazione                                         |
| registrazione, codice identificativo | registration (`registration`), code (`code`) | il codice è un dato personale: solo con `--dettagli`                         |
| regime fiscale                       | tax regime (`taxRegime`)                     | `cedolare` od `ordinario`, solo dato                                         |
| cedolare secca                       | flat-rate tax (`cedolare`)                   | solo stimata, da confermare (`cedolareExpected`, R182)                       |
| affitti dell'anno                    | annual rents (`rentYear`, `totalRent`)       | totale inserito a mano da user1, base della stima della cedolare             |
| contratti sovrapposti                | contract overlap (`contract-overlap`)        | due contratti vivi dello stesso appartamento con mesi in comune: avviso      |
| aliquota                             | rate (`cedolareRateBp`)                      | punti base inseriti dall'utente, mai una costante                            |
| storico del canone                   | rent history (`rent`)                        | voci `from`, `monthlyRent`, `monthlyAdvance`                                 |
| acconto spese                        | expense advance (`monthlyAdvance`)           | parte del contratto confrontata da R4                                        |
| annualità                            | lease year                                   | periodo di conguaglio di un contratto transitorio (1 ottobre - 30 settembre) |
| periodo di conguaglio                | settlement period                            | dipende dal contratto; impostazione dell'appartamento                        |
| permanenza, presenza                 | tenancy                                      | periodo in cui un inquilino occupa un posto, in mesi interi                  |
| subentro                             | takeover                                     | un inquilino ne sostituisce un altro a metà periodo                          |
| posto                                | bed, place                                   | divisore delle spese: numero di posti dell'appartamento                      |
| caparra                              | security deposit                             | restituita con gli interessi legali, meno conguaglio e addebiti extra        |
| caparra attesa                       | expected deposit                             | caparra chiesta al nuovo inquilino, dato della presenza inserito da user1    |
| interessi legali                     | statutory interest                           | calcolati sulla caparra per anno                                             |

## Spese e conguaglio

| Italiano                           | Inglese                                                          | Note                                                                                 |
| ---------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| bolletta                           | bill                                                             | luce, gas, acqua, internet, TARI, condominio                                         |
| utenza                             | utility, supply                                                  | contratto di fornitura (luce, gas, acqua)                                            |
| fornitore                          | supplier                                                         |                                                                                      |
| competenza                         | accrual period                                                   | periodo a cui una bolletta appartiene, non la data di arrivo                         |
| ripartizione, riparto              | split, allocation                                                | divisione di una spesa tra gli inquilini a mesi interi                               |
| quota                              | share                                                            |                                                                                      |
| conguaglio                         | settlement                                                       | saldo tra spese ripartite e forfait versato                                          |
| forfait                            | flat service charge                                              | quota mensile a persona versata insieme al canone                                    |
| acconto                            | advance payment                                                  |                                                                                      |
| rata                               | instalment                                                       | rata del condominio o del conguaglio                                                 |
| preventivo                         | budget                                                           | preventivo del condominio                                                            |
| consuntivo, bilancio               | final accounts                                                   | bilancio del condominio                                                              |
| esercizio condominiale             | condominium fiscal year                                          | Berchet e Pulci da ottobre, Lovarini da maggio                                       |
| TARI                               | waste tax (TARI)                                                 | anno solare                                                                          |
| quota di proprietà                 | owner's share                                                    | parte delle spese condominiali a carico del proprietario                             |
| straordinaria                      | extraordinary                                                    | spesa condominiale straordinaria                                                     |
| commissione                        | bank fee                                                         | 0,80 euro su alcuni addebiti                                                         |
| versato, residuo                   | paid (`versato`), residual                                       | colonne del foglio Conguagli (R172)                                                  |
| stato del conguaglio               | settlement status (`settlementStatus`)                           | saldato, parziale, da pagare, da restituire, versato in più (R178)                   |
| periodo di un versamento           | settlement period of a payment (`settlementPeriodOf`)            | senza mese indicato: fino alla fine del periodo successivo (R177)                    |
| motivo dell'attesa                 | pending reason (`reason`)                                        | in attesa di pagamento, importo diverso, quota maggiore della rata (R179)            |
| Excel dei proprietari              | owners' file (`buildOwnersWorkbook`)                             | riservato, mai agli inquilini (sezione 12, R174)                                     |
| preventivo, consuntivo             | condominium budget, final account (`condoDocument`)              | documenti dell'esercizio; consuntivo = rendiconto (R190)                             |
| piano rate                         | instalment plan                                                  | le `Instalment` dello stesso appartamento ed esercizio (R190)                        |
| quota conduttore                   | tenants' share (`quotaConduttore`)                               | dal documento dell'amministratore, che vince (R192)                                  |
| differenza di consuntivo           | condominium difference (`condoDifferenceTo`, `condoDifferences`) | consuntivo − preventivo: agli inquilini (predefinito) o al proprietario (R193, R194) |
| controllo delle spese condominiali | owners' condominium check (`condoCheck`)                         | pagata, senza addebito, importo diverso, duplicato, in programma, assunta (R194)     |
| recupero da un inquilino           | tenant recovery (`tenantRecovery`)                               | spesa straordinaria causata da inquilini, nel loro conguaglio (R196, R197)           |
| rubrica, contatto                  | address book, contact (`contact`)                                | amministratore o fornitore, contatti in testo libero (R251)                          |
| stima del condominio               | condominium estimate (`condoEstimate`)                           | documento dell'esercizio o copia del precedente, mai salvata (R250)                  |

## Banca e pagamenti

| Italiano                           | Inglese                          | Note                                                                                                   |
| ---------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------ |
| addebito                           | debit                            | movimento in uscita sul conto                                                                          |
| accredito                          | credit                           | movimento in entrata sul conto                                                                         |
| movimento                          | transaction                      | riga dell'estratto conto                                                                               |
| estratto conto                     | bank statement                   | file CSV della banca                                                                                   |
| bonifico                           | bank transfer                    |                                                                                                        |
| pagamento, versamento              | payment                          | versamento di un inquilino                                                                             |
| pagante                            | payer                            | chi versa su un conto (IBAN o nome), legato a un inquilino                                             |
| riconciliazione                    | reconciliation                   | abbinamento ai movimenti di bollette, rate e versamenti                                                |
| abbinamento                        | match                            |                                                                                                        |
| da rivedere                        | to review                        | ogni valore incerto passa da qui                                                                       |
| conto                              | account                          | conto bancario di un appartamento                                                                      |
| profilo della banca                | bank profile                     | come si legge l'estratto di una banca                                                                  |
| estratto                           | statement                        | file importato su un conto, con il periodo                                                             |
| movimento in attesa                | held transaction                 | riga non contabilizzata, da decidere                                                                   |
| possibile doppione                 | possible duplicate               | riga forse già presente: da decidere                                                                   |
| periodo coperto                    | covered period                   | giorni di un conto coperti da un estratto                                                              |
| codice disposizione                | instruction code                 | lega la commissione all'addebito                                                                       |
| uscita                             | outgoing                         | movimento in uscita senza bolletta né rata (classificato in `utenze`, `tasse`, `condominio`, `altro`)  |
| classificazione                    | movement class (`MovementClass`) | che cosa è un movimento: esclusione o categoria con l'appartamento, `mc-<movimento>`                   |
| esclusione                         | exclusion                        | classificazione `escluso`: il movimento non entra in nessun calcolo                                    |
| regola appresa                     | movement rule (`MovementRule`)   | da una conferma con «ricorda»: conto, verso e controparte danno categoria e appartamento               |
| giroconto                          | transfer (`Transfer`)            | spostamento di denaro tra due conti propri                                                             |
| gamba                              | leg                              | uno dei due movimenti di un giroconto (uscita o entrata)                                               |
| saldo tra conti                    | account balance                  | chi deve a chi tra gli appartamenti, con le voci                                                       |
| F24                                | F24                              | modello di pagamento delle imposte: sempre da confermare, mai automatico                               |
| rata IMU                           | IMU instalment (`rates`)         | una rata di un anno IMU di un gruppo F24: `(f24Group, year, rateIndex)`                                |
| gruppo F24                         | F24 group (`f24Group`)           | gli appartamenti pagati dallo stesso F24 in un anno (testo negli `imuYear`)                            |
| importo atteso                     | expected amount (`expected`)     | quanto si prevede di pagare per una rata, dal prospetto: un dato, mai calcolato                        |
| quota IMU                          | IMU share (`imuShares`)          | la parte di un appartamento nell'addebito di un F24 IMU, in proporzione agli importi attesi            |
| regola IMU                         | IMU rule (`ImuRule`)             | da un'assegnazione con «ricorda»: conto e controparte suggeriscono il gruppo F24, mai assegnato da sé  |
| scadenziario, Scadenze e pagamenti | payables list (`scadenzario`)    | voci del proprietario da IMU, rate e voci a mano, con stato; `today` è un argomento                    |
| scadenza (voce a mano)             | payable (`Payable`, `scad-<id>`) | registro, bollo, cedolare, F24, altro: data e importo inseriti da user1                                |
| stato della scadenza               | payable state (`PayableState`)   | `da-pagare`, `in-scadenza` (solo con una finestra esplicita), `pagata`, `in-ritardo` (dal giorno dopo) |
| intestatario                       | taxpayer (`taxpayers`)           | il `locatore` degli appartamenti della voce: dato personale                                            |
| ogni anno                          | yearly mark (`repeatYearly`)     | solo un segno: la voce successiva la crea `scadenza-ripeti`                                            |

## Dati e registro

| Italiano                 | Inglese                   | Note                                      |
| ------------------------ | ------------------------- | ----------------------------------------- |
| cartella condivisa       | shared folder, workspace  | la cartella di lavoro su Dropbox          |
| registro delle modifiche | journal                   | un file per operazione in `_app/journal/` |
| annullamento             | undo                      |                                           |
| impronta                 | hash, fingerprint         | dei documenti e degli addebiti            |
| profilo del fornitore    | supplier profile          | dati versionati, non codice               |
| fixture dorata           | golden fixture            | caso verificato e approvato da user1      |
| scostamento noto         | known deviation           | differenza motivata rispetto all'Excel    |
| importo in centesimi     | amount in cents (`Cents`) | intero con marchio, mai decimale          |
| archivio                 | store (`Store`)           | interfaccia di lettura e scrittura file   |
| copia in conflitto       | conflict copy             | copia di Dropbox: segnalata, mai caricata |
| scrittura obsoleta       | stale write               | da una `rev` vecchia: rifiutata           |

## Tasse e stime (piano 10)

| Italiano                                 | Inglese                                      | Note                                                          |
| ---------------------------------------- | -------------------------------------------- | ------------------------------------------------------------- |
| stima di inizio anno                     | tax estimate (`TaxEstimate`)                 | scritta da user1 per appartamento, anno e voce; mai calcolata |
| voce (delle tasse)                       | voce (`TaxVoice`)                            | cedolare, imu, registro, tari, condominio                     |
| contribuente                             | taxpayer                                     | il `locatore` dell'appartamento (dato personale)              |
| pagato finora                            | paid                                         | solo addebiti veri del CSV (R2)                               |
| ancora previsto                          | expected                                     | da Scadenze e pagamenti; mai una stima                        |
| differenza                               | difference                                   | pagato + ancora previsto − stima                              |
| in linea / discrepanza / da verificare   | `in-linea` / `discrepanza` / `da-verificare` | stato della riga; da verificare con un motivo                 |
| assegnazione di un movimento a una tassa | tax payment (`TaxPayment`)                   | un addebito «tasse» diviso tra cedolare o registro e anni     |
| copia dell'anno precedente               | copy of the previous year                    | solo a comando, mai sopra stime esistenti                     |
| file per il commercialista               | tax export (`buildTaxWorkbook`)              | immobili, contratti, canoni in `Riservato_proprietari/Tasse`  |

## Moduli e documenti (piano 12)

| Italiano           | Inglese                                  | Note                                                                   |
| ------------------ | ---------------------------------------- | ---------------------------------------------------------------------- |
| modulo             | module (`ModuleKind`, `MODULE_KINDS`)    | uno degli otto documenti della sezione 26                              |
| modello            | template                                 | il `.docx` dei proprietari con i segnaposto; il testo lo scrivono loro |
| segnaposto         | placeholder (`{{campo}}`)                | minuscole, cifre e `_`; anche spezzato in più run di Word              |
| campo dalla scheda | app field (`APP_FIELDS`, `moduleValues`) | riempito dai record; non si dà nel file dei valori                     |
| campo richiesto    | asked field (`ASKED_FIELDS`)             | testo libero dal file dei valori, mai controllato                      |
| modello di prova   | starter template (`starterDocx`)         | titolo, testo inventato, elenco dei campi; nessun testo legale         |
| file dei valori    | values file (`--valori`)                 | JSON di testi; i dati personali restano lì, non nella riga di comando  |
