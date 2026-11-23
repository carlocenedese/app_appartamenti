# Come leggere la wiki

## Schermate e riga di comando

Robin ha oggi poche schermate: il primo avvio, le utenze e gli aggiornamenti. Le altre operazioni si fanno dalla riga di comando, con `pnpm estratti`, `pnpm excel` e `pnpm moduli`. Ogni pagina dice quale delle due vie usare oggi. Quando arriveranno le schermate, i passi con le immagini prenderanno il posto dei comandi.

## La cartella dei dati

Tutti i comandi lavorano sulla cartella condivisa del gruppo (per esempio in Dropbox), quella che contiene `_app/`. Negli esempi è nella variabile `CARTELLA`:

```bash
CARTELLA="$HOME/Dropbox/App Bollette"
```

Ogni comando di `pnpm estratti` vuole `--cartella "$CARTELLA"`. Con `--utente user1` l'operazione si registra a nome di chi la fa (senza, il nome è `cli`).

```text
App Bollette/
  Appartamento A/
    Da_smistare/        qui si mettono le bollette di questo appartamento
    Contratti/          contratti e moduli, una cartella per inquilino
    2025-26/            una cartella per annualità, con le bollette smistate e l'Excel
  Riservato_proprietari/   estratti conto ed Excel dei proprietari
  _app/                 dati e registro dell'app: non toccare
```

## Aiuto dei comandi

```bash
pnpm estratti --help
pnpm estratti presenza --help
pnpm excel --help
pnpm moduli --help
```

Il primo elenca i comandi con una riga ciascuno. Il secondo dà le opzioni di un comando.

## Risposta dei comandi

Ogni comando risponde con una riga JSON. I campi più utili:

- `status`: `saved` (salvato), `unchanged` (era già così), `rejected` (rifiutato, con `reason` e `message`);
- `operationId`: l'operazione nel registro, da usare per annullarla (vedi [Annullare e riparare](13-annullare-e-riparare.md)).

Il codice di uscita è 0 se il comando è andato, 1 se è stato rifiutato, 2 se argomenti o file non sono validi, 3 per un errore inatteso.

Nomi, IBAN e importi compaiono solo con `--dettagli`. Senza, la risposta dà solo conteggi e identificativi, così si può copiare senza paura.

## Formati

| Cosa               | Formato                 | Esempio                     |
| ------------------ | ----------------------- | --------------------------- |
| Importo            | virgola per i centesimi | `350,00`, `-15,00`          |
| Data               | `AAAA-MM-GG`            | `2026-03-16`                |
| Mese               | `AAAA-MM`               | `2026-03`                   |
| Periodo, esercizio | `AAAA-AA`               | `2025-26`                   |
| Identificativo     | lettere, cifre e `-`    | `apt-a`, `t-uno`, `tcy-uno` |

Gli identificativi li scegli tu quando crei un record. Se manca `--id`, l'app ne crea uno e lo scrive nella risposta.

Un importo negativo si scrive anche con `=`: `--importo=-15,00`.
