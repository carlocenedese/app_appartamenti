# 11 · Casa chiara

**L'idea in una frase:** l'app sembra un'app di sistema del Mac: tanto bianco, elenchi raggruppati
dentro riquadri arrotondati, card degli appartamenti come widget, il vetro solo sui comandi che
galleggiano, e un anello luminoso che respira mentre l'app lavora.

Schermate: `01-home.svg`, `02-conguaglio.svg`, `03-mobile.svg`, `04-stati.svg`.

## Marchi che ispirano e cosa NON copio

- **Apple, app di sistema (Impostazioni, Casa, Wallet, Promemoria) e Human Interface Guidelines
  2025-2026.** Prendo: elenchi raggruppati «inset», titoli grandi, widget arrotondati, simboli a
  tratto uniforme, un solo colore d'azione (blu), il vetro solo sullo strato dei comandi.
- **Non copio:** nessun logo né mela, nessun nome di marchio nell'interfaccia, nessun font
  proprietario (niente SF Pro: uso Inter), nessun simbolo SF originale (i 25 simboli sono
  disegnati da zero su griglia 24 con tratto 1,6 px), nessuna icona colorata alla «Impostazioni»
  (i colori sono riservati agli stati), niente sfondo a tutta pagina in vetro, niente
  «bordo luminoso» a schermo intero: l'anello è piccolo e solo in attesa o conferma.

## Reference reali

| Reference | Cosa prendo |
| --- | --- |
| [Apple HIG, Materials (Liquid Glass e materiali standard)](https://developer.apple.com/design/human-interface-guidelines/materials) | Il vetro per lo strato di comandi e navigazione, mai per il contenuto; più spesso e opaco dove c'è testo fine. Da qui la regola «vetro solo su barre e controlli flottanti». |
| [Liquid Glass (Wikipedia)](https://en.wikipedia.org/wiki/Liquid_Glass) e [WWDC25, «Meet Liquid Glass»](https://developer.apple.com/videos/play/wwdc2025/219/) | La gerarchia: i controlli galleggiano sopra il contenuto in capsule; bordo chiaro in alto, ombra morbida. |
| [Nielsen Norman Group sul vetro di iOS 26, riassunto da anderegg.ca](https://anderegg.ca/2025/10/12/nielsen-norman-group-on-ios-26-usability) e [la critica su uxdesign.cc](https://uxdesign.cc/did-apple-abandoned-its-own-design-heuristics-accessibility-principles-2d616ed7ace5) | Cosa evitare: vetro sotto il testo, controlli che cambiano forma, contrasto basso. Il nostro vetro è all'86 % di opacità e non sta mai sopra tabelle o importi. |
| [SwiftUI `InsetGroupedListStyle` (documentazione Apple)](https://developer.apple.com/documentation/swiftui/insetgroupedliststyle) e [Sarun W., «Inset grouped List»](https://sarunw.com/tips/inset-grouped-in-swiftui/) | Lo schema delle liste: sfondo grigio chiaro, gruppi bianchi con raggio 16, separatori che partono dopo l'icona, chevron grigia a destra. |
| [SF Symbols, Apple](https://developer.apple.com/sf-symbols/) | Il metodo, non i disegni: tratto uniforme, simboli allineati all'altezza delle maiuscole, stesso peso del testo vicino. |
| [MacStories, l'app Casa in iOS 16 e Ventura](https://www.macstories.net/stories/everything-new-coming-to-the-home-app-in-ios-16-and-macos-ventura/) | Le card come tessere rettangolari arrotondate, con stato e cifra chiave, una per stanza: qui una per appartamento. |
| [MacRumors, Siri a forma di orb in iOS 27](https://www.macrumors.com/2026/06/16/iphone-18-could-make-siri-a-circle/) e [9to5Mac sul bagliore di Apple Intelligence](https://9to5mac.com/2024/11/03/new-apple-intelligence-siri-looks-different-works-the-same/) | L'idea di una luce sfumata (blu, viola, rosa, arancio) che dice «sto lavorando». La riduco a un anello di 20-80 px. |
| [Inter, rsms.me](https://rsms.me/inter/) e [repository con licenza OFL](https://github.com/rsms/inter) | Il font da sistema libero, con cifre tabellari e asse ottico. |

## Palette

Il blu è solo azione e link. I colori di stato non compaiono mai sul pulsante principale. Ogni
stato ha **due** valori: uno più acceso per riempire la forma (oggetto grafico, almeno 3:1) e uno
scuro per il testo (almeno 7:1 su bianco).

| Token | Esadecimale | Ruolo | Contrasto |
| --- | --- | --- | --- |
| `color.bg` | `#F5F5F7` | Sfondo della finestra (grigio raggruppato) | — |
| `color.surface` | `#FFFFFF` | Gruppi, card, dialoghi | — |
| `color.ink` | `#1D1D1F` | Testo principale | 16,8:1 su bianco, 15,5:1 su sfondo |
| `color.ink-2` | `#636366` | Etichette, metadati | 6,0:1 su bianco, 5,5:1 su sfondo |
| `color.separator` | `#E5E5EA` | Separatori | decorativo |
| `color.fill` | `#EEF0F5` | Tile delle icone, segmented, badge | — |
| `color.primary` | `#0066CC` | Pulsante principale, link, selezione | bianco su blu 5,6:1; blu su bianco 5,6:1 |
| `status.ok.text` / `.fill` | `#11602A` / `#248A3D` | In regola, saldato | testo 7,7:1 |
| `status.todo.text` / `.fill` | `#7A4200` / `#C76A00` | Da fare, da pagare, parziale | testo 8,1:1; forma 3,8:1 |
| `status.late.text` / `.fill` | `#A3201A` / `#D70015` | Scaduto, errore | testo 7,6:1; forma 5,4:1 |
| `status.refund.text` / `.fill` | `#5B33A8` / `#7D4FD6` | Da rimborsare | testo 8,5:1; forma 5,3:1 |
| `orb.gradient` | `#3D7BFF → #8B5CF6 → #F25CA2 → #FF9F43` | Solo l'anello | decorativo |

**Tema scuro (progettato):** sfondo `#000000`, superfici `#1C1C1E` con filetto bianco all'8 %,
testo `#F5F5F7` (15,6:1), secondario `#AEAEB2` (7,7:1), primario `#0A6CDB` con testo bianco
(5,0:1), stati schiariti per il testo: verde `#30D158` (8,4:1), arancio `#FFB340` (9,5:1),
rosso `#FF8A84` (7,5:1), viola `#C5A3FF` (8,2:1). Il vetro scuro è `#3A3A3E` all'80 %.

## Tipografia

- **Inter** (SIL Open Font License 1.1), incorporato nell'app Tauri: rende uguale su Mac e
  Windows. Fallback `'Helvetica Neue', Arial, sans-serif`. Cifre tabellari (`tnum`) per ogni
  importo. Nessun serif.
- Pesi: 400 testo, 500 righe, 600 etichette e cifre, 700 titoli.
- Scala (px): 12 note e intestazioni di colonna · 13 metadati · 14 righe dense · 15 corpo · 16
  stato nelle card e pulsanti · 17 titoli di gruppo · 20 nomi degli appartamenti e titoli di
  sezione · 22-24 cifre chiave · 34 titolo grande della pagina (spaziatura -0,3).

## Forme, spaziatura, icone

- **Griglia 8 pt.** Barra laterale flottante 244 px; contenuto da 300 a 1404 px; card in tre
  colonne da 352 px con canali da 24.
- **Raggi:** 22 widget e pannelli, 16 gruppi di lista, 10 righe selezionate, capsule per pulsanti
  e controlli. **Profondità:** due ombre lievissime (1 px al 6 % + 24 px al 6 %), niente bordi.
- **Vetro, con misura:** solo barra laterale, barra degli strumenti (selettore
  «Appartamento · Annualità», ricerca Ctrl K, sincronizzazione e utente), avviso con Annulla e
  barra a schede del telefono. Bianco all'86-74 %, bordo chiaro in alto, ombra 10 px. Mai dietro
  tabelle, importi o paragrafi. Con «riduci trasparenza» diventa bianco pieno.
- **Simboli:** 25 simboli lineari disegnati per l'app (casa, vassoio, edificio, calendario,
  frecce, documento, percentuale, ingranaggio, lente, chevron, nuvola con spunta, fulmine, fiamma,
  goccia, wi-fi, cestino, info, aereo di carta, persona). Tratto 1,6 px a 20 px, estremità tonde.
- **Forme di stato, tutte diverse:** in regola / saldato = cerchio pieno con spunta; da fare =
  quadrato arrotondato con «!»; scaduto = triangolo con «!»; da pagare = rombo con «€»; parziale =
  esagono pieno a metà; da rimborsare = capsula con freccia indietro. Sempre affiancate da testo.
  «In regola» per posto: puntini pieni verdi; il posto non in regola è un anello rosso vuoto.

## Scheda della mascotte passiva: l'anello

- **Forma:** un anello con gradiente blu → viola → rosa → arancio e un alone sfocato. Due
  cerchi SVG (uno sfocato sotto), nessuna illustrazione.
- **Dove compare:** icona dell'app nella barra laterale (18 px, ferma); attesa
  («Sto leggendo l'estratto conto…», «Sto calcolando il conguaglio…», 56-60 px); conferma riuscita
  nell'avviso con Annulla (20 px, con spunta); stato vuoto di «Da rivedere» (80 px, con spunta).
  Mai in tabelle, righe di elenco o vicino agli importi; al massimo uno per schermata.
- **Emozione:** nessuna. Respira e basta; non cambia colore per un inquilino in ritardo.
- **Fotogrammi** (in `04-stati.svg`): 1 espira (alone 30 %, raggio 27) → 2 inspira (alone 65 %,
  raggio 30, gradiente ruotato di 110°) → 3 gira (arco aperto, 220°) → 4 fine: l'anello si chiude
  e disegna la spunta in 300 ms. Ciclo 2,4 s ease-in-out, solo `transform`, `opacity` e
  `stroke-dashoffset` in CSS.
- **Come si spegne:** Impostazioni → Aspetto → «Anello animato» (acceso di default, perché è
  discreto). Spento, o con «riduci movimento» del sistema: anello fermo e la frase si aggiorna
  (es. «64 movimenti letti su circa 90»).

## Movimento

Transizioni da 200 ms con molla leggera (stile sistema) per aprire i blocchi del conguaglio e per
i fogli; l'avviso con Annulla entra dal basso e resta 6 secondi. Con «riduci movimento» tutto
diventa una dissolvenza di 100 ms.

## Usabilità (sezione 15 della specifica)

- **Un solo pulsante principale**, blu pieno a capsula: «Rivedi (3)» in Home, «Prepara il
  messaggio» nel conguaglio, «Scegli un altro file» nell'errore. Il resto è testo blu o grigio.
- **Semafori leggibili senza colore:** forma diversa per ogni stato + frase («Tutto a posto»,
  «2 cose da fare», «1 scadenza passata»). Il testo di stato piccolo è a 7:1 o più.
- **Linguaggio semplice e onesto:** «Prepara il messaggio» con sotto «Lo rileggi tu prima di
  mandarlo»; nessun «Paga»: la rata è «In scadenza», non «da pagare con l'app».
- **Conferma e annulla:** avviso con «Annulla» per 6 secondi, poi «Annulla» resta in
  «Operazioni recenti» e funziona Ctrl Z.
- **Errori che dicono cosa fare:** «Il file non sembra un estratto conto» spiega cosa manca e
  propone il passo successivo.

## Pro, contro e rischi

**Pro**
- Familiare per chi usa Mac e iPhone: nessun manuale, le liste si leggono come Impostazioni.
- Molto bianco e poche ombre: regge anni senza stancare; tabelle e importi restano protagonisti.
- Economica in token: un solo font, un blu, quattro stati, due ombre.
- L'anello dà calore senza mascotte e si spegne in un colpo.

**Contro**
- Su Windows può sembrare «un'app Mac portata male»; i semafori di sistema (pallini grigi in alto
  a sinistra) vanno sostituiti con i controlli finestra di Windows.
- Il vetro su Windows non ha lo stesso sfondo da sfocare: si riduce a bianco quasi pieno, quindi
  meglio progettarlo come bianco con bordo chiaro e lasciare la sfocatura come extra su Mac.
- Rischio «già visto»: è vicina allo stile di sistema, meno riconoscibile delle 01 o 10.

**Rischi**
- Il gradiente dell'anello sotto i 16 px diventa un cerchio grigiastro: nell'icona della barra
  laterale tenerlo a 18 px con tratto 3.
- Esagono (parziale) e rombo (da pagare) vanno provati a 16 px sul PC di Nicola a 125 %.
- Il viola di «da rimborsare» può ricordare il blu delle azioni a chi vede meno i colori: la
  capsula con freccia indietro e la parola fanno il lavoro.

## Token per il piano 4

```json
{
  "color": {
    "bg": "#F5F5F7", "surface": "#FFFFFF", "ink": "#1D1D1F", "ink-2": "#636366",
    "separator": "#E5E5EA", "fill": "#EEF0F5", "primary": "#0066CC", "on-primary": "#FFFFFF",
    "status": {
      "ok":     { "text": "#11602A", "fill": "#248A3D", "shape": "circle-check" },
      "todo":   { "text": "#7A4200", "fill": "#C76A00", "shape": "rounded-square-bang" },
      "late":   { "text": "#A3201A", "fill": "#D70015", "shape": "triangle-bang" },
      "pay":    { "text": "#7A4200", "fill": "#C76A00", "shape": "diamond-euro" },
      "part":   { "text": "#7A4200", "fill": "#C76A00", "shape": "hexagon-half" },
      "refund": { "text": "#5B33A8", "fill": "#7D4FD6", "shape": "capsule-arrow" }
    },
    "dark": { "bg": "#000000", "surface": "#1C1C1E", "ink": "#F5F5F7", "ink-2": "#AEAEB2",
              "primary": "#0A6CDB", "ok": "#30D158", "todo": "#FFB340", "late": "#FF8A84", "refund": "#C5A3FF" },
    "orb": ["#3D7BFF", "#8B5CF6", "#F25CA2", "#FF9F43"]
  },
  "glass": { "fill": "rgba(255,255,255,0.86)", "blur": "24px", "edge": "1px rgba(255,255,255,1)",
             "shadow": "0 6px 20px rgba(0,0,0,0.10)", "reduced-transparency": "#FFFFFF",
             "allowed-on": ["sidebar", "toolbar", "toast", "tabbar"] },
  "font": { "family": "Inter, 'Helvetica Neue', Arial, sans-serif", "numeric": "tabular-nums",
            "size": { "xs": 12, "sm": 13, "row": 14, "body": 15, "lead": 16, "group": 17, "h3": 20, "figure": 24, "title": 34 },
            "weight": { "regular": 400, "medium": 500, "semibold": 600, "bold": 700 } },
  "radius": { "widget": 22, "group": 16, "row": 10, "tile": 8, "capsule": 999 },
  "shadow": { "card": "0 1px 2px rgba(0,0,0,.06), 0 8px 24px rgba(0,0,0,.06)" },
  "space": { "unit": 8, "gutter": 24, "sidebar": 244, "row": 64, "row-dense": 52 },
  "icon": { "size": 20, "stroke": 1.6, "grid": 24 },
  "motion": { "base": "200ms spring(1, 100, 15)", "toast": "6s", "orb-cycle": "2400ms ease-in-out", "reduced": "100ms fade" }
}
```

In Tauri: variabili CSS in un solo file; il vetro è `backdrop-filter: blur(24px)` con fallback
bianco pieno; un componente `StatusMark` lega forma, colore e frase, così non esiste un colore di
stato senza la sua forma; un componente `Orb` (SVG + CSS) legge `prefers-reduced-motion` e
l'impostazione «Anello animato».
