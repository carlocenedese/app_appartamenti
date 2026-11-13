import { describe, expect, it } from 'vitest';
import {
  BillSchema,
  ExtractionResultSchema,
  InstalmentSchema,
  TenancySchema,
  cents,
  proposalFromExtraction,
  splitSharedDebit,
  suggestedFilePath,
} from '../src/index';
import type {
  Bill,
  ExtractionResult,
  Instalment,
  ISODate,
  Proposal,
  ProposalCheck,
  ProposalContext,
  Tenancy,
} from '../src/index';

// Synthetic data only: suppliers, numbers and codes are invented (the POD is the fictitious one
// listed in fixtures/README.md).
const POD = 'IT001E12345678';
const source = { page: 1, box: [10, 20, 110, 40], text: 'testo' };
const field = (value: unknown, confidence = 'high') => ({ value, confidence, source });

function result(overrides: Record<string, unknown> = {}): ExtractionResult {
  const { fields, ...rest } = overrides;
  return ExtractionResultSchema.parse({
    v: 1,
    engineVersion: '0.1.0',
    fileHash: 'a'.repeat(64),
    fileName: 'bolletta.pdf',
    pages: 2,
    status: 'riconosciuta',
    profileId: 'prof-1',
    profileRev: 1,
    kind: 'bill',
    category: 'elettricita',
    fields: {
      supplier: field('Fornitore Luce'),
      number: field('2026/0042'),
      issueDate: field('2026-02-05'),
      dueDate: field('2026-02-25'),
      periodStart: field('2025-12-01'),
      periodEnd: field('2026-01-31'),
      amount: field(9846),
      consumption: field({ quantity: '140.0', unit: 'kWh' }),
      ...(fields as Record<string, unknown> | undefined),
    },
    parts: [],
    identifiers: [{ kind: 'pod', value: POD }],
    checks: [{ code: 'total-matches-items', ok: true, message: 'Il totale torna.' }],
    warnings: [],
    textSource: 'pdf',
    ...rest,
  });
}

function storedTenancy(id: string, apartmentId: string, from: string, to?: string): Tenancy {
  return TenancySchema.parse({
    id,
    v: 1,
    rev: 1,
    apartmentId,
    tenantId: `t-${id}`,
    from,
    ...(to === undefined ? {} : { to }),
    monthlyRent: 40000,
    monthlyForfait: 5000,
  });
}

function storedBill(id: string, extra: Record<string, unknown> = {}): Bill {
  return BillSchema.parse({
    id,
    v: 1,
    rev: 1,
    apartmentId: 'apt-1',
    category: 'elettricita',
    supplier: 'Fornitore Luce',
    number: '2025/0001',
    periodStart: '2024-12-01',
    periodEnd: '2025-01-31',
    amount: 8000,
    consumption: { quantity: '100', unit: 'kWh' },
    includedInConguaglio: true,
    sharedWithTenants: true,
    fileHash: 'b'.repeat(64),
    filePath: 'Bollette/Elettricita/2025/x.pdf',
    ...extra,
  });
}

function context(extra: Partial<ProposalContext> = {}): ProposalContext {
  return {
    apartment: { id: 'apt-1', knownCodes: [] },
    bills: [],
    instalments: [],
    tenancies: [storedTenancy('ten-1', 'apt-1', '2025-01')],
    thresholds: { consumptionAnomalyPercent: 30 },
    ...extra,
  };
}

function ids(prefix = 'id'): () => string {
  let count = 0;
  return () => `${prefix}-${String(++count)}`;
}

const check = (proposal: Proposal, code: string): ProposalCheck | undefined =>
  proposal.checks.find((c) => c.code === code);
const severities = (proposal: Proposal): string[] => proposal.checks.map((c) => c.severity);

function asBill(proposal: Proposal) {
  if (proposal.kind !== 'bill') throw new Error(`expected a bill, got ${proposal.kind}`);
  return proposal;
}
function asTari(proposal: Proposal) {
  if (proposal.kind !== 'tari') throw new Error(`expected tari, got ${proposal.kind}`);
  return proposal;
}

describe('proposalFromExtraction: bill', () => {
  it('turns a recognised bill into a proposed record with high confidence and no failure', () => {
    const proposal = asBill(proposalFromExtraction(result(), context(), ids('bill')));
    expect(proposal.bill).toEqual({
      id: 'bill-1',
      apartmentId: 'apt-1',
      category: 'elettricita',
      supplier: 'Fornitore Luce',
      number: '2026/0042',
      issueDate: '2026-02-05',
      dueDate: '2026-02-25',
      periodStart: '2025-12-01',
      periodEnd: '2026-01-31',
      amount: 9846,
      consumption: { quantity: '140.0', unit: 'kWh' },
      includedInConguaglio: true,
      sharedWithTenants: true,
      filePath:
        'Bollette/Elettricita/2026/2026-02-05_Elettricita_Fornitore-Luce_20251201-20260131.pdf',
    });
    expect(Object.values(proposal.confidence).every((c) => c === 'high')).toBe(true);
    expect(Object.keys(proposal.confidence).sort()).toEqual(
      [
        'amount',
        'consumption',
        'dueDate',
        'issueDate',
        'number',
        'periodEnd',
        'periodStart',
        'supplier',
      ].sort(),
    );
    expect(severities(proposal)).not.toContain('fail');
    expect(severities(proposal)).not.toContain('warn');
    // The proposal plus a hash and a revision is a valid stored bill.
    expect(() =>
      BillSchema.parse({ ...proposal.bill, v: 1, rev: 1, fileHash: 'a'.repeat(64) }),
    ).not.toThrow();
  });

  it('fails duplicate-number when a live bill of the same apartment and supplier has the number', () => {
    const same = storedBill('old', { number: '2026/0042', supplier: 'FORNITORE  luce' });
    const proposal = proposalFromExtraction(result(), context({ bills: [same] }), ids());
    expect(check(proposal, 'duplicate-number')?.severity).toBe('fail');
  });

  it('does not count deleted bills, other apartments or other suppliers as duplicates', () => {
    const bills = [
      storedBill('a', { number: '2026/0042', deleted: true }),
      storedBill('b', { number: '2026/0042', apartmentId: 'apt-2' }),
      storedBill('c', { number: '2026/0042', supplier: 'Altro Fornitore' }),
    ];
    const proposal = proposalFromExtraction(result(), context({ bills }), ids());
    expect(check(proposal, 'duplicate-number')?.severity).toBe('ok');
  });

  it('warns period-tenancies for the months without tenants, and only those', () => {
    const tenancies = [
      storedTenancy('a', 'apt-1', '2025-06', '2025-12'),
      storedTenancy('b', 'apt-2', '2026-01'), // another apartment: does not count
    ];
    const proposal = proposalFromExtraction(result(), context({ tenancies }), ids());
    const found = check(proposal, 'period-tenancies');
    expect(found?.severity).toBe('warn');
    expect(found?.message).toContain('gennaio 2026');
    expect(found?.message).not.toContain('dicembre');
  });

  it('ignores deleted tenancies', () => {
    const tenancies = [{ ...storedTenancy('a', 'apt-1', '2025-01'), deleted: true }];
    const proposal = proposalFromExtraction(result(), context({ tenancies }), ids());
    expect(check(proposal, 'period-tenancies')?.severity).toBe('warn');
  });

  describe('consumption-anomaly', () => {
    const lastYear = storedBill('prev', {
      periodStart: '2024-12-01',
      periodEnd: '2025-01-31',
      consumption: { quantity: '100', unit: 'kWh' },
    });
    const withConsumption = (quantity: string, unit = 'kWh') =>
      result({ fields: { consumption: field({ quantity, unit }) } });

    it('warns when the consumption is 40 % above the same months of the year before', () => {
      const proposal = proposalFromExtraction(
        withConsumption('140'),
        context({ bills: [lastYear] }),
        ids(),
      );
      expect(check(proposal, 'consumption-anomaly')?.severity).toBe('warn');
    });

    it('is ok at +10 % and exactly at the threshold', () => {
      for (const quantity of ['110', '130.00']) {
        const proposal = proposalFromExtraction(
          withConsumption(quantity),
          context({ bills: [lastYear] }),
          ids(),
        );
        expect(check(proposal, 'consumption-anomaly')?.severity).toBe('ok');
      }
    });

    it('takes the threshold from the context, decimals included', () => {
      const ctx = context({ bills: [lastYear], thresholds: { consumptionAnomalyPercent: 9.5 } });
      expect(
        check(proposalFromExtraction(withConsumption('110'), ctx, ids()), 'consumption-anomaly')
          ?.severity,
      ).toBe('warn');
      expect(
        check(proposalFromExtraction(withConsumption('109.4'), ctx, ids()), 'consumption-anomaly')
          ?.severity,
      ).toBe('ok');
    });

    it('makes no check without history', () => {
      const others = [
        storedBill('gas', { category: 'gas' }),
        storedBill('shifted', { periodStart: '2025-01-01', periodEnd: '2025-02-28' }),
        storedBill('gone', { deleted: true }),
        storedBill('noconsumption', { consumption: undefined }),
        storedBill('otherunit', { consumption: { quantity: '1', unit: 'Smc' } }),
        storedBill('otherflat', { apartmentId: 'apt-2' }),
      ];
      const proposal = proposalFromExtraction(
        withConsumption('999'),
        context({ bills: others }),
        ids(),
      );
      expect(check(proposal, 'consumption-anomaly')).toBeUndefined();
    });

    it('makes no check when the bill has no consumption', () => {
      const proposal = proposalFromExtraction(
        result({ fields: { consumption: field(null, 'missing') } }),
        context({ bills: [lastYear] }),
        ids(),
      );
      expect(check(proposal, 'consumption-anomaly')).toBeUndefined();
      expect(asBill(proposal).bill.consumption).toBeUndefined();
    });

    it('rejects a threshold that is not a non-negative number', () => {
      expect(() =>
        proposalFromExtraction(
          result(),
          context({ thresholds: { consumptionAnomalyPercent: -1 } }),
          ids(),
        ),
      ).toThrow(RangeError);
    });
  });

  describe('apartment-codes', () => {
    it('warns when known codes exist and none appears in the result', () => {
      const ctx = context({ apartment: { id: 'apt-1', knownCodes: ['CLIENTE-0000-9'] } });
      expect(check(proposalFromExtraction(result(), ctx, ids()), 'apartment-codes')?.severity).toBe(
        'warn',
      );
    });

    it('is ok when one known code appears, spaces and case aside', () => {
      const ctx = context({ apartment: { id: 'apt-1', knownCodes: ['it001e 12345678'] } });
      expect(check(proposalFromExtraction(result(), ctx, ids()), 'apartment-codes')?.severity).toBe(
        'ok',
      );
    });

    it('makes no check without known codes', () => {
      expect(check(proposalFromExtraction(result(), context(), ids()), 'apartment-codes')).toBe(
        undefined,
      );
    });
  });

  it('turns every failed extractor check into an extraction:<code> failure', () => {
    const proposal = proposalFromExtraction(
      result({
        checks: [
          { code: 'total-matches-items', ok: false, message: 'Il totale non torna.' },
          { code: 'parts-found', ok: true, message: 'ok' },
        ],
      }),
      context(),
      ids(),
    );
    expect(check(proposal, 'extraction:total-matches-items')?.severity).toBe('fail');
    expect(check(proposal, 'extraction:parts-found')).toBeUndefined();
  });

  it('a missing amount fails missing-field and invents no value', () => {
    const proposal = proposalFromExtraction(
      result({ fields: { amount: field(null, 'missing') } }),
      context(),
      ids(),
    );
    expect(proposal.kind).toBe('none');
    const missing = proposal.checks.filter((c) => c.code === 'missing-field');
    expect(missing).toHaveLength(1);
    expect(missing[0]?.severity).toBe('fail');
    expect(missing[0]?.message).toContain('importo');
  });

  it('a required field absent from the result, or with confidence missing, fails too', () => {
    const fieldsWithoutSupplier = { ...result().fields };
    delete fieldsWithoutSupplier.supplier;
    const base = result();
    const proposal = proposalFromExtraction(
      {
        ...base,
        fields: { ...fieldsWithoutSupplier, periodEnd: { ...field('2026-01-31', 'missing') } },
      } as ExtractionResult,
      context(),
      ids(),
    );
    expect(proposal.checks.filter((c) => c.code === 'missing-field')).toHaveLength(2);
  });

  it('keeps optional fields that are missing empty', () => {
    const proposal = asBill(
      proposalFromExtraction(
        result({
          status: 'da-confermare',
          fields: {
            number: field(null, 'missing'),
            dueDate: field('2026-02-25', 'missing'),
            issueDate: field('2026-02-05', 'medium'),
          },
        }),
        context(),
        ids(),
      ),
    );
    expect(proposal.bill.number).toBeUndefined();
    expect(proposal.bill.dueDate).toBeUndefined();
    expect(proposal.bill.issueDate).toBe('2026-02-05');
    expect(proposal.confidence).toMatchObject({
      number: 'missing',
      dueDate: 'missing',
      issueDate: 'medium',
    });
    expect(check(proposal, 'duplicate-number')).toBeUndefined();
    expect(check(proposal, 'status')?.severity).toBe('warn');
  });

  it('names the file after the end of the period when the issue date is missing', () => {
    const proposal = asBill(
      proposalFromExtraction(
        result({ fields: { issueDate: field(null, 'missing') } }),
        context(),
        ids(),
      ),
    );
    expect(proposal.bill.filePath).toBe(
      'Bollette/Elettricita/2026/2026-01-31_Elettricita_Fornitore-Luce_20251201-20260131.pdf',
    );
    expect(check(proposal, 'file-name')?.severity).toBe('warn');
  });

  it('fails period-order for a period that ends before it starts', () => {
    const proposal = proposalFromExtraction(
      result({ fields: { periodStart: field('2026-02-01') } }),
      context(),
      ids(),
    );
    expect(proposal.kind).toBe('none');
    expect(check(proposal, 'period-order')?.severity).toBe('fail');
  });

  it('gives none for a bill without category or kind', () => {
    expect(proposalFromExtraction(result({ category: null }), context(), ids()).kind).toBe('none');
    const noKind = proposalFromExtraction(result({ kind: null }), context(), ids());
    expect(noKind.kind).toBe('none');
    expect(check(noKind, 'kind')?.severity).toBe('fail');
  });

  it.each(['non-riconosciuta', 'senza-testo', 'illeggibile'])(
    'gives kind none for status %s',
    (status) => {
      const proposal = proposalFromExtraction(result({ status }), context(), ids());
      expect(proposal.kind).toBe('none');
      expect(proposal.confidence).toEqual({});
      expect(check(proposal, 'status')?.severity).toBe('fail');
    },
  );

  it('asks for no id when it proposes nothing', () => {
    let calls = 0;
    proposalFromExtraction(result({ status: 'senza-testo' }), context(), () => `x${++calls}`);
    expect(calls).toBe(0);
  });
});

describe('proposalFromExtraction: TARI', () => {
  const tariResult = (overrides: Record<string, unknown> = {}) =>
    result({
      kind: 'tari',
      category: null,
      fields: {
        supplier: field('Comune di Esempio'),
        number: field('2026/1/00001'),
        issueDate: field('2026-02-20'),
        dueDate: field('2026-03-16'),
        periodStart: field('2026-01-01'),
        periodEnd: field('2026-04-30'),
        amount: field(18546),
        consumption: undefined,
      },
      parts: [
        { label: 'Berchet', amount: 10075, source },
        { label: 'Lovarini', amount: 8471, source },
      ],
      identifiers: [],
      ...overrides,
    });
  const supplies = [
    { id: 'sup-berchet', label: 'Berchet', apartments: [{ apartmentId: 'apt-b', weight: 10000 }] },
    {
      id: 'sup-lovarini',
      label: 'Lovarini',
      apartments: [{ apartmentId: 'apt-l', weight: 10000 }],
    },
  ];
  const tariContext = (extra: Partial<ProposalContext> = {}) =>
    context({
      apartment: { id: 'apt-b', knownCodes: [] },
      tenancies: [storedTenancy('b', 'apt-b', '2025-01'), storedTenancy('l', 'apt-l', '2025-01')],
      supplies,
      ...extra,
    });

  it('proposes one instalment per supply, sharing the group, and they split a debit', () => {
    const proposal = asTari(proposalFromExtraction(tariResult(), tariContext(), ids('i')));
    expect(proposal.instalments).toHaveLength(2);
    const [berchet, lovarini] = proposal.instalments;
    expect(berchet).toMatchObject({
      apartmentId: 'apt-b',
      kind: 'tari',
      esercizio: '2026',
      rateIndex: 1,
      rateCount: 3,
      dueDate: '2026-03-16',
      issueDate: '2026-02-20',
      rata: 10075,
      quotaProprieta: 0,
      conguaglioPrec: 0,
      coversFrom: '2026-01',
      coversTo: '2026-04',
      supplyId: 'sup-berchet',
      shared: { groupTotal: 18546, weight: 10075 },
    });
    expect(lovarini).toMatchObject({ apartmentId: 'apt-l', shared: { weight: 8471 } });
    expect(berchet?.shared?.groupId).toBe(lovarini?.shared?.groupId);
    expect(new Set(proposal.instalments.map((i) => i.id)).size).toBe(2);
    expect(severities(proposal)).not.toContain('fail');
    expect(severities(proposal)).not.toContain('warn');
    for (const instalment of proposal.instalments) {
      expect(() =>
        InstalmentSchema.parse({ ...instalment, v: 1, rev: 1, fileHash: 'a'.repeat(64) }),
      ).not.toThrow();
    }
    const split = splitSharedDebit(
      cents(-18600),
      proposal.instalments.map((i) => ({ itemId: i.id, weight: i.shared?.weight ?? cents(0) })),
    );
    expect(split.reduce((sum, s) => sum + s.amount, 0)).toBe(18600);
  });

  it('fails unknown-part for a label without an apartment and keeps the others', () => {
    const proposal = asTari(
      proposalFromExtraction(
        tariResult(),
        tariContext({
          supplies: [
            {
              id: 'sup-berchet',
              label: 'Berchet',
              apartments: [{ apartmentId: 'apt-b', weight: 10000 }],
            },
          ],
        }),
        ids(),
      ),
    );
    expect(proposal.instalments).toHaveLength(1);
    expect(check(proposal, 'unknown-part')?.severity).toBe('fail');
    expect(check(proposal, 'unknown-part')?.message).toContain('Lovarini');
    expect(check(proposal, 'unknown-part')?.message).toContain('Collegala qui sotto');
  });

  it('splits a supply of two apartments by weight, sharing the group', () => {
    const proposal = asTari(
      proposalFromExtraction(
        tariResult(),
        tariContext({
          supplies: [
            {
              id: 'sup-berchet',
              label: 'Berchet',
              apartments: [
                { apartmentId: 'apt-b', weight: 3333 },
                { apartmentId: 'apt-c', weight: 6667 },
              ],
            },
            {
              id: 'sup-lovarini',
              label: 'Lovarini',
              apartments: [{ apartmentId: 'apt-l', weight: 10000 }],
            },
          ],
          tenancies: [
            storedTenancy('b', 'apt-b', '2025-01'),
            storedTenancy('c', 'apt-c', '2025-01'),
            storedTenancy('l', 'apt-l', '2025-01'),
          ],
        }),
        ids(),
      ),
    );
    const [b, c, l] = proposal.instalments;
    // 10075 split 3333:6667 gives 3358.0 and 6717.0: the larger remainder takes the extra cent.
    expect([b?.apartmentId, b?.rata, b?.shared?.weight]).toEqual(['apt-b', 3358, 3358]);
    expect([c?.apartmentId, c?.rata, c?.shared?.weight]).toEqual(['apt-c', 6717, 6717]);
    expect([l?.apartmentId, l?.rata]).toEqual(['apt-l', 8471]);
    expect(b?.shared?.groupId).toBe(l?.shared?.groupId);
    expect(b?.shared?.groupTotal).toBe(18546);
    expect(check(proposal, 'duplicate-apartment')).toBeUndefined();
  });

  it('fails part-share and proposes nothing for a supply whose share rounds to zero', () => {
    const proposal = asTari(
      proposalFromExtraction(
        tariResult({
          parts: [
            { label: 'Berchet', amount: 4000, source },
            { label: 'Lovarini', amount: 8471, source },
          ],
        }),
        tariContext({
          supplies: [
            {
              id: 'sup-berchet',
              label: 'Berchet',
              apartments: [
                { apartmentId: 'apt-b', weight: 1 },
                { apartmentId: 'apt-c', weight: 9999 },
              ],
            },
            {
              id: 'sup-lovarini',
              label: 'Lovarini',
              apartments: [{ apartmentId: 'apt-l', weight: 10000 }],
            },
          ],
        }),
        ids(),
      ),
    );
    expect(check(proposal, 'part-share')?.severity).toBe('fail');
    expect(check(proposal, 'part-share')?.message).toContain(
      'La quota di un appartamento su questa utenza «Berchet» è zero: la percentuale è troppo piccola per questo importo. Controlla le percentuali.',
    );
    expect(proposal.instalments.map((i) => i.apartmentId)).toEqual(['apt-l']);
  });

  it('fails duplicate-supply for two supplies with the same label, proposing neither', () => {
    const berchet = {
      id: 'sup-berchet',
      label: 'Berchet',
      apartments: [{ apartmentId: 'apt-b', weight: 10000 }],
    };
    const proposal = asTari(
      proposalFromExtraction(
        tariResult(),
        tariContext({
          supplies: [
            berchet,
            {
              ...berchet,
              id: 'sup-berchet-2',
              label: 'berchet',
              apartments: [{ apartmentId: 'apt-c', weight: 10000 }],
            },
            {
              id: 'sup-lovarini',
              label: 'Lovarini',
              apartments: [{ apartmentId: 'apt-l', weight: 10000 }],
            },
          ],
        }),
        ids(),
      ),
    );
    expect(check(proposal, 'duplicate-supply')?.severity).toBe('fail');
    expect(check(proposal, 'duplicate-supply')?.message).toContain(
      'Apri Impostazioni, Utenze e correggi',
    );
    expect(check(proposal, 'unknown-part')?.severity).toBe('fail');
    expect(proposal.instalments.map((i) => i.apartmentId)).toEqual(['apt-l']);
  });

  it('ignores a deleted supply and treats a supply without apartments as unknown', () => {
    const proposal = asTari(
      proposalFromExtraction(
        tariResult(),
        tariContext({
          supplies: [
            {
              id: 'sup-berchet',
              label: 'Berchet',
              apartments: [{ apartmentId: 'apt-b', weight: 10000 }],
              deleted: true,
            },
            { id: 'sup-lovarini', label: 'Lovarini', apartments: [] },
          ],
        }),
        ids(),
      ),
    );
    expect(proposal.instalments).toHaveLength(0);
    expect(proposal.checks.filter((c) => c.code === 'unknown-part')).toHaveLength(2);
  });

  it('fails duplicate-apartment when one apartment gets two supplies', () => {
    const proposal = asTari(
      proposalFromExtraction(
        tariResult(),
        tariContext({
          supplies: [
            {
              id: 'sup-berchet',
              label: 'Berchet',
              apartments: [{ apartmentId: 'apt-b', weight: 10000 }],
            },
            {
              id: 'sup-lovarini',
              label: 'Lovarini',
              apartments: [{ apartmentId: 'apt-b', weight: 10000 }],
            },
          ],
        }),
        ids(),
      ),
    );
    expect(check(proposal, 'duplicate-apartment')?.severity).toBe('fail');
  });

  it('ignores a label written in other case and spacing', () => {
    const proposal = asTari(
      proposalFromExtraction(
        tariResult(),
        tariContext({
          supplies: [
            {
              id: 'sup-berchet',
              label: ' BERCHET ',
              apartments: [{ apartmentId: 'apt-b', weight: 10000 }],
            },
            {
              id: 'sup-lovarini',
              label: 'lovarini',
              apartments: [{ apartmentId: 'apt-l', weight: 10000 }],
            },
          ],
        }),
        ids(),
      ),
    );
    expect(proposal.instalments).toHaveLength(2);
  });

  it('fails unknown-part when no parts map is given', () => {
    const proposal = proposalFromExtraction(
      tariResult(),
      tariContext({ supplies: undefined }),
      ids(),
    );
    expect(proposal.checks.filter((c) => c.code === 'unknown-part')).toHaveLength(2);
  });

  it('has no parts-total check: the parts need not add up to the amount to pay', () => {
    const proposal = proposalFromExtraction(
      tariResult({ fields: { ...tariResult().fields, amount: field(18600) } }),
      tariContext(),
      ids(),
    );
    expect(check(proposal, 'parts-total')).toBeUndefined();
  });

  it('fails part-amount for a supply that is not a positive amount', () => {
    const proposal = proposalFromExtraction(
      tariResult({
        parts: [
          { label: 'Berchet', amount: 18546, source },
          { label: 'Lovarini', amount: 0, source },
        ],
      }),
      tariContext(),
      ids(),
    );
    expect(check(proposal, 'part-amount')?.severity).toBe('fail');
  });

  it.each([
    ['2026-01-31', 1, '2026-01', '2026-04'],
    ['2026-05-31', 1, '2026-01', '2026-04'],
    ['2026-06-01', 2, '2026-05', '2026-08'],
    ['2026-09-30', 2, '2026-05', '2026-08'],
    ['2026-10-01', 3, '2026-09', '2026-12'],
    ['2026-12-16', 3, '2026-09', '2026-12'],
  ])('a due date of %s gives rata %i covering %s to %s', (dueDate, rateIndex, from, to) => {
    const proposal = asTari(
      proposalFromExtraction(
        tariResult({
          fields: {
            ...tariResult().fields,
            dueDate: field(dueDate),
            periodStart: field(`${from}-01`),
            periodEnd: field(`${to}-${to.endsWith('-04') ? '30' : '31'}`),
          },
        }),
        tariContext(),
        ids(),
      ),
    );
    expect(proposal.instalments[0]).toMatchObject({
      rateIndex,
      coversFrom: from,
      coversTo: to,
      esercizio: '2026',
    });
    expect(check(proposal, 'tari-months')).toBeUndefined();
  });

  it('warns tari-months for a cumulative period, or a period that is not declared', () => {
    const cumulative = proposalFromExtraction(
      tariResult({
        fields: {
          ...tariResult().fields,
          dueDate: field('2026-12-16'),
          periodStart: field('2026-01-01'),
          periodEnd: field('2026-12-31'),
        },
      }),
      tariContext(),
      ids(),
    );
    expect(check(cumulative, 'tari-months')?.severity).toBe('warn');
    expect(asTari(cumulative).instalments[0]).toMatchObject({
      rateIndex: 3,
      coversFrom: '2026-09',
    });
    const undeclared = proposalFromExtraction(
      tariResult({ fields: { ...tariResult().fields, periodEnd: field(null, 'missing') } }),
      tariContext(),
      ids(),
    );
    expect(check(undeclared, 'tari-months')?.severity).toBe('warn');
  });

  it('a notice without parts is one instalment of the apartment, not shared', () => {
    const proposal = asTari(
      proposalFromExtraction(
        tariResult({ parts: [] }),
        tariContext({ supplies: undefined }),
        ids(),
      ),
    );
    expect(proposal.instalments).toHaveLength(1);
    expect(proposal.instalments[0]).toMatchObject({ apartmentId: 'apt-b', rata: 18546 });
    expect(proposal.instalments[0]?.shared).toBeUndefined();
    expect(severities(proposal)).not.toContain('fail');
    const emptyMap = proposalFromExtraction(
      tariResult({ parts: [] }),
      tariContext({ supplies: [] }),
      ids(),
    );
    expect(check(emptyMap, 'missing-parts')).toBeUndefined();
  });

  it('fails missing-parts when a shared notice is read without its supplies (R65)', () => {
    const proposal = proposalFromExtraction(tariResult({ parts: [] }), tariContext(), ids());
    expect(check(proposal, 'missing-parts')?.severity).toBe('fail');
  });

  it('fails duplicate-apartment when one apartment appears twice in the notice', () => {
    const sameLabel = proposalFromExtraction(
      tariResult({
        parts: [
          { label: 'Berchet', amount: 10075, source },
          { label: 'BERCHET ', amount: 8471, source },
        ],
      }),
      tariContext(),
      ids(),
    );
    expect(check(sameLabel, 'duplicate-apartment')?.severity).toBe('fail');
    const sameApartment = proposalFromExtraction(
      tariResult(),
      tariContext({
        supplies: [
          {
            id: 'sup-berchet',
            label: 'Berchet',
            apartments: [{ apartmentId: 'apt-b', weight: 10000 }],
          },
          {
            id: 'sup-lovarini',
            label: 'Lovarini',
            apartments: [{ apartmentId: 'apt-b', weight: 10000 }],
          },
        ],
      }),
      ids(),
    );
    expect(check(sameApartment, 'duplicate-apartment')?.severity).toBe('fail');
    expect(
      check(proposalFromExtraction(tariResult(), tariContext(), ids()), 'duplicate-apartment'),
    ).toBeUndefined();
  });

  it('fails missing-field without a due date or a total', () => {
    for (const name of ['dueDate', 'amount']) {
      const proposal = proposalFromExtraction(
        tariResult({ fields: { ...tariResult().fields, [name]: field(null, 'missing') } }),
        tariContext(),
        ids(),
      );
      expect(proposal.kind).toBe('none');
      expect(check(proposal, 'missing-field')?.severity).toBe('fail');
    }
  });

  it('fails duplicate-instalment when the apartment already has that TARI rate', () => {
    const existing: Instalment = InstalmentSchema.parse({
      id: 'old',
      v: 1,
      rev: 1,
      apartmentId: 'apt-l',
      kind: 'tari',
      esercizio: '2026',
      rateIndex: 1,
      rateCount: 3,
      dueDate: '2026-03-16',
      rata: 8471,
      quotaProprieta: 0,
      conguaglioPrec: 0,
      coversFrom: '2026-01',
      coversTo: '2026-04',
    });
    const proposal = proposalFromExtraction(
      tariResult(),
      tariContext({ instalments: [existing] }),
      ids(),
    );
    const duplicates = (p: Proposal) =>
      p.checks.filter((c) => c.code === 'duplicate-instalment').map((c) => c.severity);
    expect(duplicates(proposal)).toEqual(['ok', 'fail']);
    const deleted = proposalFromExtraction(
      tariResult(),
      tariContext({ instalments: [{ ...existing, deleted: true }] }),
      ids(),
    );
    expect(duplicates(deleted)).toEqual(['ok', 'ok']);
  });

  it('checks the tenancies of every apartment of the notice', () => {
    const proposal = proposalFromExtraction(
      tariResult(),
      tariContext({ tenancies: [storedTenancy('b', 'apt-b', '2025-01')] }),
      ids(),
    );
    const warnings = proposal.checks.filter(
      (c) => c.code === 'period-tenancies' && c.severity === 'warn',
    );
    expect(warnings).toHaveLength(1);
  });
});

describe('suggestedFilePath', () => {
  const input = {
    category: 'gas',
    supplier: "L'Energìa: Più Servizi",
    issueDate: '2026-04-13' as ISODate,
    periodStart: '2026-03-01' as ISODate,
    periodEnd: '2026-03-31' as ISODate,
  };

  it('builds Bollette/<Tipo>/<year>/date_Tipo_Supplier_period.pdf without forbidden characters', () => {
    const path = suggestedFilePath(input);
    expect(path).toBe(
      'Bollette/Gas/2026/2026-04-13_Gas_L-Energia-Piu-Servizi_20260301-20260331.pdf',
    );
    expect(path).toBe(path.normalize('NFC'));
    for (const segment of path.split('/')) {
      expect(segment).not.toMatch(/[<>:"\\|?*]/);
      expect(segment).not.toMatch(/[ .]$/);
      expect(segment.split('.')[0]?.toUpperCase()).not.toMatch(/^(CON|PRN|AUX|NUL|COM\d|LPT\d)$/);
    }
    expect(path).toMatch(/^[\x20-\x7e]+$/);
  });

  it('works for decomposed text, unknown categories and empty or long supplier names', () => {
    expect(
      suggestedFilePath({ ...input, supplier: 'Societa\u0300 Acqua', category: 'acqua' }),
    ).toBe('Bollette/Acqua/2026/2026-04-13_Acqua_Societa-Acqua_20260301-20260331.pdf');
    expect(suggestedFilePath({ ...input, supplier: '::', category: 'tari' })).toBe(
      'Bollette/Rifiuti/2026/2026-04-13_Rifiuti_Fornitore_20260301-20260331.pdf',
    );
    expect(suggestedFilePath({ ...input, category: 'condominio spese' })).toContain(
      'Bollette/Condominio-spese/2026/',
    );
    const long = suggestedFilePath({ ...input, supplier: 'X'.repeat(200) });
    expect(long.split('_')[2]?.length).toBeLessThanOrEqual(30);
  });

  it('does not depend on the time zone (dates are handled as text)', () => {
    // The CI runs the whole suite under several TZ values; the result is fixed text.
    expect(suggestedFilePath({ ...input, issueDate: '2026-01-01' as ISODate })).toBe(
      'Bollette/Gas/2026/2026-01-01_Gas_L-Energia-Piu-Servizi_20260301-20260331.pdf',
    );
  });
});
