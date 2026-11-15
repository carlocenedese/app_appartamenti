# Glossario italiano-inglese

Interfaccia, messaggi, documenti ed Excel generati sono in italiano; nomi nel codice e commenti
interni sono in inglese (decisione del 10 novembre 2026). Questa tabella fissa la traduzione dei
termini del dominio: va aggiornata quando ne compare uno nuovo, prima di usarlo nel codice.

## Contratti e periodi

| Italiano              | Inglese            | Note                                                                         |
| --------------------- | ------------------ | ---------------------------------------------------------------------------- |
| appartamento          | apartment          |                                                                              |
| inquilino             | tenant             |                                                                              |
| locatore              | landlord           | chi intesta il contratto e gli adempimenti fiscali                           |
| contratto             | contract           | transitorio 12 mesi, 3+2, ...                                                |
| canone                | rent               | affitto mensile, senza forfait                                               |
| annualità             | lease year         | periodo di conguaglio di un contratto transitorio (1 ottobre - 30 settembre) |
| periodo di conguaglio | settlement period  | dipende dal contratto; impostazione dell'appartamento                        |
| permanenza, presenza  | tenancy            | periodo in cui un inquilino occupa un posto, in mesi interi                  |
| subentro              | takeover           | un inquilino ne sostituisce un altro a metà periodo                          |
| posto                 | bed, place         | divisore delle spese: numero di posti dell'appartamento                      |
| caparra               | security deposit   | restituita con gli interessi legali, meno conguaglio e addebiti extra        |
| interessi legali      | statutory interest | calcolati sulla caparra per anno                                             |

## Spese e conguaglio

| Italiano               | Inglese                 | Note                                                         |
| ---------------------- | ----------------------- | ------------------------------------------------------------ |
| bolletta               | bill                    | luce, gas, acqua, internet, TARI, condominio                 |
| utenza                 | utility, supply         | contratto di fornitura (luce, gas, acqua)                    |
| fornitore              | supplier                |                                                              |
| competenza             | accrual period          | periodo a cui una bolletta appartiene, non la data di arrivo |
| ripartizione, riparto  | split, allocation       | divisione di una spesa tra gli inquilini a mesi interi       |
| quota                  | share                   |                                                              |
| conguaglio             | settlement              | saldo tra spese ripartite e forfait versato                  |
| forfait                | flat service charge     | quota mensile a persona versata insieme al canone            |
| acconto                | advance payment         |                                                              |
| rata                   | instalment              | rata del condominio o del conguaglio                         |
| preventivo             | budget                  | preventivo del condominio                                    |
| consuntivo, bilancio   | final accounts          | bilancio del condominio                                      |
| esercizio condominiale | condominium fiscal year | Berchet e Pulci da ottobre, Lovarini da maggio               |
| TARI                   | waste tax (TARI)        | anno solare                                                  |
| quota di proprietà     | owner's share           | parte delle spese condominiali a carico del proprietario     |
| straordinaria          | extraordinary           | spesa condominiale straordinaria                             |
| commissione            | bank fee                | 0,80 euro su alcuni addebiti                                 |

## Banca e pagamenti

| Italiano              | Inglese                          | Note                                                                                                  |
| --------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------- |
| addebito              | debit                            | movimento in uscita sul conto                                                                         |
| accredito             | credit                           | movimento in entrata sul conto                                                                        |
| movimento             | transaction                      | riga dell'estratto conto                                                                              |
| estratto conto        | bank statement                   | file CSV della banca                                                                                  |
| bonifico              | bank transfer                    |                                                                                                       |
| pagamento, versamento | payment                          | versamento di un inquilino                                                                            |
| pagante               | payer                            | chi versa su un conto (IBAN o nome), legato a un inquilino                                            |
| riconciliazione       | reconciliation                   | abbinamento ai movimenti di bollette, rate e versamenti                                               |
| abbinamento           | match                            |                                                                                                       |
| da rivedere           | to review                        | ogni valore incerto passa da qui                                                                      |
| conto                 | account                          | conto bancario di un appartamento                                                                     |
| profilo della banca   | bank profile                     | come si legge l'estratto di una banca                                                                 |
| estratto              | statement                        | file importato su un conto, con il periodo                                                            |
| movimento in attesa   | held transaction                 | riga non contabilizzata, da decidere                                                                  |
| possibile doppione    | possible duplicate               | riga forse già presente: da decidere                                                                  |
| periodo coperto       | covered period                   | giorni di un conto coperti da un estratto                                                             |
| codice disposizione   | instruction code                 | lega la commissione all'addebito                                                                      |
| uscita                | outgoing                         | movimento in uscita senza bolletta né rata (classificato in `utenze`, `tasse`, `condominio`, `altro`) |
| classificazione       | movement class (`MovementClass`) | che cosa è un movimento: esclusione o categoria con l'appartamento, `mc-<movimento>`                  |
| esclusione            | exclusion                        | classificazione `escluso`: il movimento non entra in nessun calcolo                                   |
| regola appresa        | movement rule (`MovementRule`)   | da una conferma con «ricorda»: conto, verso e controparte danno categoria e appartamento              |
| giroconto             | transfer (`Transfer`)            | spostamento di denaro tra due conti propri                                                            |
| gamba                 | leg                              | uno dei due movimenti di un giroconto (uscita o entrata)                                              |
| saldo tra conti       | account balance                  | chi deve a chi tra gli appartamenti, con le voci                                                      |
| F24                   | F24                              | modello di pagamento delle imposte: sempre da confermare, mai automatico                              |

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
