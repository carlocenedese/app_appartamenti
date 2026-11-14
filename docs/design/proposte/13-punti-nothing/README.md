# 13 · Punti

**L'idea in una frase:** un cruscotto chiaro e monocromo, fatto come un piccolo display a LED.
I numeri importanti si accendono a matrice di punti, tutto il resto è un grottesco pulito e
calmo. Il rosso compare solo quando qualcosa è scaduto.

Schermate: `01-home.svg`, `02-conguaglio.svg`, `03-mobile.svg`, `04-stati.svg` (vuoto, attesa con
la mascotte in 4 fotogrammi, conferma con annulla, errore, Home nel tema scuro).

## Marchi che ispirano e cosa NON copio

| Ispirazione | Cosa prendo | Cosa NON copio |
| --- | --- | --- |
| Nothing (Phone, Nothing OS, widget) | Il bianco e nero, la matrice di punti usata solo per pochi accenti, i widget arrotondati come «oggetti», la griglia di punti come texture, un solo colore di segnale | Nessun logo, nessun nome, niente font Ndot o NType (sono proprietari). Il loro rosso fa da accento decorativo, qui invece il rosso vuol dire solo «scaduto». Niente tema scuro come tema principale. |
| Teenage Engineering (OP-1 field, OP-XY) | Il tono da strumento industriale: etichette maiuscole piccole, interruttori netti, il «perché» di ogni elemento | Nessuna forma di prodotto, nessun nome, nessuna icona loro |
| Braun / Dieter Rams | Pochi elementi, gerarchia data dal peso e non dal colore | Niente citazioni di prodotto |

## Reference reali

| Reference | Cosa prendo |
| --- | --- |
| [Nothing OS 5.0: punti ridotti agli accenti, carattere Geist, base monocroma (Android Authority)](https://www.androidauthority.com/nothing-os-5-0-3702682/) | La regola principale della proposta: la matrice di punti si usa solo dove dà carattere (saluto, cifre chiave, date, mascotte) e mai dove toglie leggibilità (testo corrente, tabelle). |
| [Nothing OS, prime versioni: widget e matrice di punti (9to5Google)](https://9to5google.com/2022/07/15/nothing-os/) | I widget-card con un solo dato grande e un'etichetta piccola: le card degli appartamenti e i quattro riquadri di riepilogo del Conguaglio. |
| [Glyph Matrix del Phone (3): le notifiche come pixel art (Design Milk)](https://design-milk.com/the-nothing-phone-3s-glyph-matrix-turns-notifications-into-pixel-art/) | L'idea di una piccola griglia di LED che «vive»: è l'origine della mascotte 9 × 9 che si anima soltanto durante l'attesa. |
| [Doto su Google Fonts (OFL, Óliver Lalan)](https://fonts.google.com/specimen/Doto/about) e [Fontsource](https://fontsource.org/fonts/doto/about) | Il carattere a punti libero, variabile, con l'asse di arrotondamento ROND, che prende il posto di Ndot. |
| [OP-1 field (Wallpaper*)](https://www.wallpaper.com/technology/teenage-engineering-op-1-field-review) e [Teenage Engineering: i limiti come estetica (Blake Crosley)](https://blakecrosley.com/de/guides/design/teenage-engineering) | Etichette maiuscole spaziate, interruttore della mascotte netto, interfaccia ridotta al necessario. |
| [Tubik, trend UI: layout «grezzi e schematici», struttura visibile](https://blog.tubikstudio.com/?p=17271) | La griglia di punti a vista sullo sfondo e i filetti punteggiati al posto delle linee piene. |
| [Bubble, Web Design Trends 2026](https://bubble.io/blog/web-design-trends/) | Il trend «barely-there»: niente ombre, le superfici sono distinte solo da un filetto. |
| [Matrix Sans (OFL, 5 × 7)](https://friedorange.github.io/MatrixSans) | Una seconda opzione libera, più rigida, se Doto risultasse troppo morbido. |

## Palette

Una base in bianco e nero. Verde e ambra compaiono solo dentro i simboli di stato, mai come testo
o come riempimento grande. Il rosso è l'unico colore «forte» ed è riservato allo scaduto.

| Token | Chiaro | Scuro | Ruolo | Contrasto (chiaro / scuro) |
| --- | --- | --- | --- | --- |
| `bg` | `#F3F3F1` | `#0B0B0B` | Sfondo con griglia di punti | — |
| `surface` | `#FFFFFF` | `#161616` | Card e widget | — |
| `line` | `#DCDCD8` | `#2C2C2A` | Filetti, bordi | decorativo |
| `dot-off` | `#E6E6E2` | `#262624` | Punti «spenti» del display | decorativo |
| `ink` | `#111111` | `#F3F3F1` | Testo, cifre, simboli dei conguagli | 18,9:1 su surface · 17,0:1 su bg / 16,3:1 |
| `ink-muted` | `#5C5C58` | `#A3A39E` | Etichette, metadati | 6,7:1 su surface · 6,0:1 su bg / 7,1:1 |
| `primary` | `#111111` (testo bianco) | `#F3F3F1` (testo nero) | Pulsante principale, pillola piena | 18,9:1 / 17,7:1 |
| `success` | `#1E7A46` | `#4FC47F` | Solo il simbolo «in regola» | 5,4:1 / 8,2:1 (grafico) |
| `warning` | `#9A6400` | `#E8A93A` | Solo il simbolo «da fare» | 5,0:1 / 8,8:1 (grafico) |
| `late` | `#D71921` | `#FF5A5F` | Simbolo e posto «scaduto» | 5,2:1 / 5,9:1 (grafico) |
| `late-text` | `#A50F1A` | `#FF8A8D` | Testo piccolo «scaduto» | **7,8:1** / **8,0:1** |

Le frasi di stato («Tutto a posto», «1 scadenza passata») sono in `ink`, quindi superano 7:1 anche a
13-15 px. Il pulsante principale è **nero pieno** nel tema chiaro e **bianco pieno** nel tema scuro:
non è mai un colore di stato.

## Tipografia (solo font liberi)

- **Doto** (OFL 1.1, Google Fonts), peso 700, ROND alto: per il saluto, i nomi di appartamento
  nelle intestazioni, le cifre chiave (saldi, totali del conguaglio) e le date grandi sul
  telefono. Corpi: 20, 28, 35 px. Mai sotto i 20 px e mai nelle tabelle.
  *Nota sulle anteprime:* negli SVG la matrice è disegnata come cerchi su una griglia 5 × 7 (così si
  vede anche senza il font installato). Nell'app è testo vero in Doto, selezionabile e leggibile
  dagli screen reader.
- **Inter** (OFL 1.1), con cifre tabellari (`tnum`), per tutto il resto. Scala: 11 (etichette
  maiuscole, spaziatura 1,4) · 12-13 (metadati) · 14-15 (corpo, righe) · 16 (pulsante, frasi) ·
  17-18 (titoli di card) · 22 (nome appartamento). Pesi 450, 600, 650.
  Alternativa: **Geist** (OFL, lo stesso grottesco adottato da Nothing OS 5): da provare a 125 %
  su Windows prima di sceglierla.
- Nessun serif, quindi la regola «serif solo da 24 px in su» è rispettata per costruzione.

## Forme, spaziatura, icone, movimento

- **Griglia 8 pt.** Barra laterale 248 px, contenuto da 288 a 1392 px (1104 px = 3 card da 352 px
  e canali da 24 px, oppure 4 riquadri da 258 px).
- **Widget:** card bianche con raggio 24, filetto da 1 px e nessuna ombra. I riquadri piccoli hanno
  raggio 20, i pulsanti e i selettori sono pillole.
- **Display a punti:** dietro ogni saldo c'è una striscia 7 × 61 di punti spenti, e la cifra si
  «accende» sopra. È l'unico effetto decorativo delle card.
- **Filetti punteggiati** (`stroke-dasharray: 0 6`, estremità tonde) tra le righe; un filetto pieno
  nero solo sotto le intestazioni delle tabelle e sopra il totale.
- **Trasparenze industriali:** la barra superiore e la barra delle schede del telefono sono
  traslucide all'86-90 % sopra la griglia di punti.
- **Stati semaforo** (forma, poi colore, poi testo): in regola = cerchio con spunta (verde) · da fare
  = triangolo con «!» (ambra) · scaduto = quadrato con «!» (rosso). I posti in regola sono pallini
  neri e il posto scaduto è un quadratino rosso.
- **Stati del conguaglio** (monocromi, tutti di forma diversa): saldato = cerchio pieno con spunta
  · parziale = cerchio pieno a metà · da pagare = anello vuoto · da rimborsare = rombo con freccia.
  Nessuno è un quadrato, quindi non si confondono con lo scaduto.
- **Errore:** riquadro con bordo punteggiato e «?» a punti, in inchiostro e non in rosso.
- **Icone:** tratto da 1,6-1,8 px, terminazioni tonde. La sincronizzazione è un anello di 8 punti
  che ruota a scatti mentre sincronizza.
- **Movimento:** 120-180 ms, ease-out. Le cifre che cambiano si «riaccendono» punto per punto in
  240 ms. Nel toast di conferma 6 punti si spengono uno al secondo: si vede quanto tempo resta per
  annullare. Con «riduci movimento» tutto è istantaneo e i punti diventano un testo «6 s».

## Scheda della mascotte: «Nove»

- **Forma:** un fantasmino 9 × 9 punti, disegnato solo con il contorno (cupola, fianchi, quattro
  piedini) e due occhi pieni di 1 × 2 punti. Non ha bocca, quindi è sempre neutra o attenta.
  L'interno è fatto di punti spenti. È in inchiostro, mai rossa né verde.
- **Dimensioni:** 32 px come icona dell'app (barra laterale, telefono), 29 px nella riga di attesa,
  72 px nello stato vuoto.
- **Dove compare:** icona dell'app; stato vuoto («Niente da rivedere»); attesa («Sto leggendo
  l'estratto conto…»). Al massimo una per schermata (l'icona conta). Mai nelle tabelle, nelle
  righe o vicino agli importi. Nella conferma e nell'errore non c'è, per evitare emozioni sui soldi.
- **Animazione di attesa** (4 fotogrammi da 280 ms, in ciclo; vedi `04-stati.svg`):
  1 occhi in alto → 2 occhi a metà → 3 occhi in basso (sta «leggendo» le righe) → 4 battito di
  ciglia (occhi di un solo punto). All'avvio dell'app può ricomporsi una volta: i punti del
  contorno si accendono in ordine casuale in 400 ms.
- **Realizzazione:** 81 cerchi SVG; i fotogrammi cambiano solo gli occhi (4 cerchi), quindi bastano
  CSS `steps()` oppure 4 simboli `<use>`. Non serve un illustratore.
- **Come si spegne:** Impostazioni › Aspetto › «Mascotte» (interruttore, acceso di default ma spento
  in un clic). Da spenta resta l'anello di punti della sincronizzazione e l'icona diventa un
  quadrato 3 × 3 di punti. Con «riduci movimento» resta ferma sul fotogramma 1.

## Come rispetta i principi di usabilità

- **Un solo pulsante principale:** l'unica pillola piena della schermata, nera («Rivedi (3)»,
  «Prepara il messaggio»). Sotto c'è una riga che dice cosa succede: «Prepara il testo per i 5
  inquilini: lo invii tu». Nessuna promessa di pagare o inviare.
- **Semafori leggibili per i daltonici:** tre forme diverse più una frase. Stampata in bianco e nero,
  la Home si capisce ancora.
- **Cosa fare dopo:** ogni cosa da fare finisce con un verbo («Prepara sollecito», «Controlla»,
  «Apri»), con lo scaduto in cima.
- **Conferma e annulla:** il toast «Bolletta confermata · Annulla» resta 6 secondi e il tempo
  rimasto si vede.
- **Linguaggio semplice:** le cifre a punti hanno sempre sotto un'etichetta in italiano («Saldo di
  cassa», «da Marco T. e Sofia B.»).

## Pro, contro e rischi

**Pro**
- È riconoscibile al primo sguardo, ma il 90 % della schermata è un'interfaccia monocroma sobria,
  vicina alla 02 che piace a Carlo.
- Il rosso ha un solo significato: si nota subito che Pulci ha un problema.
- Pochi token, nessuna immagine; la mascotte è geometria pura.

**Contro**
- Le cifre a punti si leggono più lentamente di quelle piene: per questo sono solo nelle cifre
  chiave, e le tabelle restano in Inter.
- Il riferimento a Nothing è evidente: tra qualche anno può sembrare «di moda» più che senza tempo.
- Verde e ambra piccoli dentro un mondo monocromo possono sembrare un compromesso.

**Rischi**
- Doto a 125 % su Windows: i punti possono impastarsi sotto i 20 px. Va provato sul PC di Nicola.
- La griglia di punti dello sfondo su monitor economici può sfarfallare (moiré): da tenere
  disattivabile o al 50 %.
- Se qualcuno usa il rosso per un errore o per un pulsante, la regola si rompe: serve un controllo
  nei componenti (il rosso esiste solo dentro `StatusMark` con lo stato `late`).

## Token per il piano 4

```json
{
  "color": {
    "light": { "bg": "#F3F3F1", "surface": "#FFFFFF", "line": "#DCDCD8", "dot-off": "#E6E6E2",
               "ink": "#111111", "ink-muted": "#5C5C58", "primary": "#111111", "on-primary": "#FFFFFF",
               "status": { "ok": "#1E7A46", "todo": "#9A6400", "late": "#D71921", "late-text": "#A50F1A" } },
    "dark":  { "bg": "#0B0B0B", "surface": "#161616", "line": "#2C2C2A", "dot-off": "#262624",
               "ink": "#F3F3F1", "ink-muted": "#A3A39E", "primary": "#F3F3F1", "on-primary": "#0B0B0B",
               "status": { "ok": "#4FC47F", "todo": "#E8A93A", "late": "#FF5A5F", "late-text": "#FF8A8D" } }
  },
  "font": {
    "dot": "Doto, monospace", "dot-weight": 700, "dot-sizes": [20, 28, 35],
    "body": "Inter, 'Helvetica Neue', Arial, sans-serif", "numeric": "tabular-nums",
    "size": { "label": 11, "meta": 13, "body": 15, "lead": 16, "card-title": 18, "apt": 22 }
  },
  "space": { "unit": 8, "gutter": 24, "sidebar": 248, "content-x": 288 },
  "radius": { "card": 24, "tile": 20, "pill": 999 },
  "border": { "card": "1px solid line", "row": "2px dotted line (dasharray 0 6)" },
  "shadow": "none",
  "status-mark": { "ok": "circle+check", "todo": "triangle+!", "late": "square+!",
                   "saldato": "disc+check", "parziale": "half-disc", "da-pagare": "ring", "da-rimborsare": "diamond+arrow" },
  "mascot": { "grid": 9, "frames": 4, "frame-ms": 280, "sizes": [29, 32, 72], "setting": "appearance.mascot" },
  "motion": { "fast": "120ms ease-out", "base": "180ms ease-out", "digits": "240ms steps(7)", "reduced": "0ms" }
}
```

Componenti: `DotNumber` (Doto con la striscia di punti spenti), `Widget`, `StatusMark` (forma,
colore e frase inseparabili), `DotRule`, `Mascot` (rispetta l'impostazione e «riduci movimento»),
`UndoToast` (6 punti per il conto alla rovescia).
