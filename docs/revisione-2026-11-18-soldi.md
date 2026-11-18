# Revisione del 18 novembre 2026: reperti «soldi sbagliati»

Ramo `fix/revisione-soldi`. Fonti dei reperti:

- revisione 2, ciclo completo: reperti E*;
- revisione 3, regole di calcolo: reperti C*, I*, B*;
- revisione 1, annulli: solo U3.

Nessuna regola di calcolo nuova. Dove serviva una scelta del proprietario, il codice è prudente
(rifiuto, «in attesa», avviso) e la domanda è in fondo.

## Fatto, un commit per reperto

| Reperto     | Correzione                                                                                                                                                                                                                                                                                                                               |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1          | **TARI comune.** Le rate di un altro appartamento hanno ora `paidFromApartmentId` = l'appartamento dell'avviso. Il gruppo è coerente e l'addebito unico si abbina da solo: 101,04 / 84,96 €. Così tornano giusti il conguaglio, lo storno nei saldi (84,96 €), le tasse (TARI pagata) e le scadenze.                                     |
| C1          | **Voce non più «assunta».** Una voce è coperta quando un estratto del conto pagante copre almeno un giorno di [rif − 5, rif + 10]. In quel caso si abbina oppure resta «in attesa»: mai «assunta». Il bordo vale nei due sensi: anche una voce che scade fino a 5 giorni dopo la fine di un estratto ora resta in attesa.                |
| I1          | **Importo addebitato.** Una bolletta (non una rata, non un F24) si può confermare per l'intero addebito del suo movimento quando è diverso dal documento (R2). `abbina` restituisce `amountDiffers` con gli `id`. L'abbinamento conserva l'importo addebitato, quindi l'«importo diverso» si vede sempre dal confronto con il documento. |
| I5          | **Quota della proprietà.** Le rate ordinarie dello stesso esercizio con quota o numero di rate diversi danno il rifiuto del conguaglio `owner-share-inconsistent`, con un messaggio chiaro. Excel, cruscotto e caparra lo trattano già come rifiuto. La divisione per indice di rata c'era già (`equalSplit` su `rateCount`).            |
| I10/B19     | **Recupero dopo il pagamento.** Un recupero su una rata straordinaria conta solo con un abbinamento vero, non «assunto» (lotto 10).                                                                                                                                                                                                      |
| B17         | **Mese del canone.** `conferma` di un canone il cui mese è fuori dalla presenza (`month-outside-presence`) o già coperto da un altro canone confermato dell'inquilino (`month-already-paid`): avviso nel risultato, mai rifiuto (lotto 11).                                                                                              |
| E7          | **Proposta superata.** Una proposta che dopo un'altra conferma è diventata un incasso automatico dà `stale-proposal`: «rilanciare riconcilia». Gli `id` delle proposte sono già stabili (`p-chi-<movimento>`): cambia lo stato, non l'`id`. Un movimento escluso o abbinato nel frattempo resta `unknown-proposal`.                      |
| U3          | **Classe con dipendenti.** Una classe automatica con un recupero, un pagamento di tasse o una scadenza pagata sul movimento non cede all'abbinamento. `riconcilia` la lascia come proposta `has-dependents`; `abbina` rifiuta con `class-has-dependents`.                                                                                |
| E8, E9, E10 | **Profilo, inquilino e conto.** `profilo` e `inquilino` identici non scrivono più. `conto` con stesso appartamento, profilo, etichetta e IBAN dà `unchanged`, con o senza IBAN.                                                                                                                                                          |
| E2, E3      | **Giroconto a mano e scadenza.** `giroconto-manuale` identico a uno vivo dà `unchanged`; con `--id` facoltativo si registrano due giroconti uguali nello stesso giorno (`id-in-use` se l'`id` è già usato). `scadenza-nuova` con un `--id` nuovo crea la scadenza, e la stessa scadenza senza `--id` dà `unchanged`.                     |
| E6          | **Annualità dal giorno 1.** `appartamento --annualita` con un giorno diverso da 01 dà `annualita-not-first-day` (codice 2). Per i dati salvati prima, `excel` dà `bad-periods` (1) con un messaggio che dice di correggere, non di ripetere.                                                                                             |
| M1          | **Due decimali.** `parseEuro` vuole due decimali, come il lettore Python: rifiuta «1,5», «1.234,5», «12.5». Le celle numeriche degli estratti XLSX (12.5) si leggono ancora. Ho controllato i chiamanti: argomenti della CLI ed estratti; i tassi e le aliquote hanno un lettore loro.                                                   |
| E12         | **Importo negativo.** `--importo -15,00` funziona: un valore che comincia con «-» e una cifra, dopo un'opzione con valore, è quel valore.                                                                                                                                                                                                |
| E14         | **Bolletta rilanciata.** `bolletta` rilanciata dopo lo spostamento del PDF dà `duplicate-bill`, non più `bad-file`.                                                                                                                                                                                                                      |
| E15         | **Lettura non valida.** `bad-reading` con `--dettagli` elenca i campi non validi: solo i nomi, mai i valori.                                                                                                                                                                                                                             |

**Idempotenza dei rilanci.**

- Nel ciclo completo ogni comando viene rilanciato, e ora nessun rilancio scrive.
- Gli altri comandi di scrittura li ho controllati leggendo il codice. Hanno già un «unchanged» o un rifiuto al secondo invio:
  - `contatto`, `soglie-consumi`, `tasse-stima`, `tasse-copia`, `tasse-assegna`, `tasse-conferma`;
  - `condominio-stima`, `scambio-camera`, `imu-*`, `affitti-anno`;
  - `scadenza-ripeti` (`already-repeated`) e `recupero` (`--id`).
- `abbina` e `conferma` rilanciati non scrivono: rifiutano.

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

- `core/test/reconcile.test.ts` e `scripts/estratti.test.mjs`, fixture tre-conti: `bill-hera-feb` scade il 20/02, nel buco di febbraio. La sua finestra (15/02-02/03) arriva all'estratto di marzo, quindi ora è «in attesa», non «assunta» (C1).
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

1. **C1, addebito prima dell'estratto.** Una bolletta scade il 31 gennaio e il primo estratto che hai caricato parte dal 1° febbraio. Oggi l'app aspetta di vedere l'addebito, perché potrebbe essere il 3 febbraio e di un importo diverso, per esempio 105 € invece di 100 €. Se invece è stato addebitato il 30 gennaio, la bolletta resta «in attesa» per sempre, finché non carichi l'estratto di gennaio. Va bene così, o in quel caso la conto come pagata «assunta»?
2. **U3, bolletta e recupero.** Una spesa di 63 € è già stata recuperata dagli inquilini come recupero sul movimento; poi arriva la bolletta dello stesso addebito, da dividere tra gli inquilini. Quale dei due vale? Oggi l'app non sceglie: lascia la bolletta «da rivedere» e il recupero resta.
3. **B17, mese già pagato.** Confermi un canone «per gennaio» quando gennaio è già pagato. Oggi è registrato con un avviso. Deve essere un rifiuto, superabile solo con una conferma esplicita?
4. **I10, versamento in più.** Un inquilino versa 520 € invece di 480 € per coprire 40 € mancati a gennaio. Li sposto su gennaio da solo o te lo chiedo? Oggi l'eccedenza oltre affitto e forfait non conta.
5. **I5, quota dal preventivo.** La decisione del 14 novembre dice che la quota della proprietà si legge dal preventivo. Oggi è un campo di ogni rata, e l'app controlla solo che sia uguale su tutte. Esempio: preventivo con 18,00 € di quota l'anno e rate da 6,00 € ciascuna. Vuoi che l'app la prenda dal preventivo e rifiuti le rate che dicono altro?
6. **E6.** Esiste un appartamento la cui annualità non comincia il giorno 1 di un mese? Oggi è rifiutata.

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
