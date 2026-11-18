# Piano 19: chiudere i punti lasciati aperti dal piano 17 (disegno)

Stato: **implementato** (18 novembre 2026; domande in R332). Ramo `feat/piano-19-consumi-import`. R nuovi da R330.
Solo decisioni già prese da Carlo (R313, R315, R316, R307); nessuna regola nuova. Solo core e riga
di comando, niente schermate.

## 1. Allarme consumi nell'importazione e nel cruscotto (R313)

Decisioni di Carlo: media dei 12 mesi prima, per giorno; confronto per tipo di bolletta; soglie
uguali per tutti con eccezione per appartamento (`consumptionSettings`); livelli giallo/rosso solo
se le soglie li definiscono; nessun valore nel codice.

- `importBill` legge le soglie dell'appartamento (`consumptionThresholdsFor`) e confronta la
  bolletta **proposta** (`compareConsumption`, non `loadConsumption`, che vuole una bolletta già
  salvata). Solo bollette, non rate TARI. Il risultato porta `consumption` (il confronto e
  `thresholds: true|false`) per le bollette registrate o da rivedere.
- Un livello (giallo o rosso, su un lato o una metrica qualsiasi) diventa un controllo `warn`
  `consumption-alarm` della proposta, che quindi va «da rivedere» (come faceva il vecchio
  `consumption-anomaly`). Senza soglie: nessun controllo, nessun errore.
- Il vecchio controllo `consumption-anomaly` (percentuale sullo stesso periodo dell'anno prima,
  R262) resta solo se il chiamante dà la percentuale: `consumptionAnomalyPercent` diventa
  facoltativo; `bolletta --soglia-consumi` non è più obbligatoria. Non si converte in giallo/rosso:
  una percentuale sola non ha un livello.
- Cruscotto: per ogni appartamento vivo `consumptionThresholds` (`true` | `false`, «soglie non
  impostate» esplicito, non un conteggio perché i conteggi sono cose da fare) e, per ogni bolletta
  viva con un livello, `consumi:rosso` o `consumi:giallo` (il livello peggiore della bolletta).
  Revisione: conta solo l'ultima bolletta viva per appartamento e tipo (stato attuale, nessuna
  finestra di mesi). Note di credito (importo ≤ 0) e consumi a zero non si confrontano (R333).
- `bolletta` mostra `consumption` come `consumi`: `thresholds`, differenze in punti base e livelli;
  i lati (importi, quantità) solo con `--dettagli`.

**«Va bene così» (spec §21):** la spec lo prevede, il modello no (R265: non fatto). Non si
aggiunge: domanda.

## 2. PDF delle rate TARI (R315)

Limite reale, non una piccola estensione: `Instalment` non ha un percorso (servirebbe un campo e lo
schema), e per l'avviso comune di Berchet e Lovarini la spec (§20) dice che il PDF si **copia**
nell'altra cartella, mentre `moveFileNoOverwrite` sposta soltanto; l'annullamento dovrebbe togliere
anche la copia. Nessun codice: domanda.

## 3. Saldo tra conti, F24 misto (R307)

Nessun codice: la parte non IMU resta fuori dal saldo con l'avviso `mixed-f24-out` (test in
`balances.test.ts`). Domanda.

## 4. `pnpm estratti cruscotto`

Un test della riga di comando: stato delle soglie, periodo di conguaglio in corso (R316) e conteggi
`consumi:*`.

## Domande per Carlo (non decise nel codice)

1. Un livello **giallo** deve fermare la registrazione automatica (oggi: sì, come il rosso)? Vale
   anche per i cali.
2. «Va bene così» sugli avvisi dei consumi: record nuovo (per bolletta, metrica, lato?) e da quando
   l'avviso non conta più. Senza, i conteggi del cruscotto non si azzerano mai.
3. Cruscotto: basta l'ultima bolletta per appartamento e tipo (oggi)?
4. Il vecchio controllo `consumption-anomaly` con `--soglia-consumi` va tolto del tutto?
5. PDF delle rate TARI: dove vanno (`Rifiuti/`?), copia nell'altro appartamento per l'avviso comune
   e cosa fa l'annullamento della copia.
6. Come ripartire tra appartamenti la parte non IMU di un F24 misto (R307, oggi fuori dal saldo).
7. Come trattare note di credito e consumi a zero (oggi non confrontati, R333).
