# Piano 2b-1: OCR per le scansioni e le foto (disegno)

Stato: **bozza in attesa dell'approvazione di Carlo** (13 novembre 2026). Specifica di riferimento: `docs/spec.md` (sezioni 7, 8, 16, 22, 28, 40); piano 2a (`docs/plans/2026-11-11-piano-2a-lettura-pdf.md`) per la pipeline di lettura. Il piano 2b si divide in tre piani indipendenti: **2b-1 OCR e foto** (questo), **2b-2 PDF con più documenti**, **2b-3 condominio** (due tempi: prima il piano rate, poi preventivo e rendiconto con un campione dei tre amministratori). I disegni di 2b-2 e 2b-3 vengono dopo.

## Perché

39 PDF reali non hanno testo (19 a Pulci, 20 a Berchet), e l'acqua scansionata continua ad arrivare, in qualche caso come foto JPEG. Oggi questi file restano `senza-testo` e si compilano a mano. Le Enel 2020-21 di Pulci hanno glifi rotti (`(cid:…)`) e vanno disegnate come immagine.

## Decisioni di Carlo (13 novembre 2026)

1. **Motore: Tesseract incorporato** (tesserocr con pypdfium2 e i dati italiani), non l'OCR del sistema operativo.
2. **Librerie native fuori dall'elenco licenze** (Leptonica e simili): sì, **dopo un inventario**. Le accettabili vanno in `python/THIRD_PARTY.md` e in `CLAUDE.md`; macOS 15 diventa il minimo. Se l'inventario trova una GPL, AGPL o LGPL, si ferma tutto e si chiede a Carlo.
3. **Anche foto e immagini**: JPEG e PNG entrano come le scansioni.
4. **Condominio in due tempi** (vale per il 2b-3).

## Obiettivi

1. Quando un PDF non ha testo (o il testo è rotto), `read_pdf` disegna la pagina e legge le parole con le coordinate, producendo gli stessi `Line` e `Word` di oggi, così profili e ancore funzionano senza cambiare.
2. Il risultato dichiara la fonte del testo (`textSource: 'pdf' | 'ocr'`); con `ocr` la confidenza di ogni campo non supera `medium` e lo stato è sempre `da-confermare` (sezione 7: la scansione va sempre in revisione). Se l'OCR non è affidabile il campo resta vuoto.
3. JPEG e PNG entrano dalla stessa strada.
4. Risultato ripetibile: stesso file, stesso risultato (un solo thread, nessuna casualità).
5. Profili per le bollette dell'acqua scansionate e rapporto sui 39 PDF reali con soli conteggi, più un campione controllato da Carlo.

## Non obiettivi

- Niente PDF con più documenti (2b-2) né condominio (2b-3).
- Niente OCR nel core TypeScript: resta nel programma Python incorporato.
- Niente rete, niente orologio in Python (regole del pacchetto).
- Niente correzione dell'inclinazione o dei difetti di foto oltre a quello che dà il motore.

## Vincoli

- Python 3.13, solo dipendenze con versione esatta e hash, pubblicate da almeno due settimane. Licenze dell'elenco di `CLAUDE.md`; le eccezioni solo per le librerie native dentro le ruote, previo inventario (decisione 2).
- Versioni di riferimento trovate dalla ricognizione (da riverificare quando si fissano): tesserocr 2.12.0 (MIT, 22 ottobre 2026; la 2.13.0 è troppo recente), pypdfium2 5.14.0 (BSD-3-Clause o Apache-2.0, 4 ottobre 2026; la 5.15.2 è troppo recente), `ita.traineddata` di tessdata_fast (Apache-2.0).
- Peso stimato, ruote compresse: circa +30 MB su Windows, +10 MB su macOS arm64 (decompresso forse il doppio, non verificato).
- Una immagine o una scansione dà sempre una risposta con il suo `status`, mai un'eccezione, mai un valore inventato. Il testo letto dall'OCR non va mai nei messaggi di errore.
- Nessun PDF reale e nessun dato personale nel repository: le fixture sono sintetiche (pagine disegnate con testo inventato) o anonimizzate.

## Approcci considerati

- **Tesseract incorporato (scelto).** Un solo motore, uguale su Mac e Windows, in Python.
- **OCR del sistema operativo** (Apple Vision, `Windows.Media.Ocr`): nessun peso in più ma due motori con risultati diversi, codice in Rust o Swift fuori dal pacchetto Python, e l'italiano può mancare su Windows. Scartato da Carlo.
- **Python puro o ONNX (`rapidocr`)**: porta Pillow (MIT-CMU, fuori elenco) e altre dipendenze. Scartato.
- **Nessun OCR**: costo zero, tutto a mano. Scartato da Carlo.

## Disegno

- Un modulo Python `ocr` dietro `read_pdf`: quando `has_text` è falso (o il testo contiene `(cid:…)` oltre una soglia), pypdfium2 disegna ogni pagina e tesserocr restituisce le parole con riquadro; le coordinate si convertono nel sistema delle pagine di testo.
- I dati della lingua (`ita.traineddata`) sono una risorsa dell'installer scaricata con controllo sha256 da `scripts/bundle-python.mjs` (stesso meccanismo dell'interprete); il programma passa il percorso dei dati al motore.
- `ExtractionResult.textSource` in Zod e Python, con il limite `medium` e lo stato forzato a `da-confermare`.
- Ingresso immagini: JPEG e PNG riconosciuti dall'estensione e dai primi byte; passano dal motore come una pagina sola.
- Test: pagine sintetiche con testo noto (importi e date inventati) dall'immagine alla lettura; la stessa pagina dà lo stesso risultato due volte; rapporto sui PDF reali solo con conteggi (stile `python/tools/pdf_report.py`).
- Prove in CI sui tre sistemi e prova di avvio dall'installer macOS e Windows.

## Lasciato al costruttore

Quale soglia di glifi rotti fa scattare l'OCR; la risoluzione di disegno delle pagine (punti per pollice); il nome esatto delle risorse.

## Non verificato nella ricognizione (da fare nel primo task)

Elenco e licenze delle librerie native dentro le ruote (FreeType, libjpeg, libpng, libtiff, Leptonica); dimensioni dopo la decompressione; che l'italiano si legga bene sulle foto reali; il minimo macOS 15.

## Aperto con Carlo

Nessuna domanda aperta; la decisione sulla licenza dipende dall'esito dell'inventario (task 1).
