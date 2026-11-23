# Conti ed estratti conto

Ogni appartamento ha il suo conto in banca. Robin legge gli estratti conto (CSV o XLSX) e trova incassi e addebiti.

**Oggi:** riga di comando.

## Profilo della banca

Il profilo dice a Robin come leggere il file della banca: colonne, formato delle date, segno degli importi. Si salva una volta per banca, da un file JSON:

```bash
pnpm estratti profilo --cartella "$CARTELLA" profilo-banca.json
```

## Registrare il conto di un appartamento

```bash
pnpm estratti conto --cartella "$CARTELLA" --appartamento apt-a \
  --profilo bp-esempio --etichetta "Conto A" --iban "<IBAN del conto>"
```

L'IBAN è facoltativo. La risposta dà l'identificativo del conto, che serve per importare.

## Importare un estratto conto

1. Scarica l'estratto dal sito della banca, in CSV o XLSX.
2. Importalo sul conto:

```bash
pnpm estratti importa --cartella "$CARTELLA" --conto acc-apt-a \
  --dal 2025-10-01 --al 2026-09-30 estratto-a.csv
```

`--dal` e `--al` servono solo se il file non dice il periodo. L'originale va in `Riservato_proprietari/Estratti_conto/`.

<!-- IMMAGINE: 04-conti/01-importa.png | La schermata di importazione con il file scelto e il periodo -->

Un movimento già importato da un estratto precedente non si registra due volte.

## Righe in sospeso

Una riga ancora «prenotata» (non contabilizzata) resta in sospeso: la risposta la elenca in `heldRows`. Decidi tu se tenerla o escluderla:

```bash
pnpm estratti decidi --cartella "$CARTELLA" --estratto st-0001 --riga 12 --escludi
pnpm estratti decidi --cartella "$CARTELLA" --estratto st-0001 --riga 12 --tieni
```

## Annullare un'importazione

```bash
pnpm estratti annulla --cartella "$CARTELLA" --estratto st-0001
```

Si tolgono i movimenti dell'estratto e anche le decisioni prese sulle sue righe.

## Esempio completo

1. `conto` per `apt-a`, con il profilo della sua banca.
2. `importa` dell'estratto da ottobre 2025 a settembre 2026.
3. La risposta dice una riga in sospeso, la 12: un incasso prenotato.
4. `decidi --riga 12 --escludi`: l'incasso arriverà nell'estratto successivo.
5. Si passa alla [riconciliazione](06-riconciliazione.md).
