# Revisione del 18 novembre 2026: reperti «soldi sbagliati»

Ramo `fix/revisione-soldi`. Fonti dei reperti:

- revisione 2, ciclo completo: reperti E*;
- revisione 3, regole di calcolo: reperti C*, I*, B*;
- revisione 1, annulli: solo U3.

Nessuna regola di calcolo nuova. Dove serviva una scelta del proprietario, il codice è prudente
(rifiuto, «in attesa», avviso) e la domanda è in fondo.

## Fatto, un commit per reperto

| Reperto     | Correzione                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1          | **TARI comune.** Le rate di un altro appartamento hanno ora `paidFromApartmentId` = l'appartamento dell'avviso. Il gruppo è coerente e l'addebito unico si abbina da solo: 101,04 / 84,96 €. Così tornano giusti il conguaglio, lo storno nei saldi (84,96 €), le tasse (TARI pagata) e le scadenze. Per un avviso registrato prima, `riconcilia` dice di annullarlo con `annulla-bolletta` e registrarlo di nuovo; il test lo prova.                                                                                                                                                        |
| C1          | **Voce del buco con un addebito candidato.** R125 resta: una voce la cui data di riferimento non è coperta da un estratto è «presunta». Non lo è solo se nella finestra [rif − 5, rif + 10] c'è un movimento di un estratto del conto pagante che le è candidato: stesso importo, oppure importo diverso con il fornitore nella causale, come la proposta `amount-differs`. Il movimento non deve essere già preso dalle voci coperte. Allora la voce si abbina o si propone.                                                                                                                |
| I1          | **Importo addebitato.** Una bolletta (non una rata, non un F24) si può confermare per l'intero addebito del suo movimento quando è diverso dal documento (R2). `abbina` restituisce `amountDiffers` con gli `id` e l'abbinamento conserva l'importo addebitato. L'avviso «importo diverso» non è salvato a parte: si ricava confrontando l'abbinamento con il documento, come fa il file dei proprietari.                                                                                                                                                                                    |
| I5          | **Quota della proprietà.** Le rate ordinarie dello stesso esercizio con quota o numero di rate diversi danno il rifiuto del conguaglio `owner-share-inconsistent`. Il rifiuto elenca gli `id` delle rate diverse dalla maggioranza, tutte in caso di parità, ed `excel` li mostra. La divisione per indice di rata c'era già (`equalSplit` su `rateCount`); resta B8, vedi sotto.                                                                                                                                                                                                            |
| I10/B19     | **Recupero dopo il pagamento.** Un recupero su una rata straordinaria conta solo con un abbinamento vero, non «assunto» (lotto 10).                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| B17         | **Mese del canone.** `conferma` di un canone il cui mese è fuori dalla presenza (`month-outside-presence`) o già coperto da un altro canone confermato dell'inquilino (`month-already-paid`): avviso nel risultato, mai rifiuto (lotto 11).                                                                                                                                                                                                                                                                                                                                                  |
| E7          | **Proposta superata.** Una proposta che dopo un'altra conferma è diventata un incasso automatico dà `stale-proposal`: «rilanciare riconcilia». Gli `id` delle proposte sono già stabili (`p-chi-<movimento>`): cambia lo stato, non l'`id`. Un movimento escluso o abbinato nel frattempo resta `unknown-proposal`.                                                                                                                                                                                                                                                                          |
| U3          | **Classe con dipendenti.** Una classe automatica con un recupero, un pagamento di tasse o una scadenza pagata sul movimento non cede all'abbinamento. `riconcilia` la lascia come proposta `has-dependents`; `abbina` rifiuta con `class-has-dependents`.                                                                                                                                                                                                                                                                                                                                    |
| E8, E9, E10 | **Profilo, inquilino e conto.** `profilo` e `inquilino` identici non scrivono più. `conto` con stesso appartamento, profilo, etichetta e IBAN dà `unchanged`, con o senza IBAN.                                                                                                                                                                                                                                                                                                                                                                                                              |
| E2, E3      | **Giroconto a mano e scadenza.** **Ruling:** la stessa richiesta è lo stesso record. Due operazioni davvero identiche nello stesso giorno si distinguono con `--id`. `giroconto-manuale` e `scadenza-nuova` senza `--id`, uguali a un record vivo, danno `unchanged` con il messaggio «già registrato… per registrarne un secondo uguale usare --id». `scadenza-nuova --id` vuole `scad-…`: un `id` malformato è un argomento non valido (2). Un `id` nuovo crea la scadenza, e l'esito dice `action: created` o `updated`. `giroconto-manuale` rifiuta un `--id` già usato con `id-in-use`. |
| E6          | **Annualità dal giorno 1.** `appartamento --annualita` con un giorno diverso da 01 dà `annualita-not-first-day` (codice 2). Per i dati salvati prima, `excel` dà `bad-periods` (1) solo per quell'errore dei periodi, con un messaggio che dice di correggere, non di ripetere.                                                                                                                                                                                                                                                                                                              |
| M1          | **Due decimali.** `parseEuro` vuole due decimali quando c'è un separatore decimale, come il lettore Python: rifiuta «1,5», «1.234,5», «12.5». Le celle numeriche degli estratti XLSX (12.5) si leggono ancora. Ho controllato i chiamanti: argomenti della CLI ed estratti; i tassi e le aliquote hanno un lettore loro.                                                                                                                                                                                                                                                                     |
| E12         | **Importo negativo.** `--importo -15,00` funziona: un valore che comincia con «-» e una cifra, dopo un'opzione con valore, è quel valore.                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| E14         | **Bolletta rilanciata.** `bolletta` rilanciata dopo lo spostamento del PDF dà `duplicate-bill`, non più `bad-file`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| E15         | **Lettura non valida.** `bad-reading` con `--dettagli` elenca i campi non validi: solo i nomi, mai i valori.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

**Idempotenza dei rilanci.**

- Nel ciclo completo ogni comando viene rilanciato, e ora nessun rilancio scrive.
- Già provati dai test della CLI (`unchanged` al secondo invio): `contatto`, `affitti-anno`, `tasse-copia`,
  `tasse-stima`, `tasse-conferma`, `scambio-camera`.
- `scadenza-ripeti` rifiuta `already-repeated` al secondo invio, e `recupero` ha un `--id`. Questi li ho letti nel
  codice, non provati.
- **Non provati da me:** `soglie-consumi` e `tasse-assegna`. Nel codice c'è un ramo `unchanged`.
- `abbina` e `conferma` rilanciati non scrivono: rifiutano.

**Limiti rimasti delle correzioni.**

- **E1.** Le rate TARI registrate prima della correzione non hanno `paidFromApartmentId` e restano non valide. Vanno
  annullate e registrate di nuovo. Il conto pagante si suppone quello dell'appartamento per cui si registra l'avviso.
- **I5.** Resta B8: se di un indice di rata c'è solo un record con `rata` 0 (il solo conguaglio dell'anno prima), la
  quota di quell'indice non si toglie finché non arriva la rata ordinaria.
- **M1.** Restano due differenze dal lettore Python: qui un intero («63») e «1.234» (mille e duecentotrentaquattro
  euro) sono accettati come importi degli argomenti, lì no.
- **E6.**
  - Il rifiuto è nel comando `appartamento`. `saveApartment` (di un altro scrittore) accetta ancora un giorno
    diverso da 1 da altri chiamanti.
  - Con i dati salvati prima ho provato solo `excel`, non `cruscotto --periodo-conguaglio`, `caparra-restituzione`
    né `contratti`.
  - `--esercizio-condominio` non è controllato.
- **E10.** Con lo stesso IBAN e un'etichetta nuova il risultato resta `iban-in-use`. Un comando per cambiare
  l'etichetta non c'è.

## `it.fails` del ciclo completo

- Corretti, ora `it` normali:
  - E1: conguaglio, tasse e scadenze;
  - E2: saldi;
  - E3: registro;
  - E2, E3, E8: rilancio senza scritture;
  - E6.
- Il test «stato attuale» del conguaglio ora contiene la TARI. Il test di E7 si aspetta `stale-proposal`.
- **Resta un solo `it.fails`: E11** («stato finale dopo gli annulli = stato iniziale»). Serve `RECONCILE_KINDS` e
  l'annullo di `tenant.save`, `account.save`, `bank-profile.save`, `supply.link` e `statement.resolve` (`movements.ts`, di
  un altro scrittore).
- La fase 9 accetta i due esiti dell'annullo di `apartment.save`: oggi riesce, dopo la correzione U1 dell'altro ramo
  sarà rifiutato.

## Test esistenti cambiati, e perché

- `core/test/reconcile.test.ts` e `scripts/estratti.test.mjs`: tornati come in main. Il primo C1, troppo largo, aveva tolto `bill-hera-feb` dalle voci presunte; la revisione lo ha ristretto.
- `scripts/estratti.test.mjs`: i controlli «nessun importo nello stdout» tolgono prima UUID e hash (`withoutIds`). Un `id` casuale con quelle cifre faceva fallire il test a caso (run 44240240937).
- `core/test/payable-store.test.ts` e `scripts/estratti.test.mjs`: l'esito di `savePayable` e di `scadenza-nuova` ha in più `action`.
- `core/test/conguaglio.test.ts`, 200 casi casuali: una sola quota della proprietà per esercizio, perché quote diverse sulle rate ora sono un rifiuto (I5).
- `core/test/accounts.test.ts`:
  - «saves an account without IBAN, twice» diventa: il secondo è `unchanged`, un'altra etichetta è un secondo conto (E9);
  - il rifiuto `iban-in-use` usa un'altra etichetta, perché lo stesso conto ora è `unchanged` (E10).
- `core/test/payable-store.test.ts`:
  - tolto il rifiuto di un `--id` nuovo, che ora crea (E3);
  - nel test di `setPayablePaid` la seconda scadenza ha un'altra data, perché una identica ora è `unchanged`.
- `core/test/income-store.test.ts`, `movements.test.ts` e `reconcile.test.ts`: `saveTenant` di un inquilino già nei dati ora riceve anche la lingua, perché con dati identici non scrive più un'operazione (E8) e i test ne volevano una.
- `core/test/money.test.ts`: «0.5», «12.5» e «98,4» passano tra i rifiuti (M1).
- `core/test/statement-read.test.ts`: l'importo di testo «1,5» diventa «1,50». «1,5» ora è `bad-amount`, una cella numerica 12.5 resta 12,50 € (M1).

## Domande per il proprietario

1. **C1, addebito di importo diverso subito dopo l'inizio dell'estratto.** Una bolletta da 100 € scade il 31 gennaio e il primo estratto parte dal 1° febbraio. Il 3 febbraio c'è un addebito di 105 € con il nome del fornitore. Oggi l'app lo propone come «importo diverso» invece di considerare la bolletta pagata «presunta» per 100 €. Senza un addebito così resta «presunta», come prima. Va bene?
2. **U3, bolletta e recupero.** Una spesa di 63 € è già stata recuperata dagli inquilini come recupero sul movimento; poi arriva la bolletta dello stesso addebito, da dividere tra gli inquilini. Quale dei due vale? Oggi l'app non sceglie: lascia la bolletta «da rivedere» e il recupero resta.
3. **B17, mese già pagato.** Confermi un canone «per gennaio» quando gennaio è già pagato. Oggi è registrato con un avviso. Deve essere un rifiuto, superabile solo con una conferma esplicita?
4. **I10, versamento in più.** Un inquilino versa 520 € invece di 480 € per coprire 40 € mancati a gennaio. Li sposto su gennaio da solo o te lo chiedo? Oggi l'eccedenza oltre affitto e forfait non conta.
5. **I5 e B8, rata con il solo conguaglio.** La rata 2 di 3 arriva solo come conguaglio dell'anno prima (rata 0 €,
   conguaglio 48 €), la quota della proprietà è 18 € l'anno. I 6 € della rata 2 si tolgono comunque da quel record,
   o aspetto la rata ordinaria?
6. **I5, quota dal preventivo.** La decisione del 14 novembre dice che la quota della proprietà si legge dal preventivo. Oggi è un campo di ogni rata, e l'app controlla solo che sia uguale su tutte. Esempio: preventivo con 18,00 € di quota l'anno e rate da 6,00 € ciascuna. Vuoi che l'app la prenda dal preventivo e rifiuti le rate che dicono altro?
7. **E6.** Esiste un appartamento la cui annualità non comincia il giorno 1 di un mese? Oggi è rifiutata.

## Arretrato (non fatto) e motivo

- **E4 e E5.** Mancano i comandi per inserire la rata di condominio e l'utenza. Sono funzioni nuove: serve un disegno e `supply.link` tra le operazioni annullabili, quindi `movements.ts`, che è di un altro scrittore.
- **E11.** L'annullo di inquilino, conto, profilo, utenza e `decidi` è in `movements.ts` e `RECONCILE_KINDS`, entrambi di un altro scrittore.
- **Decisioni del proprietario.** Per questi reperti non ho trovato una decisione scritta:
  - E13: archiviare il PDF della TARI e conservare il nome originale;
  - E16: cedolare con una stima parziale;
  - E17: presenza senza fine dentro un contratto. Tocca `contract.ts`, ed è una regola sui periodi;
  - E18: motivo di esclusione «privato».
- **E19.** Il comando per i posti dell'appartamento tocca `apartment-store.ts`, che è di un altro scrittore.
- **Fuori dal compito.** Gli altri reperti della revisione 3 (I2-I4, I6-I9, B6 e seguenti) non erano richiesti.
