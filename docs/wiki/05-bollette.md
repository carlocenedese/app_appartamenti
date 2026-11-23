# Bollette

Robin legge i PDF delle bollette (luce, gas, acqua, internet, TARI), ne ricava fornitore, periodo, scadenza e importo e li archivia nella cartella giusta.

**Oggi:** riga di comando, in due passi: prima si legge il PDF, poi si registra la lettura. Le schermate di revisione verranno dopo.

## 1. Inserire la bolletta

1. Metti il PDF nella cartella `Da_smistare` dell'appartamento, per esempio `Appartamento A/Da_smistare/`.
2. Aspetta che Dropbox finisca di sincronizzare.

<!-- IMMAGINE: 05-bollette/01-da-smistare.png | La cartella Da_smistare con un PDF appena inserito -->

## 2. Leggere il PDF

Il lettore scrive la lettura in un file JSON. Non registra nulla.

```bash
node scripts/python.mjs -I -m bollette_pdf extract \
  --pdf "$CARTELLA/Appartamento A/Da_smistare/gas-a.pdf" \
  --profiles "$CARTELLA/_app/dati/supplierProfile" \
  --at 2026-04-20 > lettura-gas-a.json
```

`--at` è la data di oggi. Un PDF scansionato si legge con l'OCR (solo su macOS). Con `--pages 3-4` leggi solo alcune pagine.

## 3. Registrare la lettura

```bash
pnpm estratti bolletta --cartella "$CARTELLA" --appartamento apt-a \
  --lettura lettura-gas-a.json "$CARTELLA/Appartamento A/Da_smistare/gas-a.pdf"
```

Due risposte possibili:

- `registrata-automaticamente`: la lettura ha passato tutti i controlli e i codici dell'appartamento tornano;
- `da-rivedere`: qualcosa non torna. `reasons` dice cosa, per esempio «Nessun codice dell'appartamento noto: la lettura va controllata».

<!-- IMMAGINE: 05-bollette/02-da-rivedere.png | Una bolletta da rivedere, con i campi letti accanto al PDF -->

Se è da rivedere, aggiungi `--dettagli` per vedere i campi letti e confrontali con il PDF. Se sono giusti, registra con `--conferma`:

```bash
pnpm estratti bolletta --cartella "$CARTELLA" --appartamento apt-a --conferma \
  --lettura lettura-gas-a.json "$CARTELLA/Appartamento A/Da_smistare/gas-a.pdf"
```

Registrata la bolletta, Robin sposta il PDF nella cartella dell'annualità, per esempio `Appartamento A/2025-26/Gas/2025-11-28_Gas_….pdf`. Lo stesso PDF inserito una seconda volta è riconosciuto e non si registra di nuovo.

Per non ricevere più `da-rivedere` per i codici, scrivi i codici POD e PDR dell'appartamento (vedi [Appartamenti e utenze](02-appartamenti-e-utenze.md)).

## Avviso TARI condiviso

Un avviso TARI per due appartamenti si mette nella `Da_smistare` di uno dei due. Le utenze sull'avviso devono essere collegate agli appartamenti (vedi [Appartamenti e utenze](02-appartamenti-e-utenze.md)). Robin crea una rata per appartamento con la sua parte.

**Esempio.** Avviso di gennaio–aprile 2026 da 186,00 €, con `UTENZA-A` a 100,75 € e `UTENZA-B` a 84,71 €. Inserito in `Appartamento A/Da_smistare/` e registrato con `--appartamento apt-a`, dà una rata per A e una per B.

## Annullare una bolletta

```bash
pnpm estratti annulla-bolletta --cartella "$CARTELLA" \
  "$CARTELLA/Appartamento A/2025-26/Gas/2025-11-28_Gas_INV-0001.pdf"
```

Robin toglie ciò che il PDF aveva creato e lo rimette in `Da_smistare`. Se il file contiene più documenti, con `--pagine 3-4` ne annulli uno solo.
