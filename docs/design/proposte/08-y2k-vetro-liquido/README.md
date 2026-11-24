# 08 · Y2K vetro liquido

**Idea in una frase:** l'ottimismo lucido di Windows Vista e dei primi iPod (cielo, acqua, bolle,
pulsanti a gel) rifatto con il «vetro liquido» del 2025-2026, con un velo chiaro sotto ogni testo
così da restare leggibile per Carlo e Nicola ogni settimana.

Schermate: `01-home.svg` (1440 × 900), `02-conguaglio.svg` (1440 × 900), `03-mobile.svg` (390 × 844).

## Reference reali e cosa prendo da ognuna

| #   | Reference                                                                                                                                                                                                                                             | Cosa prendo                                                                                                                                                                                          |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | [Frutiger Aero Archive](https://frutigeraeroarchive.org) e la sua [storia del movimento](https://frutigeraeroarchive.org/history.html)                                                                                                                | Il repertorio di base: cieli azzurri, acqua, bolle, riflessi bianchi, colori puliti. Lo uso solo come sfondo, mai dietro un numero.                                                                  |
| 2   | [CARI Institute, scheda «Frutiger Aero»](https://cari.institute/aesthetics/frutiger-aero) (chi ha dato il nome allo stile nel 2017)                                                                                                                   | La distinzione tra Frutiger Aero (natura + tecnologia amichevole, 2004-2013) e Y2K futurista (cromo, argento). Scelgo la variante acquatica e verde, più calma.                                      |
| 3   | [Apple HIG, Materials / Liquid Glass](https://developer.apple.com/design/human-interface-guidelines/materials) e [Apple Newsroom, giugno 2025](https://www.apple.com/newsroom/2025/06/apple-introduces-a-delightful-and-elegant-new-software-design/) | La regola chiave: il vetro sta nello strato dei controlli (barra laterale, barra in alto, barra del telefono), il contenuto sta su superfici quasi opache. Gerarchia chiara tra contenuto e comandi. |
| 4   | [Six Colors, «Soaping up Liquid Glass» (nov. 2025)](https://sixcolors.com/post/2025/11/soaping-up-liquid-glass-less-transparency-more-contrast/)                                                                                                      | La lezione dopo un anno d'uso: meno trasparenza, più contrasto. Da qui il velo bianco al 74-80 % sotto ogni pannello.                                                                                |
| 5   | [Infinum, «iOS 26 Liquid Glass: sleek, shiny and questionably accessible»](https://infinum.com/blog/apples-ios-26-liquid-glass-sleek-shiny-and-questionably-accessible/)                                                                              | L'elenco dei rischi: testo che sparisce su sfondi chiari, riflessi in movimento, fatica visiva. Ogni rischio ha una contromisura sotto.                                                              |
| 6   | [Creative Bloq, perché la Gen Z ama il Frutiger Aero](https://creativebloq.com/news/frutiger-aero-aesthetic-resurgance) e [Kittl, Frutiger Aero 2026](https://www.kittl.com/blogs/frutiger-aero-aesthetic-stl/)                                       | Il trend è vivo come linguaggio, non come copia: icone lucide e colori amichevoli dentro layout moderni.                                                                                             |
| 7   | [Dribbble, tag «frutiger aero»](https://dribbble.com/tags/frutiger-aero) e [daisyUI Trends, Frutiger Aero](https://trends.daisyui.com/trend/frutiger-aero/)                                                                                           | Pulsanti a gel con riflesso nella metà alta, sfere lucide come icone di stato, ombre morbide azzurre.                                                                                                |
| 8   | [University of Waterloo Computer Museum, «Frutiger Aero: The Future of the 2000's»](https://uwaterloo.ca/computer-museum/exhibits/frutiger-aero-future-2000s)                                                                                         | Il contesto storico (Vista, Xbox 360, Wii): l'idea di tecnologia ottimista, che qui diventa «i conti sono a posto, rilassati».                                                                       |

## Palette (token)

| Token                    | Esadecimale                                      | Ruolo                                           |
| ------------------------ | ------------------------------------------------ | ----------------------------------------------- |
| `sky.top` → `sky.bottom` | `#9ED8F5` → `#D4EFFB` → `#E9F8FB` → `#B5E6EE`    | Sfondo: cielo che diventa acqua                 |
| `water`                  | `#5CC8DF` → `#1E93C2`                            | Onde in basso (decorazione)                     |
| `meadow`                 | `#9BE3C4` → `#47B88E`                            | Collina verde dietro le onde (decorazione)      |
| `glass.tint`             | `#FFFFFF` 80 % → `#F2FAFE` 74 %                  | Velo dei pannelli di vetro                      |
| `surface.row`            | `#FFFFFF` / `#F4FAFE` 95 %                       | Righe, card interne: quasi opache               |
| `ink`                    | `#0B2E4A`                                        | Testo principale                                |
| `ink.muted`              | `#3C5F78`                                        | Testo secondario                                |
| `link`                   | `#0A5C99`                                        | Link, chevron, importi da rimborsare            |
| `primary`                | gel `#1478BA` → `#075A94`                        | Pulsante principale, voce attiva, scheda attiva |
| `success`                | sfera `#3DB45A`, testo `#1E6B33`, chip `#E1F5E6` | Verde: tutto a posto, saldato                   |
| `warning`                | sfera `#FFC233`, testo `#7A4F00`, chip `#FFF3D1` | Giallo: cose da fare, parziale                  |
| `danger`                 | sfera `#F0524F`, testo `#A3201F`, chip `#FDE4E2` | Rosso: scaduto, da pagare                       |
| `accent.nicola`          | `#7C66E0`                                        | Avatar di Nicola (Carlo è azzurro)              |

### Contrasto WCAG AA (calcolato)

Il caso peggiore è il pannello di vetro sopra la parte più scura del cielo: colore effettivo `#E6F5FC`.

| Testo                 | Su vetro `#E6F5FC`                            | Su riga `#FFFFFF` |
| --------------------- | --------------------------------------------- | ----------------- |
| `ink` `#0B2E4A`       | 12,5 : 1                                      | 14,0 : 1          |
| `ink.muted` `#3C5F78` | 6,1 : 1                                       | 6,8 : 1           |
| `link` `#0A5C99`      | 6,3 : 1                                       | 7,0 : 1           |
| successo `#1E6B33`    | 5,9 : 1 (5,7 sul chip)                        | 6,6 : 1           |
| attenzione `#7A4F00`  | 6,4 : 1 (6,5 sul chip)                        | 7,1 : 1           |
| errore `#A3201F`      | 6,8 : 1 (6,2 sul chip)                        | 7,5 : 1           |
| bianco sul gel        | 4,75 : 1 in cima, 5,8 al centro, 7,2 in fondo | —                 |

Tutto supera 4,5 : 1. Il testo bianco dei pulsanti è sempre in grassetto 15-19 px e ha un'ombra scura
di 1 px sotto (tipica dell'Aero), che aggiunge margine sulla parte alta schiarita dal riflesso.

### Come resta leggibile il vetro (la tecnica)

1. **Fondo solido sotto il vetro.** Ogni pannello parte da un rettangolo pieno `#EAF6FC`: anche se la
   sfocatura non c'è (Windows vecchi, «Riduci trasparenza» attivo), il testo resta su un colore noto.
2. **Sfocatura forte.** Sopra c'è lo sfondo sfocato (nell'SVG: copia dello sfondo con
   `feGaussianBlur` 18 px ritagliata sul pannello; nell'app: `backdrop-filter: blur(24px) saturate(140%)`).
   Bolle e onde diventano macchie di colore, senza bordi che disturbano le lettere.
3. **Velo chiaro.** Un velo bianco al 74-80 % porta il colore effettivo sopra `#E6F5FC`, valore usato
   per tutti i calcoli di contrasto.
4. **Righe quasi opache.** Numeri e nomi stanno su righe bianche al 95 %: il vetro vero è solo nella
   cornice (barra laterale, barra in alto, barra del telefono, bordi dei pannelli).
5. **Niente bolle dietro i testi.** Le bolle decorative stanno nei margini; nessuna passa sotto un importo.
6. **Riserva di emergenza.** Con «Aumenta contrasto» o «Riduci trasparenza» del sistema il velo
   diventa opaco al 100 % e il bordo passa a `#7CA9C4`.

## Tipografia

- **Nunito** (titoli, numeri grandi, pulsanti; Google Fonts, licenza OFL): tonda come una bolla,
  amichevole, numeri ben distinti.
- **Nunito Sans** (testo; Google Fonts, OFL): umanista come il Frutiger da cui lo stile prende il nome.
- Fallback nell'SVG: Avenir Next, poi `sans-serif`. Nell'app i font si includono nel pacchetto
  (Windows non ha Avenir).

| Uso                                    | Corpo / peso       |
| -------------------------------------- | ------------------ |
| Saluto, titolo pagina                  | 30-34 px / 800     |
| Titolo pannello                        | 22 px / 800        |
| Nome appartamento, importo in evidenza | 19-22 px / 800     |
| Testo riga principale                  | 16 px / 800        |
| Testo, tabella                         | 15 px / 600        |
| Testo secondario                       | 14 px / 400-600    |
| Etichette, chip                        | 12-13 px / 700-800 |

## Forme, spaziatura, icone, movimento

- **Griglia 8 pt.** Margini esterni 16 px, spazio tra card 24 px, interno pannelli 24-32 px.
- **Raggi grandi:** pannelli 28 px, righe 16-20 px, pulsanti e chip a pillola (raggio = metà altezza).
- **Pulsante a gel:** gradiente verticale blu, riflesso bianco nella metà alta, bordo scuro sottile,
  piccolo bagliore azzurro sul fondo, ombra morbida. Uno solo per schermata.
- **Pulsante secondario:** stessa pillola ma chiara (`#E4F4FD`), testo blu. Mai due gel vicini.
- **Semafori come sfere lucide** con simbolo dentro: ✓ verde, ! giallo, ✕ rosso. I chip ripetono il
  simbolo e la frase. Nessuno stato è affidato al solo colore.
- **Icone:** contorno 1,8 px arrotondato, stile semplice; le sfere colorate sono riservate a stati e
  persone (Carlo azzurro, Nicola viola), così il colore ha sempre un significato.
- **Illustrazioni / mascotte:** nessuna mascotte; il «personaggio» è il paesaggio (cielo, bolle,
  onde). Per lo stato vuoto: una grande bolla con «Niente da fare, goditi la giornata».
- **Movimento:** le bolle salgono lentissime (40-60 s per ciclo) solo nella Home; il riflesso del
  pulsante principale scorre una volta all'apertura; i blocchi si aprono con una molla breve
  (200 ms). Con «Riduci movimento» tutto è fermo.

## Principi di usabilità della specifica

- **Un solo pulsante principale:** è l'unico oggetto blu pieno e lucido della pagina («Rivedi (3)»,
  «Prepara il messaggio»). Tutto il resto è vetro chiaro.
- **Semafori leggibili anche per daltonici:** sfera colorata + simbolo + frase («Tutto a posto»,
  «2 cose da fare», «1 scadenza passata»); i chip di stato nella tabella hanno simbolo e parola.
- **Linguaggio semplice:** «Quanto deve ciascuno», «Bollette per tipo», «Tutto salvato».
- **Stato sempre visibile:** sincronizzazione in alto a destra, riquadro «Tutto salvato» in basso
  nella barra laterale, «Ogni operazione si può annullare» sopra le operazioni recenti.

## Pro, contro e rischi

**Pro**

- Riconoscibile e allegro: aprire l'app delle bollette non mette ansia.
- Il semaforo a sfere lucide è immediato, quasi un gioco (vicino allo spirito Duolingo).
- È coerente con macOS e iOS 26 (vetro liquido), quindi sembra «nuovo», non solo nostalgico.

**Contro e rischi**

- **Stanca dopo un anno?** Il rischio c'è: le bolle e i riflessi possono diventare kitsch. Mitigazione:
  sfondo tranquillo, decorazioni solo ai margini, e un'opzione «Sfondo semplice» (cielo uniforme).
- **Windows:** `backdrop-filter` in WebView2 funziona, ma su PC lenti la sfocatura costa. Il fondo
  solido rende il fallback senza sfocatura identico per leggibilità; va provato sul computer di Nicola.
- **Leggibile per Nicola?** Sì se si rispettano le regole sopra; il pericolo è che in sviluppo si
  aggiunga trasparenza «per bellezza». Serve un controllo automatico di contrasto nei test visivi.
- **Tabelle dense:** il vetro va bene per la cornice, non per tabelle lunghe. Le righe restano bianche.
- **Modalità scura:** da progettare (variante «Dark Aero»: notte, vetro fumé, sfere al neon).

## Token per l'implementazione (piano 4)

```css
:root {
  /* primitivi */
  --sky-100: #e9f8fb;
  --sky-200: #d4effb;
  --sky-300: #9ed8f5;
  --water-400: #5cc8df;
  --water-600: #1e93c2;
  --blue-500: #1478ba;
  --blue-700: #075a94;
  --ink-900: #0b2e4a;
  --ink-600: #3c5f78;
  --green-500: #3db45a;
  --green-800: #1e6b33;
  --amber-400: #ffc233;
  --amber-800: #7a4f00;
  --red-500: #f0524f;
  --red-800: #a3201f;

  /* semantici */
  --bg-app: linear-gradient(
    160deg,
    var(--sky-300),
    var(--sky-200) 45%,
    var(--sky-100) 78%,
    #b5e6ee
  );
  --glass-base: #eaf6fc; /* fondo solido sotto il vetro */
  --glass-tint: rgb(255 255 255 / 0.78);
  --glass-blur: blur(24px) saturate(140%);
  --glass-rim: linear-gradient(#fff, rgb(255 255 255 / 0.35), rgb(124 195 230 / 0.6));
  --surface-row: rgb(255 255 255 / 0.95);
  --text: var(--ink-900);
  --text-muted: var(--ink-600);
  --link: #0a5c99;
  --primary-gel: linear-gradient(var(--blue-500), var(--blue-700));
  --gloss: linear-gradient(rgb(255 255 255 / 0.85), rgb(255 255 255 / 0));
  --status-ok: var(--green-500);
  --status-ok-text: var(--green-800);
  --status-ok-bg: #e1f5e6;
  --status-warn: var(--amber-400);
  --status-warn-text: var(--amber-800);
  --status-warn-bg: #fff3d1;
  --status-ko: var(--red-500);
  --status-ko-text: var(--red-800);
  --status-ko-bg: #fde4e2;

  /* forme e spazi */
  --radius-panel: 28px;
  --radius-row: 16px;
  --radius-pill: 999px;
  --space-1: 8px;
  --space-2: 16px;
  --space-3: 24px;
  --space-4: 32px;
  --shadow-panel: 0 8px 20px rgb(11 74 115 / 0.16);
  --shadow-gel: 0 4px 10px rgb(7 90 148 / 0.35);
  --font-display: 'Nunito', sans-serif;
  --font-text: 'Nunito Sans', sans-serif;
}
@media (prefers-reduced-transparency: reduce), (prefers-contrast: more) {
  :root {
    --glass-tint: #f4fafe;
    --glass-blur: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .bubble {
    animation: none;
  }
}
```

Componenti: `GlassPanel` (base + blur + tint + rim), `GelButton` (uno per pagina, controllato in
revisione), `StatusOrb` (verde/giallo/rosso con simbolo obbligatorio), `StatusChip`, `SegmentedControl`.
