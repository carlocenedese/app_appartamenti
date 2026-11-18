# Piano 2b-1: OCR per le scansioni e le foto (disegno)

Stato: **approvato da user1 il 13 novembre 2026**, comprese le «Mie scelte». Specifica di riferimento: `docs/spec.md` (sezioni 7, 8, 16, 22, 28, 40); piano 2a (`docs/plans/2026-11-11-piano-2a-lettura-pdf.md`) per la pipeline di lettura. Il piano 2b si divide in tre piani indipendenti: **2b-1 OCR e foto** (questo), **2b-2 PDF con più documenti**, **2b-3 condominio** (due tempi: prima il piano rate, poi preventivo e rendiconto con un campione dei tre amministratori). I disegni di 2b-2 e 2b-3 vengono dopo.

## Perché

39 PDF reali non hanno testo (19 a Appartamento C, 20 a Appartamento A), e l'acqua scansionata continua ad arrivare, in qualche caso come foto JPEG. Oggi questi file restano `senza-testo` e si compilano a mano. Le Enel 2020-21 di Appartamento C hanno glifi rotti (`(cid:…)`) e vanno disegnate come immagine.

## Decisioni di user1 (13 novembre 2026)

1. **Motore: Tesseract incorporato** (tesserocr con pypdfium2 e i dati italiani), non l'OCR del sistema operativo.
2. **Librerie native fuori dall'elenco licenze** (Leptonica e simili): sì, **dopo un inventario**. Le accettabili vanno in `python/THIRD_PARTY.md` e in `CLAUDE.md`; macOS 15 diventa il minimo. Se l'inventario trova una GPL, AGPL o LGPL, si ferma tutto e si chiede a user1.
3. **Anche foto e immagini**: JPEG e PNG entrano come le scansioni.
4. **Condominio in due tempi** (vale per il 2b-3).

## Obiettivi

1. Quando un PDF non ha testo (o il testo è rotto), `read_pdf` disegna la pagina e legge le parole con le coordinate, producendo gli stessi `Line` e `Word` di oggi, così profili e ancore funzionano senza cambiare.
2. Il risultato dichiara la fonte del testo (`textSource: 'pdf' | 'ocr'`); con `ocr` la confidenza di ogni campo non supera `medium` e lo stato è sempre `da-confermare` (sezione 7: la scansione va sempre in revisione). Se l'OCR non è affidabile il campo resta vuoto.
3. JPEG e PNG entrano dalla stessa strada.
4. Risultato ripetibile: stesso file, stesso risultato (un solo thread, nessuna casualità).
5. Profili per le bollette dell'acqua scansionate e rapporto sui 39 PDF reali con soli conteggi, più un campione controllato da user1.

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
- **OCR del sistema operativo** (Apple Vision, `Windows.Media.Ocr`): nessun peso in più ma due motori con risultati diversi, codice in Rust o Swift fuori dal pacchetto Python, e l'italiano può mancare su Windows. Scartato da user1.
- **Python puro o ONNX (`rapidocr`)**: porta Pillow (MIT-CMU, fuori elenco) e altre dipendenze. Scartato.
- **Nessun OCR**: costo zero, tutto a mano. Scartato da user1.

## Disegno

- Un modulo Python `ocr` dietro `read_pdf`: quando `has_text` è falso (o il testo contiene `(cid:…)` oltre una soglia), pypdfium2 disegna ogni pagina e tesserocr restituisce le parole con riquadro; le coordinate si convertono nel sistema delle pagine di testo.
- I dati della lingua (`ita.traineddata`) sono una risorsa dell'installer scaricata con controllo sha256 da `scripts/bundle-python.mjs` (stesso meccanismo dell'interprete); il programma passa il percorso dei dati al motore.
- `ExtractionResult.textSource` in Zod e Python, con il limite `medium` e lo stato forzato a `da-confermare`.
- Ingresso immagini: JPEG e PNG riconosciuti dall'estensione e dai primi byte; passano dal motore come una pagina sola.
- Test: pagine sintetiche con testo noto (importi e date inventati) dall'immagine alla lettura; la stessa pagina dà lo stesso risultato due volte; rapporto sui PDF reali solo con conteggi (stile `python/tools/pdf_report.py`).
- Prove in CI sui tre sistemi e prova di avvio dall'installer macOS e Windows.

## Mie scelte dopo la lettura di un revisore (da controllare)

Un revisore indipendente ha trovato questi punti; li decido io, user1 può correggerli.

1. **Piattaforme.** **Aggiornato il 13 novembre 2026 dopo l'inventario del Task 1:** solo macOS (arm64 e x64); **Windows senza OCR per ora**, perché la ruota Windows di tesserocr contiene due DLL LGPL-2.1 (decisione di user1: prima macOS, Windows dopo). Linux non è un obiettivo di distribuzione (resta nella CI solo per i test). Dove manca la ruota o l'OCR, quel sistema dà lo stato esplicito `senza-testo` con avviso, mai una compilazione da sorgente e mai uno stop dell'installer.
2. **Licenze delle librerie native.** Si accettano e si registrano in `THIRD_PARTY.md` e `CLAUDE.md` solo licenze permissive in stile BSD, FTL (scegliendo l'opzione FTL della doppia licenza di FreeType), IJG, libpng, libtiff, Zlib. MPL, GPL, AGPL, LGPL o una licenza che non si riesce a identificare fermano il lavoro e si chiede a user1.
3. **Testo misto.** L'OCR gira pagina per pagina solo sulle pagine senza testo (o con glifi rotti oltre la soglia). `textSource` è per documento: `'pdf'`, `'ocr'` o `'mixed'`; se il 2b-2 avrà bisogno della fonte per pagina si aggiunge allora.
4. **Confidenza.** Con `textSource` diverso da `'pdf'` ogni campo letto da pagine OCR ha confidenza al massimo `medium`, anche se perfetto. Un campo resta vuoto quando il valore non passa il suo riconoscitore (`parse_euro`, date, ecc.) oppure quando la confidenza media delle parole del testo che lo contiene è sotto una soglia; la soglia è del costruttore (parte da 70 su 100) e si scrive come regola in `docs/progress.md`.
5. **Profili dell'acqua scansionata.** Si scrivono contro fixture sintetiche con il layout dei profili già noti; la messa a punto sui PDF reali la fa user1 con i soli conteggi e un campione di dieci. Il rapporto sui 39 PDF è informativo; il criterio di successo è quello già usato (campione a mano senza errori su importo, scadenza e numero).
6. **Immagini.** Risoluzione presunta 300 punti per pollice (quella dell'EXIF se c'è); l'orientamento EXIF si applica (non la correzione dell'inclinazione); un'immagine oltre 30 megapixel o non leggibile dà `illeggibile`, mai un'eccezione.
7. **Limiti.** Al massimo 20 pagine per documento passano dall'OCR (parametro); le altre restano senza testo con un avviso e lo stato `da-confermare`. Il programma resta una chiamata sincrona per file; il tempo massimo lo tiene chi lo lancia.
8. **Dimensione e dati.** Va bene il peso stimato. `tessdata_fast` all'inizio; passare a `tessdata_best` (circa 6 MB in più) è la sostituzione di un file e si decide dopo il campione.
9. **Percorso dei dati e modalità `-I`.** Il percorso dei dati della lingua si passa come argomento al motore, senza variabili d'ambiente. I test che usano il motore reale partono solo se i dati ci sono (variabile `REQUIRE_OCR=1` in CI, come `REQUIRE_PYTHON`); gli altri usano un finto motore.

## Lasciato al costruttore

Quale soglia di glifi rotti fa scattare l'OCR; la risoluzione di disegno delle pagine (punti per pollice); il nome esatto delle risorse.

## Non verificato nella ricognizione (da fare nel primo task)

Elenco e licenze delle librerie native dentro le ruote (FreeType, libjpeg, libpng, libtiff, Leptonica); dimensioni dopo la decompressione; che l'italiano si legga bene sulle foto reali; il minimo macOS 15.

## Aperto con user1

Nessuna domanda aperta; la decisione sulla licenza dipende dall'esito dell'inventario (task 1).

## Seguito: parola da chiedere nell'app

Non si implementa ora (futuro piano dell'interfaccia). Quando una scansione non è riconosciuta da nessun profilo, l'app chiederà all'utente una parola distintiva del fornitore (o gli lascerà scegliere il fornitore tra quelli noti) e la aggiungerà come ancora al profilo, così le scansioni nuove dello stesso fornitore vengono riconosciute. Il campo c'è già (R90): `recognise.ocrAnyOf`, elenco opzionale di parole o frasi **del fornitore**, valido solo per i documenti letti per intero con l'OCR (`textSource` `ocr`), che il confronto normalizza come in R89; l'app dovrà solo aggiungervi la parola (stringa non vuota, con almeno una lettera o cifra una volta normalizzata, senza ripetizioni). I profili seed non ne hanno (R92, decisione di user1 del 14 novembre 2026): il campo serve solo a ciò che l'utente aggiunge dall'app.
