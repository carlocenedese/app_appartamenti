# Piano 12: moduli e documenti generati, core e riga di comando (disegno)

Stato: **bozza da approvare da user1** (16 novembre 2026). Il piano di implementazione è
`docs/plans/2026-11-16-piano-12-moduli.md`. Il piano copre il core (`packages/core`) e la riga di
comando (`pnpm moduli`); **niente schermate**. Riferimenti: `docs/spec.md` sezioni 17, 20, 26, 31 e
42 (che prevale), `docs/progress.md` R107, R150-R156, R173, R176, R203. Codice letto: `zip.ts`,
`xlsx-write.ts`, `excel.ts` (`excelFilePath`), `accounts.ts` (`apartmentFolder`), `excel-store.ts`,
`caparra.ts`, `interest.ts`, `model.ts` (`Apartment`, `Contract`, `Tenancy`, `Tenant`, `Account`),
`scripts/excel.mjs`; del piano 11 (ramo `feat/piano-11-subentro`, non ancora su `main`) R220-R225.
Nessun modulo reale aperto: la cartella «99.Modulistica aggiornata» non è nel repository e non si
legge. Nomi e importi inventati.

## Perché

La sezione 26 chiede che l'app prepari i moduli (promessa di contratto, subentro, conferma di
cauzione, impegno sul canone, aumento dei prezzi, conferma di disdetta, restituzione della cauzione,
contratto per studenti) partendo **da un modello Word modificabile dai proprietari** in cui l'app
sostituisce i segnaposto con i dati che ha già, chiedendo solo quelli che mancano. Il file va nella
cartella `Contratti` dell'appartamento, sottocartella dell'inquilino (sezione 20).

## Obiettivo

1. **Riempimento di un modello `.docx`** (core puro): byte del modello + valori → byte del documento.
   I segnaposto sono `{{nome_campo}}` (minuscole, cifre, `_`) nel testo del documento, delle
   intestazioni, dei piè di pagina e delle note. Word spezza spesso un segnaposto in più «run»: il
   confronto si fa sul testo unito del paragrafo e il valore va nel primo run (la formattazione
   resta quella del primo carattere del segnaposto).
2. **Campi per modulo** (`MODULE_KINDS`, `MODULE_FIELDS`): i campi che l'app riempie dai record
   (appartamento, locatore, indirizzo, dati catastali, inquilino, posto, canone, contratto,
   registrazione, IBAN, data del documento, durata residua) e quelli **richiesti** di ogni modulo
   (colonna «Dati richiesti» della sezione 26), che user1 passa a ogni generazione in un file di
   valori. Un segnaposto che il modulo non conosce, un campo senza valore, un `{{` rimasto aperto:
   **rifiuto**, mai un documento compilato a metà.
3. **Modello di prova** per ogni modulo: un `.docx` con titolo, una riga di testo **dichiaratamente
   inventata** e l'elenco dei campi come segnaposto. Non contiene clausole né testi giuridici: il
   testo vero lo mettono i proprietari nel loro modello.
4. **Riga di comando** `pnpm moduli`: genera un documento in `<Appartamento>/Contratti/<Inquilino>/`
   o in `--uscita`, mai sopra un file esistente, con la stessa scrittura dell'Excel (R156, R176);
   scrive il modello di prova con `--vuoto`.

## Non obiettivi

- **PDF** (domanda 1): nessuna libreria con licenza ammessa trasforma un `.docx` in PDF; il PDF si
  ottiene oggi con «Salva come PDF» di Word.
- Testi dei moduli, clausole, scelte fiscali: li fornisce user1 nei modelli.
- Importi suggeriti dalla sezione 26 (caparra di 500 euro, scadenza del versamento a 2 giorni,
  imposta di 67 euro, 15 giorni per i danni): **mai nel codice**; sono campi richiesti.
- Tabella di restituzione calcolata: è del piano 11 (`deposit.ts`, `caparra-restituzione`), non ancora
  su `main`; qui i suoi importi sono campi richiesti (domanda 6).
- Scheda dell'inquilino con codice fiscale e documento d'identità (sezione 26): dove conservarla è la
  domanda 3; oggi questi dati arrivano solo dal file di valori e non si salvano.
- Stato «da firmare», riconoscimento del documento firmato in `Da_smistare`, registro delle
  modifiche (domande 4 e 5): nessun record nuovo in questo piano.
- Contratto con più inquilini (righe ripetute per inquilino): domanda 7.

## Riempimento del modello

`fillDocx(template, values, inflateRaw)` in `docx.ts`:

- **Lettura dello zip** (`readZip`): directory centrale, dimensioni dalla directory centrale, metodi
  0 (stored) e 8 (deflate). Il deflate si decomprime con `inflateRaw`, **argomento** (nel core niente
  `node:zlib`; la riga di comando passa `inflateRawSync`). CRC-32 controllato. Rifiuto `bad-template`
  per: non uno zip, zip cifrato o zip64, metodo diverso, CRC o dimensione sbagliati, un percorso che
  `zipStored` non accetta, nessun `word/document.xml`.
- **Parti lette:** `word/document.xml`, `word/header*.xml`, `word/footer*.xml`,
  `word/footnotes.xml`, `word/endnotes.xml`. Tutte le altre voci passano intatte.
- **Segnaposto:** testo dei `<w:t>` unito per parte, con un separatore a ogni fine paragrafo, così un
  segnaposto non attraversa due paragrafi. `{{…}}` con un nome non `[a-z0-9_]+` → `bad-placeholder`;
  un `{{` rimasto dopo la sostituzione → `unclosed-placeholder`.
- **Valori:** testo; entità XML codificate; un a capo diventa `<w:br/>`; un carattere non ammesso da
  XML → `bad-value` con il nome del campo. Un segnaposto senza valore → `missing-fields`.
- **Scrittura:** `zipStored` (stesso ordine delle voci, date fisse): stessi byte per gli stessi
  ingressi. Solo i `<w:t>` toccati cambiano.

`docxPlaceholders(template, inflateRaw)` dà i nomi dei segnaposto (ordinati, una volta).

## Campi

Campi dell'app (`source: 'app'`), uguali per tutti i moduli; date `GG/MM/AAAA`, mesi `MM/AAAA`,
importi `€ 1.234,56`. Un campo dell'app senza dato (per esempio l'indirizzo non scritto) si può dare
nel file di valori; dare un campo che l'app ha già → `field-from-app` (i dati vengono dalla scheda,
regola 4 della sezione 26).

| Campo | Da dove |
| --- | --- |
| `data_documento` | `today` (argomento) |
| `appartamento`, `locatore`, `indirizzo`, `posti` | `Apartment` |
| `dati_catastali` | `Apartment.cadastre`, «foglio …, particella …, sub …» separati da «; » (come R215) |
| `iban` | l'IBAN dell'unico conto vivo dell'appartamento che ne ha uno; più IBAN diversi: assente |
| `inquilino` | `Tenant.name` |
| `posto`, `ingresso`, `uscita_prevista` | `Tenancy.room`, `from`, `to` (mesi) |
| `affitto_mensile`, `forfait_mensile` | `Tenancy.monthlyRent`, `monthlyForfait` |
| `canone_camera` | affitto + forfait della presenza (sezione 26: il prezzo della camera comprende il forfait) |
| `tipo_contratto`, `inizio_contratto`, `fine_contratto`, `durata_contratto_mesi` | il contratto vivo che collega la presenza (`tenancyIds`) |
| `firmato_il`, `codice_registrazione`, `registrato_il`, `regime_fiscale` | stesso contratto |
| `acconto_spese_mensile` | voce di `Contract.rent` in vigore nel mese di `today` |
| `durata_residua_mesi` | mesi interi dall'ingresso alla fine del contratto, compresi (sezione 26: 08/2026-09/2027 = 14) |

Campi richiesti (`source: 'asked'`), dalla colonna «Dati richiesti» della sezione 26:

| Modulo (`kind`) | Campi richiesti |
| --- | --- |
| `promessa` | `codice_fiscale`, `documento_numero`, `documento_ente`, `documento_rilascio`, `documento_scadenza`, `firma_entro`, `decorrenza`, `tipo_promessa`, `inquilino_uscente`, `importo_caparra`, `scadenza_versamento` |
| `subentro` | come `promessa`, più `codice_contratto_cessione` |
| `conferma-cauzione` | `nuovo_canone`, `durata_mesi`, `decorrenza`, `caparra_versata` |
| `impegno-canone` | `canone_massimo`, `periodo` |
| `aumento-prezzi` | `nuovo_canone` |
| `conferma-disdetta` | `data_recesso`, `mezzo_disdetta`, `data_disdetta`, `fine_anticipata` |
| `restituzione` | `data_consegna_chiavi`, `stato_locali`, `caparra`, `interessi_legali`, `quota_bollette`, `quota_adempimento`, `quota_pulizia`, `saldo` |
| `contratto` | `codice_fiscale`, `luogo_nascita`, `data_nascita`, `residenza`, `corso_studi`, `deposito`, `classe_energetica`, `superficie`, `caratteristiche_alloggio`, `accordo_territoriale` |

Ogni campo richiesto è testo libero: l'app non lo interpreta e non lo controlla (nessuna regola).
Un campo dell'elenco che il modello non usa non serve.

## Dove va il file

`moduleFilePath(apartment, tenant, kind, today)` =
`<Appartamento>/Contratti/<Inquilino>/<AAAA-MM-GG>_<Modulo>.docx` con `apartmentFolder` per le due
cartelle (lettere ASCII, cifre, `_`, `-`, mai un nome riservato di Windows) e il `kind` come nome
del modulo. Il percorso contiene il nome dell'inquilino: **mai** nell'uscita della riga di comando.

## Riga di comando

`pnpm moduli --cartella <dir> --tipo <kind> --presenza <tenancyId> --modello <file.docx>
[--valori <file.json>] [--oggi <AAAA-MM-GG>] [--uscita <file.docx>]`:

- `--valori`: un oggetto JSON di testi (`{ "codice_fiscale": "…" }`); i dati personali restano nel
  file di user1 e non passano dalla riga di comando.
- Uscita, una riga JSON: `{ status: 'written', kind, tenancyId, fields, appFields, askedFields }`
  (conteggi); un rifiuto ha `reason`, `message` costante e, dove serve, `fields` (**nomi** dei
  campi, mai valori). Codici: 0 scritto, 1 rifiuto, 2 argomenti, 3 errore inatteso (R107).
- Senza `--uscita` il file va in `moduleFilePath` sotto `--cartella`, con i controlli delle cartelle
  di R176; mai sopra un file esistente (`file-exists`).
- `pnpm moduli --vuoto --tipo <kind> --uscita <file.docx>`: il modello di prova.

Le funzioni di scrittura di `scripts/excel.mjs` (percorso di uscita, cartelle predefinite, scrittura
con collegamento) passano in `scripts/output-file.mjs` e servono a tutti e due i comandi.

## Lettura dall'archivio

`loadModuleData(store, { tenancyId })` (`module-store.ts`): rifiuti `inconsistent-store`
(`checkConsistency`), `unknown-tenancy`, `unknown-apartment`, `unknown-tenant`,
`ambiguous-contract` (la presenza è in due contratti vivi); altrimenti `{ apartment, tenant,
tenancy, contract?, ibans }`. Sola lettura: nessuna operazione nel registro (domanda 5).

## Domande per user1

1. **PDF:** la sezione 26 chiede anche il PDF. Senza dipendenze nuove si ottiene solo da Word
   («Salva come PDF»); una conversione automatica richiederebbe LibreOffice installato a parte
   (MPL, che i vincoli vietano come libreria). Va bene così per ora?
2. **Modelli:** dove stanno i modelli dei proprietari (una cartella `Riservato_proprietari/Modelli/`?)
   e se serve un modello per lingua (italiano e inglese, «lingua dei messaggi»).
3. **Scheda dell'inquilino:** codice fiscale, documento d'identità, nascita, residenza, corso di
   studi sono dati sensibili (sezione 26): in quale parte riservata si conservano, o si chiedono ogni
   volta come ora?
4. **«Da firmare» e documento firmato:** serve un record del documento generato con il suo stato, e
   come si riconosce il firmato rimesso in `Da_smistare`?
5. **Registro:** la generazione di un documento va nel registro delle modifiche?
6. **Restituzione:** la tabella (caparra, interessi, bollette, quota adempimento, pulizia, saldo)
   va presa dal prospetto del piano 11 quando sarà su `main`, o resta un dato inserito?
7. **Contratto con più inquilini:** il contratto per studenti elenca l'anagrafica di ciascun
   inquilino: servono righe ripetute nel modello?
8. **Versioni più recenti:** quali sono le versioni dei moduli da usare come base (sezione 26, «Da
   chiarire»), per controllare che l'elenco dei campi sia completo.
9. **Durata residua e date:** `durata_residua_mesi` conta i mesi interi dall'ingresso alla fine del
   contratto (esempio della sezione 26); `fine_contratto` è scritto come mese (`09/2027`) e non come
   ultimo giorno (`30/09/2027`): va bene?
