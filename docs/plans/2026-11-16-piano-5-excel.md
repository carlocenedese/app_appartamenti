# App Bollette: Piano 5, Excel dei conguagli per appartamento e annualità

> **Per gli agenti che eseguono:** SOTTO-SKILL OBBLIGATORIA: usare superpowers:subagent-driven-development (consigliata) oppure superpowers:executing-plans per eseguire il piano task per task. I passi usano la sintassi con casella `- [ ]`.

**Obiettivo:** dal conguaglio calcolato dal core (bollette e rate abbinate agli addebiti, commissioni, forfait incassato, pagamenti registrati) si genera l'`.xlsx` di un appartamento e di un periodo di conguaglio, con i fogli Bollette, Conguagli, Affitti versati e Versamenti conguaglio, sempre con gli stessi byte per gli stessi dati.

**Architettura:** un modello puro del file (`XlsxWorkbook`: fogli, righe, celle tipizzate) costruito da `excel.ts` con `calcConguaglio` e le sue funzioni di ripartizione; uno scrittore puro (`xlsx-write.ts` sopra `zip.ts`, OOXML minimo in uno zip senza compressione, nessuna dipendenza); un caricamento dall'archivio (`excel-store.ts`, con le voci «assunte» di `planMatch`); la riga di comando `pnpm excel` (`scripts/excel.mjs`) che scrive il file. Nessun I/O nel core.

**Stack tecnologico:** TypeScript strict, Zod 4, Vitest; **nessuna dipendenza nuova** (disegno, «Libreria xlsx: nessuna», domanda 10); il lettore Python esistente (`python -I -m bollette_pdf table`) solo nei test.

**Specifica:** il disegno `docs/plans/2026-11-16-piano-5-excel-disegno.md` (decisioni 1-11, «Il file generato», «Mie scelte» 1-6, domande 1, 3-10 **con la risposta di user1 del 16 novembre 2026**, aperte la 2, la 11 e la 12); `docs/spec.md` sezioni 6, 9, 12, 19, 20, 27 e 42 (R1-R8, che prevalgono); `docs/rules/conguaglio-rules.md` (colonne dei fogli R, C e AV); `docs/progress.md` R98, R103, R107, R130. Fuori dal piano 5: file riservato ai proprietari (5b), nota TARI, link alle cartelle, chiusura e versioni, interfaccia.

## Metodo di esecuzione

- Un ramo (`feat/piano-5-excel`), mai su `main`. Per ogni task: test che falliscono, codice, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `TZ=Pacific/Auckland pnpm test`, `TZ=America/Los_Angeles pnpm test`, `pnpm data:check`, `pnpm licenses:check`, commit. Un revisore distinto per task (piano, disegno, qualità), fino a 5 giri; poi una revisione finale e la PR.
- **Un task = un gate di revisione.** Dipendenze: 2 ← 1; 3 ← 2; 4 —; 5 ← 2, 4; 6 ← 5; 7 ← 3, 6.
- Le regole nuove vanno in `docs/progress.md` dalla **prossima R libera** (`grep -n '^- \*\*R[0-9]' docs/progress.md | tail -1`; al 16 novembre 2026 l'ultima su `main` è R132, il piano 3d può averne prese altre). Ogni task scrive la sua R nel passo 3.
- **Le domande 1-10 del disegno avevano risposta aperta durante i task 1-7.** user1 ha risposto il 16 novembre 2026 (disegno, «Domande per user1»): le risposte 3-7 sono i task 8-11 (ramo `feat/piano-5-bis`, regole da R170). Restano aperte la 2 (formato dell'esempio) e le nuove 11 e 12; nessun task le decide.

## Vincoli globali

- Importi in `Cents` interi; nel file gli euro sono testo decimale ricavato dai centesimi con soli interi (`centsToDecimal`), mai `amount / 100`. Date `YYYY-MM-DD`, calcoli solo con `daysBetween`, `addDays`, `monthsInPeriod` di `period.ts`.
- `packages/core` puro: niente `node:*`, rete, `Date.now()`, `new Date()` senza argomenti, `Math.random()`, `crypto.randomUUID()`. Lo scrittore usa solo `TextEncoder` e `Uint8Array`. File system, orologio e `randomUUID` stanno in `scripts/excel.mjs`.
- Deterministico: nessuna data nel file, zip con data fissa, ordini con `compareText`; ingresso mescolato → stessi byte (`toEqual` sui `Uint8Array`).
- Il core non scrive record: nessuna operazione del registro, nessun `rev` cambiato.
- Nessun dato personale nell'uscita della riga di comando né nei messaggi d'errore (R107): solo stato, conteggi, `id` di appartamento e periodo, motivi costanti. Il file `.xlsx` contiene nomi e importi: è il suo scopo.
- Fixture sintetiche, nomi inventati; nei file e nei commit solo `user1`/`user2`. Appartamenti di prova `apt-nord` («Nord», 4 posti) e `apt-sud` («Sud»); inquilini `ten-a`… con nomi inventati («Anna Prova», «Bruno Prova», …); IBAN solo dalla tabella di `fixtures/README.md`.
- I file `.xlsx` generati dai test vanno solo in cartelle temporanee: nessun `.xlsx` nuovo nel repository.
- Licenze: `pnpm licenses:check` invariato (nessun pacchetto nuovo in `package.json` né in `pnpm-lock.yaml`).

## Revisione mirata (Review Focus)

1. **Le due tabelle non divergono (Task 4, 5).** Somma della colonna «Quota nel periodo» del foglio Bollette = somma di `spese + commissione + condominio.rata + condominio.conguaglioPrec` degli inquilini + `unassigned` di `calcConguaglio`, sulla fixture e su varianti (condominio con esercizio maggio-aprile in un'annualità ottobre-settembre, bolletta di 14 mesi, nota di credito negativa).
2. **Solo ciò che è deciso (tutti).** Nessuna formula e nessuna caparra (risposte 1 e 3); fino al task 7 nessuna colonna versato/residuo/stato, riga dei posti vuoti o voce in attesa, che i task 8-10 aggiungono con le risposte 3, 4, 6. Un test per ciascuna.
3. **Byte uguali (Task 1, 2, 5).** Stesso file con l'ingresso mescolato, con i due `TZ`, in due corse.
4. **Validità del file (Task 2, 3).** Il lettore Python, che è stretto (R103: righe e celle in ordine, membri unici, niente DOCTYPE), lo legge; ogni foglio, intestazione, importo e data torna com'era.
5. **Uscita della riga di comando (Task 7).** `scanText` non trova nomi, importi, IBAN né percorsi; un file esistente non si sovrascrive mai.

---

## Task 1: zip senza compressione

**Files:** Create `packages/core/src/zip.ts`, `packages/core/test/zip.test.ts`; Modify `packages/core/src/index.ts`, `docs/progress.md`.

**Interfaces:**

- Consumes: nulla.
- Produces:
  - `crc32(data: Uint8Array): number`: CRC-32 IEEE (polinomio `0xEDB88320`), senza segno.
  - `interface ZipEntry { path: string; data: Uint8Array }`.
  - `zipStored(entries: readonly ZipEntry[]): Uint8Array`: per ogni voce, nell'ordine dato, intestazione locale (`0x04034b50`, versione 20, flag 0, metodo 0, ora 0, data `0x0021` = 1 gennaio 1980, CRC, dimensioni uguali, nessun campo extra) e dati; poi la directory centrale (`0x02014b50`, attributi 0) e la fine (`0x06054b50`). Interi little-endian con `DataView`. `RangeError` (messaggio costante, senza il percorso intero) se: nessuna voce; `path` vuoto, non NFC, con caratteri fuori da `[A-Za-z0-9._/\[\]-]`, che inizia con `/`, con un segmento vuoto, `.` o `..`; due `path` uguali; più di 65 535 voci; una dimensione o uno scostamento oltre `0xFFFFFFFF` (niente zip64).

- [ ] **Step 1: test che falliscono.**
  - `crc32(new TextEncoder().encode('123456789')) === 0xCBF43926`; `crc32(new Uint8Array()) === 0`.
  - Una voce `a.txt` con `abc`: lunghezza totale `30 + 5 + 3 + 46 + 5 + 22`; firme alle posizioni attese; CRC e dimensioni nella locale e nella centrale uguali; la fine dice 1 voce e lo scostamento della directory centrale giusto.
  - Due voci `[Content_Types].xml` e `xl/workbook.xml`: ordine conservato; `zipStored` chiamato due volte → `toEqual`.
  - Rifiuti: `[]`, `''`, `/a`, `a//b`, `a/../b`, `a\\b`, `é.txt` (non NFC), `à.txt`, due `a.txt`.
- [ ] **Step 2:** `pnpm test -- zip` fallisce.
- [ ] **Step 3: implementare**; scrivere la prossima R libera (zip senza compressione, data fissa, nessuna libreria: disegno, domanda 10 aperta, ripiego `fflate` solo dopo approvazione).
- [ ] **Step 4:** lint, typecheck, test con i due `TZ`, copertura passano.
- [ ] **Step 5: commit** `feat(core): zip senza compressione e deterministico per l'Excel (piano 5, task 1)`.

## Task 2: scrittore xlsx

**Files:** Create `packages/core/src/xlsx-write.ts`, `packages/core/test/xlsx-write.test.ts`; Modify `packages/core/src/index.ts`, `docs/progress.md`.

**Interfaces:**

- Consumes: Task 1 (`zipStored`), `Cents`, `ISODate`, `isoDate`, `daysBetween`.
- Produces:
  - `type XlsxCell = { kind: 'text'; value: string } | { kind: 'euro'; value: Cents } | { kind: 'int'; value: number } | { kind: 'date'; value: ISODate }`.
  - `interface XlsxSheet { name: string; rows: readonly (readonly (XlsxCell | null)[])[] }`; `interface XlsxWorkbook { sheets: readonly XlsxSheet[] }`.
  - `columnName(index: number): string` (0 → `A`, 25 → `Z`, 26 → `AA`, 16 383 → `XFD`; fuori → `RangeError`).
  - `centsToDecimal(amount: Cents): string`: sempre due decimali (`123456` → `1234.56`, `-6300` → `-63.00`, `5` → `0.05`, `-5` → `-0.05`), solo interi.
  - `excelSerial(date: ISODate): number` = `daysBetween(isoDate('1899-12-30'), date)`; `RangeError` prima del `1900-03-01` (il 29 febbraio 1900 di Excel).
  - `writeXlsx(workbook: XlsxWorkbook): Uint8Array`: voci dello zip in quest'ordine: `[Content_Types].xml`, `_rels/.rels`, `xl/workbook.xml`, `xl/_rels/workbook.xml.rels`, `xl/styles.xml`, `xl/worksheets/sheet1.xml`…; nessun `docProps`, nessun `sharedStrings`. Stili: `numFmt` 164 `"€ "#,##0.00;"- € "#,##0.00`, 165 `dd/mm/yyyy`; `cellXfs` 0 generale, 1 euro (164), 2 data (165); un font, due fill, un bordo (il minimo valido). Celle: `text` → `t="inlineStr"` con `<is><t xml:space="preserve">`; `euro` → `s="1"` e `<v>centsToDecimal</v>`; `int` → `<v>`; `date` → `s="2"` e `<v>excelSerial</v>`; `null` → nessun elemento; una riga senza celle → nessun `<row>`. Escape di `& < > "` nel testo e nei nomi dei fogli.
  - `RangeError` (messaggi costanti, mai il testo della cella) se: nessun foglio; nome di foglio vuoto, oltre 31 caratteri, con `[ ] : * ? / \`, che inizia o finisce con `'`, ripetuto senza distinguere maiuscole; testo con caratteri non ammessi da XML 1.0 (`\u0000-\u0008`, `\u000B`, `\u000C`, `\u000E-\u001F`, `￾`, `￿`, surrogati soli) o oltre 32 767 caratteri; `int` non intero sicuro; oltre 1 048 576 righe o 16 384 colonne.

- [ ] **Step 1: test che falliscono.**
  - `columnName`, `centsToDecimal`, `excelSerial('1900-03-01') === 61`, `excelSerial('2026-03-16') === 46097`, `excelSerial('1900-02-28')` → `RangeError`.
  - Un foglio `Prova` con `[[text 'Tipo', text 'Importo'], [text 'A&B <x>', euro 123456], [null, date '2026-03-16']]`: l'XML del foglio (letto dallo zip con un piccolo lettore di test che usa le dimensioni della directory centrale) è esattamente quello atteso, con `A&amp;B &lt;x&gt;`, `s="1"` e `<v>1234.56</v>`, `B3` con `s="2"` e `<v>46097</v>`, nessuna cella `A3`.
  - `workbook.xml` elenca i fogli nell'ordine dato con `sheetId` 1…n e `r:id` coerenti con `workbook.xml.rels`; `[Content_Types].xml` ha un `Override` per ogni foglio.
  - Rifiuti: nome `A/B`, nome di 32 caratteri, `Foglio` e `foglio`, testo `a\u0001b`, `int` 1.5.
  - Stesso `XlsxWorkbook` due volte → stessi byte.
- [ ] **Step 2:** `pnpm test -- xlsx-write` fallisce.
- [ ] **Step 3: implementare**; scrivere la prossima R libera (parti OOXML scritte, nessuna formula per la domanda 1, formato euro e data, nessun `docProps`).
- [ ] **Step 4:** lint, typecheck, test con i due `TZ`, copertura passano.
- [ ] **Step 5: commit** `feat(core): scrittore xlsx minimo, puro e deterministico (piano 5, task 2)`.

## Task 3: andata e ritorno con il lettore Python

**Files:** Create `packages/core/test/xlsx-python.test.ts`; Modify `docs/progress.md`.

**Interfaces:**

- Consumes: Task 2 (`writeXlsx`), `pythonAvailability` e `runPython` di `packages/core/test/helpers/python-extract`, `StatementTableSchema`, lo schema dei test esistenti (`statement-table-python.test.ts`: saltato senza Python, obbligatorio con `REQUIRE_PYTHON=1`).
- Produces: solo test. Nessun codice Python nuovo.

- [ ] **Step 1: test che falliscono.** Un `XlsxWorkbook` di due fogli (`Bollette`, `Conguagli`) con testo accentato («Elettricità», «è»), `&`, un euro positivo, uno negativo (`-6300`), un intero, una data, una cella vuota in mezzo; scritto in una cartella temporanea con il nome NFC `Città è.xlsx`; `python -I -m bollette_pdf table <file>` → esce con 0, l'uscita passa `StatementTableSchema`, due fogli con quei nomi e in quell'ordine; il testo torna uguale (`s`); gli euro sono `n` con `Math.round(Number(v) * 100)` uguale ai centesimi; la data è `d` `2026-03-16`; la cella vuota è `null`; le righe hanno il numero di Excel.
- [ ] **Step 2:** `pnpm test -- xlsx-python` fallisce (prima del Task 2 non compila; con Python disponibile, `REQUIRE_PYTHON=1`).
- [ ] **Step 3: implementare** il test; scrivere la prossima R libera (il lettore Python è il controllo di validità; apertura in Excel e Numbers non verificata, la prova a mano è di user1).
- [ ] **Step 4:** `REQUIRE_PYTHON=1 pnpm test` passa in locale con il virtualenv (`PYTHON=<interprete>`), lint e typecheck passano.
- [ ] **Step 5: commit** `test(core): l'xlsx generato si rilegge con il lettore Python (piano 5, task 3)`.

## Task 4: foglio Bollette

**Files:** Create `packages/core/src/excel.ts`, `fixtures/excel/anno-esempio.json`, `packages/core/test/helpers/excel-fixture.ts`, `packages/core/test/excel-items.test.ts`; Modify `packages/core/src/tari-note.ts` (esporta il già esistente `monthRange` come `monthRangeLabel`), `packages/core/src/index.ts`, `fixtures/README.md` (la fixture), `docs/progress.md`.

**Interfaces:**

- Consumes: `calcConguaglio`, `ConguaglioInput`, `ConguaglioResult`, `CostCategory`, `allocateBillToMonths`, `allocateInstalment`, `annualitaRange`, `monthsInPeriod`, `lastDayOfMonth`, `formatEuro`, `compareText`.
- Produces:
  - `interface ExcelItem { itemType: 'bill' | 'instalment'; itemId: string; category: CostCategory; supplier?: string; number?: string; from: ISODate; to: ISODate; dueDate?: ISODate; debitDates: ISODate[]; assumed: boolean; amount: Cents; commission: Cents; inPeriod: Cents; fileName?: string; note?: string }`.
  - `excelItems(input: ConguaglioInput, result: ConguaglioResult): ExcelItem[]`. Voci: bollette e rate vive dell'appartamento con lo stesso filtro di `calcConguaglio` (bolletta `includedInConguaglio && sharedWithTenants`; rata non `straordinaria`; mesi che toccano il periodo, per il condominio anche i 12 mesi dell'esercizio se `conguaglioPrec !== 0`) **e non** in `result.pending` (R2). Campi:
    - `amount`: bolletta e TARI = somma degli abbinamenti confermati `part: 'amount'`; condominio = somma di `rata + conguaglioPrec` di `allocateInstalment(instalment, pagato, esercizio)` su tutti i mesi, cioè la parte degli inquilini (R8, sezione 9);
    - `commission`: somma degli abbinamenti confermati `part: 'commission'` (R7);
    - `inPeriod`: le quote dei soli mesi del periodo di importo e commissione, con le ripartizioni di `calcConguaglio` (bolletta: `allocateBillToMonths` per importo e commissione; rata: `allocateInstalment` più la commissione divisa in parti uguali sui mesi coperti);
    - `debitDates`: `transactionDate` distinte e ordinate degli abbinamenti `amount` non `assumed`; `assumed` vero se tutti gli abbinamenti `amount` sono `assumed`;
    - `number`: `bill.number`; per una rata `Rata <rateIndex> di <rateCount>, <esercizio>`; `supplier`: `bill.supplier`, assente per una rata; `from`/`to`: `periodStart`/`periodEnd`, per una rata `${coversFrom}-01` e `lastDayOfMonth(coversTo)`;
    - `fileName`: l'ultimo segmento di `bill.filePath`; assente per una rata (lacuna 3);
    - `note` (solo bollette con mesi fuori dal periodo, sezione 6): `Bolletta a cavallo: ${formatEuro(fuori)} nei mesi ${monthRangeLabel(primo, ultimo)}, fuori da questo periodo.` con `fuori` = importo + commissione dei mesi fuori.
  - Ordine: `from`, poi la posizione della categoria in `CATEGORY_ORDER` di `conguaglio.ts` (esportata), poi `itemId`.
  - Fixture `anno-esempio.json` (`ExcelFixtureSchema` nel helper di test: `apartments`, `contracts`, `period`, `apartmentId`, `tenants`, `tenancies`, `bills`, `instalments`, `matches`, `payments`), con i casi del disegno («Test»), tra cui: internet 60,00 € `2026-10-01`..`2026-11-30` con commissione 0,80 €; luce 120,00 € `2026-08-01`..`2026-11-30`; gas presunto (`by: 'assumed'`); una bolletta senza abbinamento; TARI comune Nord/Sud (`groupTotal` 18000, pesi 10000 e 8000, addebito unico dal conto di Nord); condominio `rata` 30000, `quotaProprieta` 12000, `rateCount` 3, `conguaglioPrec` 6000, addebito 36000, `condominioStart` 1 ottobre.

- [ ] **Step 1: test che falliscono.**
  - Internet: `amount` 6000, `commission` 80, `inPeriod` 6080, `debitDates` con la data dell'addebito, `assumed: false`, nessuna `note`.
  - Luce: `amount` 12000, `inPeriod` 6000, `note` `Bolletta a cavallo: € 60,00 nei mesi agosto–settembre 2026, fuori da questo periodo.`
  - Gas presunto: `assumed: true`, `debitDates: []`. Bolletta senza abbinamento: assente.
  - Condominio: `amount` 32000 (36000 − 4000 di parte della proprietà), `inPeriod` 32000, `number` `Rata 1 di 3, 2026-27`. TARI di Nord: `amount` 10000.
  - Variante: condominio con `condominioStart` 1 maggio e `conguaglioPrec` 1200 → `inPeriod` con le sole quote dei mesi da ottobre.
  - Review Focus 1: `Σ inPeriod` = `Σ (spese + commissione + condominio.rata + condominio.conguaglioPrec)` degli inquilini + `unassigned`, sulla fixture e sulle varianti (bolletta di 14 mesi, nota di credito di −20,00 €).
  - Ingresso mescolato → stesso risultato (`toEqual`).
- [ ] **Step 2:** `pnpm test -- excel-items` fallisce.
- [ ] **Step 3: implementare**; scrivere la prossima R libera (voci del foglio Bollette, parte degli inquilini del condominio, nota della bolletta a cavallo, «Mie scelte» 1).
- [ ] **Step 4:** lint, typecheck, test con i due `TZ`, copertura, `pnpm data:check` passano.
- [ ] **Step 5: commit** `feat(core): voci del foglio Bollette dal conguaglio (piano 5, task 4)`.

## Task 5: il file completo

**Files:** Modify `packages/core/src/excel.ts`, `packages/core/src/index.ts`, `docs/progress.md`; Test `packages/core/test/excel.test.ts`.

**Interfaces:**

- Consumes: Task 2 (`XlsxWorkbook`, `XlsxCell`, `writeXlsx`), Task 4 (`excelItems`, fixture), `calcConguaglio`, `collectedForfait`, `isPresent`, `MONTH_NAMES`, `Tenant`.
- Produces:
  - `interface ExcelInput extends ConguaglioInput { tenants: Tenant[] }`.
  - `EXCEL_SHEETS = ['Bollette', 'Conguagli', 'Affitti versati', 'Versamenti conguaglio'] as const` e `EXCEL_HEADERS` (un elenco di intestazioni per foglio, quelle del disegno, in un punto solo per la domanda 2):
    - Bollette: `Tipo`, `Fornitore`, `Numero`, `Periodo dal`, `Periodo al`, `Scadenza`, `Addebito`, `Importo`, `Commissione`, `Quota nel periodo`, `File`, `Nota`;
    - Conguagli: `Posto`, `Inquilino`, `Mesi`, `N. mesi`, `Spese`, `Condominio`, `Forfait incassato`, `Conguaglio`;
    - Affitti versati: `Posto`, `Inquilino`, `Quota`, poi un mese per colonna (`ott 2026`);
    - Versamenti conguaglio: `Inquilino`, `Data`, `Importo`, `Mese indicato`, `Origine`.
  - `class ExcelInputError extends Error { code: 'missing-tenant'; tenantIds: string[] }` (domanda 8: un inquilino del periodo senza `Tenant` vivo; messaggio costante).
  - `buildConguaglioWorkbook(input: ExcelInput): XlsxWorkbook` (un `SettlementInputError` di `calcConguaglio` passa così com'è):
    - **Bollette:** una riga per `ExcelItem`; Tipo da `CATEGORY_LABELS` (`Elettricità`, `Gas`, `Acqua`, `Internet`, `Altro`, `TARI`, `Condominio`); Addebito = date `dd/mm/yyyy` separate da `, ` (testo), oppure `assunta, non verificata`; Importo, Commissione, Quota nel periodo in euro; date in celle data.
    - **Conguagli:** una riga per inquilino di `result.tenants`, in ordine: indice in `apartment.rooms` del posto della sua prima presenza nel periodo (senza `rooms` o posto ignoto: dopo), poi primo mese, poi `tenantId`. Posto: i posti delle presenze nel periodo, distinti, separati da `, `; Inquilino: `Tenant.name`; Mesi: per ogni presenza tagliata al periodo `ott – apr` (tre lettere di `MONTH_NAMES`), con l'anno (`mar 2024 – gen 2026`) se il periodo ha più di 12 mesi, presenze separate da `; `; N. mesi: intero; Spese = `spese + commissione`; Condominio = `rata + conguaglioPrec`; Forfait incassato; Conguaglio = `due`. Ultima riga `Totale` con le somme di Spese, Condominio, Forfait incassato e Conguaglio su tutte le righe, N. mesi vuoto.
    - **Affitti versati:** una riga per presenza viva nel periodo, stesso ordine; Quota = `monthlyRent + monthlyForfait`; nella colonna di un mese di presenza le date (`09 ott`) dei `Payment` vivi confermati `canone` dell'inquilino e dell'appartamento per quel mese (`forMonth`, altrimenti il mese della data), in ordine, separate da `, `; vuota senza versamenti o fuori presenza.
    - **Versamenti conguaglio:** `Payment` vivi, confermati, `kind: 'conguaglio'`, dell'appartamento e di un inquilino di `result.tenants`; ordine data, `id`; Importo col segno registrato (R130); Mese indicato `nov 2026` o vuoto; Origine `estratto conto` (`csv`), `a mano` (`manual`), `Excel` (`excel`).
  - Nessuna formula, nessuna colonna versato/residuo/stato, nessuna caparra, nessuna riga dei posti vuoti, nessuna voce in attesa (domande 1, 3, 4, 6).

- [ ] **Step 1: test che falliscono** (sulla fixture):
  - quattro fogli con i nomi di `EXCEL_SHEETS`, intestazioni uguali a `EXCEL_HEADERS`;
  - Bollette: la riga dell'internet ha `Internet`, il fornitore, l'addebito `dd/mm/yyyy`, euro 6000, 80, 6080; il gas `assunta, non verificata`; la luce ha la nota;
  - Conguagli: righe nell'ordine dei posti; l'inquilino che subentra nello stesso posto viene dopo quello che esce; i valori di Spese, Condominio, Forfait incassato e Conguaglio sono quelli di `calcConguaglio`; `Totale` = somme; un credito è un euro negativo;
  - Affitti versati: un mese con due versamenti ha `09 ott, 20 ott`; un mese senza versamento è vuoto;
  - Versamenti conguaglio: +5000 e −1200 col segno; la caparra di −53840 **non** c'è; un `Payment` non confermato o cancellato non c'è;
  - Review Focus 2: nessuna cella testo che inizia con `=`; nessuna intestazione «versato», «residuo», «stato», «caparra», «posti vuoti»; la bolletta in attesa non compare in nessun foglio;
  - un inquilino senza `Tenant` → `ExcelInputError` `missing-tenant` con il suo `id`; due presenze dello stesso inquilino nello stesso mese → `SettlementInputError` `tenant-overlap`;
  - Review Focus 3: `writeXlsx(buildConguaglioWorkbook(input))` con l'ingresso mescolato → stessi byte; uno SHA-256 dei byte (con `node:crypto` nel test) uguale con i due `TZ`.
- [ ] **Step 2:** `pnpm test -- excel` fallisce.
- [ ] **Step 3: implementare**; scrivere la prossima R libera (fogli e colonne del disegno «fino alla risposta» della domanda 2, ordini, «Mie scelte» 2-5, le assenze delle domande 1, 3, 4, 6, la domanda 8).
- [ ] **Step 4:** lint, typecheck, test con i due `TZ`, copertura passano.
- [ ] **Step 5: commit** `feat(core): Excel dei conguagli con i fogli Bollette, Conguagli, Affitti versati e Versamenti (piano 5, task 5)`.

## Task 6: caricamento dall'archivio

**Files:** Create `packages/core/src/excel-store.ts`, `packages/core/test/excel-store.test.ts`; Modify `packages/core/src/match-store.ts`, `packages/core/src/index.ts`, `docs/progress.md`.

**Interfaces:**

- Consumes: Task 5 (`ExcelInput`), `checkConsistency`, `loadAll`, `recordSchemas`, `settlementPeriods`, `planMatch`, `MemoryStore` dei test.
- Produces:
  - `planMatch` restituisce in più `assumedMatches: BillMatch[]` (i `BillMatch` `by: 'assumed'` freschi, già calcolati); `run` e `runMatch` non cambiano (l'uscita di `riconcilia` resta uguale).
  - `type LoadExcelInputResult = { status: 'ok'; input: ExcelInput } | { status: 'refused'; reason: 'inconsistent-store' | 'unknown-apartment' | 'unknown-period' | 'ambiguous-period' }`.
  - `loadExcelInput(store: Store, query: { apartmentId: string; periodLabel: string }): Promise<LoadExcelInputResult>`: `checkConsistency` vuoto, altrimenti `inconsistent-store`; appartamento vivo, altrimenti `unknown-apartment`; periodi = `settlementPeriods(contratto, apartment.annualitaStart)` di ogni `contract` vivo dell'appartamento; nessuno con `label === periodLabel` → `unknown-period`; più di uno con `from`/`to` diversi → `ambiguous-period`. `input`: l'appartamento, il periodo, i record vivi (`tenant`, `tenancy`, `bill`, `instalment`, `payment` dell'appartamento; i `tenant` tutti), `matches` = `BillMatch` vivi salvati + `assumedMatches` (R2: senza estratto le voci sono assunte). Non scrive nulla.

- [ ] **Step 1: test che falliscono.**
  - Archivio in memoria con la fixture `anno-esempio` (record scritti con `writeRecord`), senza estratti per il mese del gas: `loadExcelInput` → `ok`, il gas ha un abbinamento `assumed` e compare nel foglio Bollette come `assunta, non verificata`; con un `statement` che copre quel mese il gas è in attesa e non compare.
  - `buildConguaglioWorkbook(input)` sull'ingresso caricato = quello costruito dalla fixture (stessi byte).
  - Rifiuti: appartamento inesistente o cancellato, periodo `2030-31`, due contratti con lo stesso `label` e mesi diversi, un record `diverged` → nessuna scrittura, registro e archivio identici.
  - `planMatch(store).run` invariato rispetto a prima (test esistenti di `match-store` verdi).
- [ ] **Step 2:** `pnpm test -- excel-store match-store` fallisce.
- [ ] **Step 3: implementare**; scrivere la prossima R libera (`loadExcelInput`, periodo dal contratto, assunte da `planMatch`).
- [ ] **Step 4:** lint, typecheck, test con i due `TZ`, copertura passano.
- [ ] **Step 5: commit** `feat(core): dati dell'Excel di un appartamento e di un periodo dall'archivio (piano 5, task 6)`.

## Task 7: riga di comando `pnpm excel`

**Files:** Create `scripts/excel.mjs`, `scripts/excel.test.mjs`; Modify `package.json` (`"excel": "tsx scripts/excel.mjs"`), `docs/progress.md`.

**Interfaces:**

- Consumes: Task 5 (`buildConguaglioWorkbook`, `ExcelInputError`), Task 6 (`loadExcelInput`), Task 2 (`writeXlsx`), `FsStore`, `findWorkspace` se serve come in `scripts/estratti.mjs`, `assertSafeRelPath`, `SettlementInputError`, `scanText` (test), codici di uscita di R107.
- Produces:
  - `pnpm excel --cartella <dir> --appartamento <id> --periodo <etichetta> --uscita <file.xlsx>` (tutte obbligatorie, nessun argomento posizionale).
  - Controlli prima di leggere i dati: `--cartella` esiste ed è una cartella (`bad-folder`); `--uscita` finisce con `.xlsx` (senza distinguere maiuscole), il nome in NFC passa `assertSafeRelPath`, la cartella che lo contiene esiste (`bad-output`); il file esiste già → codice 1 `file-exists` (sezione 6, «Mie scelte» 6).
  - Scrittura: `writeFileSync(<cartella>/.tmp-<randomUUID()>.xlsx, bytes, { flag: 'wx' })`, `linkSync(tmp, uscita)` (non sovrascrive mai: `EEXIST` → `file-exists`), `unlinkSync(tmp)` sempre, anche in errore.
  - Uscita, una riga JSON: `{ status: 'written', apartmentId, period, sheets: 4, tenants: <n>, items: <n>, pending: <n> }` (`pending` = voci in attesa, domanda 5). Mai nomi, importi o percorsi.
  - Codici: 0 scritto; 1 rifiutato (`inconsistent-store`, `unknown-apartment`, `unknown-period`, `ambiguous-period`, `missing-tenant` con `tenantIds`, `file-exists`, `settlement-input` con il solo `code` del `SettlementInputError`); 2 argomenti non validi (`bad-arguments`, `bad-folder`, `bad-output`); 3 errore inatteso. Messaggi costanti in italiano, come `MESSAGES` di `scripts/estratti.mjs`.

- [ ] **Step 1: test che falliscono.** In una cartella temporanea con la fixture scritta come archivio: `pnpm excel … --uscita <tmp>/Conguaglio.xlsx` → codice 0, il file esiste, i suoi byte sono quelli di `writeXlsx(buildConguaglioWorkbook(…))`; la seconda volta → codice 1 `file-exists` e il file è invariato; nessun `.tmp-*` resta; `--uscita x.csv`, `--uscita <tmp>/CON.xlsx`, `--uscita <tmp>/a:b.xlsx`, cartella di uscita inesistente → codice 2 `bad-output`; `--periodo 2030-31` → codice 1 `unknown-period`; argomento in più → codice 2; Review Focus 5: `scanText` sull'uscita di tutte le corse è vuoto e l'uscita non contiene il percorso.
- [ ] **Step 2:** `pnpm test -- scripts/excel` fallisce.
- [ ] **Step 3: implementare**; scrivere la prossima R libera (comando, nessuna sovrascrittura, uscita senza dati personali, nome e cartella dal percorso dato finché manca la domanda 7).
- [ ] **Step 4:** lint, typecheck, test con i due `TZ`, `pnpm data:check`, `pnpm licenses:check` passano.
- [ ] **Step 5: commit** `feat(cli): pnpm excel scrive l'Excel dei conguagli di un appartamento e di un periodo (piano 5, task 7)`.

## Prima dell'unione

- [ ] Generare con `pnpm excel` il file della fixture `anno-esempio` in una cartella temporanea e chiedere a user1 di aprirlo in Excel (Mac) e, se può, in Numbers: è il «Non verificato» del disegno. Se Excel rifiuta lo zip senza compressione, fermarsi: il ripiego `fflate` è la domanda 10.
- [ ] Elencare a user1 le domande 1-10 ancora aperte nella descrizione della PR.

## Dopo le risposte di user1 (16 novembre 2026): task 8-11

Risposte del disegno: 1 valori (nulla da fare), 2 aperta, 8 rifiuto (già fatto), 9 piano 5b
(`2026-11-16-piano-5b-proprietari.md`), 10 nessuna libreria (già fatto). Le altre sono i task sotto,
sul ramo `feat/piano-5-bis`, con le regole da R170 (gli altri rami prendono R1xx in parallelo).
Ogni task: test rosso, codice, lint, typecheck, test toccati, `TZ=Pacific/Auckland`, commit. Lo
SHA-256 del file della fixture cambia a ogni task che cambia il file: si aggiorna nel test.

### Task 8: riga dei posti vuoti e totale del foglio Bollette (risposta 4)

**Files:** Modify `packages/core/src/excel.ts`, `packages/core/test/excel.test.ts`, `docs/progress.md`.

- Conguagli: prima del `Totale` la riga `Posti vuoti (proprietà)` con Spese =
  `unassignedByBucket.spese + commissione`, Condominio = `rata + conguaglioPrec`, le altre celle
  vuote; il `Totale` somma tutte le righe, quella compresa.
- Bollette: dopo le voci la riga `Totale` con Importo, Commissione e Quota nel periodo.
- Test: Spese + Condominio del `Totale` di Conguagli = Quota nel periodo del `Totale` di Bollette
  (fixture e variante senza posti vuoti, dove la riga vale 0).

### Task 9: versato, residuo e stato (risposta 3)

**Files:** Modify `packages/core/src/excel.ts`, `packages/core/src/excel-store.ts`,
`packages/core/test/excel.test.ts`, `packages/core/test/excel-store.test.ts`, `docs/progress.md`.

- `ExcelInput.nextPeriodFrom?: YearMonth`: il primo mese del periodo di conguaglio successivo (il
  più piccolo `from` maggiore di `period.to` tra i `settlementPeriods` dei contratti vivi
  dell'appartamento); il caricamento lo calcola.
- Versamenti che contano per un inquilino: `Payment` vivi, confermati, `kind: 'conguaglio'`,
  dell'appartamento e di quell'inquilino; con `forMonth` se è nel periodo; senza, se la data è dal
  primo giorno del periodo al giorno prima di `nextPeriodFrom` (senza periodo successivo, nessuna
  fine). Mai `caparra`, mai `caparraReturn`.
- Colonne in fondo a Conguagli: Versato (somma col segno), Residuo (`due − versato`), Stato:
  `saldato` se il residuo è 0 e ogni versamento contato ha origine `csv` (anche nessun versamento con
  `due` 0); `da pagare` se il versato è 0 e il residuo no; altrimenti `parziale`. Totale: Versato e
  Residuo sommati, Stato vuoto; posti vuoti: vuote.
- Test: l'esempio della domanda 3 (50,00 CSV + 70,00 a mano su 120,00 → versato 120,00, residuo 0,
  `parziale`); tutto CSV → `saldato`; nessun versamento → `da pagare`; restituzione negativa (R130);
  `forMonth` fuori dal periodo, data prima del periodo, data nel periodo successivo → non contano;
  caparra non conta; nessun periodo successivo → conta qualunque data dopo la fine.

### Task 10: riga «provvisorio» e voci in attesa (risposte 5 e 6)

**Files:** Modify `packages/core/src/excel.ts`, `packages/core/test/excel.test.ts`, `docs/progress.md`.

- Prima riga di Bollette e Conguagli `Conguaglio provvisorio: voci in attesa N` (N = voci in attesa
  di `calcConguaglio`): nel modello non c'è la chiusura (R5), quindi nessun periodo è chiuso e la riga
  c'è sempre. Le intestazioni passano alla seconda riga.
- In fondo a Bollette, se ci sono voci in attesa: una riga vuota, `Voci in attesa di pagamento`, poi
  una riga per voce con Tipo, Fornitore, Periodo dal, Periodo al nelle loro colonne, nessun importo,
  nell'ordine delle voci.
- Test: la riga in cima con N; la bolletta dell'acqua in attesa elencata senza importo; senza voci in
  attesa nessun elenco e N = 0.

### Task 11: nome e cartella del file (risposta 7)

**Files:** Modify `packages/core/src/accounts.ts` (esporta `apartmentFolder`), `packages/core/src/excel.ts`,
`packages/core/src/index.ts`, `scripts/excel.mjs`, `scripts/excel.test.mjs`, test del core,
`docs/progress.md`.

- `excelFilePath(apartment, period)` →
  `<apartmentFolder(name)>/<period.label>/Excel/Conguaglio_<apartmentFolder(name)>_<period.label>.xlsx`
  (lettere ASCII, `_` e `-`, nessun nome riservato di Windows).
- `pnpm excel`: `--uscita` facoltativo; senza, il percorso è `excelFilePath` sotto `--cartella`, le
  cartelle mancanti si creano, il file esistente resta un rifiuto `file-exists`. L'uscita JSON non
  scrive il percorso.
- Test: nome con accenti e spazi, nome riservato; la riga di comando senza `--uscita` scrive nel
  percorso atteso e la seconda volta rifiuta.


## Autoverifica

- **Copertura del disegno:** obiettivi 1 (modello puro) → Task 4-5; 2 (scrittore deterministico) → Task 1-2; 3 (caricamento con le assunte) → Task 6; 4 (`pnpm excel`) → Task 7; 5 (andata e ritorno Python) → Task 3. Decisioni 1-11: 1 → Task 5 (Bollette e Conguagli); 2 → Task 4-5 (quote dal core, totali su tutte le righe); 3 → Task 4 (fuori i `pending`) e 6 (assunte); 4 → Task 4 (importo addebitato, commissione); 5 → Task 4 (parte degli inquilini, una voce) e 5 (colonna Condominio); 6 → Task 4 (nota); 7 → Task 4 (`fileName`); 8 → Task 5 (ordine e mesi); 9 → Task 2 (formati); 10 → Task 6-7 (periodo dal contratto, nessuna sovrascrittura); 11 → Task 1-2 (nessuna libreria). Domande aperte: nessun task le decide (Review Focus 2).
- **Firme coerenti:** `zipStored` (Task 1) è usato solo da `writeXlsx` (Task 2); `XlsxWorkbook` (Task 2) è prodotto da `buildConguaglioWorkbook` (Task 5) e scritto da `writeXlsx` nel Task 7; `ExcelItem` (Task 4) entra nel foglio Bollette (Task 5); `ExcelInput` (Task 5) è il risultato di `loadExcelInput` (Task 6); `assumedMatches` (Task 6) entra in `ExcelInput.matches`.
- **Review Focus nei test:** 1 → Task 4; 2 → Task 5; 3 → Task 1, 2, 5; 4 → Task 2, 3; 5 → Task 7.

## Seconda risposta di user1 (16 novembre 2026): task 12-14

Domande 11-15 del disegno; regole R177-R179 (R180-R183 sono di un altro ramo).

### Task 12: un versamento senza mese in un periodo solo (D11, D13)

`ExcelInput.periods` (tutti i periodi di conguaglio dei contratti vivi dell'appartamento, al posto di
`nextPeriodFrom`; `loadExcelInput` li dà in ordine, senza doppioni) e `settlementPeriodOf(mese,
periodi)`: un periodo prende i mesi dal suo inizio alla fine del successivo (il primo che inizia dopo
il suo inizio; nessuno: senza fine); tra i periodi che prendono il mese vince uno già finito (quello
che inizia per ultimo), altrimenti quello che inizia per ultimo. Test: fine del periodo successivo
compresa, il mese dopo no, conta una volta sola, periodi sovrapposti.

### Task 13: parole dello stato (D12, D14)

`versato in più` (versato oltre il conguaglio, stesso segno) e `da restituire` (credito
dell'inquilino e nulla restituito); il resto come R172.

### Task 14: colonna «Motivo» delle voci in attesa (D15)

Nell'elenco in fondo al foglio Bollette la colonna Motivo (dopo Periodo al): `in attesa di pagamento`
(nessun addebito), `importo diverso`, `quota maggiore della rata`, dal `reason` di `calcConguaglio`.
