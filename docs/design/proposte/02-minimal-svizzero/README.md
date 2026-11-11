# 02 · Minimale svizzero

**L'idea in una frase:** una pagina bianca su una griglia rigorosa, dove i numeri grandi fanno da
protagonisti, le linee sostituiscono le card e un solo rettangolo rosso dice che cosa fare adesso.

Lo stile riprende l'International Typographic Style (la "scuola svizzera" degli anni '50-'60):
un solo carattere grottesco in pochi pesi, testo allineato a sinistra e a bandiera, griglia
modulare a 12 colonne, bianco, nero e grigi, e un unico colore di segnale. Niente ombre, niente
angoli arrotondati, quasi nessun riquadro.

Schermate: `01-home.svg`, `02-conguaglio.svg`, `03-mobile.svg`.

## Reference reali

| Reference                                                                                                                                                                                                                                                      | Cosa prendo                                                                                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [The Vignelli Canon (PDF ufficiale, Vignelli Center, RIT)](https://www.rit.edu/vignellicenter/sites/rit.edu.vignellicenter/files/documents/The%20Vignelli%20Canon.pdf)                                                                                         | La griglia come struttura che dà continuità da una pagina all'altra; pochi caratteri e pochi corpi; la disciplina del "meno ma meglio".                |
| [International Typographic Style (Wikipedia)](https://en.wikipedia.org/wiki/International_Typographic_Style) e il libro _Grid Systems in Graphic Design_ di Josef Müller-Brockmann                                                                             | Allineamento a sinistra e a bandiera, griglia modulare, grottesco, gerarchia data dal corpo e dal peso invece che dal colore.                          |
| [Dribbble: collezione con "Swiss style dark/white dashboard" (Milkinside)](https://dribbble.com/aaronpeck/collections/999116-Dashboards) e [la variante "Swiss style white dashboard"](https://dribbble.com/digitalscience/collections/489397-Dashboard-Light) | Cifre enormi come titolo della sezione, etichette piccole grigie sotto, filetti neri al posto delle card.                                              |
| [Bubble, Web Design Trends 2026](https://bubble.io/blog/web-design-trends/)                                                                                                                                                                                    | Il trend "barely-there": un solo carattere fa quasi tutto il lavoro e la struttura nasce da spazio bianco e peso tipografico, non da riquadri e ombre. |
| [Line25, Web Design Trends 2026](https://line25.com/articles/web-design-trends-2026/)                                                                                                                                                                          | La tipografia che diventa essa stessa il disegno (titolo grande "Buongiorno, Carlo." e importi a 48 px).                                               |
| [Ginetta, app mobile di Zürcher Kantonalbank](https://ginetta.net/zkb-mobile-app)                                                                                                                                                                              | Un'app bancaria svizzera reale: sobrietà, dati finanziari leggibili, tono istituzionale ma semplice. Utile per la versione telefono.                   |
| [Things 3 (Cultured Code)](https://culturedcode.com/things/) e [iA Writer](https://ia.net/writer)                                                                                                                                                              | Il livello di sobrietà da raggiungere: elenchi a righe con filetti sottili, un solo stato attivo, nessuna decorazione.                                 |
| [Inter Tight / Inter su Google Fonts](https://fonts.google.com/specimen/Inter+Tight/about)                                                                                                                                                                     | Grottesco libero (OFL) con cifre tabellari, erede funzionale di Helvetica e Akzidenz sugli schermi.                                                    |

## Palette

Una sola tinta "che grida" (il rosso), usata solo per il pulsante principale e per ciò che è
scaduto: in entrambi i casi significa "agisci qui".

| Token             | Esadecimale | Ruolo                                                  | Contrasto                              |
| ----------------- | ----------- | ------------------------------------------------------ | -------------------------------------- |
| `color.bg`        | `#FFFFFF`   | Sfondo                                                 | —                                      |
| `color.surface`   | `#F3F3F1`   | Superficie rara (campi, popup, hover di riga)          | testo `#0A0A0A` 17,8:1                 |
| `color.ink`       | `#0A0A0A`   | Testo principale, filetti di sezione, selezione attiva | 19,8:1 su bianco (AAA)                 |
| `color.ink-muted` | `#5C5C5C`   | Etichette, metadati, voci non attive                   | 6,7:1 su bianco (AA)                   |
| `color.rule`      | `#DADAD6`   | Filetti sottili tra le righe                           | decorativo                             |
| `color.primary`   | `#D40511`   | Pulsante principale (testo bianco)                     | bianco su rosso 5,5:1 (AA)             |
| `color.success`   | `#007A3D`   | Semaforo verde (cerchio con spunta)                    | 5,5:1 su bianco                        |
| `color.warning`   | `#B57F00`   | Semaforo giallo (triangolo con "!")                    | 3,5:1 su bianco: solo forme, mai testo |
| `color.danger`    | `#D40511`   | Semaforo rosso (quadrato con "!") e testo "scaduto"    | 5,5:1 su bianco (AA)                   |

Il giallo puro sul bianco non regge il contrasto: per questo il giallo è un ocra scuro e si usa
solo come riempimento dell'icona, mentre la frase accanto resta nera.

## Tipografia

- **Inter** (SIL Open Font License, Google Fonts), variabile con asse ottico: a 48-56 px si
  stringe da sola come un grottesco da manifesto. Fallback: `'Helvetica Neue', Helvetica, Arial,
sans-serif`. Cifre tabellari (`font-feature-settings: 'tnum'`) ovunque ci sia un importo, così le
  colonne si allineano alla virgola. Alternativa da valutare: Inter Tight solo per i titoli.
- Tre pesi: 400 (testo), 600 (righe e azioni), 700 (titoli e cifre).
- Scala (px): 12 metadati e note · 13 meta di riga, intestazioni di tabella · 14 etichette ·
  15 corpo nelle liste · 16 corpo e voci da fare · 18 sottotitolo · 20 marchio · 28 nome
  appartamento · 40 titolo pagina · 48 cifra chiave · 56 saluto.
- Interlinea a multipli di 8 px; crenatura leggermente negativa solo sopra i 28 px.

## Forme, spaziatura, icone, movimento

- **Griglia:** finestra 1440 px, barra laterale 240 px, area contenuti con margini di 48 px,
  12 colonne da 70 px e canali da 24 px. Le tre colonne degli appartamenti occupano esattamente
  4 + 4 + 4 colonne; in Conguaglio la tabella usa 8 colonne e le tipologie 4. Tutto su base 8 pt.
- **Forme:** angoli vivi (raggio 0). Le sezioni si aprono con un filetto nero da 2 px, le righe
  si separano con un filetto grigio da 1 px. Nessuna ombra, nessuna card, nessun gradiente.
- **Pulsante principale:** rettangolo rosso pieno 56 px di altezza con freccia; è l'unico
  elemento colorato pieno della pagina, quindi non si può non vederlo. Le azioni secondarie sono
  testo semibold nero ("Apri", "Controlla", "+ Registra pagamento a mano").
- **Icone:** geometria pura, tratto 1,5-2 px: freccia, più/meno, lente, chevron. I tre segnali di
  stato sono forme diverse (cerchio, triangolo, quadrato). I posti "in regola" sono quadratini
  pieni o vuoti, leggibili anche in bianco e nero.
- **Illustrazioni o mascotte:** nessuna. Gli stati vuoti sono una frase grande in grigio
  ("Nessuna azione richiesta.") con, se serve, un'azione testuale.
- **Movimento:** minimo e funzionale. Transizioni di 120-160 ms in ease-out; i blocchi per
  tipologia si aprono scorrendo verso il basso; le cifre che cambiano dopo un ricalcolo
  sfumano dal vecchio al nuovo valore, senza contatori animati. Con "riduci movimento" tutto è
  istantaneo.

## Come rispetta i principi di usabilità (sezione 15)

- **Un pulsante principale evidente:** il rosso è riservato. In Home c'è un solo rettangolo
  rosso («Rivedi (3)»), in Conguaglio uno solo («Prepara il messaggio»).
- **Semafori leggibili anche per i daltonici:** ogni stato combina tre segnali: colore, forma
  (cerchio con spunta, triangolo con "!", quadrato con "!") e frase («Tutto a posto», «2 cose da
  fare», «1 scadenza passata»). In bianco e nero la schermata si capisce ancora.
- **Stato a parole, non numeri da interpretare:** sotto ogni cifra c'è un'etichetta in italiano
  semplice («Da incassare da 3 inquilini», «uscite più alte delle entrate»).
- **Cosa fare dopo:** ogni riga di "Cose da fare" finisce con un verbo («Apri», «Controlla»,
  «Prepara un sollecito»); le righe sono ordinate per urgenza, scadute in alto.
- **Confermare e annullare:** le operazioni recenti mostrano autore, ora e «Annulla».

## Pro, contro e rischi

**Pro**

- Senza tempo: la scuola svizzera ha 70 anni e non passa di moda; difficilmente stanca dopo un anno.
- Massima leggibilità di importi e tabelle, che sono il cuore dell'app.
- Facilissimo da implementare e mantenere: pochi token, nessuna immagine, rende identico su Mac e
  Windows (Inter si include nell'app, quindi non dipende dai font di sistema).
- Scala bene al telefono: le righe con filetti diventano liste native senza riprogettare nulla.

**Contro**

- Meno "amichevole" dei riferimenti citati nella specifica (Duolingo, Revolut): niente mascotte
  né colore di benvenuto. Il calore deve venire dalle frasi.
- Il rosso ha due significati vicini (azione principale e scaduto). Funziona perché entrambi
  dicono "agisci qui", ma va verificato con Nicola.
- Con molto bianco e pochi riquadri, chi è abituato a Excel potrebbe non capire subito dove
  finisce un blocco: i filetti neri di sezione vanno mantenuti con disciplina.

**Rischi**

- Su schermi Windows a bassa densità i filetti da 1 px grigio chiaro possono sparire: tenere
  `#DADAD6` come minimo, non più chiaro.
- Se in futuro si aggiungono troppi stati o colori, lo stile si rompe: serve una regola scritta
  "un solo rosso per schermata".
- Leggibilità per Nicola: il corpo minimo del contenuto è 15-16 px, i metadati 13 px non
  portano mai informazioni indispensabili da soli.

## Traduzione in token (piano 4)

```json
{
  "color": {
    "bg": "#FFFFFF",
    "surface": "#F3F3F1",
    "ink": "#0A0A0A",
    "ink-muted": "#5C5C5C",
    "rule": "#DADAD6",
    "primary": "#D40511",
    "on-primary": "#FFFFFF",
    "status": { "ok": "#007A3D", "todo": "#B57F00", "late": "#D40511", "neutral": "#0A0A0A" }
  },
  "font": {
    "family": "Inter, 'Helvetica Neue', Helvetica, Arial, sans-serif",
    "weight": { "regular": 400, "semibold": 600, "bold": 700 },
    "size": {
      "xs": 12,
      "sm": 13,
      "label": 14,
      "body": 15,
      "body-lg": 16,
      "lead": 18,
      "h3": 28,
      "h2": 40,
      "figure": 48,
      "display": 56
    },
    "numeric": "tabular-nums"
  },
  "space": { "unit": 8, "gutter": 24, "margin": 48, "sidebar": 240, "row": 56, "row-dense": 48 },
  "grid": { "columns": 12, "column": 70 },
  "border": { "section": "2px solid ink", "row": "1px solid rule", "radius": 0 },
  "shadow": "none",
  "button": { "primary": { "height": 56, "bg": "primary", "fg": "on-primary", "radius": 0 } },
  "status-marker": {
    "ok": "circle+check",
    "todo": "triangle+!",
    "late": "square+!",
    "neutral": "circle-outline"
  },
  "motion": { "fast": "120ms ease-out", "base": "160ms ease-out", "reduced": "0ms" }
}
```

In Tauri questi valori diventano variabili CSS (`--color-ink`, `--space-unit`…) in un unico
file; i marcatori di stato sono un componente `StatusMark` con forma e colore legati allo stato,
così non si può mai mostrare un colore senza la sua forma e la sua frase.
