import { describe, expect, expectTypeOf, it } from 'vitest';
import type { Cents } from '../src/money';
import {
  ApartmentSchema,
  BankTransactionSchema,
  BillMatchSchema,
  BillSchema,
  ContractSchema,
  InstalmentSchema,
  NoteSchema,
  PaymentSchema,
  SupplierProfileSchema,
  SupplySchema,
  TenancySchema,
  WorkspaceSchema,
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

const validRecords: Record<RecordKind, Record<string, unknown>> = {
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
      { apartmentId: 'apt-1', weight: 1 },
      { apartmentId: 'apt-2', weight: 3 },
    ],
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
    profileId: 'carlo',
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
        'apartment',
        'bill',
        'contract',
        'instalment',
        'match',
        'note',
        'payment',
        'supplierProfile',
        'supply',
        'tenancy',
        'transaction',
      ].sort(),
    );
  });

  it('maps each kind to its named schema', () => {
    expect(recordSchemas.apartment).toBe(ApartmentSchema);
    expect(recordSchemas.contract).toBe(ContractSchema);
    expect(recordSchemas.tenancy).toBe(TenancySchema);
    expect(recordSchemas.supply).toBe(SupplySchema);
    expect(recordSchemas.bill).toBe(BillSchema);
    expect(recordSchemas.payment).toBe(PaymentSchema);
    expect(recordSchemas.transaction).toBe(BankTransactionSchema);
    expect(recordSchemas.instalment).toBe(InstalmentSchema);
    expect(recordSchemas.match).toBe(BillMatchSchema);
    expect(recordSchemas.note).toBe(NoteSchema);
    expect(recordSchemas.supplierProfile).toBe(SupplierProfileSchema);
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

describe('Tenancy', () => {
  it('has an optional room and an optional end month', () => {
    const parsed = TenancySchema.parse(without(validRecords.tenancy, 'room', 'to'));
    expect(parsed).not.toHaveProperty('room');
    expect(parsed).not.toHaveProperty('to');
  });

  it('accepts a supply of several apartments and rejects a bad one', () => {
    expect(SupplySchema.safeParse(validRecords.supply).success).toBe(true);
    const one = { apartmentId: 'apt-1', weight: 1 };
    for (const apartments of [
      [],
      [{ apartmentId: 'apt-1', weight: 0 }],
      [{ apartmentId: 'apt-1', weight: 1.5 }],
      [one, one],
    ]) {
      expect(SupplySchema.safeParse(changed(validRecords.supply, { apartments })).success).toBe(
        false,
      );
    }
    expect(SupplySchema.safeParse(changed(validRecords.supply, { label: '' })).success).toBe(false);
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
