# Caparra e moduli Word

**Oggi:** riga di comando.

## Prospetto di restituzione della caparra

Quando un inquilino esce, Robin prepara il prospetto della caparra: versato, interessi al tasso legale (vedi [Tasse e scadenze](09-tasse-e-scadenze.md#tasso-legale)), conguaglio e addebiti.

```bash
pnpm estratti caparra-restituzione --cartella "$CARTELLA" --appartamento apt-a --inquilino t-due --dettagli
```

Il conguaglio arriva dal calcolo; con `--conguaglio 35,00` lo scrivi tu. Un addebito in più si aggiunge con `--addebito descrizione:importo`, anche più volte:

```bash
pnpm estratti caparra-restituzione --cartella "$CARTELLA" --appartamento apt-a --inquilino t-due \
  --addebito "Pulizia finale:60,00" --dettagli
```

<!-- IMMAGINE: 11-caparra/01-prospetto.png | Il prospetto di restituzione della caparra -->

La restituzione vera si registra come uscita verso l'inquilino (vedi [Uscite e giroconti](07-uscite-e-giroconti.md#unuscita-verso-un-inquilino)).

## Scheda riservata dell'inquilino

Codice fiscale e documento servono ai moduli e non compaiono mai nelle risposte. Si salvano da un file JSON:

```json
{
  "codice_fiscale": "XXXINVENTATO",
  "documento_numero": "DOC-INVENTATO-1",
  "documento_ente": "Comune Esempio",
  "documento_rilascio": "2020-01-01",
  "documento_scadenza": "2030-01-01"
}
```

```bash
pnpm estratti scheda-inquilino --cartella "$CARTELLA" --inquilino t-uno --valori scheda-t-uno.json
```

Cancella il file JSON dopo averlo salvato.

## Moduli da modello Word

I tipi sono: `promessa`, `subentro`, `conferma-cauzione`, `impegno-canone`, `aumento-prezzi`, `conferma-disdetta`, `restituzione` e `contratto`.

**1. Il modello.** La prima volta, fatti dare il modello vuoto del tipo:

```bash
pnpm moduli --vuoto --tipo promessa --uscita modello-promessa.docx
```

Aprilo in Word e scrivi il testo come vuoi. I campi sono segnaposto come `{{nome}}`: Robin li sostituisce.

<!-- IMMAGINE: 11-moduli/01-modello-word.png | Il modello Word con i segnaposto tra doppie graffe -->

**2. Il modulo di un inquilino.**

```bash
pnpm moduli --cartella "$CARTELLA" --tipo promessa --presenza tcy-uno \
  --modello modello-promessa.docx --valori valori-promessa.json --oggi 2026-10-20
```

Robin riempie ciò che sa dai dati (inquilino, appartamento, canone, scheda) e salva il file nella cartella `Contratti` dell'appartamento, nella sottocartella dell'inquilino. I campi che non conosce, come la decorrenza o la durata, li prende da `--valori`. Se ne manca uno, la risposta dice quale.

**Esempio di `valori-promessa.json`:**

```json
{
  "decorrenza": "2025-10-01",
  "durata_contratto_mesi": "12",
  "firma_entro": "2025-09-20",
  "tipo_promessa": "nuovo",
  "uscita_prevista": "2026-09-30"
}
```
