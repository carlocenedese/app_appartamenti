# Regole di conguaglio ricavate dagli Excel (Task 7)

Approvato da Carlo l'11 novembre 2026, insieme ai valori `expected` della fixture
`fixtures/golden/berchet-2024-25.json`. Le regole di calcolo in vigore sono quelle della
sezione 42 della specifica (R1-R8); questo documento risponde alle domande (a)-(k) del Task 7 con
quello che fanno oggi gli Excel e con la regola che userà l'app. Gli inquilini sono indicati con
lettere (A-L per Berchet 2024-25), mai con il nome. I riferimenti di cella sono ai file:

- Berchet 2024-25: `Lista bollette e conguagli_2025.xlsx`, fogli `RegistroBollette24.25` (R),
  `Conguagli` (C), `Affitti Versati` (AV). È l'annualità conclusa, il banco di prova.
- Lovarini 2024-27: `Lista bollette e conguagli_2024_2027.xlsx` (stessi fogli, registro
  `RegistroBollette_dal_04.2024`).
- Pulci 2025-26: `Lista bollette e conguagli_Set26.xlsx`.
- Estratti conto di ottobre 2026 dei tre conti (`Lista_Operazioni_*.xlsx`).

Inquilini di Berchet 2024-25 (5 posti, tutti occupati tutto l'anno):

| Posto          | Inquilini e mesi                        |
| -------------- | --------------------------------------- |
| Singola        | A ott-apr (7), B mag-set (5)            |
| Doppia marmo 1 | C ott-ago (11), D set (1)               |
| Doppia marmo 2 | E ott-lug (10), F ago-set (2)           |
| Doppia 1       | G ott (1), H nov-lug (9), I ago-set (2) |
| Doppia 2       | J ott-mag (8), K giu-ago (3), L set (1) |

## (a) Arrotondamento e resti

- **Excel:** nessun arrotondamento. Le quote restano decimali (C!J7 = 0,002083…; R!G3 =
  9,2858…) e il «conguaglio da versare» contiene frazioni di centesimo.
- **Regola dell'app:** tutto in centesimi. Una voce si divide prima sui suoi mesi, poi in ogni
  mese per i 5 posti; ogni divisione dà la somma esatta, con i centesimi di resto ai primi mesi e,
  nel mese, ai primi posti nell'ordine dei posti dell'appartamento (Singola, Doppia marmo 1, …).
  La somma delle quote più i posti vuoti è sempre uguale all'importo.
- **Deciso (Carlo):** resti ai primi mesi, poi ai primi posti nell'ordine dei posti dell'Excel.
  L'ordine sta nell'appartamento, nel campo `rooms` (un nome per posto, `Tenancy.room` usa questi
  nomi); per Berchet: Singola, Doppia marmo 1, Doppia marmo 2, Doppia 1, Doppia 2.

## (b) Divisore

- **Excel:** il divisore è il numero di posti, non quello degli inquilini presenti: Berchet `/5`
  (C!J6 `=D6/5+E6/5-H6-I6`), Lovarini `/4` (C!J6 `=D6/4+…`), Pulci `/4` (R!N24 `=N13/4-…`).
- **Regola dell'app:** divisore = posti dell'appartamento (sezione 15). Un posto vuoto in un mese
  resta alla proprietà (`unassigned`).

## (c) Mese di ingresso e di uscita

- **Excel:** a mesi interi, con i mesi scritti a mano per ogni inquilino (C!F6 «Ott - Apr»,
  C!G6 = 7). Nessun caso a metà mese.
- **Regola dell'app:** mesi interi (sezione 6). Il mese di ingresso conta per chi entra e il mese
  di uscita per chi esce; se due inquilini dello stesso posto si sovrappongono nello stesso mese,
  l'app avvisa e chiede a quale dei due assegnarlo.
- **Errori dell'Excel da non replicare:** Lovarini C!G6 `=9+12+1` = 22 mesi per «Mar 24 - Gen 26»,
  che sono 23; in Berchet C!E17 e C!E21 il condominio di I e L è calcolato su R!G17 (una bolletta
  della luce) invece che su R!G16.

## (d) Affitti versati, canone e forfait

- **Excel:** il foglio AV registra solo le date dei versamenti (AV!F6 «09 ott»), non gli importi.
  La «Quota» (AV!E6 = 380 per la Singola, 280 per posto nelle doppie) è il prezzo del posto, forfait
  compreso. Il forfait considerato è quello dovuto: `30 × mesi` (C!H6 `=30*G6`), non quello
  incassato.
- **Regola dell'app:** per le annualità senza estratto conto i versamenti si leggono da AV
  (`source: 'excel'`): una data nel mese vale un versamento di affitto + forfait per intero. Affitto =
  quota − forfait (350 + 30, 250 + 30). Conta il forfait incassato (R4): un mese senza data non
  riduce il dovuto. Un versamento insufficiente copre prima l'affitto, poi il forfait (deciso).
- **Versamenti che non sono canone:** caparre e saldi di conguaglio. Negli estratti di ottobre 2026
  compaiono «Prima rata conguaglio …», «caparra …», «promessa di sottoscrizione contratto …»: tutti
  da classificare a mano (R4). Nel foglio C la colonna I «Conguaglio versato» registra i saldi già
  pagati (C!I7 `=68.28+44.11+10.15`): non sono canone.
- **Deciso (Carlo):** l'inquilino I (Doppia 1, ago-set), senza righe in AV e con C!I17 = −6,47, ha
  pagato affitto e forfait di agosto e settembre: nella fixture ha due versamenti completi.

## (e) Commissione bancaria

- **Excel:** 0,80 € su ogni voce tranne il condominio (R!F3 `=IF(C3="Condominiali", 0, 0.8)`),
  aggiunta all'importo fino ad aprile 2025 (R!G3 `=D3*E3+F3`); da maggio 2025 la colonna F c'è
  ancora ma G non la somma più (R!G17 `=D17*E17`). Lovarini fa lo stesso da giugno 2025 (registro,
  G48 `=D48*F48`). Pulci la somma sempre (R!F2 `=(C2*D2)+E2`).
- **Estratti di ottobre 2026:** la commissione è una riga «Commissioni E Spese Adue» di −0,80 € con
  lo stesso «Cod Disp.» e la stessa data dell'addebito (Lovarini, Hera −92,81 € e −0,80 € il
  27/10/2026; Pulci, Enel e Fastweb il 26/10/2026). Sul conto di Berchet l'addebito Fastweb del
  26/10/2026 non ha commissione.
- **Regola dell'app:** la commissione è solo quella che compare nel CSV (R7), legata dal codice
  disposizione (R20). Per Berchet 2024-25 non c'è estratto: le bollette sono «assunte» e la
  commissione è 0. Differenza per costruzione rispetto all'Excel: in `knownDeviations`.

## (f) Condominio: parte della proprietà e rate

- **Excel:** un'unica riga annua (R!B16 «2023/2024», R!D16 = 2.103,34 €, «Anno 2024/2025») divisa
  per i mesi di presenza `/12` e poi `/5` (C!E6 `=R!G16*(G6/12)`). Nessuna distinzione tra rate,
  parte della proprietà e conguaglio dell'anno prima.
- **Regola dell'app:** R3 (rate da 4 mesi, parte della proprietà sottratta, conguaglio dell'anno
  prima sui 12 mesi). Il condominio non si confronta con l'Excel: le fixture lo escludono da
  `expected` (Task 7).
- **Deciso (Carlo):** i 2.103,34 € dell'Excel sono la quota annua a carico degli inquilini del
  preventivo 2024-25. Le rate di quell'esercizio non sono disponibili, quindi la fixture non ha rate
  di condominio (comunque escluse da `expected`) e il controllo di fine esercizio del Task 9 non si
  applica a questa fixture: varrà dalle annualità con le rate registrate.

## (g) Conguaglio condominiale dell'anno prima

- **Excel:** non compare (nessuna riga per i 1.302,68 € a debito della scheda 2024-25).
- **Deciso (Carlo):** i 1.302,68 € sono a carico della sola proprietà e non entrano nel conguaglio
  2024-25 degli inquilini; la fixture non li registra.

## (h) Giorni tra scadenza e addebito

- **Excel:** la colonna «Data scad» (R!H) c'è, l'addebito no.
- **Estratti di ottobre 2026:** Fastweb scade il 25 del mese (R!H4 25/11/2024, R!H5 25/12/2024)
  e l'addebito arriva il 26 (Berchet, Lovarini e Pulci, 26/10/2026): +1 giorno. Per Hera, Enel e
  la TARI gli estratti di un solo mese non bastano.
- **Deciso (Carlo):** finestra predefinita da 5 giorni prima a 10 giorni dopo la scadenza, uguale
  per tutti i fornitori finché non ci sono più estratti; si stringe per fornitore quando l'app ne ha
  letti almeno sei mesi.

## (i) Righe del CSV da non ripartire

- Negli estratti: «Imposta Di Bollo E/c E Rendiconto» (−8,60 €, Lovarini, 30/09/2026, senza codice
  disposizione); «Commissione Bonifico disposto a favore di BENEFICIARI DIVERSI» (Berchet,
  12/10/2026, legata a un bonifico della proprietà, non a una bolletta); «Pagamento Delega F24»
  (−67,00 €); bonifici al condominio per spese straordinarie; restituzioni di caparre; rate di
  mutuo (giroconti).
- **Regola dell'app:** non si ripartiscono le righe senza una voce abbinata (R7, R20): restano tra i
  movimenti da classificare (piano 3).

## (j) Competenza degli avvisi TARI

- **Excel:** usa quote fisse dell'anno solare, diverse a ogni avviso:
  - terzo avviso del 2024 (101,83 € = `290.42-93.5-95.09`, R!D3): 1/12 a ottobre e
    2/12 a novembre-dicembre (R!E3, R!E7), cioè 25,46 € nell'annualità;
  - avviso gennaio-aprile 2025 (95,48 €, R!D10): per intero;
  - secondo avviso del 2025 (97,93 €, R!D24-D26): 4/8 + 3/8 + 1/8 su gennaio-agosto, con R!G26 = 48,97
    scritto a mano invece della formula (dovrebbe essere 12,24);
  - terzo avviso del 2025 (121,86 €, R!D30): 9/12 su gennaio-settembre (91,40 €).
- **Regola dell'app (R3, decisa):** ogni avviso copre i suoi 4 mesi nuovi: il terzo del 2024
  settembre-dicembre 2024 (3/4 nell'annualità, 76,37 €), il primo del 2025 gennaio-aprile, il
  secondo maggio-agosto (tutti e due per intero), il terzo del 2025 settembre-dicembre (1/4,
  30,47 €). Differenza per costruzione: in `knownDeviations`.

## (k) TARI comune di Berchet e Lovarini

- **Excel:** ognuno dei due file usa l'importo della propria utenza indicato nell'avviso, non
  l'addebito: per l'avviso gennaio-aprile 2025 Berchet 95,48 € (Berchet R!D10) e Lovarini 80,03 €
  (Lovarini, registro D44); per il terzo avviso del 2024 Berchet 101,83 € e Lovarini 85,13 €
  (Lovarini D45). La somma per utenza può differire dall'addebito arrotondato all'euro.
- **Regola dell'app (R3, decisa):** l'addebito unico si divide in proporzione ai totali per utenza
  (`splitSharedDebit`). Per Berchet 2024-25 non c'è estratto: si usa l'importo dell'utenza
  (abbinamento assunto), che coincide con l'Excel.

## Confronto per Berchet 2024-25 (senza condominio)

Spese di ogni inquilino (bollette e TARI, per posto) calcolate con le regole qui sopra, confrontate
con `C!D/5` dell'Excel. Il forfait incassato è 30 € per ogni mese con un versamento in AV.

| Inq. | Mesi | App      | Excel    | Diff.    | Motivi principali                            |
| ---- | ---- | -------- | -------- | -------- | -------------------------------------------- |
| A    | 7    | 150,09 € | 159,83 € | −9,74 €  | commissione; TARI                            |
| B    | 5    | 95,69 €  | 97,26 €  | −1,57 €  | TARI                                         |
| C    | 11   | 233,66 € | 229,43 € | +4,23 €  | TARI (terzo avviso 2024 per 3/4)             |
| D    | 1    | 12,09 €  | 8,02 €   | +4,07 €  | TARI di settembre                            |
| E    | 10   | 212,85 € | 221,43 € | −8,58 €  | commissione; TARI                            |
| F    | 2    | 32,79 €  | 35,66 €  | −2,87 €  | TARI (R!G26 scritto a mano)                  |
| G    | 1    | 22,38 €  | 19,47 €  | +2,91 €  | TARI di ottobre                              |
| H    | 9    | 190,43 € | 187,75 € | +2,68 €  | commissione; TARI                            |
| I    | 2    | 32,78 €  | 49,88 €  | −17,10 € | Excel C!D17 somma tutto il terzo avviso 2025 |
| J    | 8    | 171,03 € | 178,04 € | −7,01 €  | commissione; TARI                            |
| K    | 3    | 62,46 €  | 71,04 €  | −8,58 €  | TARI                                         |
| L    | 1    | 12,08 €  | 8,02 €   | +4,06 €  | TARI di settembre                            |

Totale app 1.228,33 €, Excel 1.265,82 €; posti vuoti 0. Manca la bolletta della luce
settembre-ottobre 2025: la sua metà di settembre appartiene al 2024-25 e arriverà come conguaglio
supplementare (R5).

## Decisioni di Carlo (11 novembre 2026)

1. Resti di centesimo: primi mesi, poi primi posti nell'ordine dell'Excel (a).
2. Inquilino I di Berchet (ago-set 2025): ha pagato affitto e forfait (d).
3. Condominio Berchet 2024-25: i 2.103,34 € sono la quota annua degli inquilini (f).
4. Conguaglio condominiale 2023-24 di 1.302,68 €: solo proprietà, fuori dal conguaglio (g).
5. Finestra di abbinamento da 5 giorni prima a 10 dopo la scadenza (h).
6. Tutte le differenze della tabella sono accettate come `knownDeviations`.
