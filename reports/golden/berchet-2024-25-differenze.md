# Differenze tra Excel e app: berchet-2024-25

Generato da `pnpm golden:report` da `fixtures/golden/berchet-2024-25.json`: non modificarlo a mano.

Periodo 2024-25 (2024-10 – 2025-09), 5 posti. Valori dell'app approvati da: Carlo, 11 novembre 2026.
Condominio escluso (sezione 42, R3). Differenza = app − Excel.

## Spese per inquilino e voce

| Inquilino | Voce | Excel | App | Differenza |
| --- | --- | ---: | ---: | ---: |
| ten-a | Luce | € 74,20 | € 73,75 | - € 0,45 |
| ten-a | Internet | € 43,05 | € 41,93 | - € 1,12 |
| ten-a | TARI | € 42,58 | € 34,41 | - € 8,17 |
| ten-a | **Totale** | € 159,83 | € 150,09 | - € 9,74 |
| ten-b | Luce | € 40,02 | € 40,04 | € 0,02 |
| ten-b | Internet | € 29,95 | € 29,95 | € 0,00 |
| ten-b | TARI | € 27,29 | € 25,70 | - € 1,59 |
| ten-b | **Totale** | € 97,26 | € 95,69 | - € 1,57 |
| ten-c | Luce | € 94,57 | € 113,78 | € 19,21 |
| ten-c | Internet | € 67,01 | € 65,89 | - € 1,12 |
| ten-c | TARI | € 67,85 | € 53,99 | - € 13,86 |
| ten-c | **Totale** | € 229,43 | € 233,66 | € 4,23 |
| ten-d | Internet | € 5,99 | € 5,99 | € 0,00 |
| ten-d | TARI | € 2,03 | € 6,10 | € 4,07 |
| ten-d | **Totale** | € 8,02 | € 12,09 | € 4,07 |
| ten-e | Luce | € 104,39 | € 103,90 | - € 0,49 |
| ten-e | Internet | € 61,02 | € 59,90 | - € 1,12 |
| ten-e | TARI | € 56,02 | € 49,05 | - € 6,97 |
| ten-e | **Totale** | € 221,43 | € 212,85 | - € 8,58 |
| ten-f | Luce | € 9,82 | € 9,82 | € 0,00 |
| ten-f | Internet | € 11,98 | € 11,98 | € 0,00 |
| ten-f | TARI | € 13,86 | € 10,99 | - € 2,87 |
| ten-f | **Totale** | € 35,66 | € 32,79 | - € 2,87 |
| ten-g | Luce | € 11,46 | € 11,30 | - € 0,16 |
| ten-g | Internet | € 6,15 | € 5,99 | - € 0,16 |
| ten-g | TARI | € 1,86 | € 5,09 | € 3,23 |
| ten-g | **Totale** | € 19,47 | € 22,38 | € 2,91 |
| ten-h | Luce | € 92,93 | € 92,58 | - € 0,35 |
| ten-h | Internet | € 54,87 | € 53,91 | - € 0,96 |
| ten-h | TARI | € 39,95 | € 43,94 | € 3,99 |
| ten-h | **Totale** | € 187,75 | € 190,43 | € 2,68 |
| ten-i | Luce | € 9,82 | € 9,82 | € 0,00 |
| ten-i | Internet | € 11,98 | € 11,98 | € 0,00 |
| ten-i | TARI | € 28,07 | € 10,98 | - € 17,09 |
| ten-i | **Totale** | € 49,87 | € 32,78 | - € 17,09 |
| ten-j | Luce | € 84,38 | € 83,87 | - € 0,51 |
| ten-j | Internet | € 49,04 | € 47,92 | - € 1,12 |
| ten-j | TARI | € 44,62 | € 39,24 | - € 5,38 |
| ten-j | **Totale** | € 178,04 | € 171,03 | - € 7,01 |
| ten-k | Luce | € 29,83 | € 29,82 | - € 0,01 |
| ten-k | Internet | € 17,97 | € 17,97 | € 0,00 |
| ten-k | TARI | € 23,23 | € 14,67 | - € 8,56 |
| ten-k | **Totale** | € 71,03 | € 62,46 | - € 8,57 |
| ten-l | Internet | € 5,99 | € 5,99 | € 0,00 |
| ten-l | TARI | € 2,03 | € 6,09 | € 4,06 |
| ten-l | **Totale** | € 8,02 | € 12,08 | € 4,06 |

## Totali

- App: € 1.228,33; posti vuoti: € 0,00.
- Excel: € 1.265,81.
- Differenza: - € 37,48.

## Scostamenti noti

1. **Commissione bancaria di 0,80 € per bolletta.** L'Excel la somma fino ad aprile 2025 (RegistroBollette G = D*E+F); l'app conta solo le commissioni presenti nell'estratto conto (R7, R20) e per il 2024-25 non c'è estratto: commissione 0.
2. **Competenza degli avvisi TARI.** L'Excel usa quote dell'anno solare diverse a ogni avviso; l'app assegna a ogni avviso i suoi 4 mesi nuovi (R3): terzo avviso 2024 per 3/4 nell'annualità, primo e secondo 2025 per intero, terzo 2025 per 1/4.
3. **Quota TARI di agosto 2025 scritta a mano.** RegistroBollette G26 = 48,97 € invece della formula (12,24 €); l'app calcola dalla regola.
4. **Luce dell'inquilino C (Doppia marmo 1, ott 2024 - ago 2025).** Conguagli D9 somma la luce fino a giugno (RegistroBollette G17:G21) e omette luglio-agosto 2025 (G22-G23): 94,57 € nell'Excel contro 113,78 € dell'app.
5. **Importi dell'Excel per voce (campo excel).** Ricavati dalle formule di Conguagli D/5 per tipologia, con la commissione compresa dove l'Excel la somma; arrotondati al centesimo per voce, quindi il totale può differire di 1 centesimo da D/5 (inquilini I e K).
6. **Spese dell'inquilino I (Doppia 1, ago-set 2025).** Conguagli D17 somma tutto il terzo avviso TARI 2025; l'app ne assegna solo settembre 2025.
7. **Condominio.** Escluso da expected per costruzione (sezione 42, R3). Le rate 2024-25 non sono disponibili (l'Excel ha solo la quota annua inquilini di 2.103,34 €), quindi la fixture non ha rate di condominio e il controllo di fine esercizio del Task 9 non si applica a questa fixture. Il conguaglio condominiale 2023-24 di 1.302,68 € resta alla proprietà (Carlo).
8. **Forfait.** L'Excel considera il forfait dovuto (30 € x mesi); l'app quello incassato (R4). Qui coincidono: ogni mese ha un versamento (l'inquilino I ha pagato agosto e settembre, confermato da Carlo).
9. **Bolletta della luce settembre-ottobre 2025.** Non ancora registrata: la sua metà di settembre appartiene al 2024-25 e arriverà come conguaglio supplementare (R5).
10. **Scadenza della bolletta luce settembre-ottobre 2024.** RegistroBollette H6 (10/11/2024) è prima dell'emissione I6 (25/11/2024): riportate come nell'Excel; la bolletta è assunta pagata e la data non cambia il conguaglio.
11. **Scadenza della bolletta luce novembre-dicembre 2024.** RegistroBollette H8 riporta 27/01/2024, prima dell'emissione: errore di battitura, nella fixture 27/01/2025.
