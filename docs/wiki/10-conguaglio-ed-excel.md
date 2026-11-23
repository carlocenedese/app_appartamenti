# Conguaglio ed Excel

Il conguaglio confronta, per ogni inquilino, le spese del periodo con gli acconti versati. Il periodo si scrive `AAAA-AA`, per esempio `2025-26`, e comincia nel mese scritto nell'appartamento (`--annualita`).

**Oggi:** riga di comando.

## Il cruscotto

```bash
pnpm estratti cruscotto --cartella "$CARTELLA" --oggi 2026-10-20
pnpm estratti cruscotto --cartella "$CARTELLA" --oggi 2026-10-20 \
  --periodo-conguaglio apt-a:2025-26 --periodo-conguaglio apt-b:2025-26 --dettagli
```

Mostra, per appartamento, cosa è da rivedere, le scadenze vicine e lo stato del conguaglio (`provvisorio` o `chiuso`).

<!-- IMMAGINE: 10-conguaglio/01-cruscotto.png | Il cruscotto con i conteggi per appartamento -->

## Il file Excel per gli inquilini

```bash
pnpm excel --cartella "$CARTELLA" --appartamento apt-a --periodo 2025-26
```

Il file va nella cartella `Excel` dell'annualità dell'appartamento. La risposta dice il percorso; con `--uscita file.xlsx` lo scegli tu. In basso a ogni foglio c'è «Generato il» con la data di oggi, o con quella di `--oggi`.

Finché ci sono voci in attesa (una bolletta non ancora addebitata, per esempio), la prima riga dice «Conguaglio provvisorio: voci in attesa N».

<!-- IMMAGINE: 10-conguaglio/02-excel-inquilini.png | Il foglio «Conguagli» dell'Excel per gli inquilini -->

## Il file dei proprietari e quello del commercialista

```bash
pnpm excel --cartella "$CARTELLA" --appartamento apt-a --periodo 2025-26 --proprietari
pnpm excel --cartella "$CARTELLA" --tasse 2026
```

Il primo è riservato ai proprietari, con tutti gli importi. Il secondo è per il commercialista: le tasse dell'anno, senza appartamento e periodo.

## Chiudere il periodo

Si chiude quando sono incassati tutti gli affitti e i forfait e non c'è nessuna voce in attesa.

```bash
pnpm estratti chiudi-periodo --cartella "$CARTELLA" --appartamento apt-a --periodo 2025-26
```

Se manca qualcosa, Robin rifiuta con `cannot-close` e l'elenco di cosa manca: inquilino, mese, tipo o voce. Con `--dettagli` vedi anche gli importi. Se l'appartamento ha una TARI condivisa, serve anche l'addebito della rata TARI di dicembre.

Alla chiusura Robin salva un'istantanea del conguaglio. L'Excel dice allora «Conguaglio chiuso il GG/MM/AAAA».

## Dopo la chiusura

**Segnare l'invio agli inquilini:**

```bash
pnpm estratti invia-conguaglio --cartella "$CARTELLA" --appartamento apt-a --periodo 2025-26 --data 2026-11-20
```

**Segnare saldato il conguaglio di un inquilino**, con il movimento se c'è:

```bash
pnpm estratti conguaglio-saldato --cartella "$CARTELLA" --appartamento apt-a --periodo 2025-26 \
  --inquilino t-uno --data 2026-12-01 --movimento tx-0120
```

**Il forfait «da verificare» di un inquilino.** L'esito è `rimborso`, `credito` o `stessi-soldi`:

```bash
pnpm estratti forfait-verificato --cartella "$CARTELLA" --appartamento apt-a --periodo 2025-26 \
  --inquilino t-uno --data 2026-12-01 --esito credito
```

## Conguaglio supplementare

Se dopo la chiusura arriva una bolletta tardiva o cambia un costo, serve un conguaglio supplementare. Robin lo segnala nel cruscotto e nell'Excel.

```bash
pnpm estratti conguaglio-supplementare --cartella "$CARTELLA" --appartamento apt-a --periodo 2025-26 --dettagli
```

Per ogni inquilino dice l'azione: `nessuna`, `da-pagare`, `da-rimborsare` o `da-trattenere-o-richiedere` (chi è già partito). Il saldo si segna con `conguaglio-saldato --supplementare`.

**Esempio.** Alla chiusura ad A toccavano 120,00 € di spese. Arriva una bolletta della luce da 90,00 € per luglio–settembre: il supplementare dice a ogni inquilino quanto della differenza gli tocca.

## Riaprire un periodo chiuso

```bash
pnpm estratti riapri-periodo --cartella "$CARTELLA" --appartamento apt-a --periodo 2025-26 \
  --data 2026-12-05 --motivo "Bolletta del gas corretta dal fornitore"
```

L'istantanea resta nello storico. Dopo una riapertura, un canone che manca si segna con `canone-non-incassato`, con esito `richiesto`, `saldato` o `non-recuperabile`.
