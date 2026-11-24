# 05 · Videogioco, pixel art 16-bit / JRPG

**Idea in una frase:** l'app come un piccolo gioco gestionale accogliente: i tre appartamenti
sono casette pixel su una mappa, le «Cose da fare» sono un registro delle missioni, i semafori
sono icone di stato da gioco, il conguaglio è un «inventario» con riquadri di dialogo, ma importi e
testi restano in un carattere leggibilissimo, perché qui si parla di soldi veri.

Schermate: `01-home.svg` (1440 × 900), `02-conguaglio.svg` (1440 × 900), `03-mobile.svg`
(390 × 844). Tutta la grafica è originale: casette, alberi, avatar e la mascotte «Coppo» (una
tegola in cotto con le gambe, omaggio ai tetti di Padova) sono disegnati qui, pixel per pixel, come
`<rect>` con `shape-rendering="crispEdges"`. Nessun personaggio, nome o asset di giochi esistenti.

## Reference reali e cosa prendo da ognuna

| Reference                                                                                                                                                                                                                                                                                                                                                                               | Cosa prendo                                                                                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Cozy Pixel UI Essentials Pack (itch.io)](https://hazardpay.itch.io/cozy-ui-essentials-pack)                                                                                                                                                                                                                                                                                            | Cornici 9-slice con angoli smussati di un pixel, pulsanti con ombra interna sotto: la base dei miei `frame()` e del pulsante principale.                         |
| [Pixel UI Kit, 3 stili legno, pietra, pergamena (itch.io)](https://gegx.itch.io/pixel-ui-kit)                                                                                                                                                                                                                                                                                           | La pergamena come superficie di lettura (`paper` / `parch`) invece del nero «da arcade»: più calma, più vicina a un foglio contabile.                            |
| [Cozy Farming UI Kit, NEXA Visuals (ArtStation)](https://nexavisuals.artstation.com/projects/31lm6v)                                                                                                                                                                                                                                                                                    | L'idea di schermate intere coerenti (inventario, diario, missioni) che diventano qui Conguaglio, Operazioni recenti e Cose da fare.                              |
| [Cute Cats UI Kit (itch.io, aggiornato 10/2025)](https://s-neuri.itch.io/cute-cats-ui-kit)                                                                                                                                                                                                                                                                                              | Tono tenero e barre di stato piccole: da qui gli omini «in regola» al posto dei numeri nudi.                                                                     |
| [Endesga 32 su Lospec](https://lospec.com/palette-list/tag/endesga) e [palette PICO-8 (Nerdy Teachers)](https://nerdyteachers.com/PICO-8/Guide/PALETTES)                                                                                                                                                                                                                                | Palette limitata, rampe con tonalità spostata (ombra del tetto più fredda e scura), contorno scuro unico `ink` invece del nero puro.                             |
| [«The calm and charm of cosy games in a chaotic world», UX Collective, 2026](https://uxdesign.cc/the-calm-and-charm-of-cosy-games-in-a-chaotic-world-7f29dbd8f4d9) e [PC Gamer sulla crescita del tag «cozy» dal 2024](https://www.pcgamer.com/games/life-sim/are-we-in-the-cozy-gaming-gold-rush-era-cozy-has-grown-over-250-percent-on-steam-and-200-percent-in-my-inbox-since-2024/) | Il trend 2025-2026: interfacce «cozy» per abbassare l'ansia. Bollette e conguagli sono un compito noioso e un po' stressante: lo stile serve a renderlo leggero. |
| [Game Accessibility Guidelines](https://gameaccessibilityguidelines.com/) e [Unity, basi di accessibilità](https://unity.com/blog/video-game-accessibility-basics)                                                                                                                                                                                                                      | Mai il colore da solo: ogni stato ha forma diversa (cerchio, triangolo, ottagono) più testo. Testo ingrandibile tramite una sola dimensione di base.             |
| [Pixelify Sans (Fontsource / Google Fonts)](https://fontsource.org/fonts/pixelify-sans/about) e [Atkinson Hyperlegible Next (Braille Institute, 2025)](https://fontsource.org/fonts/atkinson-hyperlegible-next/about)                                                                                                                                                                   | La coppia tipografica: pixel solo per i titoli, carattere ad alta leggibilità per tutto il resto.                                                                |

## Palette (token)

Ispirata a PICO-8 / Endesga ma ricalibrata per il contrasto: contorno unico viola-bruno, superfici
pergamena, semafori saturi solo nelle icone e scuriti nel testo.

| Token                 | Esadecimale                                                                                                             | Ruolo                                             |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `bg`                  | `#E9DCB9` (puntinato `#DCCCA2` ogni 8 px)                                                                               | Sfondo dell'app, «terreno»                        |
| `surface` / `paper`   | `#FFF6DF`                                                                                                               | Card, pannelli, dialoghi                          |
| `surface-2` / `parch` | `#F3E3BC`                                                                                                               | Righe alternate, schede non attive, barra in alto |
| `shade`               | `#E4CF9F`                                                                                                               | Smusso interno delle cornici                      |
| `line`                | `#C9B48A`                                                                                                               | Divisori tratteggiati                             |
| `ink`                 | `#2A1E33`                                                                                                               | Testo principale e contorni di tutto              |
| `muted`               | `#665446`                                                                                                               | Testo secondario                                  |
| `night`               | `#3B2D4F`                                                                                                               | Barra laterale, intestazioni di tabella           |
| `primary`             | `#2F5FB3` (luce `#6B95E3`, ombra `#1C3D78`)                                                                             | Unico pulsante principale e link d'azione         |
| `success`             | testo `#246A2D`, icona `#58B04B`                                                                                        | Semaforo verde                                    |
| `warning`             | testo `#875200`, icona `#F2B82E`                                                                                        | Semaforo giallo                                   |
| `error`               | testo `#B3292B`, icona `#DA4340`                                                                                        | Semaforo rosso, importi negativi                  |
| `gold`                | `#F2C14E`                                                                                                               | Monete, badge contatori, cursore del menu         |
| Illustrazione         | cielo `#CFE7EE`, erba `#8DBE68`/`#6A9A4B`, muro `#F6E7C8`, tetti Berchet `#B9552F`, Lovarini `#4D6FA8`, Pulci `#7A5AA6` | Solo nelle scene, mai per comunicare stato        |

**Contrasto WCAG (calcolato):** `ink` su `paper` 14,6:1; `ink` su `parch` 12,4:1; `muted` su
`paper` 6,7:1 e su `parch` 5,7:1; bianco su `primary` 6,2:1; `primary` su `paper` 5,7:1;
`success` 6,1:1, `warning` 6,0:1, `error` 6,0:1 su `paper` (tutti ≥ 5:1 anche su `parch`); testo
barra laterale `#F3EAD8` su `night` 10,5:1. Tutto supera AA (4,5:1); il testo principale supera AAA.

## Tipografia

- **Titoli e etichette di sezione:** [Pixelify Sans](https://fontsource.org/fonts/pixelify-sans/about)
  (SIL OFL, pesi 400-700), solo in maiuscolo o in titoli brevi, mai sotto 11 px, mai per numeri da
  leggere. Fallback `Menlo, monospace` (è quello che si vede nei PNG di anteprima, perché il font
  non è installato su questo Mac: la resa finale è più «pixel» e meno larga).
- **Corpo, tabelle e importi:** [Atkinson Hyperlegible Next](https://fontsource.org/fonts/atkinson-hyperlegible-next/about)
  (SIL OFL, 2025), con cifre tabellari e allineamento a destra. Fallback `Inter, sans-serif`.
- **Scala (px):** 12 nota · 13 secondario · 14-15 corpo e tabelle · 16 corpo forte e importi ·
  17-18 pulsante e titolo di pannello (pixel) · 20 nome appartamento (pixel) · 24 titolo pagina
  (pixel). Interlinea 1,4 per il corpo.

## Forme, spaziatura, icone, mascotte, movimento

- **Griglia a 4 px** (un «pixel d'arte» = 4 px a schermo, 3 o 2 px per le icone piccole), che
  coincide con la griglia a 8 pt richiesta dal brief: margini 24, colonne con 24-40 di spazio.
- **Cornici:** bordo `ink` di 4 px con angoli tagliati, luce bianca di 2 px in alto a sinistra,
  smusso `shade` in basso a destra, ombra piatta di 4 px. Nessun raggio d'angolo, nessuna sfocatura.
- **Pulsante principale:** l'unico elemento blu pieno della schermata, con «gradino» scuro sotto
  che si schiaccia di 4 px al clic.
- **Semafori come icone di stato da gioco:** verde = cerchio con spunta, giallo = triangolo con
  «!», rosso = ottagono con «×». Sulle card compaiono come fumetto sopra la casetta (come un
  personaggio di gioco con un'icona sopra la testa) e di nuovo accanto alla frase.
- **Omini «in regola»:** uno per posto, pieni se l'inquilino è in regola, vuoti se no, sempre con
  la frase «3 su 4 in regola».
- **Icone 8 × 8:** casa, posta, palazzine, calendario, bilancia, foglio, ingranaggio, lente; per
  le tipologie fulmine, fiamma, goccia, antenna, bidone, condominio.
- **Mascotte Coppo:** parla solo nei riquadri di dialogo per dire il passo successivo («Tutto
  calcolato! Ora prepara il messaggio…»). Mai nelle tabelle, mai nei messaggi di errore gravi.
- **Movimento (descritto):** cursore a freccia gialla che salta da una voce del menu all'altra
  (passi di 4 px, 120 ms); il triangolino ▼ in fondo ai dialoghi lampeggia lento; le missioni
  completate si cancellano con un tratto e una scintilla di 4 fotogrammi; fumo dal camino solo
  sulla casa verde. Tutto disattivato con «riduci movimento» del sistema. Nessun suono di default.

## Come tenerlo usabile per soldi veri

1. **Il gioco sta nella cornice, non nei numeri.** Gli importi sono sempre in Atkinson
   Hyperlegible, 16 px, grassetto, allineati a destra, formato `€ 1.234,56` e `- € 63,00` in
   rosso con il segno meno scritto (mai solo il colore).
2. **Nessuna gamification sui soldi:** niente punti, livelli, monete premio, serie di giorni.
   «Missione» è solo una metafora visiva della lista: le frasi restano semplici («Paga ora»,
   «Sollecita», «Controlla»).
3. **Un solo pulsante principale per schermata** (blu pieno); le altre azioni sono link o
   pulsanti chiari con contorno.
4. **I dialoghi di Coppo spiegano, non decorano:** dicono cosa fare dopo e ricordano che tutto si
   annulla. Si possono nascondere in Impostazioni («Modalità sobria»: via mascotte e scene, restano
   cornici e colori).
5. **Daltonici:** forma più parola su ogni stato; i colori dei tetti non coincidono con i
   semafori e non portano significato.
6. **Tabelle «vere»:** righe alternate, intestazioni su sfondo scuro, totale separato da una riga
   spessa: il conguaglio si legge come un foglio Excel, solo vestito da inventario.

## Rispetto dei principi della specifica

- **Un pulsante principale:** «Rivedi (3)» in Home, «Prepara il messaggio» nel Conguaglio.
- **Stato sempre visibile con colori e frasi:** card con fumetto, icona, frase e omini; righe
  delle missioni con icona di stato; colonna Stato nel conguaglio con icona più parola.
- **Linguaggio semplice:** frasi intere («Ci sono 3 documenti da rivedere», «Positivo = da
  pagare, negativo = da rimborsare»), nessun gergo da gioco nei testi operativi.
- **Conferma e annulla:** ricordato nel riquadro «Salvataggio» della barra laterale e nei dialoghi.
- **Nota sull'estratto conto:** in piccolo sotto al dialogo del Conguaglio.

## Pro, contro e rischi

**Pro**

- Fortissima riconoscibilità: ogni appartamento ha la «sua» casetta e il suo colore di tetto, si
  ritrova a colpo d'occhio anche sul telefono.
- Rende piacevole un lavoro noioso; il registro missioni con massimo 4 voci dà senso di chiusura.
- Stile economico da implementare: solo rettangoli e due font, nessuna immagine raster, SVG
  piccoli; regge identico su Mac e Windows (niente effetti di sfocatura o vetro).

**Contro e rischi**

- **Stanca dopo un anno?** Possibile: per questo scene e mascotte sono uno strato rimovibile
  («Modalità sobria») e le cornici da sole restano gradevoli.
- **Serietà percepita:** mostrare un conguaglio a un commercialista o a un inquilino da uno
  schermo «da gioco» può sembrare poco professionale. Gli Excel e i messaggi generati restano
  neutri, senza grafica pixel.
- **Leggibile per Nicola?** Sì, se il pixel resta nei titoli: il corpo è un font progettato per
  l'ipovisione. Il rischio è che uno sviluppatore estenda il font pixel a etichette e numeri:
  va vietato nei token.
- **Windows e scale non intere:** con ridimensionamento al 125 % o 150 % i pixel da 4 px diventano
  5 o 6 px e le icone piccole (2-3 px) possono sfocarsi. Serve disegnare le icone come SVG a griglia
  intera e arrotondare le posizioni, oppure usare multipli di 4 in tutta l'interfaccia.
- **Localizzazione:** Pixelify Sans copre latino e cirillico, ok per l'italiano (accenti
  inclusi); i messaggi in altre lingue per gli inquilini non usano il font pixel.

## Traduzione in token (piano 4)

```css
:root {
  /* colore */
  --color-bg: #e9dcb9;
  --color-bg-dot: #dccca2;
  --color-surface: #fff6df;
  --color-surface-2: #f3e3bc;
  --color-bevel: #e4cf9f;
  --color-line: #c9b48a;
  --color-ink: #2a1e33;
  --color-muted: #665446;
  --color-sidebar: #3b2d4f;
  --color-sidebar-text: #f3ead8;
  --color-primary: #2f5fb3;
  --color-primary-hi: #6b95e3;
  --color-primary-lo: #1c3d78;
  --color-success-text: #246a2d;
  --color-success-icon: #58b04b;
  --color-warning-text: #875200;
  --color-warning-icon: #f2b82e;
  --color-error-text: #b3292b;
  --color-error-icon: #da4340;
  --color-gold: #f2c14e;
  /* tipografia */
  --font-display: 'Pixelify Sans', Menlo, monospace; /* solo titoli */
  --font-body: 'Atkinson Hyperlegible Next', Inter, sans-serif;
  --fs-note: 12px;
  --fs-small: 13px;
  --fs-body: 15px;
  --fs-strong: 16px;
  --fs-panel-title: 18px;
  --fs-card-title: 20px;
  --fs-page-title: 24px;
  --num: tabular-nums;
  /* pixel e spazi */
  --px: 4px; /* un pixel d'arte */
  --space-1: 8px;
  --space-2: 16px;
  --space-3: 24px;
  --space-4: 32px;
  --border: 4px solid var(--color-ink);
  --shadow: 4px 4px 0 rgba(0, 0, 0, 0.15);
  --radius: 0; /* angoli tagliati con clip-path o border-image 9-slice */
}
```

Componenti: `PixelFrame` (border-image 9-slice da un SVG 12 × 12), `StatusIcon` (ok, warn, err,
half, coin, back; sempre con `aria-label` e testo accanto), `TenantPips`, `QuestRow`,
`DialogueBox` (mascotte opzionale), `HouseSprite` (colore del tetto come parametro
dell'appartamento). Una preferenza `ui.mode = cozy | sobrio` toglie scene e mascotte senza
cambiare layout. Per Tauri le icone vanno esportate come SVG con `shape-rendering: crispEdges` e
`image-rendering: pixelated` per eventuali PNG.

## Dati usati nelle schermate (inventati, coerenti)

Berchet (5 posti): Marco T., Sofia B., Luca P. (da dicembre, 9 mesi), Anna V., Pietro L.; quota
per posto e mese € 65,20; costi totali € 3.912,00 = Elettricità € 1.178,88 (12 × € 98,24) + Gas
€ 1.264,20 + Acqua € 312,48 + Internet € 359,40 (12 × € 29,95) + TARI € 404,16 (4 × € 101,04) +
Condominio € 392,88; a carico inquilini € 3.716,40, posto libero 3 mesi € 195,60; forfait
incassato € 3.540,00; conguaglio totale € 176,40 (da - € 57,60 a € 62,40). Lovarini: Giulia R.
non ha pagato l'affitto di novembre. Pulci: rata condominio del 05/11 scaduta, saldo - € 63,00.
