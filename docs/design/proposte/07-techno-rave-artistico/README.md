# 07 · Techno / Rave artistico — «BLT-2526»

**Idea in una frase:** l'app come un disco techno in edizione limitata. Nero profondo, un solo
accento acido `#CCFF00`, titoli cromati e stirati come su un flyer berlinese. Ogni appartamento è
una traccia del mixer e l'annualità è un pattern di 12 step. I numeri e le frasi restano in un
sans pulito e leggibile.

Schermate: `01-home.svg` (1440 × 900), `02-conguaglio.svg` (1440 × 900), `03-mobile.svg` (390 × 844).

---

## Reference reali

| #   | Reference                                                                                                                                                                                                                                         | Cosa prendo                                                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Vanja Golubovic, poster per Tresor Berlin, [It's Nice That](https://www.itsnicethat.com/articles/vanja-golubovic-techno-club-posters) e [Typeroom](https://typeroom.eu/content/techno-bold-dynamic-typographic-posters-vanja-golubovic-tresor)    | Un solo grottesco molto nero su fondo testurizzato. La tipografia fa da immagine. Il trucco dei giorni barrati diventa il pattern dei mesi: lo step acceso è un mese presente, quello tratteggiato un mese vuoto. |
| 2   | Eye Magazine, [«Systems of nightlife»](https://eyemagazine.com/blog/post/systems-of-nightlife)                                                                                                                                                    | L'identità del club come _sistema_ e non come singolo poster: griglia fissa, metadati ricorrenti, variazioni controllate. È ciò che serve a un'app usata ogni settimana.                                          |
| 3   | Red Bull Music Academy, [Three Decades of Berlin Club Flyers](https://daily.redbullmusicacademy.com/2018/09/three-decades-of-berlin-club-flyers)                                                                                                  | La fotocopia e il computer domestico: retino, dithering, scanline. Qui sono trame decorative a bassissima opacità, mai dietro al testo dei dati.                                                                  |
| 4   | AIGA Eye on Design, [Acid graphics are the new psychedelia](https://eyeondesign.aiga.org/acid-graphics-are-the-new-psychedelia-with-a-heady-dose-of-cynicism/) e [daisyUI trends: Acid graphics](https://trends.daisyui.com/trend/acid-graphics/) | Il titolo cromato (gradiente argento con la riga nera dell'orizzonte), le linee d'oscilloscopio, il viola UV come secondo colore. Il cromo resta un accento, come consigliano le guide ai trend.                  |
| 5   | Museum of Youth Culture, [The Design of Rave in Underground Flyers](https://museumofyouthculture.com/design-of-rave-in-underground-flyers) e [Alice Twemlow, «Smiley Faces»](https://alicetwemlow.com/smiley-faces/)                              | Detroit contro UK: il lato Detroit, scuro, tecnologico e monocromo, regge la struttura. Il lato acid house dà l'unico colore squillante.                                                                          |
| 6   | People's Graphic Design Archive, [tag «techno»](https://peoplesgdarchive.org/tag/1195/techno) e l'archivio su Are.na citato da [DJ Mag](https://djmag.com/content/classic-rave-artwork-18-awesome-images-amazing-archive)                         | Il catalogo-flyer: numeri di catalogo, «side A/B», giri al minuto e date in monospaziato. Diventano metadati decorativi come `BLT-2526`, `TRK 01` e `CH 03`.                                                      |
| 7   | Mixmag, [Ctrl Print vol. 2: vaporwave, acidgrafix, cybersigilism](https://mixmag.asia/feature/ctrl-print-vol-2-vaporwave-acidgrafix-cybersigilism) e [Made Good Designs, trend 2026](https://madegooddesigns.com/graphic-design-trends/)          | Conferma che nel 2025-2026 l'estetica rave e cromata è viva. Mi avvisa anche del rischio di «horror vacui», che qui evito: un solo elemento rumoroso per schermata.                                               |

---

## Palette

| Token              | Hex       | Ruolo                                                                           |
| ------------------ | --------- | ------------------------------------------------------------------------------- |
| `bg`               | `#0A0A0A` | sfondo (nero vinile)                                                            |
| `bg-deep`          | `#050505` | barra laterale                                                                  |
| `surface`          | `#161616` | card, tabelle                                                                   |
| `surface-2`        | `#1F1F1F` | riga evidenziata, blocco aperto, scheda attiva                                  |
| `line`             | `#2E2E2E` | bordi, divisori, tratteggio dei mesi vuoti                                      |
| `text`             | `#F2F2F2` | testo principale                                                                |
| `text-muted`       | `#A3A3A3` | testo secondario, etichette                                                     |
| `text-dim`         | `#6E6E6E` | **solo** metadati decorativi (cataloghi), mai informazione                      |
| `primary` / `acid` | `#CCFF00` | pulsante principale, voce attiva, step accesi, link d'azione                    |
| `on-primary`       | `#0A0A0A` | testo sul pulsante acido                                                        |
| `accent-uv`        | `#9D7BFF` | ombra del pulsante, oscilloscopio, avatar, importi da rimborsare                |
| `success`          | `#2EE59D` | «Tutto a posto», «Saldato» (menta, non acido, per non confondersi col primario) |
| `warning`          | `#FFB020` | «2 cose da fare», «Parziale»                                                    |
| `error`            | `#FF4D5E` | «Scadenza passata», saldo negativo                                              |

**Contrasto WCAG** (calcolato con la formula di luminanza relativa):

| Coppia                            | Rapporto      | Esito                             |
| --------------------------------- | ------------- | --------------------------------- |
| `text` su `bg`                    | 17,7 : 1      | AAA                               |
| `text` su `surface`               | 16,2 : 1      | AAA                               |
| `text-muted` su `bg` / `surface`  | 7,9 / 7,2 : 1 | AAA                               |
| `on-primary` su `acid` (pulsante) | 16,9 : 1      | AAA                               |
| `success` su `surface`            | 11,0 : 1      | AAA                               |
| `warning` su `surface`            | 9,9 : 1       | AAA                               |
| `error` su `surface`              | 5,6 : 1       | AA                                |
| `accent-uv` su `bg`               | 6,3 : 1       | AA                                |
| `text-dim` su `bg`                | 3,9 : 1       | solo decorativo (AA testo grande) |

## Tipografia (tutte con licenza libera, Google Fonts, SIL OFL)

- **Display: [Unbounded](https://fonts.google.com/specimen/Unbounded)** (Black 900). È largo e
  geometrico, un «extended» da flyer. Nelle schermate è stirato in verticale (scala 1,25-1,35),
  maiuscolo, con riempimento cromato solo per il titolo della pagina. Si usa solo per i titoli: saluto,
  nome dell'appartamento, titoli delle sezioni. Fallback: `Arial Black`. Le anteprime PNG sono rese
  col fallback, perché Unbounded non è installato.
- **Testo e importi: [Inter](https://fonts.google.com/specimen/Inter)** con `tabular-nums`. Lo uso
  per tutto ciò che si legge davvero: frasi, nomi, importi, stati.
- **Metadati: [JetBrains Mono](https://fonts.google.com/specimen/JetBrains+Mono)** maiuscolo con
  spaziatura +1,2/+2. Lo uso per numeri di catalogo, intestazioni di colonna, date compatte e
  scorciatoie (`Ctrl K`).

Scala (px): display 58 / 50 / 26 / 18 / 14 (mobile) · titolo 20 · corpo 16 / 15 / 14 · didascalia 13 / 12 ·
meta mono 11 / 10. Il corpo non scende mai sotto i 14 px per l'informazione. Mono 10-11 solo per le
etichette ripetute.

## Forme, spaziatura, icone, decorazioni, movimento

- **Griglia 8 pt.** Contenuto da x = 288 a 1392 (1104 px), gutter 24, card da 352 px, raggi 4-6 px:
  forme quasi squadrate, da hardware.
- **Pulsante principale:** rettangolo acido senza raggio, freccia, ombra piena UV spostata di 4 px.
  È l'unico elemento con ombra, quindi l'occhio ci va subito.
- **Mixer e sequencer:**
  - ogni card appartamento è una traccia (`TRK 01`), con il proprio catalogo (`BLT-2526`,
    `LOV-2526`, `PUL-2526`);
  - gli inquilini in regola sono un VU-meter a segmenti;
  - nel conguaglio i mesi di ogni inquilino sono un pattern di 12 step in tre gruppi da quattro.
    Il mese presente è acceso, il mese vuoto è tratteggiato e il primo step di ogni gruppo è più
    luminoso, come la battuta di una drum machine;
  - le tipologie di bolletta sono canali (`CH 01`-`CH 06`).
- **Semafori daltonici-safe:** colore, **forma** e **frase** insieme:
  - cerchio con spunta, «Tutto a posto» / «Saldato»;
  - triangolo con «!», «Cose da fare»;
  - quadrato con «×», «Scadenza passata»;
  - mezzo cerchio, «Parziale»;
  - cerchio vuoto, «Da pagare».
- **Icone:** lineari, tratto 1,6-2 px, terminazioni quadrate. Logo: un battito/onda nero su
  quadrato acido.
- **Texture:**
  - retino a punti acido o UV, sfumato con una maschera, solo nella fascia d'intestazione;
  - dithering a scacchiera al 7 % su tutto lo schermo, appena percettibile;
  - linee d'oscilloscopio nell'intestazione e nel blocco aperto.

  Mai dietro tabelle o importi.

- **Illustrazioni / mascotte:** nessuna mascotte. Il «personaggio» è l'oscilloscopio. In uno stato
  vuoto («Niente da fare») la linea diventa piatta con la scritta «Silenzio. Tutto a posto.».
- **Movimento (descritto):**
  - l'oscilloscopio scorre lento (8 s per ciclo) e si ferma con `prefers-reduced-motion`;
  - quando si apre un appartamento, gli step del pattern si accendono in sequenza da sinistra
    (30 ms per step, una «battuta»);
  - il pulsante principale, al passaggio del mouse, sposta l'ombra UV da 4 a 6 px;
  - alla conferma di un'azione compare un toast con «Annulla» e un breve lampo acido sul bordo.
  - Niente strobo né lampeggi ripetuti, per sicurezza fotosensibile.

## Come rispetta i principi di usabilità (spec. sez. 15)

- **Un solo pulsante principale** per schermata: «Rivedi (3)» e «Prepara il messaggio». È l'unico
  oggetto acido pieno con ombra. Le altre azioni sono link testuali acidi («Controlla →»).
- **Stato sempre visibile con frasi:** ogni semaforo ha colore, forma ed etichetta in parole
  («1 scadenza passata», «Manca: Giulia R.»). Si legge anche in scala di grigi.
- **Linguaggio semplice:** la parte «da club» vive solo nei metadati decorativi (`TRK`, `CH`, `LATO B`),
  che si possono ignorare senza perdere informazione. Le etichette funzionali restano in italiano
  normale.
- **Cosa fare dopo:** sotto il saluto c'è una frase che riassume la situazione. La lista «Cose da
  fare» è numerata come una tracklist, con un verbo d'azione a destra.
- **Conferma e annulla:** toast con «Annulla» dopo ogni azione importante. Le conferme usano lo
  stesso blocco acido.
- **Nota sull'estratto conto** sempre visibile in fondo al conguaglio, segnata da una barretta UV.

## Pro, contro e rischi

**Pro**

- È inconfondibile e ha carattere. Aprire l'app «per fare le bollette» diventa meno noioso.
- Il nero con un solo accento fa risaltare l'unico pulsante principale.
- Le metafore sequencer e mixer sono funzionali: un pattern di 12 step mostra i mesi di presenza
  meglio di una colonna «12».
- È un tema scuro nativo, quindi riposante la sera.

**Contro e rischi**

- **Stanca dopo un anno?** Le parti più rumorose (cromo, retino, oscilloscopio) sono limitate
  all'intestazione e si possono attenuare con un'impostazione «Modalità sobria». Il resto è un
  normale dark UI.
- **Leggibile per Nicola?** Se non ama il nero, serve un tema chiaro (carta da fotocopia
  `#F2F0E8` con accento verde scuro `#3A5A00`), da progettare a parte. Il giallo acido su bianco
  non è leggibile.
- **Windows:** il cromo è un gradiente SVG/CSS e non dipende dal font. Unbounded va incorporato
  nell'app, perché senza diventa Arial Black. Il dithering va disattivato su schermi a 100 % di
  scala se crea moiré.
- L'acido `#CCFF00` non va **mai** usato per testo su fondo chiaro o per stati di successo: per
  questo il successo è menta.
- Il registro «club» può sembrare poco serio quando si parla di soldi con gli inquilini. I messaggi
  e gli Excel generati restano neutri, senza lo stile dell'app.

## Traduzione in token (piano 4)

```json
{
  "color": {
    "bg": "#0A0A0A",
    "bg-deep": "#050505",
    "surface": "#161616",
    "surface-2": "#1F1F1F",
    "line": "#2E2E2E",
    "text": "#F2F2F2",
    "text-muted": "#A3A3A3",
    "text-dim": "#6E6E6E",
    "primary": "#CCFF00",
    "on-primary": "#0A0A0A",
    "accent": "#9D7BFF",
    "status": { "ok": "#2EE59D", "warn": "#FFB020", "error": "#FF4D5E", "todo": "#F2F2F2" }
  },
  "font": {
    "display": "Unbounded, 'Arial Black', sans-serif",
    "body": "Inter, 'Segoe UI', system-ui, sans-serif",
    "mono": "'JetBrains Mono', Consolas, monospace"
  },
  "display": {
    "stretchY": 1.3,
    "chromeGradient": ["#FFFFFF", "#BDBDBD 45%", "#4A4A4A 50%", "#E8E8E8 62%", "#8A8A8A"]
  },
  "size": {
    "display-xl": 58,
    "display-l": 50,
    "display-m": 26,
    "display-s": 18,
    "title": 20,
    "body-l": 16,
    "body": 15,
    "body-s": 14,
    "caption": 13,
    "meta": 11
  },
  "space": [4, 8, 16, 24, 32, 48, 64],
  "radius": { "control": 4, "card": 6, "pill": 999, "button-primary": 0 },
  "shadow": { "primary": "4px 4px 0 #9D7BFF" },
  "texture": {
    "halftone": "dot 1.6px / 8px, opacity .22, masked",
    "dither": "checker 1px / 4px, opacity .07"
  },
  "motion": {
    "step": "30ms",
    "scope-loop": "8s linear",
    "toast": "180ms ease-out",
    "reduce": "disable loops"
  }
}
```

Componenti da derivare:

- `StatusMark`: forma, colore ed etichetta, con le varianti ok, warn, error, half e todo;
- `StepPattern`: 12 step in 3 gruppi da 4, con gli stati acceso, vuoto e corrente;
- `SegmentMeter`, `TrackCard`, `ChannelRow` (blocco apribile), `CatalogTag` (mono, decorativo,
  `aria-hidden`), `PrimaryButton` (acido con ombra UV).
- In Tailwind/CSS variabili `--blt-*`. Le texture sono `background-image` SVG inline, disattivabili
  con una classe `.sober`.
