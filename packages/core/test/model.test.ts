import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { Cents } from '../src/money';
import {
  AccountSchema,
  ApartmentSchema,
  BankProfileSchema,
  StatementSchema,
  TenantSchema,
  PayerSchema,
  BankTransactionSchema,
  BillMatchSchema,
  BillSchema,
  ContractSchema,
  InstalmentSchema,
  MovementClassSchema,
  MovementRuleSchema,
  ImuRuleSchema,
  ImuYearSchema,
  NoteSchema,
  PaymentSchema,
  SupplierProfileSchema,
  SupplySchema,
  UserSchema,
  TenancySchema,
  WorkspaceSchema,
  DEFAULT_RENT_LATE_DAYS,
  recordSchemas,
} from '../src/model';
import type {
  Apartment,
  BankTransaction,
  Bill,
  BillMatch,
  Contract,
  Instalment,
  Note,
  Payment,
  RecordKind,
  SupplierProfile,
  Tenancy,
  Workspace,
} from '../src/model';
import type { ISODate, YearMonth } from '../src/period';

// Plain input as it comes out of a JSON file (dates are strings, amounts are numbers).
const base = { id: 'rec-1', v: 1, rev: 1 };

const bankProfile: Record<string, unknown> = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../../fixtures/bank/profilo-sintetico.json', import.meta.url)),
    'utf8',
  ),
);

const validRecords: Record<RecordKind, Record<string, unknown>> = {
  account: {
    ...base,
    apartmentId: 'apt-1',
    label: 'Conto principale',
    bankProfileId: 'profilo-sintetico',
    iban: 'IT60X0542811101000000123456',
    holder: 'Mario Rossi',
  },
  bankProfile,
  statement: {
    ...base,
    id: 'abc123',
    accountId: 'acc-1',
    bankProfileId: 'profilo-sintetico',
    fileName: 'estratto.csv',
    suggestedPath: 'Estratti/2026/estratto.csv',
    from: '2026-01-01',
    to: '2026-01-31',
    periodSource: 'file',
    rowCount: 2,
    transactionIds: ['tx-1'],
    held: [
      {
        row: 2,
        reason: 'pending',
        transaction: {
          ...base,
          apartmentId: 'apt-1',
          date: '2026-01-30',
          amount: -500,
          description: 'In attesa',
          statementHash: 'abc123',
          booked: false,
        },
      },
    ],
  },
  apartment: {
    ...base,
    name: 'Appartamento A',
    locatore: 'Locatore Uno',
    posti: 3,
    contrattoMensile: 120000,
    annualitaStart: { month: 10, day: 1 },
    condominioStart: { month: 10, day: 1 },
  },
  contract: {
    ...base,
    apartmentId: 'apt-1',
    type: '1+1',
    start: '2025-10',
    end: '2026-09',
    settlement: 'annuale',
  },
  supply: {
    ...base,
    label: 'Utenza 1111',
    apartments: [
      { apartmentId: 'apt-1', weight: 2500 },
      { apartmentId: 'apt-2', weight: 7500 },
    ],
  },
  user: { ...base, name: 'Utente di prova' },
  tenant: { ...base, name: 'Mario Rossi', language: 'it' },
  payer: {
    ...base,
    key: 'iban:IT60X0542811101000000123456',
    tenantId: 'ten-1',
    validFrom: '2026-01-01',
    source: 'confirmed',
  },
  tenancy: {
    ...base,
    apartmentId: 'apt-1',
    tenantId: 'ten-1',
    room: 'Camera 1',
    from: '2025-10',
    to: '2026-09',
    monthlyRent: 40000,
    monthlyForfait: 5000,
  },
  bill: {
    ...base,
    apartmentId: 'apt-1',
    category: 'elettricita',
    supplier: 'Fornitore Luce',
    number: '2026/123',
    issueDate: '2026-02-01',
    dueDate: '2026-02-20',
    periodStart: '2025-12-01',
    periodEnd: '2026-01-31',
    amount: 9846,
    includedInConguaglio: true,
    sharedWithTenants: true,
    fileHash: 'abc123',
    filePath: 'bollette/2026-02-luce.pdf',
  },
  payment: {
    ...base,
    apartmentId: 'apt-1',
    tenantId: 'ten-1',
    date: '2026-03-05',
    amount: 45000,
    confirmed: true,
    kind: 'canone',
    forMonth: '2026-03',
    source: 'csv',
    transactionId: 'tx-1',
    note: 'bonifico',
  },
  transaction: {
    ...base,
    apartmentId: 'apt-1',
    date: '2026-02-20',
    amount: -9846,
    description: 'Addebito fornitore luce',
    dispCode: 'D123',
    statementHash: 'def456',
  },
  instalment: {
    ...base,
    apartmentId: 'apt-1',
    kind: 'condominio',
    esercizio: '2026-27',
    rateIndex: 1,
    rateCount: 3,
    dueDate: '2026-10-15',
    rata: 30000,
    quotaProprieta: 12000,
    conguaglioPrec: -2500,
    straordinaria: false,
    paidFromApartmentId: 'apt-2',
    shared: { groupId: 'grp-1', groupTotal: 90000, weight: 30000 },
    coversFrom: '2026-10',
    coversTo: '2027-01',
    fileHash: 'ghi789',
  },
  match: {
    ...base,
    itemType: 'bill',
    itemId: 'bill-1',
    transactionId: 'tx-1',
    transactionDate: '2026-02-20',
    amount: 9846,
    part: 'amount',
    confirmed: true,
    by: 'auto',
  },
  movementClass: {
    ...base,
    id: 'mc-t1',
    transactionId: 't1',
    kind: 'escluso',
    excludeReason: 'doppione',
  },
  movementRule: {
    ...base,
    id: 'rule-t1',
    direction: 'out',
    accountId: 'acc-1',
    key: 'iban:IT60X0542811101000000123456',
    kind: 'altro',
    apartmentId: 'apt-1',
  },
  transfer: {
    ...base,
    id: 'tr-t1',
    fromAccountId: 'acc-1',
    toAccountId: 'acc-2',
    amount: 20000,
    date: '2027-04-02',
    outTransactionId: 't1',
    purpose: 'saldo',
    source: 'confirmed',
  },
  imuRule: {
    ...base,
    id: 'imur-t1',
    accountId: 'acc-1',
    f24Group: 'gruppo-1',
  },
  imuYear: {
    ...base,
    id: 'imu-apt-1-2026',
    apartmentId: 'apt-1',
    year: '2026',
    f24Group: 'gruppo-1',
    rates: [{ index: 1 }, { index: 2, expected: 60000 }],
  },
  rentYear: {
    ...base,
    id: 'rent-apt-1-2026',
    apartmentId: 'apt-1',
    year: '2026',
    totalRent: 1935000,
  },
  supplierProfile: {
    ...base,
    supplier: 'Fornitore Luce',
    kind: 'bill',
    category: 'elettricita',
    status: 'confermato',
    autoRegister: false,
    validFrom: '2025-01-01',
    validTo: '2026-12-31',
    recognise: { allOf: ['Fornitore Luce', 'Fattura'], noneOf: ['Avviso TARI'] },
    fields: {
      amount: {
        required: true,
        rules: [
          {
            anchor: 'Totale da pagare',
            position: 'right',
            pattern: '([0-9.]+,[0-9]{2})',
            valueType: 'euro',
            group: 1,
          },
        ],
      },
      dueDate: {
        required: false,
        rules: [
          {
            anchor: 'Scadenza',
            position: 'same-line',
            pattern: '([0-9]{2}/[0-9]{2}/[0-9]{4})',
            valueType: 'date',
            group: 1,
          },
        ],
      },
    },
    identifiers: [{ kind: 'pod', pattern: '(IT[0-9A-Z]{12})' }],
    items: { pattern: '([0-9.]+,[0-9]{2})' },
  },
  note: {
    ...base,
    targetType: 'bill',
    targetId: 'bill-1',
    text: 'Bolletta verificata con il fornitore.',
    profileId: 'user1',
    at: '2026-11-10T20:15:00.000Z',
    visibleToTenants: false,
  },
};

const validWorkspace = {
  workspaceId: 'ws-1',
  name: 'Appartamenti',
  schemaVersion: 1,
  minAppVersion: '1.0.0',
  createdAt: '2026-11-10T20:15:00.000Z',
};

const kinds = Object.keys(validRecords) as RecordKind[];

/** A copy of `record` with `changes` applied; a change to `undefined` removes the key. */
function changed(
  record: Record<string, unknown>,
  changes: Record<string, unknown>,
): Record<string, unknown> {
  const merged = { ...record, ...changes };
  return Object.fromEntries(Object.entries(merged).filter(([, value]) => value !== undefined));
}

function without(record: Record<string, unknown>, ...keys: string[]): Record<string, unknown> {
  return changed(record, Object.fromEntries(keys.map((key) => [key, undefined])));
}

describe('recordSchemas', () => {
  it('has one schema for each record directory under _app/dati', () => {
    expect(Object.keys(recordSchemas).sort()).toEqual(
      [
        'account',
        'apartment',
        'bankProfile',
        'statement',
        'bill',
        'contract',
        'instalment',
        'match',
        'movementClass',
        'movementRule',
        'note',
        'payment',
        'supplierProfile',
        'supply',
        'tenancy',
        'transaction',
        'user',
        'tenant',
        'payer',
        'transfer',
        'imuYear',
        'rentYear',
        'imuRule',
      ].sort(),
    );
  });

  it('maps each kind to its named schema', () => {
    expect(recordSchemas.apartment).toBe(ApartmentSchema);
    expect(recordSchemas.contract).toBe(ContractSchema);
    expect(recordSchemas.tenancy).toBe(TenancySchema);
    expect(recordSchemas.supply).toBe(SupplySchema);
    expect(recordSchemas.user).toBe(UserSchema);
    expect(recordSchemas.bill).toBe(BillSchema);
    expect(recordSchemas.payment).toBe(PaymentSchema);
    expect(recordSchemas.transaction).toBe(BankTransactionSchema);
    expect(recordSchemas.instalment).toBe(InstalmentSchema);
    expect(recordSchemas.match).toBe(BillMatchSchema);
    expect(recordSchemas.note).toBe(NoteSchema);
    expect(recordSchemas.supplierProfile).toBe(SupplierProfileSchema);
    expect(recordSchemas.movementClass).toBe(MovementClassSchema);
    expect(recordSchemas.movementRule).toBe(MovementRuleSchema);
    expect(recordSchemas.imuYear).toBe(ImuYearSchema);
    expect(recordSchemas.imuRule).toBe(ImuRuleSchema);
  });
});

describe('record base (id, v, rev, deleted)', () => {
  it.each(kinds)('%s: a valid record parses to the same values', (kind) => {
    expect(recordSchemas[kind].parse(validRecords[kind])).toEqual(validRecords[kind]);
  });

  it.each(kinds)('%s: a record without rev fails', (kind) => {
    expect(recordSchemas[kind].safeParse(without(validRecords[kind], 'rev')).success).toBe(false);
  });

  it.each(kinds)('%s: a record without id or v fails', (kind) => {
    expect(recordSchemas[kind].safeParse(without(validRecords[kind], 'id')).success).toBe(false);
    expect(recordSchemas[kind].safeParse(without(validRecords[kind], 'v')).success).toBe(false);
  });

  it.each(kinds)('%s: an empty id fails', (kind) => {
    expect(recordSchemas[kind].safeParse(changed(validRecords[kind], { id: '' })).success).toBe(
      false,
    );
  });

  it.each([0, -1, 1.5, '1', null])('rev %j fails', (rev) => {
    expect(BillSchema.safeParse(changed(validRecords.bill, { rev })).success).toBe(false);
  });

  it('accepts a rev above one', () => {
    expect(BillSchema.parse(changed(validRecords.bill, { rev: 42 })).rev).toBe(42);
  });

  it.each([2, 0, '1', null])('v %j fails (a future version is handled by the store)', (v) => {
    expect(BillSchema.safeParse(changed(validRecords.bill, { v })).success).toBe(false);
  });

  it('accepts deleted as an optional boolean', () => {
    expect(BillSchema.parse(changed(validRecords.bill, { deleted: true })).deleted).toBe(true);
    expect(BillSchema.parse(changed(validRecords.bill, { deleted: false })).deleted).toBe(false);
    expect(BillSchema.parse(validRecords.bill)).not.toHaveProperty('deleted');
    expect(BillSchema.safeParse(changed(validRecords.bill, { deleted: 'yes' })).success).toBe(
      false,
    );
  });

  it.each(kinds)('%s: unknown keys are accepted and dropped from the parsed record', (kind) => {
    const parsed = recordSchemas[kind].parse(changed(validRecords[kind], { addedLater: 'x' }));
    expect(parsed).not.toHaveProperty('addedLater');
    expect(parsed).toEqual(validRecords[kind]);
  });
});

describe('amounts and dates', () => {
  it.each([1.5, 0.1, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53, '98.46', null])(
    'an amount of %j is not cents',
    (amount) => {
      expect(BillSchema.safeParse(changed(validRecords.bill, { amount })).success).toBe(false);
    },
  );

  it('normalises negative zero in an amount', () => {
    const parsed = BillSchema.parse(changed(validRecords.bill, { amount: -0 }));
    expect(Object.is(parsed.amount, 0)).toBe(true);
  });

  it.each([
    '2026-02-30',
    '2026-13-01',
    '2026-00-10',
    '2026-99-99',
    '2026-1-01',
    '01/02/2026',
    '2026-02-01T00:00:00Z',
    '2026-02-01\n',
    '\u0662\u0660\u0662\u0666-\u0660\u0662-\u0660\u0661',
    '',
  ])('the date %j is rejected', (dueDate) => {
    expect(BillSchema.safeParse(changed(validRecords.bill, { dueDate })).success).toBe(false);
  });

  it('accepts a real leap day and rejects a missing one', () => {
    expect(
      BillSchema.safeParse(changed(validRecords.bill, { dueDate: '2028-02-29' })).success,
    ).toBe(true);
    expect(
      BillSchema.safeParse(changed(validRecords.bill, { dueDate: '2026-02-29' })).success,
    ).toBe(false);
  });

  it.each([
    '2026-13',
    '2026-00',
    '2026-99',
    '2026-1',
    '2026-03-05',
    '2026-03\n',
    '\u0662\u0660\u0662\u0666-\u0660\u0663',
    'marzo 2026',
  ])('the month %j is rejected', (forMonth) => {
    expect(PaymentSchema.safeParse(changed(validRecords.payment, { forMonth })).success).toBe(
      false,
    );
  });
});

describe('Apartment', () => {
  it('needs only the required fields', () => {
    const minimal = without(validRecords.apartment, 'contrattoMensile', 'condominioStart');
    const parsed = ApartmentSchema.parse(minimal);
    expect(parsed).not.toHaveProperty('contrattoMensile');
    expect(parsed).not.toHaveProperty('condominioStart');
  });

  it.each([
    [{ month: 13, day: 1 }],
    [{ month: 0, day: 1 }],
    [{ month: 10, day: 0 }],
    [{ month: 10, day: 32 }],
    [{ month: 4, day: 31 }],
    [{ month: 2, day: 30 }],
    [{ month: 2, day: 29 }],
    [{ month: 10.5, day: 1 }],
    [{ month: 10 }],
  ])('the lease year start %j is rejected', (annualitaStart) => {
    expect(
      ApartmentSchema.safeParse(changed(validRecords.apartment, { annualitaStart })).success,
    ).toBe(false);
  });

  it('applies the same rule to the condominium year start', () => {
    expect(
      ApartmentSchema.safeParse(
        changed(validRecords.apartment, { condominioStart: { month: 5, day: 1 } }),
      ).success,
    ).toBe(true);
    expect(
      ApartmentSchema.safeParse(
        changed(validRecords.apartment, { condominioStart: { month: 2, day: 31 } }),
      ).success,
    ).toBe(false);
  });

  it.each([0, -1, 2.5])('posti %j is rejected: it divides the shared costs', (posti) => {
    expect(ApartmentSchema.safeParse(changed(validRecords.apartment, { posti })).success).toBe(
      false,
    );
  });

  it('accepts one unique room name per bed and rejects anything else', () => {
    const ok = changed(validRecords.apartment, { rooms: ['A', 'B', 'C'] });
    expect(ApartmentSchema.safeParse(ok).success).toBe(true);
    for (const rooms of [
      ['A', 'B'],
      ['A', 'A', 'B'],
      ['A', 'B', ''],
    ]) {
      expect(ApartmentSchema.safeParse(changed(validRecords.apartment, { rooms })).success).toBe(
        false,
      );
    }
  });

  it('requires a name and a landlord', () => {
    expect(ApartmentSchema.safeParse(changed(validRecords.apartment, { name: '' })).success).toBe(
      false,
    );
    expect(ApartmentSchema.safeParse(without(validRecords.apartment, 'locatore')).success).toBe(
      false,
    );
  });
});

describe('Contract', () => {
  it.each(['1+1', '3+2', '4+4', 'altro'])('accepts the type %s', (type) => {
    expect(ContractSchema.parse(changed(validRecords.contract, { type })).type).toBe(type);
  });

  it.each(['transitorio', '2+2', ''])('rejects the type %j', (type) => {
    expect(ContractSchema.safeParse(changed(validRecords.contract, { type })).success).toBe(false);
  });

  it.each(['annuale', 'intero-contratto'])('accepts the settlement %s', (settlement) => {
    expect(ContractSchema.parse(changed(validRecords.contract, { settlement })).settlement).toBe(
      settlement,
    );
  });

  it('rejects an unknown settlement', () => {
    expect(
      ContractSchema.safeParse(changed(validRecords.contract, { settlement: 'mensile' })).success,
    ).toBe(false);
  });

  it('rejects a contract that ends before it starts, accepts a one-month contract', () => {
    expect(
      ContractSchema.safeParse(changed(validRecords.contract, { start: '2026-10', end: '2026-09' }))
        .success,
    ).toBe(false);
    expect(
      ContractSchema.safeParse(changed(validRecords.contract, { start: '2026-09', end: '2026-09' }))
        .success,
    ).toBe(true);
  });
});

describe('Contract data and rent history (plan 7, task 1)', () => {
  // Invented figures and codes only (fixtures/README.md).
  const full = {
    ...base,
    id: 'ctr-berchet',
    apartmentId: 'berchet',
    type: '1+1',
    start: '2025-10',
    end: '2027-09',
    settlement: 'annuale',
    agreedRent: true,
    forStudents: true,
    durationMonths: 12,
    signedOn: '2025-09-20',
    registration: { code: 'CODICE-PROVA-0001', date: '2025-10-10' },
    taxRegime: 'cedolare',
    cedolareRateBp: 1000,
    tenancyIds: ['tcy-a'],
    depositPaymentIds: ['pay-c1'],
    rent: [
      { from: '2025-10', monthlyRent: 160000, monthlyAdvance: 15000 },
      { from: '2026-10', monthlyRent: 165000, monthlyAdvance: 15000 },
    ],
  };
  const fixture = (path: string): unknown =>
    JSON.parse(readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8'));

  it('a contract without the new fields stays valid and equal, as do the fixtures', () => {
    expect(ContractSchema.parse(validRecords.contract)).toEqual(validRecords.contract);
    const excel = fixture('../../../fixtures/excel/anno-esempio.json') as { contracts: unknown[] };
    const golden = fixture('../../../fixtures/golden/berchet-2024-25.json') as {
      contract: unknown;
    };
    for (const contract of [...excel.contracts, golden.contract]) {
      expect(ContractSchema.parse(contract)).toEqual(contract);
    }
  });

  it('accepts a complete contract', () => {
    expect(ContractSchema.parse(full)).toEqual(full);
  });

  const rent = (entries: Record<string, unknown>[]) => changed(full, { rent: entries });
  const entry = (from: string, monthlyRent = 160000, monthlyAdvance = 15000) => ({
    from,
    monthlyRent,
    monthlyAdvance,
  });
  it.each([
    ['equal from', rent([entry('2025-10'), entry('2025-10')])],
    ['decreasing from', rent([entry('2026-10'), entry('2025-10')])],
    ['from before start', rent([entry('2025-09')])],
    ['from after end', rent([entry('2027-10')])],
    ['zero rent', rent([entry('2025-10', 0)])],
    ['negative advance', rent([entry('2025-10', 160000, -1)])],
    ['rate with ordinario', changed(full, { taxRegime: 'ordinario' })],
    ['rate without regime', without(full, 'taxRegime')],
    ['rate 0', changed(full, { cedolareRateBp: 0 })],
    ['rate 10001', changed(full, { cedolareRateBp: 10001 })],
    ['repeated tenancy', changed(full, { tenancyIds: ['a', 'a'] })],
    ['repeated deposit', changed(full, { depositPaymentIds: ['a', 'a'] })],
    ['duration 0', changed(full, { durationMonths: 0 })],
    ['agreedRent false', changed(full, { agreedRent: false })],
    ['forStudents false', changed(full, { forStudents: false })],
    ['impossible registration date', changed(full, { registration: { date: '2025-02-30' } })],
  ])('rejects %s', (_name, contract) => {
    expect(ContractSchema.safeParse(contract).success).toBe(false);
  });

  it('accepts an ordinario contract without a rate and a zero advance', () => {
    const ordinario = changed(without(full, 'cedolareRateBp'), {
      taxRegime: 'ordinario',
      rent: [entry('2025-10', 160000, 0)],
    });
    expect(ContractSchema.safeParse(ordinario).success).toBe(true);
  });
});

describe('Tenancy', () => {
  it('has an optional room and an optional end month', () => {
    const parsed = TenancySchema.parse(without(validRecords.tenancy, 'room', 'to'));
    expect(parsed).not.toHaveProperty('room');
    expect(parsed).not.toHaveProperty('to');
  });

  it('accepts a user and rejects a blank name', () => {
    expect(UserSchema.safeParse(validRecords.user).success).toBe(true);
    expect(UserSchema.safeParse(changed(validRecords.user, { name: ' ' })).success).toBe(false);
  });

  it('accepts a supply of several apartments and rejects a bad one', () => {
    expect(SupplySchema.safeParse(validRecords.supply).success).toBe(true);
    const w = (...weights: number[]) =>
      weights.map((weight, i) => ({ apartmentId: `apt-${i + 1}`, weight }));
    const one = { apartmentId: 'apt-1', weight: 5000 };
    for (const apartments of [
      [],
      w(5000, 4999),
      w(10001),
      w(0, 10000),
      w(5000.5, 4999.5),
      [one, one],
    ]) {
      expect(SupplySchema.safeParse(changed(validRecords.supply, { apartments })).success).toBe(
        false,
      );
    }
    for (const apartments of [w(10000), w(2500, 7500)]) {
      expect(SupplySchema.safeParse(changed(validRecords.supply, { apartments })).success).toBe(
        true,
      );
    }
    expect(SupplySchema.safeParse(changed(validRecords.supply, { label: '' })).success).toBe(false);
  });

  it('accepts address and cadastre on an apartment and rejects empty ones', () => {
    const cadastre = [{ sheet: '1', parcel: '2', sub: '3' }];
    const ok = changed(validRecords.apartment, { address: 'Via Roma 1', cadastre });
    expect(ApartmentSchema.safeParse(ok).success).toBe(true);
    for (const bad of [
      { address: '' },
      { cadastre: [{ sheet: '', parcel: '2', sub: '3' }] },
      { cadastre: [{ sheet: '1', parcel: '', sub: '3' }] },
      { cadastre: [{ sheet: '1', parcel: '2', sub: '' }] },
    ]) {
      expect(ApartmentSchema.safeParse(changed(validRecords.apartment, bad)).success).toBe(false);
    }
  });

  it('accepts supplyId on an instalment and supply as a note target', () => {
    expect(
      InstalmentSchema.safeParse(changed(validRecords.instalment, { supplyId: 'sup-1' })).success,
    ).toBe(true);
    expect(
      InstalmentSchema.safeParse(changed(validRecords.instalment, { supplyId: '' })).success,
    ).toBe(false);
    expect(NoteSchema.safeParse(changed(validRecords.note, { targetType: 'supply' })).success).toBe(
      true,
    );
  });

  it('rejects a tenancy that ends before it starts', () => {
    expect(
      TenancySchema.safeParse(changed(validRecords.tenancy, { from: '2026-05', to: '2026-04' }))
        .success,
    ).toBe(false);
    expect(
      TenancySchema.safeParse(changed(validRecords.tenancy, { from: '2026-05', to: '2026-05' }))
        .success,
    ).toBe(true);
  });

  it('keeps rent and flat service charge as whole cents', () => {
    expect(
      TenancySchema.safeParse(changed(validRecords.tenancy, { monthlyRent: 400.5 })).success,
    ).toBe(false);
    expect(TenancySchema.safeParse(without(validRecords.tenancy, 'monthlyForfait')).success).toBe(
      false,
    );
  });
});

describe('Bill', () => {
  it('accepts a negative amount (a credit note)', () => {
    expect(BillSchema.parse(changed(validRecords.bill, { amount: -6300 })).amount).toBe(-6300);
  });

  it.each(['elettricita', 'gas', 'acqua', 'internet', 'altro'])('accepts the category %s', (c) => {
    expect(BillSchema.parse(changed(validRecords.bill, { category: c })).category).toBe(c);
  });

  it.each(['luce', 'condominio', 'imu', 'rifiuti', 'tari', ''])(
    'rejects the category %j',
    (category) => {
      expect(BillSchema.safeParse(changed(validRecords.bill, { category })).success).toBe(false);
    },
  );

  it('does not need number, issue date or due date', () => {
    const parsed = BillSchema.parse(without(validRecords.bill, 'number', 'issueDate', 'dueDate'));
    expect(parsed).not.toHaveProperty('number');
    expect(parsed).not.toHaveProperty('issueDate');
    expect(parsed).not.toHaveProperty('dueDate');
  });

  it('rejects a period that ends before it starts, accepts a one-day period', () => {
    expect(
      BillSchema.safeParse(
        changed(validRecords.bill, { periodStart: '2026-02-01', periodEnd: '2026-01-31' }),
      ).success,
    ).toBe(false);
    expect(
      BillSchema.safeParse(
        changed(validRecords.bill, { periodStart: '2026-02-01', periodEnd: '2026-02-01' }),
      ).success,
    ).toBe(true);
  });

  it.each([
    'apartmentId',
    'category',
    'supplier',
    'periodStart',
    'periodEnd',
    'amount',
    'includedInConguaglio',
    'sharedWithTenants',
    'fileHash',
    'filePath',
  ])('requires %s', (field) => {
    expect(BillSchema.safeParse(without(validRecords.bill, field)).success).toBe(false);
  });
});

describe('Payment', () => {
  it('rejects a payment without kind', () => {
    expect(PaymentSchema.safeParse(without(validRecords.payment, 'kind')).success).toBe(false);
  });

  it.each(['canone', 'conguaglio', 'caparra', 'altro'])('accepts the kind %s', (kind) => {
    expect(PaymentSchema.parse(changed(validRecords.payment, { kind })).kind).toBe(kind);
  });

  it.each(['affitto', 'forfait', ''])('rejects the kind %j', (kind) => {
    expect(PaymentSchema.safeParse(changed(validRecords.payment, { kind })).success).toBe(false);
  });

  it.each(['csv', 'manual', 'excel'])('accepts the source %s', (source) => {
    expect(PaymentSchema.parse(changed(validRecords.payment, { source })).source).toBe(source);
  });

  it('rejects an unknown source', () => {
    expect(PaymentSchema.safeParse(changed(validRecords.payment, { source: 'pdf' })).success).toBe(
      false,
    );
  });

  it('requires confirmed, because only confirmed payments enter the calculations', () => {
    expect(PaymentSchema.safeParse(without(validRecords.payment, 'confirmed')).success).toBe(false);
  });

  it('rejects an empty transaction id: it is an id when present', () => {
    expect(
      PaymentSchema.safeParse(changed(validRecords.payment, { transactionId: '' })).success,
    ).toBe(false);
  });

  it('has optional month, transaction and note', () => {
    const parsed = PaymentSchema.parse(
      without(validRecords.payment, 'forMonth', 'transactionId', 'note'),
    );
    expect(parsed).not.toHaveProperty('forMonth');
    expect(parsed).not.toHaveProperty('transactionId');
    expect(parsed).not.toHaveProperty('note');
  });
});

describe('BankTransaction', () => {
  it('accepts debits and credits, with or without a disposition code', () => {
    expect(
      BankTransactionSchema.parse(changed(validRecords.transaction, { amount: -9846 })).amount,
    ).toBe(-9846);
    expect(
      BankTransactionSchema.parse(changed(validRecords.transaction, { amount: 45000 })).amount,
    ).toBe(45000);
    expect(
      BankTransactionSchema.parse(without(validRecords.transaction, 'dispCode')),
    ).not.toHaveProperty('dispCode');
  });

  it('requires the statement hash and whole cents', () => {
    expect(
      BankTransactionSchema.safeParse(without(validRecords.transaction, 'statementHash')).success,
    ).toBe(false);
    expect(
      BankTransactionSchema.safeParse(changed(validRecords.transaction, { amount: -98.46 }))
        .success,
    ).toBe(false);
  });
});

describe('Instalment', () => {
  it('may carry the issue date of the notice, which must be a real date', () => {
    const parse = (issueDate: unknown) =>
      InstalmentSchema.safeParse(changed(validRecords.instalment, { issueDate })).success;
    expect(parse('2026-02-05')).toBe(true);
    expect(parse(undefined)).toBe(true);
    expect(parse('2026-02-30')).toBe(false);
    expect(parse('05/02/2026')).toBe(false);
  });

  it.each([5, 7, 8, 9, 10, 11, 0, -3, 13, 24, 2.5])('rejects rateCount %j', (rateCount) => {
    expect(
      InstalmentSchema.safeParse(changed(validRecords.instalment, { rateCount, rateIndex: 1 }))
        .success,
    ).toBe(false);
  });

  it.each([1, 2, 3, 4, 6, 12])('accepts rateCount %j, which divides 12', (rateCount) => {
    expect(
      InstalmentSchema.safeParse(changed(validRecords.instalment, { rateCount, rateIndex: 1 }))
        .success,
    ).toBe(true);
  });

  it.each([0, 4, -1, 1.5])('rejects rateIndex %j out of 1..rateCount (3)', (rateIndex) => {
    expect(
      InstalmentSchema.safeParse(changed(validRecords.instalment, { rateIndex })).success,
    ).toBe(false);
  });

  it.each([1, 2, 3])('accepts rateIndex %j of 3', (rateIndex) => {
    expect(
      InstalmentSchema.safeParse(changed(validRecords.instalment, { rateIndex })).success,
    ).toBe(true);
  });

  it('rejects coverage that ends before it starts, accepts a single month', () => {
    expect(
      InstalmentSchema.safeParse(
        changed(validRecords.instalment, { coversFrom: '2027-01', coversTo: '2026-10' }),
      ).success,
    ).toBe(false);
    expect(
      InstalmentSchema.safeParse(
        changed(validRecords.instalment, { coversFrom: '2026-10', coversTo: '2026-10' }),
      ).success,
    ).toBe(true);
  });

  it.each(['condominio', 'tari'])('accepts the kind %s', (kind) => {
    expect(InstalmentSchema.parse(changed(validRecords.instalment, { kind })).kind).toBe(kind);
  });

  it.each(['imu', 'rifiuti', 'altro'])('rejects the kind %s', (kind) => {
    expect(InstalmentSchema.safeParse(changed(validRecords.instalment, { kind })).success).toBe(
      false,
    );
  });

  it.each(['paidFromApartmentId', 'fileHash'])('rejects an empty %s when present', (field) => {
    expect(
      InstalmentSchema.safeParse(changed(validRecords.instalment, { [field]: '' })).success,
    ).toBe(false);
  });

  it('has optional straordinaria, paidFromApartmentId, shared and fileHash', () => {
    const parsed = InstalmentSchema.parse(
      without(
        validRecords.instalment,
        'straordinaria',
        'paidFromApartmentId',
        'shared',
        'fileHash',
      ),
    );
    expect(parsed).not.toHaveProperty('straordinaria');
    expect(parsed).not.toHaveProperty('paidFromApartmentId');
    expect(parsed).not.toHaveProperty('shared');
    expect(parsed).not.toHaveProperty('fileHash');
  });

  it('keeps the shared notice amounts as whole cents and requires its group', () => {
    const shared = { groupId: 'grp-1', groupTotal: 90000, weight: 30000 };
    expect(
      InstalmentSchema.safeParse(
        changed(validRecords.instalment, { shared: { ...shared, weight: 300.5 } }),
      ).success,
    ).toBe(false);
    expect(
      InstalmentSchema.safeParse(
        changed(validRecords.instalment, { shared: { ...shared, groupId: '' } }),
      ).success,
    ).toBe(false);
    expect(
      InstalmentSchema.safeParse(
        changed(validRecords.instalment, { shared: { groupId: 'grp-1', weight: 30000 } }),
      ).success,
    ).toBe(false);
  });

  it.each(['rata', 'quotaProprieta', 'conguaglioPrec'])('requires %s', (field) => {
    expect(InstalmentSchema.safeParse(without(validRecords.instalment, field)).success).toBe(false);
  });

  it('accepts a zero rata (a conguaglio paid as a separate debit) and a negative credit', () => {
    const parsed = InstalmentSchema.parse(
      changed(validRecords.instalment, { rata: 0, conguaglioPrec: -2500 }),
    );
    expect(parsed.rata).toBe(0);
    expect(parsed.conguaglioPrec).toBe(-2500);
  });
});

describe('BillMatch', () => {
  it.each(['bill', 'instalment'])('accepts the item type %s', (itemType) => {
    expect(BillMatchSchema.parse(changed(validRecords.match, { itemType })).itemType).toBe(
      itemType,
    );
  });

  it.each([
    ['itemType', 'payment'],
    ['part', 'fee'],
    ['by', 'robot'],
  ])('rejects %s = %s', (field, value) => {
    expect(BillMatchSchema.safeParse(changed(validRecords.match, { [field]: value })).success).toBe(
      false,
    );
  });

  it.each(['amount', 'commission'])('accepts the part %s', (part) => {
    expect(BillMatchSchema.parse(changed(validRecords.match, { part })).part).toBe(part);
  });

  it.each(['auto', 'manual', 'assumed'])('accepts the origin %s', (by) => {
    expect(BillMatchSchema.parse(changed(validRecords.match, { by })).by).toBe(by);
  });

  it('requires whole cents and the transaction date', () => {
    expect(BillMatchSchema.safeParse(changed(validRecords.match, { amount: 98.46 })).success).toBe(
      false,
    );
    expect(BillMatchSchema.safeParse(without(validRecords.match, 'transactionDate')).success).toBe(
      false,
    );
    expect(BillMatchSchema.safeParse(without(validRecords.match, 'confirmed')).success).toBe(false);
  });
});

describe('Note', () => {
  it.each([
    'apartment',
    'contract',
    'tenancy',
    'bill',
    'instalment',
    'payment',
    'transaction',
    'match',
  ])('accepts the target type %s', (targetType) => {
    expect(NoteSchema.parse(changed(validRecords.note, { targetType })).targetType).toBe(
      targetType,
    );
  });

  it.each(['note', 'tenant', 'workspace', ''])(
    'rejects the unknown target type %j',
    (targetType) => {
      expect(NoteSchema.safeParse(changed(validRecords.note, { targetType })).success).toBe(false);
    },
  );

  it.each(['', ' ', '   \n\t '])('rejects the empty text %j', (text) => {
    expect(NoteSchema.safeParse(changed(validRecords.note, { text })).success).toBe(false);
  });

  it('accepts a text of exactly 2000 characters and rejects one of 2001', () => {
    expect(
      NoteSchema.safeParse(changed(validRecords.note, { text: 'a'.repeat(2000) })).success,
    ).toBe(true);
    expect(
      NoteSchema.safeParse(changed(validRecords.note, { text: 'a'.repeat(2001) })).success,
    ).toBe(false);
  });

  it('keeps the text as written, without trimming it', () => {
    expect(NoteSchema.parse(changed(validRecords.note, { text: '  ciao \n' })).text).toBe(
      '  ciao \n',
    );
  });

  it('keeps notes private to the landlord unless marked', () => {
    const parsed = NoteSchema.parse(without(validRecords.note, 'visibleToTenants'));
    expect(parsed.visibleToTenants).toBe(false);
    expect(
      NoteSchema.parse(changed(validRecords.note, { visibleToTenants: true })).visibleToTenants,
    ).toBe(true);
    expect(
      NoteSchema.safeParse(changed(validRecords.note, { visibleToTenants: 'si' })).success,
    ).toBe(false);
  });

  it.each(['2026-11-10T20:15:00.000Z', '2026-11-10T20:15:00Z', '2028-02-29T00:00:00.5Z'])(
    'accepts the UTC timestamp %s',
    (at) => {
      expect(NoteSchema.parse(changed(validRecords.note, { at })).at).toBe(at);
    },
  );

  it.each([
    '2026-11-10',
    '2026-11-10T20:15:00',
    '2026-11-10T20:15:00+01:00',
    '2026-11-10 20:15:00Z',
    '2026-02-30T10:00:00Z',
    '2026-11-10T25:00:00Z',
    '2026-11-10T20:15:00Z\n',
    '\u0662\u0660\u0662\u0666-11-10T20:15:00Z',
    '',
  ])('rejects the timestamp %j', (at) => {
    expect(NoteSchema.safeParse(changed(validRecords.note, { at })).success).toBe(false);
  });

  it('requires a profile and a target', () => {
    expect(NoteSchema.safeParse(changed(validRecords.note, { profileId: '' })).success).toBe(false);
    expect(NoteSchema.safeParse(changed(validRecords.note, { targetId: '' })).success).toBe(false);
    expect(NoteSchema.safeParse(without(validRecords.note, 'profileId')).success).toBe(false);
  });
});

describe('Workspace', () => {
  it('parses a workspace file, which has no id, v or rev', () => {
    expect(WorkspaceSchema.parse(validWorkspace)).toEqual(validWorkspace);
  });

  it('drops unknown keys', () => {
    expect(WorkspaceSchema.parse({ ...validWorkspace, addedLater: 1 })).toEqual(validWorkspace);
  });

  it.each(['workspaceId', 'name', 'schemaVersion', 'minAppVersion', 'createdAt'])(
    'requires %s',
    (field) => {
      expect(WorkspaceSchema.safeParse(without(validWorkspace, field)).success).toBe(false);
    },
  );

  it.each([0, -1, 1.5, '1'])('rejects schemaVersion %j', (schemaVersion) => {
    expect(WorkspaceSchema.safeParse({ ...validWorkspace, schemaVersion }).success).toBe(false);
  });

  it.each(['1.2', '1.2.3.4', 'v1.2.3', '1.2.x', '01.2.3', '1.2.3-beta.1', ''])(
    'rejects minAppVersion %j',
    (minAppVersion) => {
      expect(WorkspaceSchema.safeParse({ ...validWorkspace, minAppVersion }).success).toBe(false);
    },
  );

  it('rejects a creation time that is not a UTC timestamp', () => {
    expect(
      WorkspaceSchema.safeParse({ ...validWorkspace, createdAt: '2026-11-10T21:15:00+01:00' })
        .success,
    ).toBe(false);
    expect(WorkspaceSchema.safeParse({ ...validWorkspace, createdAt: '2026-11-10' }).success).toBe(
      false,
    );
  });
});

describe('inferred types', () => {
  it('use the branded money and date types', () => {
    expectTypeOf<Bill['amount']>().toEqualTypeOf<Cents>();
    expectTypeOf<Bill['periodStart']>().toEqualTypeOf<ISODate>();
    expectTypeOf<Bill['dueDate']>().toEqualTypeOf<ISODate | undefined>();
    expectTypeOf<Payment['forMonth']>().toEqualTypeOf<YearMonth | undefined>();
    expectTypeOf<Payment['amount']>().toEqualTypeOf<Cents>();
    expectTypeOf<Contract['start']>().toEqualTypeOf<YearMonth>();
    expectTypeOf<Tenancy['monthlyRent']>().toEqualTypeOf<Cents>();
    expectTypeOf<Apartment['contrattoMensile']>().toEqualTypeOf<Cents | undefined>();
    expectTypeOf<BankTransaction['amount']>().toEqualTypeOf<Cents>();
    expectTypeOf<BillMatch['transactionDate']>().toEqualTypeOf<ISODate>();
    expectTypeOf<Instalment['coversTo']>().toEqualTypeOf<YearMonth>();
    expectTypeOf<NonNullable<Instalment['shared']>['groupTotal']>().toEqualTypeOf<Cents>();
    expectTypeOf<NonNullable<Instalment['shared']>['weight']>().toEqualTypeOf<Cents>();
  });

  it('give every record the shared base and keep v at 1', () => {
    expectTypeOf<Note['id']>().toEqualTypeOf<string>();
    expectTypeOf<Note['v']>().toEqualTypeOf<1>();
    expectTypeOf<Note['rev']>().toEqualTypeOf<number>();
    expectTypeOf<Note['deleted']>().toEqualTypeOf<boolean | undefined>();
    expectTypeOf<Note['visibleToTenants']>().toEqualTypeOf<boolean>();
    expectTypeOf<Workspace>().not.toHaveProperty('rev');
  });
});

describe('Bill consumption', () => {
  it('accepts a consumption as decimal text and the old JSON without it', () => {
    const consumption = { quantity: '123.4', unit: 'kWh' };
    expect(BillSchema.parse(changed(validRecords.bill, { consumption })).consumption).toEqual(
      consumption,
    );
    expect(BillSchema.parse(validRecords.bill)).not.toHaveProperty('consumption');
  });

  it.each(['123,4', 'abc', '', '1.', '.5'])('rejects the quantity %j', (quantity) => {
    const consumption = { quantity, unit: 'kWh' };
    expect(BillSchema.safeParse(changed(validRecords.bill, { consumption })).success).toBe(false);
  });

  it('rejects an empty unit', () => {
    const consumption = { quantity: '1', unit: '' };
    expect(BillSchema.safeParse(changed(validRecords.bill, { consumption })).success).toBe(false);
  });
});

describe('SupplierProfile', () => {
  const profile = validRecords.supplierProfile ?? {};
  const rule = {
    anchor: 'Totale',
    position: 'right',
    pattern: '([0-9]+)',
    valueType: 'euro',
    group: 1,
  };
  const ok = (value: Record<string, unknown>): boolean =>
    SupplierProfileSchema.safeParse(value).success;
  const tari = (changes: Record<string, unknown> = {}): Record<string, unknown> =>
    changed(profile, {
      kind: 'tari',
      category: undefined,
      parts: { pattern: '([A-Za-z]+) ([0-9.]+,[0-9]{2})' },
      ...changes,
    });
  const withRule = (field: string, changes: Record<string, unknown>): Record<string, unknown> =>
    changed(profile, {
      fields: { [field]: { required: true, rules: [{ ...rule, ...changes }] } },
    });

  it('reads a bill profile and a TARI profile', () => {
    expectTypeOf(SupplierProfileSchema.parse(profile)).toEqualTypeOf<SupplierProfile>();
    expect(ok(profile)).toBe(true);
    expect(ok(tari())).toBe(true);
  });

  it('needs only the required fields', () => {
    const minimal = without(profile, 'validTo', 'items', 'parts');
    expect(ok(changed(minimal, { fields: {}, identifiers: [] }))).toBe(true);
  });

  it('defaults the group of a rule to 1', () => {
    const noGroup = { anchor: 'Totale', position: 'right', pattern: '([0-9]+)', valueType: 'euro' };
    const parsed = SupplierProfileSchema.parse(
      changed(profile, {
        fields: { amount: { required: true, rules: [noGroup] } },
      }),
    );
    expect(parsed.fields.amount?.rules[0]?.group).toBe(1);
  });

  it('requires a category for a bill and forbids it for a TARI notice', () => {
    expect(ok(without(profile, 'category'))).toBe(false);
    expect(ok(tari({ category: 'gas' }))).toBe(false);
    expect(ok(changed(profile, { category: 'telefono' }))).toBe(false);
  });

  it('allows parts only for a TARI notice', () => {
    expect(ok(changed(profile, { parts: { pattern: '([a-z]+) ([0-9]+)' } }))).toBe(false);
  });

  it('refuses a validTo before validFrom and accepts the same day', () => {
    expect(ok(changed(profile, { validTo: '2024-12-31' }))).toBe(false);
    expect(ok(changed(profile, { validTo: '2025-01-01' }))).toBe(true);
  });

  it('refuses an empty allOf but accepts an empty noneOf', () => {
    expect(ok(changed(profile, { recognise: { allOf: [], noneOf: [] } }))).toBe(false);
    expect(ok(changed(profile, { recognise: { allOf: ['x'], noneOf: [] } }))).toBe(true);
    expect(ok(changed(profile, { recognise: { allOf: [''], noneOf: [] } }))).toBe(false);
  });

  it('refuses a field without rules and a field name it does not know', () => {
    expect(ok(changed(profile, { fields: { amount: { required: true, rules: [] } } }))).toBe(false);
    expect(ok(changed(profile, { fields: { unknown: { required: true, rules: [rule] } } }))).toBe(
      false,
    );
  });

  it('refuses unknown status, position and identifier kind', () => {
    expect(ok(changed(profile, { status: 'finale' }))).toBe(false);
    expect(ok(withRule('amount', { position: 'left' }))).toBe(false);
    expect(ok(changed(profile, { identifiers: [{ kind: 'iban', pattern: 'x' }] }))).toBe(false);
  });

  it.each([-1, 1.5])('refuses the group %j', (group) => {
    expect(ok(withRule('amount', { group }))).toBe(false);
  });

  it.each([
    ['amount', 'euro', true],
    ['amount', 'date', false],
    ['issueDate', 'date', true],
    ['dueDate', 'date', true],
    ['dueDate', 'euro', false],
    ['period', 'date-range', true],
    ['period', 'date', false],
    ['consumption', 'quantity', true],
    ['consumption', 'text', false],
    ['number', 'text', true],
    ['number', 'euro', false],
  ])('field %s with value type %s: accepted is %j', (field, valueType, accepted) => {
    expect(ok(withRule(field, { valueType }))).toBe(accepted);
  });

  it.each([
    ['unclosed group', '('],
    ['unterminated class', '[a-'],
    ['named group', '(?<total>[0-9]+)'],
    ['Python named group', '(?P<total>[0-9]+)'],
    ['positive lookbehind', '(?<=EUR )[0-9]+'],
    ['negative lookbehind', '(?<!EUR )[0-9]+'],
    ['inline flag', '(?i)totale'],
    ['scoped inline flag', '(?i:totale)'],
  ])('refuses a pattern with %s', (_name, pattern) => {
    expect(ok(withRule('amount', { pattern }))).toBe(false);
    expect(ok(changed(profile, { identifiers: [{ kind: 'pod', pattern }] }))).toBe(false);
    expect(ok(changed(profile, { items: { pattern } }))).toBe(false);
    expect(ok(tari({ parts: { pattern } }))).toBe(false);
  });

  it('accepts lookahead, non-capturing groups and an escaped question mark', () => {
    // Group 0 (the whole match): the patterns without capture groups have no group 1.
    for (const pattern of ['(?:a|b)([0-9]+)(?=,)', '(?!x)[0-9]+', '\\(?<x', '[(?<=]']) {
      expect(ok(withRule('amount', { pattern, group: 0 })), pattern).toBe(true);
    }
  });
});

describe('fileDocument', () => {
  const fileDocument = { pages: [3, 4], documentKind: 'bill' };
  it('is optional on Bill and Instalment: records without it stay valid', () => {
    expect(BillSchema.safeParse(validRecords.bill).success).toBe(true);
    expect(InstalmentSchema.safeParse(validRecords.instalment).success).toBe(true);
    expect(BillSchema.parse(changed(validRecords.bill, { fileDocument })).fileDocument).toEqual(
      fileDocument,
    );
    expect(
      InstalmentSchema.safeParse(changed(validRecords.instalment, { fileDocument })).success,
    ).toBe(true);
  });
  it.each([
    { pages: [4, 3], documentKind: 'bill' },
    { pages: [0, 3], documentKind: 'bill' },
    { pages: [1, 2], documentKind: 'other' },
    { pages: [1, 2] },
  ])('rejects %j', (bad) => {
    expect(BillSchema.safeParse(changed(validRecords.bill, { fileDocument: bad })).success).toBe(
      false,
    );
  });
});

describe('accounts, bank profiles and statements (plan 3a)', () => {
  const ok = (schema: { safeParse: (v: unknown) => { success: boolean } }, v: unknown) =>
    schema.safeParse(v).success;

  it('rejects an IBAN that is not normalised or fails mod-97', () => {
    expect(
      ok(
        AccountSchema,
        changed(validRecords.account, { iban: 'it60 x054 2811 1010 0000 0123 456' }),
      ),
    ).toBe(false);
    expect(
      ok(
        AccountSchema,
        changed(validRecords.account, { iban: `${'IT60X0542811101000000123456'.slice(0, -1)}7` }),
      ),
    ).toBe(false);
    expect(ok(AccountSchema, without(validRecords.account, 'iban', 'holder'))).toBe(true);
  });

  it('accepts the synthetic profile and rejects inconsistent columns', () => {
    const columns = bankProfile['columns'] as Record<string, unknown>;
    const withColumns = (c: Record<string, unknown>) => changed(bankProfile, { columns: c });
    expect(ok(BankProfileSchema, bankProfile)).toBe(true);
    expect(ok(BankProfileSchema, withColumns({ ...columns, debit: 'Dare', credit: 'Avere' }))).toBe(
      false,
    );
    const split = { ...columns, amount: undefined, sign: undefined, debit: 'Dare' };
    expect(ok(BankProfileSchema, withColumns(split))).toBe(false);
    expect(
      ok(BankProfileSchema, withColumns({ ...split, credit: 'Avere', pending: undefined })),
    ).toBe(true);
    expect(ok(BankProfileSchema, changed(bankProfile, { signValues: undefined }))).toBe(false);
    expect(ok(BankProfileSchema, changed(bankProfile, { pendingValues: undefined }))).toBe(false);
    expect(ok(BankProfileSchema, changed(bankProfile, { periodPattern: 'dal ([0-9/]+)' }))).toBe(
      false,
    );
    expect(ok(BankProfileSchema, changed(bankProfile, { accountPattern: 'conto [A-Z]+' }))).toBe(
      false,
    );
    expect(ok(BankProfileSchema, changed(bankProfile, { validTo: '2019-12-31' }))).toBe(false);
  });

  it('rejects a statement that starts after it ends', () => {
    expect(ok(StatementSchema, changed(validRecords.statement, { from: '2026-02-01' }))).toBe(
      false,
    );
    expect(ok(StatementSchema, changed(validRecords.statement, { periodSource: 'x' }))).toBe(false);
  });

  it('rejects empty label lists: they would recognise any file', () => {
    const empty = (changes: Record<string, unknown>) =>
      ok(BankProfileSchema, changed(bankProfile, changes));
    expect(empty({ header: { allOf: [] } })).toBe(false);
    const columns = bankProfile['columns'] as Record<string, unknown>;
    expect(empty({ columns: { ...columns, description: [] } })).toBe(false);
    expect(empty({ signValues: { debit: [], credit: ['A'] } })).toBe(false);
    expect(empty({ signValues: { debit: ['D'], credit: [] } })).toBe(false);
    expect(empty({ pendingValues: [] })).toBe(false);
  });

  it('allows one-day ranges and refuses sign without amount', () => {
    expect(ok(StatementSchema, changed(validRecords.statement, { from: '2026-01-31' }))).toBe(true);
    expect(ok(BankProfileSchema, changed(bankProfile, { validTo: '2020-01-01' }))).toBe(true);
    const columns = bankProfile['columns'] as Record<string, unknown>;
    const split = {
      ...columns,
      amount: undefined,
      debit: 'Dare',
      credit: 'Avere',
      pending: undefined,
    };
    expect(ok(BankProfileSchema, changed(bankProfile, { columns: split }))).toBe(false); // sign left
  });

  it('checks the held rows', () => {
    const held = validRecords.statement['held'] as Record<string, unknown>[];
    const withHeld = (changes: Record<string, unknown>) =>
      ok(StatementSchema, changed(validRecords.statement, { held: [{ ...held[0], ...changes }] }));
    expect(withHeld({ decision: 'keep' })).toBe(true);
    expect(withHeld({ decision: 'maybe' })).toBe(false);
    expect(withHeld({ reason: 'other' })).toBe(false);
    expect(withHeld({ row: 0 })).toBe(false);
    expect(withHeld({ transaction: { id: 'x' } })).toBe(false);
  });

  it('keeps a transaction without the new fields valid', () => {
    expect(ok(BankTransactionSchema, validRecords.transaction)).toBe(true);
    expect(
      ok(
        BankTransactionSchema,
        changed(validRecords.transaction, {
          accountId: 'acc-1',
          counterparty: { name: 'X' },
          booked: true,
        }),
      ),
    ).toBe(true);
  });
});

describe('tenant, payer and rentLateDays (plan 3b)', () => {
  it('rejects an empty tenant name and an unknown language', () => {
    expect(TenantSchema.safeParse(validRecords.tenant).success).toBe(true);
    expect(TenantSchema.safeParse(changed(validRecords.tenant, { name: '' })).success).toBe(false);
    expect(TenantSchema.safeParse(changed(validRecords.tenant, { language: 'de' })).success).toBe(
      false,
    );
  });

  it('accepts only normalised payer keys', () => {
    const ok = (key: string) => PayerSchema.safeParse(changed(validRecords.payer, { key })).success;
    expect(ok('iban:IT60X0542811101000000123456')).toBe(true);
    expect(ok('name:mario rossi')).toBe(true);
    for (const key of [
      'iban:it60x0542811101000000123456',
      'iban:IT60 X0542811101000000123456',
      'name:Mario Rossi',
      'name:',
      'tel:1',
    ]) {
      expect(ok(key), key).toBe(false);
    }
  });

  it('rejects a payer validTo before validFrom', () => {
    const parse = (validTo: string) =>
      PayerSchema.safeParse(changed(validRecords.payer, { validTo })).success;
    expect(parse('2025-12-31')).toBe(false);
    expect(parse('2026-01-01')).toBe(true);
  });

  it('bounds rentLateDays to an integer between 0 and 31', () => {
    const parse = (rentLateDays: number) =>
      ApartmentSchema.safeParse(changed(validRecords.apartment, { rentLateDays })).success;
    expect([-1, 32, 2.5].map(parse)).toEqual([false, false, false]);
    expect([0, 10, 31].map(parse)).toEqual([true, true, true]);
    expect(ApartmentSchema.safeParse(validRecords.apartment).success).toBe(true);
    expect(DEFAULT_RENT_LATE_DAYS).toBe(10);
  });
});

describe('MovementClassSchema (plan 3c, task 1)', () => {
  const ok = (changes: Record<string, unknown>) =>
    MovementClassSchema.safeParse(changed(validRecords.movementClass, changes)).success;

  it('accepts an exclusion with its reason, and a category with its apartment', () => {
    expect(
      MovementClassSchema.parse({
        id: 'mc-t1',
        v: 1,
        rev: 1,
        transactionId: 't1',
        kind: 'escluso',
        excludeReason: 'doppione',
      }),
    ).toMatchObject({ kind: 'escluso', excludeReason: 'doppione' });
    expect(ok({ kind: 'utenze', excludeReason: undefined, apartmentId: 'apt-1' })).toBe(true);
    expect(ok({ kind: 'tasse', excludeReason: undefined, apartmentId: 'apt-1', f24: true })).toBe(
      true,
    );
    expect(ok({ kind: 'altro', excludeReason: undefined, apartmentId: 'a', ruleId: 'r' })).toBe(
      true,
    );
  });

  it('refuses what the refinements forbid', () => {
    expect(ok({ excludeReason: undefined })).toBe(false);
    expect(ok({ apartmentId: 'apt-1' })).toBe(false);
    expect(ok({ kind: 'utenze', excludeReason: undefined })).toBe(false);
    expect(ok({ kind: 'utenze', apartmentId: 'apt-1' })).toBe(false);
    expect(ok({ kind: 'altro', excludeReason: undefined, apartmentId: 'a', f24: true })).toBe(
      false,
    );
    expect(ok({ ruleId: 'r' })).toBe(false);
    expect(ok({ id: 'mc-t2' })).toBe(false);
    expect(ok({ excludeReason: 'altro' })).toBe(false);
  });

  it('an IMU rate only on an F24 (plan 3d, task 2)', () => {
    const imu = { f24Group: 'g', year: '2026', rateIndex: 1 };
    const tasse = { kind: 'tasse', excludeReason: undefined, apartmentId: 'a' };
    expect(ok({ ...tasse, f24: true, imu })).toBe(true);
    expect(ok({ ...tasse, imu })).toBe(false);
    expect(ok({ ...tasse, f24: true, imu: { ...imu, year: '26' } })).toBe(false);
    expect(ok({ ...tasse, f24: true, imu: { ...imu, rateIndex: 0 } })).toBe(false);
    expect(ok({ ...tasse, f24: true, imu: { ...imu, f24Group: '' } })).toBe(false);
  });
});

describe('ImuYearSchema (plan 3d, task 1)', () => {
  const year = {
    ...base,
    id: 'imu-berchet-2026',
    apartmentId: 'berchet',
    year: '2026',
    f24Group: 'berchet-lovarini',
    rates: [{ index: 1 }, { index: 2, expected: 60000 }],
  };
  const ok = (changes: Record<string, unknown>) =>
    ImuYearSchema.safeParse(changed(year, changes)).success;

  it('accepts rates without amount, with an amount, a due date and an annual total', () => {
    expect(ImuYearSchema.parse(year)).toEqual(year);
    expect(ok({ annualTotal: 130000, rates: [{ index: 1, dueDate: '2026-06-16' }] })).toBe(true);
  });

  it('refuses another id, a year not AAAA, indices not 1 to n, amounts not positive', () => {
    expect(ok({ id: 'imu-berchet-2025' })).toBe(false);
    expect(ok({ year: '26' })).toBe(false);
    expect(ok({ rates: [{ index: 1 }, { index: 3 }] })).toBe(false);
    expect(ok({ rates: [{ index: 2 }, { index: 1 }] })).toBe(false);
    expect(ok({ rates: [{ index: 1, expected: 0 }] })).toBe(false);
    expect(ok({ annualTotal: -1 })).toBe(false);
    expect(ok({ rates: [] })).toBe(false);
    expect(ok({ f24Group: '' })).toBe(false);
  });
});

describe('ImuRuleSchema (plan 3d, task 5)', () => {
  const rule = { ...base, id: 'imur-f', accountId: 'acc-1', f24Group: 'berchet-lovarini' };
  const ok = (changes: Record<string, unknown>) =>
    ImuRuleSchema.safeParse(changed(rule, changes)).success;

  it('accepts an account and a group, a key and dates; refuses an end before the start', () => {
    expect(ImuRuleSchema.parse(rule)).toEqual(rule);
    expect(ok({ key: 'name:ente inventato', validFrom: '2026-06-14', validTo: '2026-06-14' })).toBe(
      true,
    );
    expect(ok({ validFrom: '2026-06-15', validTo: '2026-06-14' })).toBe(false);
    expect(ok({ f24Group: '' })).toBe(false);
    expect(ok({ key: 'nessuna' })).toBe(false);
  });
});
