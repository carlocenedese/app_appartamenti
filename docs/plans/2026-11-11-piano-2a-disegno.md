# Piano 2a: lettura delle bollette in PDF di testo — disegno

Disegno approvato a voce da Carlo l'11 novembre 2026, da rileggere prima di scrivere il piano con i
task. La specifica (`docs/spec.md`, sezioni 7, 8, 22, 30, 32 e 42) resta l'autorità: qui si
scelgono solo i dettagli che la specifica lascia aperti.

## Scopo

Dato il PDF di una bolletta, proporre un record con importo, periodo, scadenza, numero, data di
emissione e consumo, e dire quanto ognuno di questi campi è sicuro. La schermata «Da rivedere» che
li mostra è del piano 4; qui nasce solo ciò che quella schermata leggerà.

Criterio di successo: una bolletta registrata è corretta oppure segnalata come dubbia, mai
sbagliata senza avviso. Un campo che non si legge in modo affidabile resta vuoto: nessun valore
inventato (sezione 22).

## Ambito

- **Piano 2a (questo):** PDF con testo, per i fornitori che oggi hanno i tre appartamenti (luce,
  gas, internet e avvisi TARI, compresa la TARI condivisa tra Berchet e Lovarini).
- **Piano 2b (dopo):** scansioni con OCR (acqua), condominio (tabella di ripartizione), PDF con più
  documenti.
- **Un PDF senza testo** non produce campi: risposta `senza-testo`, da compilare a mano. Le
  scansioni vanno sempre in revisione manuale, anche quando l'OCR arriverà.
- **Fuori ambito:** interfaccia, spostamento e rinomina del file, osservazione della cartella
  `Da_smistare`, sincronizzazione.

## Decisioni di architettura

1. **Python come programma a riga di comando, un PDF per volta** (approccio A, scelto da Carlo).
   L'app lo lancia, riceve un JSON su stdout e il programma termina. Niente servizio sempre acceso,
   nessuna porta di rete (sezione 28), un PDF guasto non ferma gli altri.
2. **I profili sono record JSON**, come gli altri, nella cartella dei dati condivisa
   (`_app/dati/profili-fornitore/<id>.json`, con `id`, `v`, `rev`, `deleted`). Lo schema vive nel
   core TypeScript ed è esportato in `docs/schemas/`; Python valida profili e risultati sugli stessi
   schemi, così i due lati non possono divergere.
3. **Il core resta puro.** Python estrae; il core TypeScript confronta, controlla e decide. Nessun
   orologio e nessun generatore di `id` dentro i due lati: arrivano come argomenti.
4. **Python incorporato nell'installer** come interprete autonomo (*python-build-standalone*) più
   le librerie, senza programmi che congelano il codice. Motivo: PyInstaller ha licenza GPL con
   un'eccezione, e il progetto vieta la GPL (sezione 40). Librerie previste: pdfplumber e
   pdfminer.six (MIT), jsonschema (MIT). Il controllo delle licenze copre anche i pacchetti Python.

## Componenti

| Pezzo | Dove | Cosa fa |
| --- | --- | --- |
| Estrattore | `python/bollette_pdf/` | Legge il testo con le coordinate, riconosce il fornitore con i profili, estrae i campi, valida e stampa il risultato |
| Costruttore di profili | stesso pacchetto | Da un PDF di esempio e da un testo selezionato produce un profilo (la schermata col mouse è del piano 4) |
| Schemi | `packages/core` | `SupplierProfile` e `ExtractionResult`, esportati in JSON Schema |
| Proposta | `packages/core` | Trasforma un `ExtractionResult` in una bolletta o rata TARI proposta, con i controlli automatici |
| Politica di conferma | `packages/core` | Decide se una proposta si registra da sola o va in revisione (sezione 22, scelta a) |
| Profili dei fornitori | `fixtures/` e dati dell'utente | Profili di Hera, Enel, Fastweb e TARI, senza codici cliente |

## Contratto del programma Python

Comando: `python -I -m bollette_pdf extract --pdf <file> --profiles <cartella> --at <data-ora ISO>`.
Uscita (stdout, un solo documento JSON, UTF-8; gli errori vanno su stderr con codice 2):

- `status`: `riconosciuta` | `da-confermare` | `non-riconosciuta` | `senza-testo`;
- `profileId` e `profileRev` del profilo scelto (o `null`), `fileHash` (SHA-256 del file);
- `kind` (`bill` o `tari`) e `category`;
- `fields`: per ogni campo (`supplier`, `number`, `issueDate`, `dueDate`, `periodStart`,
  `periodEnd`, `amount`, `consumption`) il valore, la `confidence` e l'origine (pagina, riquadro e
  testo letto). Gli importi sono centesimi interi, le date `YYYY-MM-DD`;
- `checks`: controlli fatti dall'estrattore (per esempio totale uguale alla somma delle voci), con
  esito e messaggio;
- `warnings`: avvisi che non cambiano lo stato.

`confidence` ha tre valori: `high` (una sola corrispondenza e controlli superati), `medium` (più
corrispondenze o un controllo dubbio) e `missing` (nessun valore). L'interfaccia li mostra come
verde, giallo e rosso, sempre con un testo o un'icona.

## Profili

Un profilo dice come riconoscere un fornitore (parole chiave, codice cliente, POD o PDR, indirizzo
di fornitura) e dove trovare ogni campo: un'etichetta di ancoraggio, la posizione rispetto
all'etichetta (a destra, sotto, sulla stessa riga), un'espressione regolare, il tipo (importo, data,
periodo, testo) e se il campo è obbligatorio. Ha una data di inizio validità (sezione 22): se il
layout cambia nasce un profilo nuovo e il vecchio resta per i PDF vecchi. Per la TARI condivisa tra
Berchet e Lovarini il profilo dichiara le utenze dell'avviso, che alimentano `splitSharedDebit` e
`tariNote` del piano 1.

I profili nel repository non contengono codici cliente, POD, PDR o indirizzi: riconoscono per
parole chiave. I codici dell'utente stanno nei suoi dati, fuori dal repository.

## Controlli e conferma (core)

- Controlli: numero già presente; totale uguale alla somma delle voci; periodo coerente con le
  permanenze; importo e consumo confrontati con lo storico dello stesso periodo (allarme consumi
  anomali); appartamento coerente con l'indirizzo di fornitura.
- Conferma: la prima volta di un layout serve la conferma e nasce il profilo; poi una bolletta che
  supera tutti i controlli si registra da sola come «registrata automaticamente», con Annulla.
  Il comportamento si può cambiare per fornitore («conferma sempre»).
- Registrazione e annullamento passano dal registro delle operazioni del piano 1 (`registerBill`,
  `journal`).

## Prove e dati

- Nessun PDF reale nel repository, mai. Si committano testi estratti con le coordinate,
  anonimizzati con `tools/anonymise.py`, e PDF sintetici generati da uno script.
- I profili dei fornitori si provano sui PDF reali sul posto (cartelle Bollette di Dropbox, sola
  lettura, nessuna copia). Il risultato è un rapporto con i soli conteggi per fornitore: letti con
  tutti i campi sicuri, con dubbi, non riconosciuti. Niente dati personali nei log.
- Un test del core avvia davvero il programma Python su PDF sintetici, in CI su Ubuntu, Windows e
  macOS; un controllo di fumo verifica che l'interprete incorporato parta dall'installer su Windows.
- Stessi vincoli del piano 1: tre fusi orari, copertura minima del 90 % su `packages/core/src`,
  lint e tipi puliti, licenze verdi.

## Rischi e punti aperti

- **Layout che cambiano:** è il rischio principale; lo gestiscono la data di inizio validità e il
  ritorno in revisione quando un controllo fallisce.
- **Dimensione dell'installer:** l'interprete incorporato aggiunge dai 30 ai 60 MB, da misurare.
- **Cifre e date italiane:** `1.234,56`, mesi in lettere, anni a due cifre; coperti da test con
  Decimal, mai con numeri decimali.
- **Windows:** percorsi con spazi e accenti (NFC), codifica dell'output (UTF-8 esplicito).
- **Decisione rinviata al piano 2b:** quale libreria per l'OCR e come incorporare Tesseract.
