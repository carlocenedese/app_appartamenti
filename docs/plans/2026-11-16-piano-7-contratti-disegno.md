# Piano 7: contratti di locazione, storico del canone e controlli sui dati (disegno)

Stato: **bozza da approvare da user1** (16 novembre 2026). Solo disegno; il piano di implementazione è
`docs/plans/2026-11-16-piano-7-contratti.md`. Il piano copre il core (`packages/core`) e la riga di
comando (`pnpm estratti`); **niente schermate e niente veste grafica**. Riferimenti: `docs/spec.md`
sezioni 6, 17, 23, 26, 31, 34, 38 e 42 (R1 e R4, che prevalgono), `docs/progress.md` R34, R38, R107,
R112, R113, R117, R132, R155; disegno e piano del 3c e del 3d per la forma. Codice letto: `model.ts`
(`Apartment`, `Contract`, `Tenancy`, `Tenant`, `Payment`, `Note`), `period.ts` (`settlementPeriods`),
`conguaglio.ts` (`contractWarnings`, `isPresent`), `caparra.ts`, `interest.ts`, `income.ts`,
`income-store.ts` (`saveTenant`), `imu-store.ts`, `excel-store.ts`, `scripts/estratti.mjs`. Nessun
documento reale aperto.

Nota sui nomi: nel compito «presenza» vuol dire la permanenza di un inquilino (`tenancy`, glossario),
non `presence.ts` (chi lavora nella cartella condivisa), che questo piano non tocca.

## Perché

Oggi il record `contract` esiste ma dice solo appartamento, forma (`1+1`, `3+2`, …), primo e ultimo
mese e tipo di conguaglio: serve a `settlementPeriods` e all'Excel (R155). Non c'è nessun modo di
scriverlo se non a mano, non dice il canone né come cambia ai rinnovi, non dice chi ci abita, non
conserva i dati di registrazione che servono ai moduli (sezione 26: «codice identificativo del
contratto registrato», data di firma e di registrazione tenute separate) e all'esportazione per il
commercialista (sezione 34). Il controllo di R4 («il totale mensile di tutti gli affitti e forfait si
confronta con il contratto: è solo un avviso») usa un solo numero per appartamento
(`Apartment.contrattoMensile`, R34), che non segue i rinnovi.

## Obiettivo

1. **Scrivere un contratto** con la riga di comando, annullabile, con i dati che user1 ha: appartamento,
   forma e date, conguaglio, canone concordato, contratto per studenti, durata, data di firma, codice e
   data di registrazione, regime fiscale (cedolare od ordinario) come **dato**, l'aliquota della
   cedolare come **dato** inserito da user1, le presenze e le caparre collegate.
2. **Storico del canone** per data (rinnovo annuale, aumento): canone mensile e acconto spese dal mese
   indicato.
3. **Controlli in sola lettura**: presenze collegate fuori dalle date del contratto, collegamenti rotti,
   caparre che non tornano, e il confronto di R4 tra il totale mensile delle presenze e il canone del
   contratto in quel mese. Sempre un elenco: **mai una correzione automatica**, mai un blocco.

## Non obiettivi

- **Calcolo della cedolare secca** (`cedolareExpected`): la sezione 34 dice che «nell'app non ci sono
  aliquote e nulla si calcola da solo» e gli importi delle tasse li inserisce l'utente anno per anno;
  la base del calcolo non è decisa. Resta fuori: domanda 1. L'aliquota si salva solo come dato.
- Imposta di registro, proroghe RLI, scadenze (sezione 23, Scadenze e pagamenti), Tasse e stime
  (sezione 34), esportazione per il commercialista: useranno questi dati in altri piani.
- Moduli Word e PDF (sezione 26), procedura di subentro e uscita (sezione 17), registrazione della
  cessione come dato separato (domanda 7).
- Scrittura delle presenze (`tenancy`): non c'è ancora un comando e questo piano non lo aggiunge; le
  presenze si collegano, non si creano né si correggono.
- Qualsiasi cambiamento al conguaglio, all'Excel, agli incassi o a `settlementPeriods`: nessun calcolo
  esistente cambia (domanda 2 per il controllo di R34).
- Schermate, veste grafica.

## Decisioni già prese da user1

Vincolanti (spec, CLAUDE.md, richiesta del 16 novembre 2026):

1. **Tutti i contratti sono a canone concordato** e la scheda degli appartamenti indica la **cedolare
   secca** per tutti e tre (sezione 23); canone concordato e cedolare sono due cose distinte.
2. **Cedolare al 10% dal contratto** (user1, 16 novembre 2026): è un dato del contratto, non una
   costante. CLAUDE.md vieta aliquote nel codice: l'aliquota arriva solo da ciò che user1 inserisce.
3. **Periodo di conguaglio dal contratto** (R1): transitori da 12 mesi rinnovabili con un periodo per
   annualità, 3+2 con un solo periodo; la forma e il tipo di conguaglio sono già nel record
   (`type`, `settlement`).
4. **R4:** il totale mensile di affitti e forfait si confronta con il contratto (canone + acconto) ed è
   **solo un avviso**. Il confronto di questo piano è esattamente quello, sullo storico del contratto.
5. **Mesi interi** (sezione 6, R1): presenze e contratto si confrontano a mesi.
6. **Moduli** (sezione 26): il codice identificativo del contratto registrato serve ai moduli; data di
   firma e data di registrazione restano separate.
7. **Caparra** (sezione 26, regola 1): 500 € per inquilino; il versamento è un `Payment` `caparra`
   (R130). Il contratto ne tiene solo il riferimento.
8. Vincoli permanenti: `Cents` interi, mesi `YYYY-MM`, date `YYYY-MM-DD`, core puro, un JSON per record
   con `id`/`v`/`rev`, mai cancellato dal disco; ogni scrittura dopo `checkConsistency` (R113);
   rieseguire non scrive nulla; nessun dato personale nell'uscita predefinita della riga di comando
   (R107, R117, R132); codici di uscita 0/1/2/3.

## Modello dati

Nessun record nuovo: il record **`contract`** esistente (`_app/dati/contract/<id>.json`, `v: 1`) riceve
solo campi **opzionali**, quindi i contratti già scritti restano validi e nessuna migrazione serve.

| Campo | Tipo | Significato |
| --- | --- | --- |
| `apartmentId`, `type`, `start`, `end`, `settlement` | come oggi | invariati; `end` comprende le proroghe già certe |
| `agreedRent?` | `true` | canone concordato |
| `forStudents?` | `true` | contratto per studenti universitari |
| `durationMonths?` | intero ≥ 1 | la durata scritta nel contratto (12, 36, …), un dato: non si ricava da `start`/`end`, che comprendono le proroghe |
| `signedOn?` | `ISODate` | data di firma |
| `registration?` | `{ code?: testo, date?: ISODate }` | codice identificativo e data di registrazione |
| `taxRegime?` | `'cedolare' \| 'ordinario'` | regime fiscale, solo dato |
| `cedolareRateBp?` | intero 1..10000 | aliquota in punti base (1000 = 10%), solo con `taxRegime: 'cedolare'`; mai usata in un calcolo (domanda 1) |
| `tenancyIds?` | `string[]`, senza ripetizioni | le presenze del contratto |
| `depositPaymentIds?` | `string[]`, senza ripetizioni | i `Payment` `caparra` del contratto |
| `rent?` | `{ from: YearMonth, monthlyRent: Cents, monthlyAdvance: Cents }[]` | storico del canone: `from` strettamente crescenti, tutti tra `start` e `end`; `monthlyRent` > 0, `monthlyAdvance` ≥ 0 |

- **Canone del mese** `m`: la voce con il `from` più grande non dopo `m`; prima della prima voce il
  canone non è noto e nessun confronto si fa. È la lettura di uno storico per data, non una regola di
  calcolo.
- **Il canone è il totale del contratto** (tutte le camere), come `Apartment.contrattoMensile` e come
  R4 lo confronta: domanda 3 se serve per camera.
- **Codice di registrazione:** dato personale ai fini dell'uscita (identifica il contratto all'Agenzia
  delle Entrate): mai in `summary`, messaggi, registro dei log o uscita predefinita; solo con
  `--dettagli`. Nelle fixture codici inventati, dichiarati in `fixtures/README.md`.
- `Note.targetType` ha già `contract`: le note sul contratto funzionano senza modifiche.

## 1. Scrivere un contratto

- `saveContract(store, input, …)`: crea o aggiorna `input.id` (nuova `rev`; un contratto cancellato da
  un annullamento torna vivo), operazione `contract.save`, `summary` costante `Contratto salvato.`,
  `apartmentId` del contratto. L'aggiornamento sostituisce tutti i campi dati **tranne `rent`**, che
  resta com'è (si cambia solo con la sezione 2).
- Rifiuti senza scrivere, in quest'ordine: `inconsistent-store`; `unknown-apartment` (assente o
  cancellato); `unknown-tenancy` (una presenza assente, cancellata o di un altro appartamento: un
  collegamento sbagliato non si salva); `unknown-deposit` (un pagamento assente, cancellato, non
  `caparra` o di un altro appartamento); `rent-outside-contract` (le nuove date lascerebbero fuori una
  voce dello storico già scritta). Stesso contenuto già scritto: `unchanged`, nulla scritto.
- **Le date non si controllano contro le presenze in scrittura:** una presenza collegata fuori dalle
  date si salva e compare nei controlli (sezione 3). È la richiesta: segnalare, mai correggere.
- Nessuna cancellazione: non c'è un comando per cancellare un contratto; solo l'annullamento
  dell'operazione lo rimette com'era.

## 2. Storico del canone

- `setContractRent(store, { contractId, from, monthlyRent, monthlyAdvance }, …)`: aggiunge la voce, o
  sostituisce quella con lo stesso `from`; operazione `contract.rent`, `summary`
  `Aggiornato il canone di un contratto.`. Stessa voce già scritta: `unchanged`.
- Rifiuti senza scrivere: `inconsistent-store`; `unknown-contract` (assente o cancellato);
  `month-outside-contract` (`from` prima di `start` o dopo `end`); `bad-amount` (`monthlyRent` ≤ 0 o
  `monthlyAdvance` < 0).
- Una voce si toglie solo annullando l'operazione che l'ha scritta.
- **Esempio (importi inventati):** contratto `ctr-app-a` dal 2025-10 al 2027-09, voce 2025-10
  1.600,00 € + 150,00 €; rinnovo da 2026-10 1.650,00 € + 150,00 €. Il canone di 2026-09 è 1.600,00 €,
  quello di 2026-10 1.650,00 €.

## 3. Controlli (sola lettura)

Funzione pura `contractChecks({ contracts, tenancies, payments, asOf })` sui contratti **vivi**; ogni
voce ha un `code`, il `contractId` e quanto serve per trovarla. Ordine: `contractId`, `code`, poi
`tenancyId`/`paymentId`/`from`. Nessuna voce cambia dati, calcoli o proposte.

| `code` | Quando |
| --- | --- |
| `unknown-tenancy` | un `tenancyIds` non è una presenza viva (per esempio cancellata dopo il collegamento) |
| `tenancy-other-apartment` | la presenza è di un altro appartamento |
| `tenancy-outside-contract` | la presenza comincia prima di `start`, finisce dopo `end`, o non ha fine mentre il contratto ce l'ha |
| `tenancy-linked-twice` | la stessa presenza viva è in due contratti vivi |
| `unlinked-tenancy` | una presenza viva di un appartamento in cui almeno un contratto vivo ha `tenancyIds`, che tocca i mesi di quel contratto e non è collegata a nessun contratto vivo |
| `unknown-deposit` | un `depositPaymentIds` non è un `Payment` vivo `caparra` dello stesso appartamento |
| `deposit-other-tenant` | l'inquilino del pagamento non è l'inquilino di nessuna presenza collegata |
| `rent-differs` | R4: in un mese fino al mese di `asOf`, con un canone noto, il totale `monthlyRent + monthlyForfait` delle presenze vive dell'appartamento presenti nel mese è diverso da `monthlyRent + monthlyAdvance` del contratto |

- `rent-differs` usa **tutte** le presenze vive dell'appartamento presenti nel mese (`isPresent`), come
  il controllo di R34, non solo quelle collegate: è il confronto di R4. Mesi consecutivi con lo stesso
  atteso e lo stesso totale diventano un intervallo `{ from, to, expected, actual }`.
- I mesi dopo `asOf` non si controllano: le presenze future non sono ancora scritte e darebbero un
  avviso per ogni mese fino alla fine del contratto. `asOf` è un argomento (core puro); la riga di
  comando passa il mese dell'orologio.
- Un posto vuoto dà `rent-differs` come oggi R34 (rilievo minore rimandato della Fase C): domanda 4.
- **Esempio (importi inventati):** `ctr-app-a` canone 1.600,00 + 150,00 € = 1.750,00 € da 2025-10;
  presenze di Anna Prova, Bruno Esempio, Carla Finta, Dario Inventato 350,00 + 30,00 € ciascuno e di
  Elena Fittizia 330,00 + 30,00 €: totale 1.880,00 € → `rent-differs` da 2025-10 a 2026-09 con atteso
  175000 e totale 188000. La presenza di Elena Fittizia collegata da 2025-09 → anche
  `tenancy-outside-contract`.
- `loadContractChecks(store, { asOf, apartmentId? })`: `inconsistent-store` se `checkConsistency` non è
  vuoto, altrimenti i controlli; non scrive mai. I controlli **non** entrano in `checkConsistency`, che
  bloccherebbe ogni scrittura.

**Incassi.** L'importo che gli incassi si aspettano ogni mese è `monthlyRent + monthlyForfait` della
presenza (R112): il confronto `rent-differs` è quindi già il confronto tra l'atteso degli incassi e il
canone del contratto, senza nessuna regola nuova. Confrontare invece i **versamenti ricevuti** con il
canone richiede di decidere quali pagamenti contano: resta fuori (domanda 5).

## Riga di comando

- `contratto --cartella <dir> --id <id> --appartamento <id> --tipo 1+1|3+2|4+4|altro --inizio <AAAA-MM>
  --fine <AAAA-MM> --conguaglio annuale|intero-contratto [--concordato] [--studenti] [--durata <mesi>]
  [--firmato <AAAA-MM-GG>] [--codice-registrazione <testo>] [--registrato <AAAA-MM-GG>]
  [--regime cedolare|ordinario] [--aliquota-cedolare <percentuale>] [--presenze <id,id>]
  [--caparre <id,id>]`: crea o aggiorna come `inquilino` (un'opzione assente toglie il campo).
  `--aliquota-cedolare` accetta `10` o `10,5` (al più due decimali, letti come interi: 1050 punti
  base) e solo con `--regime cedolare`. Uscita `{ status: 'saved'|'unchanged', contractId, operationId? }`.
- `contratto-canone --cartella <dir> --contratto <id> --dal <AAAA-MM> --canone <importo> --acconto
  <importo>` (importi con `parseEuro`). Uscita `{ status, contractId, operationId? }`.
- `contratti --cartella <dir> [--appartamento <id>] [--dettagli]`: di default per contratto `id`,
  `apartmentId`, `type`, `start`, `end`, `settlement`, `agreedRent`, `forStudents`, `taxRegime`,
  numero di presenze, di caparre e di voci del canone, e i controlli come `{ code, contractId, from?,
  to? }`; con `--dettagli` anche importi, storico, aliquota, firma, codice e data di registrazione,
  `tenancyId`, `paymentId`, `expected`, `actual`.
- `annulla-riconciliazione` accetta `contract.save` e `contract.rent`.
- Codici: 0 riuscito, 1 rifiutato (messaggi costanti), 2 argomenti non validi, 3 errore inatteso.

## Scritture, registro e annullamento

- Operazioni `contract.save`, `contract.rent`; `summary` costanti, senza importi, codici né nomi.
- Ogni scrittura rifiuta `inconsistent-store` senza scrivere; la stessa richiesta sullo stesso stato
  non scrive nulla.
- Annullare `contract.save` di un contratto nuovo lo cancella (`deleted`), di un aggiornamento rimette
  la `rev` di prima; annullare `contract.rent` toglie la voce. Il registro rifiuta l'annullamento di
  un'operazione con un'operazione successiva sullo stesso percorso (`has-dependents`), come sempre.
- Un contratto cancellato non dà più periodi a `settlementPeriods`/Excel: è il comportamento di oggi
  dei record cancellati (`loadAll` li salta).

## Domande per user1

Regole di calcolo o di fiducia non decise: non le decido io. Finché sono aperte il punto resta fuori o
dietro un rifiuto, indicato per ognuna. Per ognuna la mia raccomandazione e un esempio inventato.

Risposte di user1 del 16 novembre 2026 (piano 7-bis): domande 1-4 e 6-9 decise, scritte in grassetto
sotto ognuna; la domanda 5 resta aperta (fuori).

1. **Cedolare attesa (`cedolareExpected`).** La sezione 34 dice che nulla si calcola da solo e che le
   tasse le inserisce l'utente anno per anno; calcolarla è una regola nuova. Se la si vuole: su quale
   base (canone del contratto o affitti incassati; acconto spese escluso; mesi del contratto nell'anno
   solare), con quale arrotondamento, e solo come stima da confrontare in Tasse e stime? Raccomando:
   stima = somma dei `monthlyRent` (senza acconto) dei mesi del contratto nell'anno × aliquota, un solo
   arrotondamento al centesimo (metà in su), solo come proposta della stima di inizio anno da
   confermare. Esempio: canone 1.600,00 € da gennaio a settembre e 1.650,00 € da ottobre a dicembre,
   aliquota 10%: (14.400,00 + 4.950,00) × 10% = 1.935,00 €. **Decisa da user1 (R182):** la base è
   il totale degli affitti dell'appartamento nell'anno inserito a mano da user1 (record `rentYear`,
   comando `affitti-anno`), non il canone del contratto né i versamenti; aliquota quella del
   contratto (`cedolareRateBp`); `cedolareExpected` con un solo arrotondamento al centesimo (metà
   in su), solo stima mostrata da confermare, mai scritta come pagata.
2. **Fonte del controllo del conguaglio (R34).** `calcConguaglio` usa `Apartment.contrattoMensile`, un
   numero solo. Deve usare lo storico del contratto del mese, quando c'è? Raccomando: sì, contratto del
   mese se ha il canone, altrimenti `contrattoMensile`; poi `contrattoMensile` si toglie. Esempio:
   rinnovo da 1.750,00 a 1.800,00 € a ottobre: oggi l'avviso scatta per tutti i mesi dopo, con lo
   storico no. **Decisa da user1 (R180):** sì, contratto vivo del mese con il canone, altrimenti
   `contrattoMensile`, che per ora resta (si toglierà più avanti).
3. **Canone per contratto o per camera.** Il piano tiene il totale del contratto (come R4). Serve anche
   il canone per camera (sezione 26: «canone mensile della camera»)? Raccomando: per ora no; il canone
   per camera è già nella presenza (`monthlyRent`). **Decisa da user1:** no, solo il totale.
4. **Posto vuoto.** Un mese con un posto vuoto ha un totale minore del contratto e dà `rent-differs`
   (come R34). Deve tacere? Raccomando: no, è un avviso utile (il posto vuoto è a carico della
   proprietà, R1), ma mostrato come tale. Esempio: 4 presenze da 380,00 € su un contratto di 1.900,00 €
   → avviso con totale 1.520,00 €. **Decisa da user1:** l'avviso `rent-differs` resta com'è.
5. **Versamenti ricevuti contro canone.** Confrontare i `Payment` `canone` di un mese con il canone del
   contratto richiede di decidere quali contano (confermati, `forMonth`, di quali inquilini). Serve?
   Raccomando: no, gli arretrati (R117) lo coprono per inquilino. *Aperta: fuori.*
6. **Rinnovo annuale: un contratto o uno per anno.** Il piano tiene un solo record per i transitori
   rinnovati (`end` con le proroghe certe, R1 con `settlement: 'annuale'`) e il rinnovo come voce del
   canone. Va bene, o ogni rinnovo è un contratto nuovo con un nuovo codice? Esempio: Appartamento A
   2025-10 – 2027-09 con un rinnovo a 2026-10 in una voce del canone. **Decisa da user1:** un record,
   il rinnovo è una voce dello storico del canone.
7. **Cessione e subentro.** La sezione 26 vuole data e codice della registrazione della cessione
   separati da quelli del contratto. Un elenco `assignments` nel contratto o un record a parte con il
   piano del subentro? Raccomando: con il piano del subentro (sezione 17). **Decisa da user1:** non
   ora.
8. **Caparra attesa.** Controllare l'importo del `Payment` `caparra` contro la caparra del modulo
   (500 €, sezione 26) è una regola di controllo nuova. Raccomando: con la procedura del nuovo
   inquilino, dove l'importo è un parametro dell'appartamento. **Decisa da user1:** non ora.
9. **Contratti vivi sovrapposti.** Due contratti vivi dello stesso appartamento con mesi in comune
   (per esempio un rinnovo salvato come contratto nuovo senza accorciare il primo) danno due canoni
   per lo stesso mese e due confronti di R4. Serve un controllo `contract-overlap` in `contratti`?
   Raccomando: sì, solo come avviso. Esempio: Appartamento A 2025-10 – 2027-09 e 2026-10 – 2028-09 →
   avviso per 2026-10 – 2027-09. **Decisa da user1 (R181):** sì, avviso `contract-overlap` con i mesi
   in comune, in `contractChecks` e in `contratti`.

## Mie scelte (da controllare)

1. **Il record `contract` esistente si estende** (campi opzionali) invece di un record nuovo: è già il
   contratto per `settlementPeriods`, l'Excel e `Note`. Nessun `minAppVersion` nuovo: nessuna versione
   precedente dell'app scrive contratti, quindi nessuna riscrittura perde i campi nuovi.
2. **Mesi, non giorni**, per `start`/`end` (invariati); il giorno sta in `signedOn` e
   `registration.date`.
3. **Collegamento alle presenze** (`tenancyIds`), non agli inquilini: gli inquilini si ricavano dalle
   presenze, e un inquilino con due presenze in due contratti resta chiaro.
4. **Collegamenti rotti rifiutati in scrittura, date sbagliate no:** un `id` inesistente o di un altro
   appartamento è un errore di battitura; una data diversa è un fatto da segnalare.
5. **`unlinked-tenancy` solo dove l'appartamento usa i collegamenti**, per non dare un avviso per ogni
   presenza degli appartamenti in cui nessun contratto ne ha.
6. **`rent-differs` a intervalli** di mesi uguali e solo fino al mese di `asOf`.
7. **`monthlyAdvance` obbligatorio** in ogni voce (anche 0), perché R4 confronta canone + acconto.
8. **Aliquota in punti base** come i tassi legali (`interest.ts`), letta senza numeri decimali.
9. **Annullamento con `annulla-riconciliazione`**, come le operazioni IMU (R133-R135), invece di un
   comando nuovo.
10. **`agreedRent` e `forStudents` due campi** e non un solo tipo: un contratto per studenti può essere
    anche a canone concordato.

## Test (solo fixture sintetiche)

- `ContractSchema`: un contratto di oggi senza campi nuovi resta valido; storico non crescente, fuori
  dalle date o con importi non validi rifiutato; `cedolareRateBp` senza `cedolare` o fuori 1..10000
  rifiutato; ripetizioni in `tenancyIds`/`depositPaymentIds` rifiutate.
- `rentForMonth`: prima della prima voce `undefined`; il mese della voce e quelli dopo.
- `saveContract` e `setContractRent`: salvato, `unchanged` alla seconda volta (registro e archivio
  uguali byte per byte), ogni rifiuto senza scrittura, `rent` conservato da `saveContract`, annullamento.
- `contractChecks`: un caso per codice, l'esempio della sezione 3, ingresso mescolato → stesso
  risultato, mesi dopo `asOf` ignorati.
- Riga di comando: codici 0/1/2/3; senza `--dettagli` nessun importo, codice di registrazione né `id`
  di presenze o pagamenti (`scanText` vuoto); `annulla-riconciliazione` delle due operazioni.
- Conguaglio ed Excel della fixture invariati byte per byte (Review Focus).
- Tutto anche con `TZ=Pacific/Auckland` e `TZ=America/Los_Angeles`.

## Rischi

- **Presenze future assenti:** senza `asOf` ogni mese futuro darebbe un avviso; con `asOf` un mese
  passato senza presenze scritte resta un avviso finché le presenze non ci sono (corretto: R4).
- **Due fonti del canone** (`Apartment.contrattoMensile` e lo storico) possono dire cose diverse finché
  la domanda 2 è aperta.
- **Codice di registrazione** nell'uscita: solo con `--dettagli`; i test lo cercano esplicitamente.

## Non verificato

- Forma del codice identificativo dei contratti registrati e se user1 vuole conservarlo per intero.
- Se le presenze reali di user1 sono già scritte per tutti i mesi dei contratti in corso.

## Cosa resta fuori

- Cedolare attesa e ogni calcolo di tasse (domanda 1); imposta di registro, proroghe RLI, Scadenze e
  pagamenti, Tasse e stime, esportazione per il commercialista.
- Registrazione della cessione (domanda 7), caparra attesa (domanda 8), versamenti contro canone
  (domanda 5), cambio della fonte di R34 (domanda 2).
- Comando per scrivere le presenze; moduli; interfaccia e veste grafica.
