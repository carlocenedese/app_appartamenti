import { describe, expect, it } from 'vitest';
import {
  AccountSchema,
  BankProfileSchema,
  BankTransactionSchema,
  BillMatchSchema,
  BillSchema,
  MovementClassSchema,
  MovementRuleSchema,
  PayerSchema,
  TenantSchema,
  isF24,
  isoDate,
  reconcileOutgoing,
} from '../src/index';
import type { MovementRule } from '../src/index';

// Synthetic records only: the own accounts and the invented supplier of fixtures/README.md.
const BERCHET = 'IT85X0542811101000000000301';
const PULCI = 'IT52A9999999999000000000001';
const SUPPLIER = 'IT04X0542811101000000000401';
/** The IBAN of the supplier with a check digit changed: not valid, so the name is the key. */
const WRONG_CHECK = SUPPLIER.replace('IT04', 'IT05');
const base = { v: 1, rev: 1 };

const accounts = [
  AccountSchema.parse({
    ...base,
    id: 'acc-berchet',
    apartmentId: 'berchet',
    label: 'Conto',
    bankProfileId: 'bp',
    iban: BERCHET,
  }),
  AccountSchema.parse({
    ...base,
    id: 'acc-pulci',
    apartmentId: 'pulci',
    label: 'Conto',
    bankProfileId: 'bp',
    iban: PULCI,
  }),
];
const tx = (
  id: string,
  amount: number,
  counterparty?: { name?: string; iban?: string },
  extra: Record<string, unknown> = {},
) =>
  BankTransactionSchema.parse({
    ...base,
    id,
    apartmentId: 'berchet',
    accountId: 'acc-berchet',
    date: '2028-02-10',
    amount,
    description: 'BONIFICO',
    statementHash: 's',
    ...(counterparty === undefined ? {} : { counterparty }),
    ...extra,
  });
const supplier = { name: 'Fornitore Inventato', iban: SUPPLIER };
const rule = (id: string, extra: Partial<Record<keyof MovementRule, unknown>> = {}) =>
  MovementRuleSchema.parse({
    ...base,
    id,
    direction: 'out',
    accountId: 'acc-berchet',
    key: `iban:${SUPPLIER}`,
    kind: 'altro',
    apartmentId: 'berchet',
    ...extra,
  });

const run = (over: Partial<Parameters<typeof reconcileOutgoing>[0]> = {}) =>
  reconcileOutgoing({
    accounts,
    transactions: [],
    classes: [],
    rules: [],
    payers: [],
    tenants: [],
    bills: [],
    supplierProfiles: [],
    matches: [],
    used: new Set(),
    operations: [],
    bankProfiles: [],
    ...over,
  });

describe('MovementRuleSchema (plan 3c, task 6)', () => {
  it('an incoming rule needs an iban key; an outgoing one may have a name key', () => {
    expect(rule('r', { key: 'name:fornitore inventato' }).key).toBe('name:fornitore inventato');
    expect(rule('r', { direction: 'in' }).direction).toBe('in');
    expect(() => rule('r', { direction: 'in', key: 'name:fornitore inventato' })).toThrow();
    expect(() => rule('r', { kind: 'escluso' })).toThrow();
    expect(() => rule('r', { validFrom: '2028-02-11', validTo: '2028-02-10' })).toThrow();
    expect(rule('r', { validFrom: '2028-02-10', validTo: '2028-02-10' }).validTo).toBe(
      '2028-02-10',
    );
    expect(() => rule('r', { key: `iban:${SUPPLIER.toLowerCase()}` })).toThrow();
  });
});

describe('reconcileOutgoing (plan 3c, task 6)', () => {
  it('a valid rule classifies an outgoing whatever its amount; on another account it is a proposal', () => {
    const result = run({
      transactions: [
        tx('b', -4200, supplier),
        tx('p', -4200, supplier, { accountId: 'acc-pulci', apartmentId: 'pulci' }),
      ],
      rules: [rule('rule-a')],
    });
    expect(result).toEqual({
      classes: [
        { id: 'mc-b', transactionId: 'b', kind: 'altro', apartmentId: 'berchet', ruleId: 'rule-a' },
      ],
      proposals: [
        { id: 'p-uscita-p', transactionId: 'p', step: 'uscita', reason: 'new-counterparty' },
      ],
      missingDocument: [],
    });
  });

  it('a rule holds up to its validTo, never when deleted or for the other direction', () => {
    const cases: [Partial<Record<keyof MovementRule, unknown>>, boolean][] = [
      [{ validTo: '2028-02-10' }, true],
      [{ validTo: '2028-02-09' }, false],
      [{ validFrom: '2028-02-10' }, true],
      [{ validFrom: '2028-02-11' }, false],
      [{ deleted: true }, false],
      [{ direction: 'in' }, false],
      [{ key: 'name:fornitore inventato' }, false],
    ];
    for (const [extra, holds] of cases) {
      const result = run({ transactions: [tx('b', -4000, supplier)], rules: [rule('r', extra)] });
      expect(result.classes.length === 1).toBe(holds);
    }
  });

  it('a dirty counterparty (review focus 4)', () => {
    const result = run({
      transactions: [
        // Spaces and lower case: the same IBAN key.
        tx('spaced', -4000, { iban: 'it04 x054 2811 1010 0000 0000 401' }),
        // An own account with spaces and lower case: a transfer, never an outgoing.
        tx('own', -4000, { iban: 'it52 a999 9999 9990 0000 0000 001' }),
        // A wrong check digit: the name is the key, so only the name rule holds.
        tx('wrong', -4000, { name: ' FORNITORE   inventato ', iban: WRONG_CHECK }),
        // A blank name and no IBAN: no counterparty.
        tx('blank', -4000, { name: '   ' }),
        tx('none', -4000),
      ],
      rules: [
        rule('rule-iban'),
        rule('rule-name', { key: 'name:fornitore inventato', kind: 'utenze' }),
      ],
    });
    expect(result.classes).toEqual([
      {
        id: 'mc-spaced',
        transactionId: 'spaced',
        kind: 'altro',
        apartmentId: 'berchet',
        ruleId: 'rule-iban',
      },
      {
        id: 'mc-wrong',
        transactionId: 'wrong',
        kind: 'utenze',
        apartmentId: 'berchet',
        ruleId: 'rule-name',
      },
    ]);
    expect(result.proposals).toEqual([
      { id: 'p-uscita-blank', transactionId: 'blank', step: 'uscita', reason: 'no-counterparty' },
      { id: 'p-uscita-none', transactionId: 'none', step: 'uscita', reason: 'no-counterparty' },
    ]);
  });

  it('rules with different categories conflict; with the same, the first by id', () => {
    const t = [tx('b', -4000, supplier)];
    expect(run({ transactions: t, rules: [rule('r1'), rule('r2', { kind: 'utenze' })] })).toEqual({
      classes: [],
      proposals: [
        { id: 'p-uscita-b', transactionId: 'b', step: 'uscita', reason: 'rule-conflict' },
      ],
      missingDocument: [],
    });
    expect(
      run({ transactions: t, rules: [rule('r1', { apartmentId: 'pulci' }), rule('r2')] }).proposals,
    ).toEqual([{ id: 'p-uscita-b', transactionId: 'b', step: 'uscita', reason: 'rule-conflict' }]);
    expect(run({ transactions: t, rules: [rule('r2'), rule('r1')] }).classes).toEqual([
      { id: 'mc-b', transactionId: 'b', kind: 'altro', apartmentId: 'berchet', ruleId: 'r1' },
    ]);
  });

  it('skips used, deleted and zero movements and those of a deleted or missing account', () => {
    const result = run({
      transactions: [
        tx('used', -4000, supplier),
        tx('gone', -4000, supplier, { deleted: true }),
        tx('zero', 0, supplier),
        tx('noacc', -4000, supplier, { accountId: undefined }),
        tx('other', -4000, supplier, { accountId: 'acc-lovarini' }),
      ],
      used: new Set(['used']),
    });
    expect(result).toEqual({ classes: [], proposals: [], missingDocument: [] });
  });

  it('an incoming movement: only by an iban rule and only without a valid payer (question 2)', () => {
    const payer = PayerSchema.parse({
      ...base,
      id: 'payer-x',
      key: `iban:${SUPPLIER}`,
      tenantId: 't-mario',
      validFrom: '2028-01-01',
      source: 'confirmed',
    });
    const inRule = rule('rule-in', { direction: 'in', kind: 'utenze', apartmentId: 'pulci' });
    const refund = [tx('r', 810, supplier)];
    expect(run({ transactions: refund, rules: [inRule] }).classes).toEqual([
      { id: 'mc-r', transactionId: 'r', kind: 'utenze', apartmentId: 'pulci', ruleId: 'rule-in' },
    ]);
    // A payer with that key: the movement is the income's, never classified.
    expect(run({ transactions: refund, rules: [inRule], payers: [payer] })).toEqual({
      classes: [],
      proposals: [],
      missingDocument: [],
    });
    // A payer of a deleted tenant is not valid (R119), one not yet valid neither.
    const deleted = TenantSchema.parse({ ...base, id: 't-mario', name: 'Mario', deleted: true });
    expect(
      run({ transactions: refund, rules: [inRule], payers: [payer], tenants: [deleted] }).classes,
    ).toHaveLength(1);
    expect(
      run({
        transactions: refund,
        rules: [inRule],
        payers: [{ ...payer, validFrom: isoDate('2028-03-01') }],
      }).classes,
    ).toHaveLength(1);
    // No rule, a name key, an outgoing rule: no class and no proposal (the «chi» of the income).
    expect(run({ transactions: refund })).toEqual({
      classes: [],
      proposals: [],
      missingDocument: [],
    });
    expect(
      run({
        transactions: [tx('n', 810, { name: 'Fornitore Inventato', iban: WRONG_CHECK })],
        rules: [rule('rule-out-name', { key: 'name:fornitore inventato' })],
      }),
    ).toEqual({ classes: [], proposals: [], missingDocument: [] });
    expect(run({ transactions: refund, rules: [rule('rule-out')] }).classes).toEqual([]);
  });

  it('suggests utenze only for a known supplier in the description (question 7)', () => {
    const bill = BillSchema.parse({
      ...base,
      id: 'bill-enel',
      apartmentId: 'lovarini',
      category: 'elettricita',
      supplier: 'Enel',
      periodStart: '2027-11-01',
      periodEnd: '2027-12-31',
      amount: 4820,
      includedInConguaglio: true,
      sharedWithTenants: true,
      fileHash: 'h',
      filePath: 'bollette/b.pdf',
    });
    const result = run({
      transactions: [
        tx('enel', -4820, undefined, { description: 'ADDEBITO DIRETTO  ENEL' }),
        tx('rossi', -12000, undefined, { description: 'BONIFICO A ROSSI IDRAULICO' }),
      ],
      bills: [bill],
    });
    expect(result.proposals).toEqual([
      {
        id: 'p-uscita-enel',
        transactionId: 'enel',
        step: 'uscita',
        reason: 'no-counterparty',
        suggestedKind: 'utenze',
      },
      { id: 'p-uscita-rossi', transactionId: 'rossi', step: 'uscita', reason: 'no-counterparty' },
    ]);
    // A deleted bill suggests nothing; a supplier profile does.
    expect(
      run({
        transactions: [tx('enel', -4820, undefined, { description: 'ADDEBITO DIRETTO ENEL' })],
        bills: [{ ...bill, deleted: true }],
      }).proposals[0],
    ).not.toHaveProperty('suggestedKind');
    expect(
      run({
        transactions: [tx('enel', -4820, undefined, { description: 'ADDEBITO DIRETTO ENEL' })],
        supplierProfiles: [{ supplier: 'enel' } as never],
      }).proposals[0],
    ).toMatchObject({ suggestedKind: 'utenze' });
  });

  it('lists the live utenze and condominio classes without a confirmed match (question 8)', () => {
    const cls = (id: string, kind: string, extra = {}) =>
      MovementClassSchema.parse({
        ...base,
        id: `mc-${id}`,
        transactionId: id,
        kind,
        apartmentId: 'berchet',
        ...extra,
      });
    const match = (transactionId: string, extra = {}) =>
      BillMatchSchema.parse({
        ...base,
        id: `m-${transactionId}`,
        itemType: 'bill',
        itemId: 'b',
        transactionId,
        transactionDate: '2028-02-10',
        amount: 100,
        part: 'amount',
        confirmed: true,
        by: 'manual',
        ...extra,
      });
    const result = run({
      transactions: [tx('auto', -4000, supplier)],
      rules: [rule('rule-a', { kind: 'condominio' })],
      classes: [
        cls('u', 'utenze'),
        cls('c', 'condominio'),
        cls('a', 'altro'),
        cls('gone', 'utenze', { deleted: true }),
        cls('m', 'utenze'),
        cls('p', 'utenze'),
        cls('x', 'utenze'),
      ],
      matches: [match('m'), match('p', { confirmed: false }), match('x', { deleted: true })],
      used: new Set(['u', 'c', 'a', 'm', 'p', 'x']),
    });
    expect(result.missingDocument).toEqual(['auto', 'c', 'p', 'u', 'x']);
  });

  it('gives the same result in any order of its arrays', () => {
    const input = {
      transactions: [
        tx('b', -4000, supplier),
        tx('a', -4000, { name: 'Altro' }),
        tx('c', 900, supplier),
        tx('d', -100, undefined, { description: 'ENEL' }),
      ],
      rules: [rule('r2'), rule('r1', { direction: 'in', kind: 'utenze' })],
      bills: [] as never[],
      supplierProfiles: [{ supplier: 'Enel' } as never, { supplier: 'Hera' } as never],
    };
    const reversed = {
      transactions: [...input.transactions].reverse(),
      rules: [...input.rules].reverse(),
      bills: [],
      supplierProfiles: [...input.supplierProfiles].reverse(),
      accounts: [...accounts].reverse(),
    };
    expect(run(reversed)).toEqual(run(input));
    expect(run(input).classes.map((c) => c.id)).toEqual(['mc-b', 'mc-c']);
  });
});

describe('F24 (plan 3c, task 7, decision 5)', () => {
  // An invented description: the real text of an F24 at the bank is not verified yet (R129).
  const profile = BankProfileSchema.parse({
    ...base,
    id: 'bp',
    bank: 'Banca inventata',
    validFrom: '2020-01-01',
    container: 'csv',
    header: { allOf: ['Data'] },
    columns: { date: 'Data', description: ['Descrizione'], amount: 'Importo' },
    dateFormat: 'DD/MM/YYYY',
    f24Pattern: '^PAGAMENTO F24\\b',
  });
  const f24 = tx('f', -6700, supplier, { description: 'PAGAMENTO F24 DELEGA 0001' });
  const proposal = {
    id: 'p-f24-f',
    transactionId: 'f',
    step: 'f24',
    reason: 'f24',
    suggestedKind: 'tasse',
  };

  it('isF24 tests the description with the pattern of the profile, none without one', () => {
    expect(isF24(f24, profile)).toBe(true);
    expect(isF24(tx('b', -6700, supplier, { description: 'PAGAMENTO F245' }), profile)).toBe(false);
    expect(isF24(f24, undefined)).toBe(false);
    expect(isF24(f24, { ...profile, f24Pattern: undefined })).toBe(false);
  });

  it('always a p-f24- proposal, even with a valid rule; never an automatic class', () => {
    expect(run({ transactions: [f24], bankProfiles: [profile] })).toEqual({
      classes: [],
      proposals: [proposal],
      missingDocument: [],
    });
    expect(run({ transactions: [f24], bankProfiles: [profile], rules: [rule('rule-a')] })).toEqual({
      classes: [],
      proposals: [proposal],
      missingDocument: [],
    });
    // Rules in conflict: still the F24 proposal, not rule-conflict.
    expect(
      run({
        transactions: [f24],
        bankProfiles: [profile],
        rules: [rule('r1'), rule('r2', { kind: 'tasse' })],
      }),
    ).toEqual({ classes: [], proposals: [proposal], missingDocument: [] });
  });

  it('a description longer than 300 characters is tried on its first 300 (R102)', () => {
    const ids = (description: string, p = profile) =>
      run({
        transactions: [tx('f', -6700, supplier, { description })],
        bankProfiles: [p],
      }).proposals.map((x) => x.id);
    const head = `PAGAMENTO F24 ${'X'.repeat(386)}`;
    expect(head).toHaveLength(400);
    expect(ids(head)).toEqual(['p-f24-f']);
    // Unanchored, the text after character 300 is never seen.
    const late = { ...profile, f24Pattern: 'PAGAMENTO F24' };
    const tail = `${'X'.repeat(300)}PAGAMENTO F24${'X'.repeat(87)}`;
    expect(tail).toHaveLength(400);
    expect(ids(tail, late)).toEqual(['p-uscita-f']);
    expect(ids(`${'X'.repeat(287)}PAGAMENTO F24${'X'.repeat(100)}`, late)).toEqual(['p-f24-f']);
  });

  it('a profile without f24Pattern, deleted or of another account recognises no F24', () => {
    const plain = {
      id: 'p-uscita-f',
      transactionId: 'f',
      step: 'uscita',
      reason: 'new-counterparty',
    };
    for (const bankProfiles of [
      [{ ...profile, f24Pattern: undefined }],
      [{ ...profile, deleted: true as const }],
      [{ ...profile, id: 'bp-other' }],
      [],
    ]) {
      expect(run({ transactions: [f24], bankProfiles }).proposals).toEqual([plain]);
    }
    // An incoming movement is never an F24: it keeps the path of the income.
    expect(
      run({
        transactions: [tx('in', 6700, supplier, { description: 'PAGAMENTO F24 RIMBORSO' })],
        bankProfiles: [profile],
      }),
    ).toEqual({ classes: [], proposals: [], missingDocument: [] });
  });
});
