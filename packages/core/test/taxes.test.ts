import { describe, expect, it } from 'vitest';
import {
  TAX_DISCREPANCY_TOLERANCE,
  buildTaxWorkbook,
  isoDate,
  taxFilePath,
  recordSchemas,
  taxTable,
  taxYearWarnings,
} from '../src/index';
import type { RecordKind, TaxTableInput } from '../src/index';
import { cents } from '../src/money';

// Invented apartments, taxpayers (user1, user2) and amounts only (plan 10).
const base = { v: 1, rev: 1 };
const parse = <K extends RecordKind>(kind: K, list: Record<string, unknown>[]) =>
  list.map((r) => recordSchemas[kind].parse({ ...base, ...r })) as never;

const apartment = (id: string, locatore: string) => ({
  id,
  name: id,
  locatore,
  posti: 4,
  annualitaStart: { month: 10, day: 1 },
});
const estimates = (apartmentId: string, amounts: Record<string, number>, year = '2026') =>
  Object.entries(amounts).map(([voce, amount]) => ({
    id: `tax-${apartmentId}-${year}-${voce}`,
    apartmentId,
    year,
    voce,
    amount,
  }));
const tx = (id: string, amount: number, extra: Record<string, unknown> = {}) => ({
  id,
  apartmentId: 'nord',
  accountId: 'acc-nord',
  date: '2026-06-16',
  amount,
  description: 'F24',
  statementHash: 'h1',
  ...extra,
});
const tasse = (transactionId: string, extra: Record<string, unknown> = {}) => ({
  id: `mc-${transactionId}`,
  transactionId,
  kind: 'tasse',
  apartmentId: 'nord',
  f24: true,
  ...extra,
});
const tari = (id: string, apartmentId: string, rateIndex: number, rata: number) => ({
  id,
  apartmentId,
  kind: 'tari',
  esercizio: '2026',
  rateIndex,
  rateCount: 3,
  dueDate: '2026-04-16',
  rata,
  quotaProprieta: 0,
  conguaglioPrec: 0,
  coversFrom: '2026-01',
  coversTo: '2026-04',
});
const match = (
  id: string,
  itemId: string,
  amount: number,
  extra: Record<string, unknown> = {},
) => ({
  id,
  itemType: 'instalment',
  itemId,
  transactionId: `tx-${id}`,
  transactionDate: '2026-04-16',
  amount,
  part: 'amount',
  confirmed: true,
  by: 'auto',
  ...extra,
});

/** user1 has nord and est, user2 has sud; every voce of user1 checks except the cedolare. */
function input(changes: Partial<Record<keyof TaxTableInput, unknown>> = {}): TaxTableInput {
  return {
    year: '2026',
    tolerance: TAX_DISCREPANCY_TOLERANCE,
    apartments: parse('apartment', [
      apartment('nord', 'user1'),
      apartment('est', 'user1'),
      apartment('sud', 'user2'),
    ]),
    estimates: parse('taxEstimate', [
      ...estimates('nord', {
        cedolare: 50000,
        imu: 60000,
        registro: 0,
        tari: 20005,
        condominio: 1,
      }),
      ...estimates('est', { cedolare: 30011, imu: 40000, registro: 0, tari: 0, condominio: 2 }),
      // Another year and a deleted record do not count.
      ...estimates('nord', { cedolare: 999 }, '2025'),
      { ...estimates('sud', { imu: 5 })[0], deleted: true },
    ]),
    imuYears: parse('imuYear', [
      {
        id: 'imu-nord-2026',
        apartmentId: 'nord',
        year: '2026',
        f24Group: 'g1',
        rates: [
          { index: 1, expected: 30000 },
          { index: 2, expected: 30000 },
        ],
      },
      {
        id: 'imu-est-2026',
        apartmentId: 'est',
        year: '2026',
        f24Group: 'g1',
        rates: [
          { index: 1, expected: 20000 },
          { index: 2, expected: 20000 },
        ],
      },
    ]),
    transactions: parse('transaction', [
      tx('tx-imu1', -50000),
      tx('tx-ced', -100000),
      tx('tx-in', 7000),
    ]),
    classes: parse('movementClass', [
      tasse('tx-imu1', { imu: { f24Group: 'g1', year: '2026', rateIndex: 1 } }),
      tasse('tx-ced'),
      tasse('tx-in'),
    ]),
    instalments: parse('instalment', [
      tari('tari-n1', 'nord', 1, 10000),
      tari('tari-n2', 'nord', 2, 10000),
      { ...tari('tari-old', 'nord', 1, 777), esercizio: '2025' },
    ]),
    matches: parse('match', [
      match('m1', 'tari-n1', 10000),
      match('m1c', 'tari-n1', 80, { part: 'commission' }),
      match('m-old', 'tari-old', 777),
    ]),
    taxPayments: parse('taxPayment', [
      {
        id: 'taxp-tx-ced',
        transactionId: 'tx-ced',
        parts: [
          { voce: 'cedolare', year: '2025', amount: 60000 },
          { voce: 'cedolare', year: '2026', amount: 40000 },
        ],
      },
    ]),
    contracts: parse('contract', [
      {
        id: 'ctr-nord',
        apartmentId: 'nord',
        type: '1+1',
        start: '2025-10',
        end: '2027-09',
        settlement: 'annuale',
        taxRegime: 'cedolare',
        cedolareRateBp: 1000,
      },
    ]),
    rentYears: parse('rentYear', [
      { id: 'rent-nord-2026', apartmentId: 'nord', year: '2026', totalRent: 1000000 },
    ]),
    expectedItems: [
      { apartmentId: 'nord', voce: 'cedolare', year: '2026', amount: cents(40000) },
      { apartmentId: 'sud', voce: 'cedolare', year: '2026', amount: cents(5) },
      { apartmentId: 'est', voce: 'registro', year: '2027', amount: cents(5) },
    ],
    ...changes,
  } as TaxTableInput;
}

const rowOf = (tables: ReturnType<typeof taxTable>, taxpayer: string, voce: string) =>
  tables.find((t) => t.taxpayer === taxpayer)?.rows.find((r) => r.voce === voce);

describe('taxTable (plan 10, task 3)', () => {
  it('gives one table per taxpayer, with every voce: estimate, paid, expected, difference, state', () => {
    const tables = taxTable(input());
    expect(tables.map((t) => [t.taxpayer, t.apartmentIds])).toEqual([
      ['user1', ['est', 'nord']],
      ['user2', ['sud']],
    ]);
    const [user1] = tables;
    expect(user1?.rows).toEqual([
      {
        voce: 'cedolare',
        state: 'discrepanza',
        reasons: [],
        estimate: 80011,
        paid: 40000,
        expected: 40000,
        difference: -11,
        cedolareProposals: [{ apartmentId: 'nord', amount: 100000 }],
      },
      {
        voce: 'imu',
        state: 'in-linea',
        reasons: [],
        estimate: 100000,
        paid: 50000,
        expected: 50000,
        difference: 0,
      },
      {
        voce: 'registro',
        state: 'in-linea',
        reasons: [],
        estimate: 0,
        paid: 0,
        expected: 0,
        difference: 0,
      },
      // The TARI of the esercizio 2026 (answer of user1): checked as the other voci.
      {
        voce: 'tari',
        state: 'in-linea',
        reasons: [],
        estimate: 20005,
        paid: 10000,
        expected: 10000,
        difference: -5,
      },
      { voce: 'condominio', state: 'da-verificare', reasons: ['rule-undecided'], estimate: 3 },
    ]);
    // user2 typed nothing: every voce is missing its estimate.
    expect(rowOf(tables, 'user2', 'cedolare')).toEqual({
      voce: 'cedolare',
      state: 'da-verificare',
      reasons: ['missing-estimate'],
      paid: 0,
      expected: 5,
    });
  });

  it('is a discrepancy only above the threshold: 0,10 € is in line, 0,11 € is not', () => {
    const at = (cedolare: number) =>
      rowOf(
        taxTable(
          input({
            estimates: parse('taxEstimate', [
              ...estimates('nord', { cedolare }),
              ...estimates('est', { cedolare: 0 }),
            ]),
          }),
        ),
        'user1',
        'cedolare',
      );
    expect(at(80010)).toMatchObject({ state: 'in-linea', difference: -10 });
    expect(at(79990)).toMatchObject({ state: 'in-linea', difference: 10 });
    expect(at(79989)).toMatchObject({ state: 'discrepanza', difference: 11 });
    expect(() => taxTable(input({ tolerance: -1 }))).toThrow(RangeError);
    expect(() => taxTable(input({ tolerance: 0.5 }))).toThrow(RangeError);
  });

  it('without the source of the payables, cedolare and registro are da verificare', () => {
    const tables = taxTable(input({ expectedItems: undefined }));
    for (const voce of ['cedolare', 'registro']) {
      expect(rowOf(tables, 'user1', voce)).toMatchObject({
        state: 'da-verificare',
        reasons: ['no-expected-source'],
      });
      expect(rowOf(tables, 'user1', voce)).not.toHaveProperty('expected');
      expect(rowOf(tables, 'user1', voce)).not.toHaveProperty('difference');
    }
    expect(rowOf(tables, 'user1', 'imu')).toMatchObject({ state: 'in-linea' });
  });

  it('an estimate missing for one apartment of the taxpayer is da verificare, never a partial sum', () => {
    const tables = taxTable(
      input({
        estimates: parse('taxEstimate', [...estimates('nord', { imu: 100000 })]),
      }),
    );
    expect(rowOf(tables, 'user1', 'imu')).toEqual({
      voce: 'imu',
      state: 'da-verificare',
      reasons: ['missing-estimate'],
      paid: 50000,
      expected: 50000,
    });
  });

  it('IMU: a group of two taxpayers stays out, rates without amount or out of 1% are flagged', () => {
    const imuYear = (apartmentId: string, f24Group: string, rates: unknown[]) => ({
      id: `imu-${apartmentId}-2026`,
      apartmentId,
      year: '2026',
      f24Group,
      rates,
    });
    const tables = taxTable(
      input({
        imuYears: parse('imuYear', [
          imuYear('nord', 'g1', [{ index: 1, expected: 30000 }, { index: 2 }]),
          imuYear('est', 'g2', [{ index: 1, expected: 20000 }]),
          imuYear('sud', 'g2', [{ index: 1, expected: 20000 }]),
        ]),
        classes: parse('movementClass', [
          tasse('tx-imu1', { imu: { f24Group: 'g1', year: '2026', rateIndex: 1 } }),
          tasse('tx-ced'),
        ]),
      }),
    );
    // tx-imu1 pays 500,00 € on an expected 300,00 €: counted, to be checked.
    expect(rowOf(tables, 'user1', 'imu')).toEqual({
      voce: 'imu',
      state: 'da-verificare',
      reasons: ['imu-expected-missing', 'imu-mixed-taxpayers', 'imu-to-check'],
      estimate: 100000,
      paid: 50000,
      expected: 0,
    });
    expect(rowOf(tables, 'user2', 'imu')?.reasons).toEqual([
      'imu-mixed-taxpayers',
      'missing-estimate',
    ]);
  });

  it('TARI: an assumed match is not paid from the CSV and is flagged', () => {
    const tables = taxTable(
      input({
        matches: parse('match', [
          match('m1', 'tari-n1', 10000, { by: 'assumed' }),
          match('m2', 'tari-n2', 4000, { confirmed: false }),
        ]),
      }),
    );
    expect(rowOf(tables, 'user1', 'tari')).toEqual({
      voce: 'tari',
      state: 'da-verificare',
      reasons: ['assumed-payment'],
      estimate: 20005,
      paid: 0,
      expected: 10000,
    });
  });

  it('a «tasse» debit of the year without assignment flags cedolare, IMU and registro', () => {
    const tables = taxTable(
      input({
        transactions: parse('transaction', [
          tx('tx-imu1', -50000),
          tx('tx-ced', -100000),
          tx('tx-free', -6700),
          tx('tx-old', -6700, { date: '2025-12-31' }),
          tx('tx-pending', -6700, { booked: false }),
        ]),
        classes: parse('movementClass', [
          tasse('tx-imu1', { imu: { f24Group: 'g1', year: '2026', rateIndex: 1 } }),
          tasse('tx-ced'),
          tasse('tx-free'),
          tasse('tx-old'),
          tasse('tx-pending'),
        ]),
      }),
    );
    for (const voce of ['cedolare', 'imu', 'registro']) {
      expect(rowOf(tables, 'user1', voce)?.reasons).toEqual(['unassigned-tax-movement']);
    }
    expect(rowOf(tables, 'user1', 'tari')?.reasons).toEqual([]);
    expect(rowOf(tables, 'user2', 'cedolare')?.reasons).toEqual(['missing-estimate']);
  });

  it('an assignment on a movement that is no longer «tasse» does not count and is flagged', () => {
    const tables = taxTable(
      input({
        classes: parse('movementClass', [
          tasse('tx-imu1', { imu: { f24Group: 'g1', year: '2026', rateIndex: 1 } }),
          tasse('tx-ced', { kind: 'altro', f24: undefined }),
        ]),
      }),
    );
    expect(rowOf(tables, 'user1', 'cedolare')).toMatchObject({
      state: 'da-verificare',
      reasons: ['stale-assignment'],
      paid: 0,
    });
    expect(rowOf(tables, 'user1', 'registro')?.state).toBe('in-linea');
  });

  it('IMU: an F24 not yet booked is not paid and is to be checked', () => {
    const tables = taxTable(
      input({
        transactions: parse('transaction', [
          tx('tx-imu1', -50000, { booked: false }),
          tx('tx-ced', -100000),
        ]),
      }),
    );
    expect(rowOf(tables, 'user1', 'imu')).toMatchObject({
      state: 'da-verificare',
      reasons: ['imu-to-check'],
      paid: 0,
      expected: 50000,
    });
  });

  it('one taxpayer even with other spaces or another Unicode form of the same name', () => {
    const tables = taxTable(
      input({
        apartments: parse('apartment', [
          apartment('nord', 'Società Inventata'),
          apartment('est', ' Societa\u0300 Inventata '),
          apartment('sud', 'user2'),
        ]),
      }),
    );
    expect(tables.map((t) => [t.taxpayer, t.apartmentIds])).toEqual([
      ['Società Inventata', ['est', 'nord']],
      ['user2', ['sud']],
    ]);
  });

  it('the cedolare estimate of R182 is shown beside, never in the amounts', () => {
    const without = taxTable(input({ rentYears: [] }));
    expect(rowOf(without, 'user1', 'cedolare')).not.toHaveProperty('cedolareProposals');
    expect(rowOf(without, 'user1', 'cedolare')).toMatchObject({ paid: 40000, expected: 40000 });
  });
});

describe('taxYearWarnings (plan 10, task 3)', () => {
  const apartments = parse('apartment', [
    apartment('nord', 'user1'),
    apartment('est', 'user1'),
    apartment('sud', 'user2'),
  ]);
  const list = parse('taxEstimate', [
    ...estimates('nord', { imu: 1 }, '2027'),
    ...estimates('est', { imu: 1 }, '2026'),
  ]);

  it('in January, the apartments without estimates in the year, and whether the year before can be copied', () => {
    expect(taxYearWarnings({ today: isoDate('2027-01-15'), apartments, estimates: list })).toEqual([
      { apartmentId: 'est', year: '2027', canCopy: true },
      { apartmentId: 'sud', year: '2027', canCopy: false },
    ]);
  });

  it('nothing outside January', () => {
    for (const today of ['2027-02-01', '2026-12-31']) {
      expect(taxYearWarnings({ today: isoDate(today), apartments, estimates: list })).toEqual([]);
    }
  });
});

describe('buildTaxWorkbook and taxFilePath (plan 10, task 5)', () => {
  const apartments = parse('apartment', [
    {
      ...apartment('nord', 'user1'),
      address: 'Via Inventata 1',
      cadastre: [
        { sheet: '1', parcel: '2', sub: '3' },
        { sheet: '1', parcel: '2', sub: '4' },
      ],
    },
    apartment('sud', 'user2'),
    { ...apartment('vecchio', 'user1'), deleted: true },
  ]);
  const contracts = parse('contract', [
    {
      id: 'ctr-sud',
      apartmentId: 'sud',
      type: '3+2',
      start: '2024-04',
      end: '2029-03',
      settlement: 'intero-contratto',
      taxRegime: 'ordinario',
    },
    {
      id: 'ctr-nord',
      apartmentId: 'nord',
      type: '1+1',
      start: '2025-10',
      end: '2027-09',
      settlement: 'annuale',
      agreedRent: true,
      forStudents: true,
      durationMonths: 12,
      signedOn: '2025-09-20',
      registration: { code: 'CODICE-INVENTATO', date: '2025-10-05' },
      taxRegime: 'cedolare',
      cedolareRateBp: 1050,
      rent: [
        { from: '2025-10', monthlyRent: 150000, monthlyAdvance: 20000 },
        { from: '2026-10', monthlyRent: 155000, monthlyAdvance: 20000 },
      ],
    },
    {
      id: 'ctr-del',
      apartmentId: 'nord',
      type: 'altro',
      start: '2020-01',
      end: '2020-12',
      settlement: 'annuale',
      deleted: true,
    },
  ]);
  const text = (value: string) => ({ kind: 'text', value });

  it('lists every live property, contract and rent entry, as data', () => {
    const workbook = buildTaxWorkbook({ apartments, contracts });
    expect(workbook.sheets.map((s) => s.name)).toEqual(['Immobili', 'Contratti', 'Canoni']);
    const [immobili, contratti, canoni] = workbook.sheets;
    expect(immobili?.rows).toEqual([
      ['Appartamento', 'Nome', 'Locatore', 'Indirizzo', 'Dati catastali'].map(text),
      [
        text('nord'),
        text('nord'),
        text('user1'),
        text('Via Inventata 1'),
        text('foglio 1, particella 2, sub 3; foglio 1, particella 2, sub 4'),
      ],
      [text('sud'), text('sud'), text('user2'), null, null],
    ]);
    expect(contratti?.rows[0]).toEqual(
      [
        'Appartamento',
        'Contratto',
        'Tipo',
        'Inizio',
        'Fine',
        'Durata (mesi)',
        'Firmato il',
        'Codice di registrazione',
        'Registrato il',
        'Canone concordato',
        'Per studenti',
        'Regime',
        'Aliquota cedolare (%)',
      ].map(text),
    );
    expect(contratti?.rows.slice(1)).toEqual([
      [
        text('nord'),
        text('ctr-nord'),
        text('1+1'),
        text('10/2025'),
        text('09/2027'),
        { kind: 'int', value: 12 },
        { kind: 'date', value: '2025-09-20' },
        text('CODICE-INVENTATO'),
        { kind: 'date', value: '2025-10-05' },
        text('sì'),
        text('sì'),
        text('cedolare'),
        text('10,50'),
      ],
      [
        text('sud'),
        text('ctr-sud'),
        text('3+2'),
        text('04/2024'),
        text('03/2029'),
        null,
        null,
        null,
        null,
        text('no'),
        text('no'),
        text('ordinario'),
        null,
      ],
    ]);
    expect(canoni?.rows).toEqual([
      ['Contratto', 'Dal', 'Canone mensile', 'Acconto mensile'].map(text),
      [
        text('ctr-nord'),
        text('10/2025'),
        { kind: 'euro', value: 150000 },
        { kind: 'euro', value: 20000 },
      ],
      [
        text('ctr-nord'),
        text('10/2026'),
        { kind: 'euro', value: 155000 },
        { kind: 'euro', value: 20000 },
      ],
    ]);
  });

  it('goes to Riservato_proprietari/Tasse/<anno>', () => {
    expect(taxFilePath('2026')).toBe('Riservato_proprietari/Tasse/2026/Tasse_2026.xlsx');
    expect(() => taxFilePath('26')).toThrow(RangeError);
  });
});
