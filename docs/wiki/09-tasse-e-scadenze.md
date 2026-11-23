# Tasse e scadenze

Robin non contiene aliquote o tassi: li scrivi tu, una volta l'anno.

**Oggi:** riga di comando.

## IMU

**1. L'IMU attesa.** Per ogni appartamento e anno, le rate con importo e scadenza (`numero:importo:data`). Il gruppo unisce gli appartamenti pagati con lo stesso F24.

```bash
pnpm estratti imu-atteso --cartella "$CARTELLA" --appartamento apt-a --anno 2026 \
  --gruppo gruppo-ab --rata 1:600,00:2026-06-16 --rata 2:600,00:2026-12-16
```

**2. L'F24 pagato.** Dopo la riconciliazione, assegna l'addebito dell'F24 alla rata:

```bash
pnpm estratti imu-f24 --cartella "$CARTELLA" --movimento tx-0080 \
  --gruppo gruppo-ab --anno 2026 --rata 1
```

**3. Il controllo.**

```bash
pnpm estratti imu --cartella "$CARTELLA" --anno 2026 --dettagli
```

Una differenza piccola tra atteso e pagato è tollerata. La tolleranza predefinita è l'1%; si cambia con `impostazioni --tolleranza-imu 1,5`, o si riporta al valore predefinito con `impostazioni --tolleranza-imu predefinita`.

<!-- IMMAGINE: 09-tasse/01-imu.png | Il controllo delle rate IMU di un anno -->

## Stime e tabella delle tasse

Le voci sono `cedolare`, `imu`, `registro`, `tari` e `condominio`.

```bash
pnpm estratti tasse-stima --cartella "$CARTELLA" --appartamento apt-a --anno 2026 --voce imu --importo 1200,00
pnpm estratti tasse-copia --cartella "$CARTELLA" --appartamento apt-a --anno 2027
pnpm estratti tasse --cartella "$CARTELLA" --anno 2026 --dettagli
```

`tasse-copia` copia nel 2027 le stime del 2026. `tasse` mostra la tabella per contribuente.

Un addebito di cedolare o registro si assegna con `--parte voce:anno:importo`:

```bash
pnpm estratti tasse-assegna --cartella "$CARTELLA" --movimento tx-0090 --parte cedolare:2026:300,00
```

Una differenza che sai spiegare si conferma con una nota, e non avvisa più:

```bash
pnpm estratti tasse-conferma --cartella "$CARTELLA" --appartamento apt-a --anno 2026 \
  --voce cedolare --note "Acconto pagato in due volte"
```

## Tasso legale

Serve per gli interessi sulla caparra. Uno per anno:

```bash
pnpm estratti tasso-legale --cartella "$CARTELLA" --anno 2026 --tasso 1,6
```

## Scadenze della proprietà

`scadenze` elenca le scadenze della proprietà. Quelle che Robin non conosce dai dati si scrivono a mano. Il tipo è `registro`, `bollo`, `cedolare`, `f24` o `altro`.

**Esempio.** Il saldo della cedolare di Appartamento A, 300,00 € entro il 30 giugno 2026:

```bash
pnpm estratti scadenza-nuova --cartella "$CARTELLA" --appartamento apt-a --tipo cedolare \
  --scadenza 2026-06-30 --importo 300,00 --anno-riferimento 2026
```

Con `--ogni-anno` la scadenza si ripete. La risposta dà l'id della scadenza, che serve ai comandi qui sotto.

```bash
pnpm estratti scadenze --cartella "$CARTELLA" --oggi 2026-10-05 --entro 2026-12-31
pnpm estratti scadenza-pagata --cartella "$CARTELLA" --id pay-0003 --data 2026-06-30
pnpm estratti scadenza-ripeti --cartella "$CARTELLA" --id pay-0003 --scadenza 2027-06-30
```

`scadenza-pagata` accetta il movimento (`--movimento`) o la data. `scadenza-ripeti` crea la stessa scadenza l'anno dopo, con la data che scrivi.

<!-- IMMAGINE: 09-tasse/02-scadenze.png | L'elenco delle scadenze con quelle in arrivo in evidenza -->
