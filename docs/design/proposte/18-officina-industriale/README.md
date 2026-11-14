# 18 · Officina

**L'idea in una frase:** l'app come un pannello di strumenti di casa, grigio caldo e opaco, dove
ogni appartamento è un modulo avvitato con il suo LED, gli importi si leggono su piccoli display e
c'è un solo tasto arancione da premere.

Ispirata al design industriale di prodotto: le calcolatrici e le radio Braun di Dieter Rams, i
sintetizzatori e i manuali di Teenage Engineering, l'essenzialità delle fotocamere Leica, i
pannelli di elettrodomestici e strumenti di misura. Etichette in maiuscoletto piccolo come quelle
serigrafate sopra i comandi, cifre monospaziate come su un display, tasti con uno spessore e
un'ombra sotto. Mascotte passiva micro: un **robottino-contatore**.

Schermate: `01-home.svg`, `02-conguaglio.svg`, `03-mobile.svg`, `04-stati.svg`.

## Marchi che mi ispirano e cosa NON copio

| Marchio / oggetto | Cosa prendo | Cosa NON copio |
| --- | --- | --- |
| Braun (Dieter Rams, Dietrich Lubs), calcolatrice ET66 | Un solo tasto colorato per il gesto che conta (l'«uguale» giallo); tutto il resto neutro; «meno, ma meglio». | Niente marchio, niente forma dei tasti tondi ET66, niente giallo (qui il colore d'azione è arancione). |
| Teenage Engineering (OP-1, siti e manuali) | Grigio chiaro, etichette in maiuscoletto minuscolo, numerazione dei moduli («Modulo 01»), arancione come colore d'azione, manuale con un capitolo per ogni tasto. | Nessun logo, nessun font proprietario, niente icone o grafiche dei loro display, niente nomi di prodotto. |
| Leica (M11) | Pochissimi comandi, menu corti, il rosso come segnale raro. | Niente punto rosso come logo, niente lettering. |
| Pannelli di elettrodomestici e strumenti di misura | Il LED di stato con forma propria, la finestrella del display incassata, le viti agli angoli, le barre a segmenti come livelli. | Niente finto metallo, niente texture fotografiche: solo forme piatte con un'ombra di 2 px. |

## Reference reali

| Reference | Cosa prendo |
| --- | --- |
| [Teenage Engineering, pagina dell'OP-1](https://teenage.engineering/products/op-1) | Grigio opaco, arancione come unico richiamo, etichette piccole in maiuscolo, display come cuore dell'oggetto. |
| [Manuale OP-1 (PDF ufficiale)](https://teenage.engineering/_img/676030a8ef599a28c8bc97cf_original.pdf) | Un capitolo per ogni comando: ogni modulo dell'app ha un nome e un numero, come una legenda. |
| [V&A, calcolatrice Braun ET66](https://collections.vam.ac.uk/item/O1360553) | Tasti neutri con un solo colore funzionale: da qui il tasto arancione unico e i tasti secondari chiari. |
| [Braun, «Colour choices – placing function above beauty»](https://www.braun-audio.com/en-ES/stories/design/braun-colour-choices/) | Il colore usato solo per una funzione (acceso/spento, risultato), mai per decorare: regola dei colori di stato. |
| [Cooper Hewitt, calcolatrice Braun ET55](https://collection.cooperhewitt.org/objects/35520977) | Tasti articolati e codificati con il colore per un uso intuitivo: tasti con spessore e bordo inferiore. |
| [Red Dot Forum, recensione Leica M11](https://www.reddotforum.com/content/2022/01/leica-m11-review-the-ultimate-digital-m/) e [PetaPixel](https://petapixel.com/2022/01/13/leica-m11-first-impressions-review/) | Menu ridotti all'osso, accesso rapido: barra laterale corta, un solo livello di schede. |
| [Automattic Design, «From flat to feel» (2025)](https://automattic.design/2025/07/01/from-flat-to-feel/) e [Lux, «Physicality: the new age of UI»](https://lux.camera/physicality-the-new-age-of-ui) | Il trend 2025-26 della fisicità dosata: un dettaglio tattile sui tasti chiave, il resto piatto. |
| [daisyUI, tendenze UI 2026: interfacce materiche e dimensionali](https://trends.daisyui.com/material-dimensional-ui/) | Superfici opache, una sola fonte di luce coerente (dall'alto), comandi che sembrano progettati e non decorati. |

## Palette (tema chiaro)

Contrasti calcolati con la formula WCAG 2.x.

| Token | Esadecimale | Ruolo | Contrasto |
| --- | --- | --- | --- |
| `color.housing` | `#E2DED6` | Sfondo, la «scocca» | — |
| `color.sidebar` | `#D8D3CA` | Barra laterale, barra in basso del telefono | ink 11,7:1 |
| `color.module` | `#F4F2ED` | Moduli (card) e pannelli | ink 15,6:1 |
| `color.display` | `#E6E8DF` | Finestrelle dei display (incassate) | ink 14,1:1 |
| `color.edge` / `color.deep` | `#C7C1B6` / `#B3AC9F` | Bordo dei moduli, ombra di 2 px sotto | decorativo |
| `color.ink` | `#1B1A17` | Testo principale, cifre | 15,6:1 su modulo |
| `color.ink-muted` | `#4A463F` | Etichette maiuscolette, metadati | 8,4:1 su modulo, 7,6:1 su display |
| `color.action` | `#FF6A1F` (bordo `#C2470E`) | **Solo** il tasto principale; etichetta in `ink` | ink su arancione 6,1:1 |
| `color.ok` | `#165C36` | In regola, saldato (cerchio con spunta) | 7,2:1 su modulo |
| `color.todo` | `#174A8F` | Da fare, da pagare, parziale (rombo, mezzo cerchio) | 7,8:1 |
| `color.late` | `#9A1D16` | Scaduto, errore (quadrato con ×) | 7,3:1 |
| `color.refund` | `#5B3A8C` | Da rimborsare (triangolo verso sinistra) | 7,7:1 |

**L'attenzione non è gialla.** Il giallo/arancio è del tasto d'azione, quindi «da fare» è un
**rombo blu cobalto** (il colore dei LED blu «in attesa» degli strumenti). Rosso solo per lo
scaduto e gli errori; il pulsante principale non coincide con nessun colore di stato.

**Tema scuro** (progettato, non invertito; in `04-stati.svg`): scocca `#1A1A18`, modulo
`#262522`, display `#1C1D1A`, ink `#ECE9E2` (12,6:1), muted `#B8B3A9` (7,3:1), azione `#FF7A33`
con etichetta scura (6,7:1), ok `#5BCB8F` (7,6:1), da fare `#8DB8FF` (7,6:1), scaduto `#FF968A`
(7,3:1), rimborso `#C3A6F2`. I moduli nel buio hanno un bordo `#3A3833` al posto dell'ombra.

## Tipografia

- **Inter** (SIL Open Font License) per tutto il testo: 15-16 px il corpo, 600 per le righe e
  i tasti, 700 per titoli e nomi degli appartamenti. Etichette in **maiuscoletto finto** (maiuscolo
  12 px, peso 600, spaziatura +1,2 px) come le serigrafie sopra i comandi.
- **IBM Plex Mono** (SIL Open Font License) per gli importi, le date e gli orari: cifre a larghezza
  fissa come su un display. Nelle anteprime PNG il Plex non era installato e si vede il fallback
  Menlo: con il Plex vero gli spazi attorno a «€» sono più stretti.
- Nessun serif. Scala (px): 11-12 etichette · 13-14 metadati · 15-16 corpo · 17-18 tasti ·
  24 nome appartamento · 26-30 cifre nei display · 32 titolo scheda · 40 saluto.

## Forme, spaziatura, icone, movimento

- **Griglia** a 8 pt; barra laterale 240 px; contenuto da 272 a 1408 px; tre moduli da 360 px
  con canale di 28 px.
- **Moduli:** raggio 10 px, bordo 1 px, «ombra» piena di 2 px sotto (nessuna sfocatura grande),
  quattro viti di 7 px agli angoli. Il nome del modulo è numerato («Modulo 01 · 5 posti»).
- **Display:** rettangolo incassato (gradiente interno del 7 % in alto), cifre monospaziate a
  destra, etichetta maiuscoletta in alto a sinistra. Usato per saldi, totali, date, orari e
  contatori (il «3» di Da rivedere, il «4» delle cose da fare).
- **Tasti:** il primario è arancione con bordo inferiore di 3 px più scuro (sembra sporgere);
  i secondari sono chiari con lo stesso spessore; la scheda o il filtro attivo è un tasto
  **premuto** nero (spessore 1 px). Alla pressione il tasto scende di 2 px.
- **Indicatori LED** (forma + colore + testo, sempre insieme): cerchio con spunta = in regola /
  saldato; rombo con «!» = da fare / da pagare; mezzo cerchio = parziale; triangolo verso
  sinistra = da rimborsare; quadrato con × = scaduto / errore. Ogni LED ha un alone del 13 % del
  suo colore. Nessuna forma è condivisa da due stati diversi.
- **Barre a segmenti** come livelli: posti in regola (pieni o vuoti), affitti pagati (12 su 13),
  avanzamento della lettura dell'estratto conto, conto alla rovescia dell'«Annulla».
- **Icone:** tratto 1,6 px, angoli arrotondati, geometria semplice (casa, vassoio, griglia,
  calendario, frecce, percentuale, ingranaggio).
- **Movimento:** 120 ms per la pressione dei tasti, 160 ms per aprire i blocchi; il LED «da
  fare» non lampeggia (l'ansia non serve). Con «riduci movimento» tutto è istantaneo.

## Scheda della mascotte: il robottino-contatore

- **Forma:** un rettangolo 24 × 32 unità con angoli di 3,5, bordo `ink` 1,4; una «faccia» che è un
  display scuro 15 × 9; un'antenna con pallino; un tastino e una griglia d'altoparlante; due
  piedini. Niente occhi, niente bocca: l'espressione è il display, quindi resta sempre neutra.
- **Dove compare:** solo (1) attesa ed elaborazione («Sto leggendo l'estratto conto…», 24 px),
  (2) stati vuoti («Niente da rivedere.», 96 px dentro un display), (3) icona dell'app e
  intestazione (24-36 px). Mai in tabelle, righe di elenco o vicino agli importi; al massimo una
  per schermata.
- **Fotogrammi (attesa):** quattro, 200 ms ciascuno, in ciclo: una cella accesa che scorre da
  sinistra a destra (1, 2, 3) e poi tutte e tre accese (4). Stato vuoto: il display mostra uno
  «0». A riposo (icona): una linea orizzontale.
- **Realizzazione:** 12 forme SVG; l'animazione cambia solo l'opacità di tre rettangoli con
  `@keyframes` CSS (`steps(1)`), nessun illustratore.
- **Come si spegne:** Impostazioni → «Mascotte» (interruttore). Spenta: restano il testo e la
  barra di avanzamento a segmenti; lo stato vuoto mostra solo la frase. Con «riduci movimento» il
  display resta fermo sul fotogramma 4.

## Come rispetta i principi di usabilità (sezione 15)

- **Un pulsante principale:** l'arancione esiste solo su «Rivedi (3)», «Prepara il messaggio» e,
  negli stati, «Scegli un altro file». Tutto il resto è tasto chiaro o testo.
- **Semafori leggibili anche per i daltonici:** forma diversa per ogni stato + parola in
  maiuscoletto («TUTTO A POSTO», «2 COSE DA FARE», «1 SCADENZA PASSATA») + colore. In bianco e
  nero cerchio, rombo e quadrato restano distinti.
- **Cosa fare dopo:** ogni riga delle cose da fare ha il suo tasto con un verbo («Controlla»,
  «Apri»); la scaduta è in cima. Nessun tasto «Paga»: l'app registra e verifica.
- **Confermare e annullare:** la conferma è una barra scura con «Annulla» e un conto alla
  rovescia a segmenti (Ctrl Z funziona per tutto il tempo).
- **Linguaggio semplice:** errori che dicono cosa fare («Scarica dalla banca il file PDF o CSV»).

## Pro, contro e rischi

**Pro**
- Carattere forte ma calmo: sembra un oggetto ben fatto, non una dashboard; regge l'uso
  settimanale perché i colori sono pochissimi.
- I display rendono gli importi la cosa più leggibile della pagina; le cifre monospaziate si
  allineano nelle tabelle senza sforzo.
- Facile in CSS: bordi, un'ombra piena, un gradiente interno. Rende uguale su Mac e Windows.
- La mascotte è piccola e meccanica: non può «piangere» per un inquilino che non paga.

**Contro**
- Le viti e i tasti con spessore, se moltiplicati, diventano decorazione: servono regole (viti
  solo sui moduli grandi, mai nelle righe; spessore solo sui tasti).
- Il maiuscoletto 11-12 px è affascinante ma meno leggibile: non deve mai portare da solo
  un'informazione indispensabile (lo stato ha sempre anche la forma).
- Il blu per «da fare» è insolito: chi si aspetta il giallo dei semafori deve impararlo una volta.

**Rischi**
- Su Windows a 125 % l'ombra di 2 px e il bordo `#C7C1B6` potrebbero risultare deboli: provare
  con `#BDB6A9`.
- Il monospaziato allarga gli importi: nel caso peggiore (€ 12.345,67) il display di una card
  deve restare largo almeno 260 px.
- Il riferimento a marchi molto riconoscibili rischia l'effetto «omaggio»: tenere lontani i loro
  colori esatti, le forme dei tasti e i caratteri.

## Traduzione in token (piano 4)

```json
{
  "color": {
    "housing": "#E2DED6", "sidebar": "#D8D3CA", "module": "#F4F2ED", "display": "#E6E8DF",
    "edge": "#C7C1B6", "deep": "#B3AC9F", "line": "#D3CEC4",
    "ink": "#1B1A17", "ink-muted": "#4A463F",
    "action": "#FF6A1F", "action-edge": "#C2470E", "on-action": "#1B1A17",
    "key": "#FBFAF7",
    "status": { "ok": "#165C36", "todo": "#174A8F", "late": "#9A1D16", "refund": "#5B3A8C" },
    "dark": {
      "housing": "#1A1A18", "module": "#262522", "display": "#1C1D1A", "edge": "#3A3833",
      "ink": "#ECE9E2", "ink-muted": "#B8B3A9", "action": "#FF7A33",
      "status": { "ok": "#5BCB8F", "todo": "#8DB8FF", "late": "#FF968A", "refund": "#C3A6F2" }
    }
  },
  "font": {
    "ui": "Inter, 'Helvetica Neue', Arial, sans-serif",
    "display": "'IBM Plex Mono', Menlo, Consolas, monospace",
    "label": { "size": 12, "weight": 600, "tracking": 1.2, "transform": "uppercase" },
    "size": { "xs": 11, "sm": 13, "body": 15, "body-lg": 16, "key": 17, "h3": 24, "figure": 30, "h2": 32, "h1": 40 }
  },
  "space": { "unit": 8, "gutter": 28, "sidebar": 240, "content-x": 272 },
  "radius": { "module": 10, "display": 6, "key": 7, "pill": 14 },
  "elevation": { "module": "0 2px 0 deep", "key": "0 3px 0 edge", "key-pressed": "0 1px 0 edge" },
  "status-marker": {
    "ok": "circle+check", "todo": "diamond+!", "partial": "half-circle",
    "refund": "triangle-left", "late": "square+x"
  },
  "mascot": { "size": [16, 24, 48, 96], "frames": 4, "frame-ms": 200, "default": "on", "reduced-motion": "frame-4" },
  "motion": { "press": "120ms ease-out", "open": "160ms ease-out", "reduced": "0ms" }
}
```

In Tauri: variabili CSS in un unico file; un componente `Led` (stato → forma, colore, parola),
un `Display` (etichetta + cifra monospaziata), un `Key` (primario, secondario, premuto) e un
`Robot` (fotogramma o animazione, disattivabile).
