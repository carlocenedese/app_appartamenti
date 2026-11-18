# Strumenti

Script di supporto per il lavoro sui dati di partenza. Non fanno parte dell'app e non hanno
effetto sul suo codice.

## excel_dump.py

Legge un file Excel (`.xlsx`) e stampa su stdout un unico documento JSON con, per ogni foglio, il
nome, l'intervallo occupato (`dimensions`), gli intervalli uniti (`merged`) e tutte le celle non
vuote: coordinata, riga e colonna, formula (`null` se la cella contiene un valore), valore
calcolato, tipo (`n` numero, `s` testo, `b` booleano, `d` data, `e` errore) e formato numerico.
Serve a leggere le formule e i valori degli Excel reali per ricavare le regole di conguaglio
(Task 7 del piano 1).

I valori sono quelli che Excel ha salvato nel file l'ultima volta: lo script non ricalcola nulla.
Un file scritto da un programma e mai aperto in Excel ha quindi `"value": null` nelle celle con
formula. Le date sono stringhe ISO 8601.

Lo script legge soltanto il file indicato: non scrive file, non usa la rete e non stampa altro che
il JSON su stdout. Gli errori (file mancante, file non `.xlsx`, foglio inesistente) vanno su
stderr con codice di uscita 2.

I file reali (Excel, estratti conto, PDF) restano fuori dal repository, in una cartella locale:
`.gitignore` li esclude, e `pnpm data:check` controlla i file tracciati. Non salvare in `tools/`
l'output dello script: contiene i dati dei file.

### Uso

Serve Python 3 con [openpyxl](https://openpyxl.readthedocs.io) (licenza MIT):
`python3 -m pip install openpyxl`.

```sh
python3 -I tools/excel_dump.py /percorso/fuori/dal/repository/file.xlsx > /percorso/fuori/dal/repository/file.json
python3 -I tools/excel_dump.py file.xlsx --sheet "Affitti Versati"
python3 -I tools/excel_dump.py file.xlsx --formulas-only
```

- `--sheet NOME` limita l'output a un foglio; si può ripetere. L'ordine dell'output è sempre
  quello della cartella di lavoro.
- `--formulas-only` stampa solo le celle con formula.
- L'output è su una riga sola e ordinato (fogli, poi righe, poi colonne): per leggerlo si può
  passare da `python3 -m json.tool`.

### Test

```sh
pnpm tools:test
```

Esegue `python3 -I -m unittest discover -s tools -p 'test_*.py'`. I test costruiscono da soli
piccole cartelle di lavoro con valori inventati in una cartella temporanea.

## anonymise.py

Rende anonimo un documento JSON costruito dai dati reali prima che diventi una fixture (Task 7 del
piano 1). Si usa su file che stanno fuori dal repository e scrive il risultato dove serve, di
solito in `fixtures/golden/`.

```sh
python3 -I tools/anonymise.py --map /fuori/dal/repository/map.json /fuori/dal/repository/raw.json fixtures/golden/app-a-2024-25.json
```

Il file `map.json` (fuori dal repository) dice cosa sostituire e cosa non deve sopravvivere:
`{"replace": {"<testo reale>": "<testo fittizio>"}, "forbid": ["<testo reale>"]}`. Per ogni testo
del documento, chiavi comprese:

1. applica le sostituzioni di `replace` a parole intere, senza distinguere maiuscole e minuscole,
   dalla più lunga alla più corta;
2. sostituisce con i codici d'esempio di `fixtures/README.md` IBAN, codici fiscali, POD, PDR (ogni
   sequenza di esattamente 14 cifre) e indirizzi e-mail, e cancella i link;
3. controlla che nessun testo di `replace` o di `forbid` compaia ancora come parola intera: se ne
   trova, non scrive niente ed esce con codice 1.

Non stampa mai i testi che sostituisce o trova, solo quanti sono. Errori di lettura: codice 2.
