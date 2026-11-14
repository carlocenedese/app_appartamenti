# 15 · «Banca moderna»

**L'idea in una frase:** l'evoluzione moderna della 01: la fiducia di una banca (blu notte, cifre in colonna, tono cortese) con la chiarezza delle migliori app fintech. In testa un saldo grande, gli appartamenti presentati come «conti», grafici sottili del flusso di cassa e icone tonde colorate per luce, gas, acqua e internet.

Schermate: `01-home.svg` (Home, 1440 × 900), `02-conguaglio.svg` (Berchet, scheda Conguaglio, 1440 × 900), `03-mobile.svg` (telefono in sola lettura, 390 × 844), `04-stati.svg` (stato vuoto, attesa in 4 fotogrammi, conferma con annulla, errore, tema scuro).

## Marchi che mi ispirano e cosa NON copio

| Marchio | Cosa prendo | Cosa NON copio |
| --- | --- | --- |
| Mercury | Saldo totale in testa con il flusso di cassa subito sotto; sobrietà, nessun accento aggressivo. | Il nome, il marchio, il suo font proprietario, il tema scuro di default. |
| Stripe Dashboard | Numeri in colonna allineati a destra, grafici piccoli e monocromi, colore riservato agli stati. | La palette viola/ciano, i gradienti animati del sito, il font Söhne. |
| Revolut | Conti e saldi visibili dalla Home, si passa da uno all'altro con un clic; i conti secondari come «tasche». | Lo sfondo a tutto colore, le schede delle carte, i widget promozionali. |
| Monzo | Le categorie con un'icona e un colore propri, riconoscibili a colpo d'occhio. | Il corallo del marchio, il tono scherzoso, l'icona della carta. |
| N26 | Il saldo totale sopra l'elenco dei sotto-conti, sfondi tenui al posto delle immagini. | Il verde acqua del marchio, i nomi «Spaces». |
| Wise | Le cifre trattate come protagoniste, l'accessibilità come regola (focus, lettori di schermo). | Il verde lime, il font Wise Sans e i titoli ultra-neri. |

Nell'interfaccia non compaiono loghi, nomi di marchio o font proprietari. Il marchio dell'app è disegnato da zero: un quadrato arrotondato con tre barre, cioè i tre conti.

## Reference trovate online

| Riferimento | Cosa prendo |
| --- | --- |
| [925 Studios, _Mercury design breakdown_](https://www.925studios.co/blog/mercury-design-breakdown) e [SaaSFrame, _Mercury checking dashboard_](https://www.saasframe.io/examples/mercury-checking-dashboard) | Gerarchia «saldo → andamento → movimenti»: da qui la testata della Home con il saldo dei tre conti e il grafico «Flusso di cassa». |
| [925 Studios, _Stripe dashboard design breakdown_](https://www.925studios.co/blog/stripe-dashboard-design-breakdown) e [Stripe Apps, _Chart layout_](https://docs.stripe.com/stripe-apps/patterns/chart-layout) / [_Sparkline_](https://docs.stripe.com/stripe-apps/components/sparkline) | Sparkline senza assi per il «quick trend» (le mini-linee nelle card), non più di tre grafici per riga, cifre tabellari allineate a destra. |
| [Revolut, _Revolut 10_](https://www.revolut.com/news/revolut_launches_revolut_10_as_it_targets_primary_accounts_and_passes_35m_customers_worldwide) | I conti come oggetti di primo livello in Home: le tre card degli appartamenti sono «conti» con saldo, andamento e stato. |
| [Monzo, _categorie personalizzate_](https://monzo.com/help/budgeting-overdrafts-savings/advanced-budgeting-custom-categories) e [Creative Bloq, _Monzo's brilliant UI_](https://www.creativebloq.com/web-design/ux-ui/monzos-brilliant-ui-design-is-a-delight-to-use) | Categoria = nome + icona + colore. Da qui i tondi colorati di Elettricità, Gas, Acqua, Internet, TARI e Condominio. |
| [N26, _Shaping visual experiences of Spaces_](https://medium.com/insiden26/shaping-visual-experiences-of-spaces-4193249e9b3d) | Sfondi tenui e oggetti semplici al posto di immagini; il saldo totale sopra i sotto-conti (mobile). |
| [Wise Design, _Wise Sans refined_](https://medium.com/transferwise-design/wise-sans-refined-expressive-by-default-51b019b700af) e [_Accessible but never boring_](https://medium.com/@therealstephsmith/accessible-but-never-boring-part-2-e188db299bd0) | Le cifre come elemento grafico principale, l'accessibilità come vincolo di progetto. |
| [Merge, _Fintech UX anti-trends 2026_](https://merge.rocks/blog/fintech-ux-anti-trends-of-2026) e [Veza Digital, _Fintech design trends 2026_](https://vezadigital.com/post/fintech-web-design-trends) | Niente coriandoli né «gamification» sui soldi; un movimento prevedibile che spiega cosa succede. Da qui una sola micro-animazione, breve. |
| [Mind the Product, _UX that builds trust_](https://www.mindtheproduct.com/ux-that-builds-trust-what-top-fintechs-get-right/) | Piccole conferme visive che chiudono l'azione (la spunta del toast «Bolletta confermata · Annulla»). |

## Palette (tema chiaro)

| Token | Esadecimale | Ruolo |
| --- | --- | --- |
| `color.bg` | `#F5F6F8` | Sfondo pagina, grigio freddo |
| `color.surface` | `#FFFFFF` | Card, tabelle, elenchi |
| `color.surface.sunken` | `#F0F2F5` | Intestazioni di tabella, blocco aperto, segmentato |
| `color.rule` / `rule.soft` | `#E4E7EC` / `#EEF0F3` | Bordi da 1 px / separatori di riga |
| `color.text` | `#101828` | Testo e cifre |
| `color.text.muted` | `#556070` | Etichette, meta |
| `color.nav` / `nav.active` | `#0E1A2E` / `#1B2944` | Barra laterale blu notte (eredità della 01) |
| `color.primary` | `#4338CA` | **Indaco**: pulsante principale, link, scheda attiva, barra di lettura |
| `color.hero` | `#FFFFFF → #ECEDFC` | Unico gradiente, solo nella testata (Home, Conguaglio, telefono) |
| `color.ok` / icona / fondo | `#16653F` / `#1F8A54` / `#E7F4EC` | In regola, Saldato |
| `color.warn` / icona / fondo | `#7A4B00` / `#C98500` / `#FBF0D9` | Da fare, Parziale |
| `color.bad` / icona / fondo | `#A3201A` / `#C4271F` / `#FBE7E5` | Scaduto, Da pagare, importi negativi |
| `color.refund` / icona / fondo | `#3F4A5C` / `#56627A` / `#ECEEF2` | Da rimborsare (neutro: non è un errore) |

**Colori di categoria** (fondo del tondo / glifo): Elettricità `#EDE9FE`/`#6D28D9` (fulmine) · Gas `#DDF3F1`/`#0F766E` (fiamma) · Acqua `#E0ECFF`/`#1D4ED8` (goccia) · Internet `#FCE7F3`/`#BE185D` (onde) · TARI `#F1ECE2`/`#6B5B3E` (cestino) · Condominio `#EEF0F3`/`#475467` (palazzo) · Affitto `#E8EAFD`/`#3730A3` (casa) · Estratto conto e conguaglio `#E6F1F7`/`#0B5C8A`. Sono scelti lontano da verde, giallo e rosso di stato e non diventano mai il riempimento di un pulsante.

**Il pulsante principale è indaco,** un colore che non è di stato: non è verde, giallo o rosso, ed è diverso anche dal grigio ardesia di «da rimborsare».

### Contrasto WCAG (calcolato)

- Testo `#101828` su sfondo `#F5F6F8`: **16,4 : 1**; su bianco 17,8 : 1; sul gradiente della testata (`#ECEDFC`) 15,3 : 1.
- Testo secondario `#556070`: 5,9 : 1 su sfondo, 6,4 : 1 su bianco, 5,5 : 1 sul gradiente.
- Bianco su indaco `#4338CA` (pulsante): **7,9 : 1**; indaco come link su bianco 7,9 : 1, su `#F0F2F5` 7,1 : 1.
- Testi di stato piccoli (12-13 px), sempre ≥ 7 : 1 su bianco: verde 7,1 · ocra 7,4 · rosso 7,6 · ardesia 9,0. Sul fondo della pillola: 6,3 · 6,6 · 6,4 · 7,7 (AA pieno; il testo della pillola è semibold da 12,5 px).
- Barra laterale: `#E8ECF4` su `#0E1A2E` 14,7 : 1; voci secondarie `#9AA6BD` 7,1 : 1.
- Icone di stato (elementi grafici, minimo 3 : 1): verde 4,4 · ocra 3,1 · rosso 5,7. L'ocra è al limite, ma l'icona non è mai l'unico segnale: c'è sempre il testo `#7A4B00`.
- Glifi di categoria sul loro tondo: tra 4,7 e 6,0 : 1.

## Tema scuro (progettato, in `04-stati.svg`)

| Token | Esadecimale | Note |
| --- | --- | --- |
| `bg` / `surface` / `rule` | `#0B1220` / `#141C2E` / `#243049` | blu notte, non nero puro |
| testata | `#141C2E → #1C2348` | stesso gradiente discreto, verso l'indaco |
| testo / secondario | `#E6E9F0` / `#9BA5B8` | 15,4 : 1 / 7,6 : 1 sullo sfondo |
| primario | `#8E95FF` con testo `#0B1220` | 7,0 : 1; l'indaco si schiarisce, il pulsante ha testo scuro |
| stati | ok `#7BD3A2` · da fare `#F2C66D` · scaduto `#FF8A80` | 9,5 · 10,6 · 7,5 : 1 su `#141C2E` |

## Tipografia

- **Un solo font: [Inter](https://fonts.google.com/specimen/Inter)** (SIL Open Font License 1.1), con tagli ottici; si distribuisce dentro l'app Tauri, quindi rende uguale su Mac e su Windows. In tutta l'interfaccia le cifre usano `font-variant-numeric: tabular-nums`, allineate a destra. Nei PNG di controllo `rsvg` non applica `tnum`, quindi le colonne sono allineate a destra ma con cifre proporzionali: nell'app saranno impeccabili.
- **Nessun serif**: il registro bancario lo danno il blu notte, le cifre e il tono. La regola «serif solo da 24 px in su» è rispettata perché non ce ne sono.
- Alternativa libera con più carattere: [Plus Jakarta Sans](https://github.com/tokotype/PlusJakartaSans) (OFL, cifre tabellari dalla v2.7) solo per il saldo grande.
- Scala: 54 (saldo in Home) · 42 (saldo sul telefono) · 28 (titolo pagina) · 26 (saldo di card e KPI) · 18 (titolo di sezione) · 15-16 (corpo, righe, pulsanti) · 14 (corpo secondario) · 13 (meta, stati) · 12 (note) · 11 maiuscoletto spaziato 1,2 (sovrattitoli). Pesi: 400, 500 e 600; 700 solo per le iniziali e i totali.
- Il saldo grande ha una spaziatura negativa (-1,6 px a 54 px), come nelle app di banca moderne.

## Forme, spaziatura, icone, movimento

- **Griglia** 8 pt; barra laterale 240 px; contenuto da 288 a 1392 px (1104 = 3 × 352 + 2 × 24).
- **Forme:** card con raggio 14-16 px, pulsanti a pillola (raggio 24), pillole di stato con raggio 13, bordi da 1 px e nessuna ombra. La profondità viene dal passaggio sfondo grigio → card bianca.
- **Gradiente:** uno solo, molto discreto (bianco → `#ECEDFC` più un alone indaco al 10 %), e solo nella testata: saldo in Home, riepilogo del conguaglio, parte alta del telefono.
- **Grafici sottili:** barre da 12 px con raggio 3 (entrate indaco, uscite grigie, il mese in corso più chiaro e etichettato «nov (in corso)»), sparkline da 1,6 px con riempimento sfumato nelle card. Pulci ha la linea rossa con lo zero tratteggiato. Nessun asse con cifre inventate: il grafico mostra l'andamento, le cifre stanno nel testo.
- **Card come conti:** iniziale nel tondo, nome, pillola di stato, «Saldo di cassa» grande, sparkline, «N su M in regola» con puntini (pieno = in regola, anello rosso = no) e «Apri …» in indaco.
- **Icone di stato, una forma per stato:** cerchio con spunta (in regola, saldato: è lo stesso significato) · triangolo con ! (da fare) · ottagono con ! (scaduto) · cerchio mezzo pieno (parziale) · rombo con trattino (da pagare) · quadrato arrotondato con freccia di ritorno (da rimborsare). Ottagono e rombo, i due rossi, hanno forme diverse.
- **Micro-illustrazioni:** solo i tondi di categoria (fulmine, fiamma, goccia, onde, cestino, palazzo, casa, documento), da 28-36 px, geometrici e disegnabili in SVG senza illustratore. Nello stato vuoto tre tondi si sovrappongono con una spunta. Nessuna mascotte.
- **Movimento (l'unica micro-animazione):**
  1. **Il saldo «conta» fino al valore:** quando arriva un estratto conto o si apre la Home dopo un'importazione, il saldo va da 0 (o dal valore precedente) al valore vero in 1200 ms con `cubic-bezier(0.2, 0.7, 0.2, 1)`. Le cifre sono tabellari, quindi il numero non «balla». Si anima una volta per sessione, non a ogni visita.
  2. **La barra sottile si riempie** (4 px, gradiente indaco) mentre l'app legge l'estratto conto: «12 di 124 movimenti» → «124 movimenti letti». I fotogrammi sono in `04-stati.svg` (0, 400, 800 e 1200 ms).
  3. Il resto è funzionale: il toast entra dal basso in 160 ms e la sua linea si svuota in 8 s (tempo per annullare); i blocchi del conguaglio si aprono a tendina in 200 ms.
  - **Riduci movimento** (impostazione dell'app e `prefers-reduced-motion`): il saldo compare già al valore finale e la barra diventa il testo «Lettura in corso: 60 di 124».

## Usabilità secondo la specifica

- **Un solo pulsante principale pieno per schermata**, sempre indaco: «Rivedi (3)» in Home, «Prepara il messaggio» nel Conguaglio, «Scegli un altro file» nell'errore. Il resto sono link indaco con freccia («Conferma →») o pulsanti a contorno («Registra pagamento a mano»).
- **Semafori leggibili per daltonici:** forma dell'icona + frase («Tutto a posto», «2 cose da fare», «1 scadenza passata») + colore. Ogni riga di «Cose da fare» ripete lo stato in testo («Scaduto il 5/11», «Da confermare»).
- **Linguaggio semplice:** «Saldo di cassa», «Ancora da incassare € 80,75», «Niente da rivedere». Nessun gergo da trading.
- **L'app non paga:** nessun pulsante «Paga» o «Invia denaro». Le azioni sono conferma, registra, prepara il messaggio, ricalcola. In Home: «Prepara sollecito», cioè un testo da inviare a mano.
- **Stato sempre visibile:** sincronizzazione in alto, «Aggiornato con l'estratto conto di ottobre · ieri 18:10» sotto il saldo, la nota «Gli importi contano solo le voci trovate nell'estratto conto.» nel conguaglio, «Sola lettura» sul telefono.
- **Conguaglio confrontabile:** la testata riassume costi € 1.873,00, forfait € 1.740,00, differenza € 133,00, ancora da incassare € 80,75 (Marco 58,60 + Sofia 22,15) e da rimborsare € 54,60. La barra di composizione sopra i blocchi mostra il peso di ogni categoria con i suoi colori.

## Pro, contro e rischi

**Pro**

- Mantiene ciò che piace della 01 (blu notte, cifre in colonna, calma) e la rende più leggibile e attuale.
- Si costruisce facilmente: un font, angoli e grafici standard, un solo gradiente. Si mappa bene su Tailwind e shadcn/ui.
- I numeri in grande rispondono subito alla domanda della settimana: «quanti soldi ci sono e dove».
- Regge su Windows: Inter incorporato, nessun vetro né sfocatura.

**Contro e rischi**

- **Rischio «un'altra dashboard SaaS»:** è lo stile più diffuso del momento. La personalità sta nei tondi di categoria e nel blu notte: se si tolgono, diventa generico.
- **Il saldo aggregato (€ 538,05) può confondere**, perché i tre conti sono separati e Pulci è in negativo. Per questo la ripartizione per appartamento è sempre visibile sotto il saldo, e si può scegliere di non sommare.
- Otto colori di categoria più quattro di stato fanno molti colori: le categorie restano piccole (tondi pastello) e non riempiono mai superfici grandi.
- Il conteggio del saldo, se ripetuto a ogni visita, stanca e rallenta la lettura: va limitato al primo ingresso dopo un'importazione.
- L'ocra delle icone di stato è a 3,1 : 1: va bene solo perché è sempre accompagnato dal testo scuro.
- Da provare sul PC di Nicola a 125 %: la tabella del conguaglio a 704 px con cinque colonne di cifre è al limite.

## Token per l'implementazione (piano 4)

```css
:root {
  /* primitivi */
  --gray-50: #f5f6f8; --gray-100: #f0f2f5; --gray-200: #e4e7ec; --gray-600: #556070; --gray-900: #101828;
  --navy-900: #0e1a2e; --navy-800: #1b2944;
  --indigo-50: #eeedfc; --indigo-600: #4338ca; --indigo-300: #8e95ff;
  --green-700: #16653f; --ochre-700: #7a4b00; --red-700: #a3201a; --slate-600: #3f4a5c;

  /* semantici */
  --color-bg: var(--gray-50);
  --color-surface: #ffffff;
  --color-sunken: var(--gray-100);
  --color-rule: var(--gray-200);
  --color-text: var(--gray-900);
  --color-text-muted: var(--gray-600);
  --color-nav: var(--navy-900);
  --color-primary: var(--indigo-600);
  --color-on-primary: #ffffff;
  --color-ok: var(--green-700);
  --color-warn: var(--ochre-700);
  --color-bad: var(--red-700);
  --color-refund: var(--slate-600);
  --gradient-hero: linear-gradient(110deg, #ffffff 0%, #f8f8fe 55%, #ecedfc 100%);

  /* categorie: fondo / glifo */
  --cat-luce-bg: #ede9fe; --cat-luce-fg: #6d28d9;
  --cat-gas-bg: #ddf3f1; --cat-gas-fg: #0f766e;
  --cat-acqua-bg: #e0ecff; --cat-acqua-fg: #1d4ed8;
  --cat-internet-bg: #fce7f3; --cat-internet-fg: #be185d;
  --cat-tari-bg: #f1ece2; --cat-tari-fg: #6b5b3e;
  --cat-condominio-bg: #eef0f3; --cat-condominio-fg: #475467;

  --font-ui: 'Inter', system-ui, sans-serif;
  --num: tabular-nums;
  --radius-card: 14px; --radius-hero: 16px; --radius-pill: 999px;
  --space: 8px; /* 8, 16, 24, 32, 48 */
  --motion-count: 1200ms; --motion-fast: 160ms; --ease: cubic-bezier(0.2, 0.7, 0.2, 1);
}
[data-theme='dark'] {
  --color-bg: #0b1220; --color-surface: #141c2e; --color-rule: #243049;
  --color-text: #e6e9f0; --color-text-muted: #9ba5b8;
  --color-primary: var(--indigo-300); --color-on-primary: #0b1220;
  --color-ok: #7bd3a2; --color-warn: #f2c66d; --color-bad: #ff8a80;
  --gradient-hero: linear-gradient(110deg, #141c2e, #1c2348);
}
```

Componenti: `BalanceHero` (saldo + ripartizione + `CashFlowBars`), `AccountCard` (iniziale, `StatusPill`, `Amount size="lg"`, `Sparkline`, `InRegolaDots`), `CategoryIcon` (prop `categoria`), `StatusPill` / `StatusIcon` (prop `stato`: `ok | da-fare | scaduto | parziale | da-pagare | rimborso`, sempre icona + testo), `Amount` (tabellare, negativo `- €`), `CountUp` (rispetta `prefers-reduced-motion` e l'impostazione dell'app), `ReadProgress`, `UndoToast`.
