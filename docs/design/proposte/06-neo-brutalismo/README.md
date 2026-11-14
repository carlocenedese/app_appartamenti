# 06 · Neo-brutalismo

**L'idea in una frase:** un'app delle bollette che sembra un quaderno pieno di adesivi: bordi neri spessi, ombre piene spostate, blocchi di colore pieno e semafori grandi come etichette appiccicate, per capire tutto al primo sguardo e senza noia.

Schermate: [`01-home.svg`](01-home.svg) · [`02-conguaglio.svg`](02-conguaglio.svg) · [`03-mobile.svg`](03-mobile.svg)

---

## Reference reali e cosa prendo da ciascuna

| Reference                                                                                                                                                                                           | Cosa prendo                                                                                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Setproduct: «Retro, brutalist and Y2K UI design trends that work in 2026»](https://setproduct.com/blog/retro-brutalist-ui-design-2026)                                                             | Il punto di partenza: il brutalismo «che funziona» nel 2026 è quello addomesticato in un prodotto vero, con griglia ordinata sotto la superficie grezza. |
| [daisyUI, trend «Neubrutalism» (UI design trends 2026)](https://trends.daisyui.com/trend/neubrutalism/)                                                                                             | Il lessico dei componenti: bordo 2-3 px nero, ombra dura senza sfocatura, angoli poco arrotondati, colori pastello saturi su fondo chiaro.               |
| [neobrutalism.dev, componenti React/shadcn](https://neobrutalism.dev/)                                                                                                                              | La prova che lo stile si traduce in componenti e token (bordo, ombra, offset) su shadcn/Tailwind: base per il piano 4. Pulsanti che «affondano» premuti. |
| [Bruddle, Neo-brutalism UI kit (Dribbble)](https://dribbble.com/shots/23709960-Bruddle-Neo-brutalism-UI-kit)                                                                                        | Dashboard, tabelle e card dense in stile neo-brutale: come tenere tabelle leggibili con righe sottili e solo il contorno esterno spesso.                 |
| [«Financial Management – Neobrutalism» (Dribbble)](https://dribbble.com/shots/21754257-Financial-Management-Neobrutalism)                                                                           | Importi grandi in carattere monospazio dentro card colorate: soldi leggibili come su uno scontrino.                                                      |
| [Gumroad, interpretazione del suo design system (design.md)](https://www.webdesignhot.com/design.md/gumroad/)                                                                                       | Il riferimento storico: fondo crema, bordi neri, ombre piene, un solo colore forte per l'azione principale. Qui il colore d'azione è il lilla.           |
| [RetroUI: «12 neobrutalist websites you should know in 2026»](https://retroui.shadcn.io/blogs/12-neobrutalist-websites-you-should-know-in-2026)                                                     | Siti di prodotto 2026 in produzione: adesivi ruotati di pochi gradi, titoli enormi, usati con parsimonia.                                                |
| [Pixso: «Neo brutalism design»](https://pixso.net/articles/neo-brutalism-design/) e [DesignRush, trend 2026](https://www.designrush.com/agency/website-design-development/trends/web-design-trends) | L'avvertenza per un'app di soldi: lo stile va dosato. Bordi e ombre su card e pulsanti, tipografia del corpo pulita, niente caos.                        |
| [Designpieces: risorse neo-brutaliste (font, kit Figma, palette), 2026](https://www.designpieces.com/2026/08/brutalist-design-resources/)                                                           | Abbinamenti di font gratuiti (grotesk + display nero + mono) e palette giallo/lilla/menta/corallo.                                                       |

---

## Palette (token)

| Token                | Hex       | Ruolo                                                           |
| -------------------- | --------- | --------------------------------------------------------------- |
| `color.bg`           | `#FFF4E0` | Sfondo crema (con griglia di puntini al 13 % nella Home)        |
| `color.surface`      | `#FFFFFF` | Card, tabelle, barra laterale                                   |
| `color.ink`          | `#111111` | Testo, bordi, ombre: un solo nero per tutto                     |
| `color.muted`        | `#4A4237` | Testo secondario                                                |
| `color.primary`      | `#A78BFA` | Lilla: **solo** il pulsante principale e la voce di menu attiva |
| `color.primary.soft` | `#E4DAFF` | Intestazione delle tabelle                                      |
| `color.success`      | `#5EE0A0` | Menta: semaforo verde, «saldato», «nel CSV»                     |
| `color.warning`      | `#FFD23F` | Giallo: semaforo giallo, «parziale», etichette di annualità     |
| `color.danger`       | `#FF6B5B` | Corallo: semaforo rosso, «da pagare», contatore Da rivedere     |
| `color.info`         | `#7CC8FF` | Azzurro: promemoria futuri, «da rimborsare», avatar di Nicola   |
| `color.accent.peach` | `#FFB38A` | Avatar di Carlo, blocco Gas                                     |

**Contrasto WCAG (calcolato):** tutti i colori pieni portano testo nero, mai bianco.

| Testo su sfondo                          | Rapporto                     | AA       |
| ---------------------------------------- | ---------------------------- | -------- |
| ink su bg                                | 17,3 : 1                     | sì (AAA) |
| ink su surface                           | 18,9 : 1                     | sì (AAA) |
| muted su bg / surface                    | 9,1 / 9,9 : 1                | sì (AAA) |
| ink su primary (lilla)                   | 6,9 : 1                      | sì       |
| ink su success / warning / danger / info | 11,4 / 13,1 / 6,8 / 10,4 : 1 | sì       |

## Tipografia (tutti Google Fonts, licenza OFL)

- **Archivo Black**: titoli e nomi degli appartamenti. Nelle schermate cade su Arial Black se manca.
- **Space Grotesk** (500, 700, 800): interfaccia e corpo, con un carattere un po' grezzo ma leggibilissimo.
- **Space Mono** (400, 700): tutti gli importi e le date, allineati in colonna come su uno scontrino.

Scala (px): 12 etichette maiuscole spaziate · 14 secondario · **16 corpo** · 17-18 righe importanti · 20-22 pulsanti e titoli di sezione · 28-30 titoli di blocco · 52-56 saluto e nome dell'appartamento.

## Forme, spaziatura, icone, movimento

- **Bordo** 3 px nero ovunque (2-2,5 px negli elementi piccoli). **Raggio** 10-14 px sulle card, pillola sugli adesivi.
- **Ombra dura** nera senza sfocatura: 4 px sugli elementi secondari, 6-7 px su card e pulsante principale. L'ombra più profonda segnala l'elemento più importante.
- **Griglia 8 pt**: margini di 40 px, spazi tra le card di 32-36 px, righe di tabella da 44 px.
- **Adesivi-semaforo**: pillola del colore di stato, cerchio bianco con icona (✓, !, ✕, orologio) e testo MAIUSCOLO. Sono ruotati di -2/-3° per sembrare appiccicati: è l'unico elemento storto, così resta un segnale.
- **Icone**: tratto 2,6 px con estremità arrotondate (stile Phosphor Bold o Tabler a tratto spesso).
- **Mascotte**: nessuna. Il logo «BOLLETTE!» è a sua volta un adesivo giallo.
- **Movimento**: al passaggio del mouse il pulsante si alza di 2 px e l'ombra cresce. Premuto, scende sull'ombra (traslazione di 6 px, ombra a 0) con uno scatto di 80 ms. Alla conferma l'adesivo nuovo «si stacca e si riattacca» (rotazione da -8° a -2°, 200 ms). Niente dissolvenze lunghe. Con «riduci movimento» attivo resta solo il cambio di colore.

## Come rispetta i principi della specifica (sezione 15)

- **Un solo pulsante principale**: è l'unico elemento lilla con l'ombra più profonda e la freccia («Rivedi (3)», «Prepara il messaggio»). Le altre azioni sono pulsanti crema piccoli e senza ombra.
- **Semafori leggibili per i daltonici**: ogni stato ha colore, icona di forma diversa e una frase («Tutto a posto», «2 cose da fare», «1 scadenza passata»). Le card hanno anche la fascia di colore in testa, ma il testo basta da solo.
- **Stato sempre visibile**: quadratini pieni o vuoti per «4 su 5 in regola». Nel telefono gli inquilini che non hanno pagato hanno il cerchio tratteggiato e vuoto, non solo un colore diverso.
- **Linguaggio semplice**: «Da dove vengono i costi», «Tocca un blocco per vedere le bollette», «Ogni operazione si può annullare dallo Storico».
- **Errori e stati vuoti**: badge tratteggiato «non trovata» per una bolletta assente dal CSV. Lo stato vuoto di «Cose da fare» sarà un grande adesivo menta «Niente da fare oggi ✓».

## Pro, contro e rischi

**Pro**

- Personalità forte, quasi da gioco (vicina a Duolingo), ma con la gerarchia esplicita: si sa sempre dove cliccare.
- Contrasto altissimo, quindi ottimo per Nicola, su schermi economici e con il sole sullo schermo.
- Pochi effetti (niente sfocature né trasparenze), quindi la resa è identica su WebView2 (Windows) e WKWebView (Mac) ed è leggero da implementare.

**Contro e rischi**

- **Stanchezza**: dopo un anno di uso settimanale gli adesivi ruotati e i colori pieni possono sembrare rumorosi. Va limitato il colore pieno a stati e azioni, mai alla decorazione.
- **Densità**: bordi e ombre occupano spazio, e le tabelle lunghe (movimenti CSV) diventano pesanti. Lì si usano solo righe sottili e il bordo spesso esterno.
- **Moda**: è uno stile 2022-2026 che potrebbe sembrare datato in fretta. I token permettono di ridurre bordo e ombra senza ridisegnare.
- **Serietà**: per documenti verso gli inquilini (Excel, messaggi) lo stile non va esportato, perché lì serve sobrietà.
- **Windows**: Archivo Black e Space Grotesk vanno inclusi nell'app (non presenti di sistema). Il nero pieno con ClearType rende bene.

## Token per l'implementazione (piano 4)

```css
:root {
  --color-bg: #fff4e0;
  --color-surface: #ffffff;
  --color-ink: #111111;
  --color-muted: #4a4237;
  --color-primary: #a78bfa;
  --color-primary-soft: #e4daff;
  --color-success: #5ee0a0;
  --color-warning: #ffd23f;
  --color-danger: #ff6b5b;
  --color-info: #7cc8ff;

  --border-w: 3px;
  --border-w-sm: 2px;
  --border: var(--border-w) solid var(--color-ink);
  --radius-sm: 8px;
  --radius-md: 10px;
  --radius-lg: 14px;
  --radius-pill: 999px;
  --shadow-sm: 4px 4px 0 var(--color-ink);
  --shadow-md: 6px 6px 0 var(--color-ink);
  --shadow-lg: 7px 7px 0 var(--color-ink); /* solo card e pulsante principale */
  --sticker-rotate: -2.5deg;

  --font-display: 'Archivo Black', 'Arial Black', sans-serif;
  --font-body: 'Space Grotesk', system-ui, sans-serif;
  --font-money: 'Space Mono', ui-monospace, monospace;
  --space: 8px; /* multipli: 8, 16, 24, 32, 40 */
  --press-duration: 80ms;
}
```

Componenti semantici: `Button.primary` (lilla, shadow-lg), `Button.secondary` (crema, bordo 2,5 px, senza ombra), `StatusSticker{tone: ok|warn|err|info}` (colore, icona e testo obbligatori), `Card` (surface, border, shadow-md, fascia di stato opzionale), `MoneyText` (font-money, segno «- €» per i negativi). Si appoggia direttamente a shadcn/ui e Tailwind (vedi neobrutalism.dev): `border-[3px] border-ink shadow-[6px_6px_0_#111]`.
