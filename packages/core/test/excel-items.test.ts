import { describe, expect, it } from 'vitest';
import { calcConguaglio, cents, excelItems, isoDate } from '../src/index';
import type { BillMatch, ConguaglioInput, ExcelItem } from '../src/index';
import { bill, mulberry32, shuffled } from './helpers/conguaglio-builders';
import { fixtureInput } from './helpers/excel-fixture';

const itemsOf = (input: ConguaglioInput) => excelItems(input, calcConguaglio(input));
const byId = (items: ExcelItem[], id: string) => items.find((i) => i.itemId === id);

function amountMatch(itemType: BillMatch['itemType'], itemId: string, amount: number): BillMatch {
  return {
    id: `m-${itemType}-${itemId}-amount-tx-${itemId}`,
    v: 1,
    rev: 1,
    itemType,
    itemId,
    transactionId: `tx-${itemId}`,
    transactionDate: isoDate('2027-01-10'),
    amount: cents(amount),
    part: 'amount',
    confirmed: true,
    by: 'auto',
  };
}

describe('excelItems on the fixture', () => {
  const items = itemsOf(fixtureInput());

  it('lists the items that count, by start, category and id', () => {
    expect(items.map((i) => i.itemId)).toEqual([
      'bill-luce',
      'bill-internet',
      'inst-tari-nord',
      'inst-cond-1',
    ]);
  });

  it('gives the internet bill its amount, commission, share and debit date', () => {
    expect(byId(items, 'bill-internet')).toEqual({
      itemType: 'bill',
      itemId: 'bill-internet',
      category: 'internet',
      supplier: 'Rete Esempio',
      number: 'INT-2026-10',
      from: '2026-10-01',
      to: '2026-11-30',
      dueDate: '2026-12-10',
      debitDates: ['2026-12-10'],
      amount: 6000,
      commission: 80,
      inPeriod: 6080,
      fileName: 'internet-2026-10.pdf',
    });
  });

  it('notes the months of a bill outside the period', () => {
    const luce = byId(items, 'bill-luce');
    expect(luce?.amount).toBe(12000);
    expect(luce?.inPeriod).toBe(5999);
    expect(luce?.note).toBe(
      'Bolletta a cavallo: € 60,01 nei mesi agosto–settembre 2026, fuori da questo periodo.',
    );
  });

  it('leaves out a bill to verify (B1) and a bill without its debit', () => {
    expect(byId(items, 'bill-gas')).toBeUndefined();
    expect(byId(items, 'bill-acqua')).toBeUndefined();
  });

  it('leaves out a bill with an assumed match stored before B1: never paid (B1)', () => {
    const input = fixtureInput();
    input.matches.push({
      ...amountMatch('bill', 'bill-gas', 9000),
      transactionId: 'assumed-bill-gas',
      by: 'assumed',
    });
    expect(byId(itemsOf(input), 'bill-gas')).toBeUndefined();
    expect(calcConguaglio(input).pending).toContainEqual({
      itemType: 'bill',
      itemId: 'bill-gas',
      reason: 'da verificare',
    });
  });

  it("gives the condominium the tenants' part and the TARI this apartment's share", () => {
    expect(byId(items, 'inst-cond-1')).toEqual({
      itemType: 'instalment',
      itemId: 'inst-cond-1',
      category: 'condominio',
      number: 'Rata 1 di 3, 2026-27',
      from: '2026-10-01',
      to: '2027-01-31',
      dueDate: '2026-10-05',
      debitDates: ['2026-10-06'],
      amount: 32000,
      commission: 0,
      inPeriod: 32000,
    });
    expect(byId(items, 'inst-tari-nord')?.amount).toBe(10000);
    expect(byId(items, 'inst-tari-sud')).toBeUndefined();
  });

  it('does not depend on the order of the input', () => {
    const next = mulberry32(7);
    const input = fixtureInput();
    const mixed: ConguaglioInput = {
      ...input,
      bills: shuffled(input.bills, next),
      instalments: shuffled(input.instalments, next),
      matches: shuffled(input.matches, next),
      tenancies: shuffled(input.tenancies, next),
      payments: shuffled(input.payments, next),
    };
    expect(itemsOf(mixed)).toEqual(items);
  });
});

/** A fixture whose condominium year starts in May, inside an October-September lease year. */
function mayFiscalYear(): ConguaglioInput {
  const input = fixtureInput();
  input.apartment.condominioStart = { month: 5, day: 1 };
  const cond = input.instalments.find((i) => i.id === 'inst-cond-1');
  if (cond === undefined) throw new Error('no condominium');
  cond.conguaglioPrec = cents(1200);
  input.matches = input.matches.map((m) =>
    m.itemId === 'inst-cond-1' ? { ...m, amount: cents(31200) } : m,
  );
  return input;
}

describe('excelItems variants', () => {
  it("counts only the months of last year's settlement inside the period", () => {
    // 26000 over October-January, 1200 over May 2026-April 2027: 7 months of 100 in the period.
    const cond = byId(itemsOf(mayFiscalYear()), 'inst-cond-1');
    expect(cond?.amount).toBe(27200);
    expect(cond?.inPeriod).toBe(26700);
  });

  it('names both sides of a bill longer than the period', () => {
    const input = fixtureInput();
    input.bills.push(
      bill('bill-lunga', '2026-09-01', '2027-10-31', 14000, { apartmentId: 'apt-nord' }),
    );
    input.matches.push(amountMatch('bill', 'bill-lunga', 14000));
    expect(byId(itemsOf(input), 'bill-lunga')?.note).toBe(
      'Bolletta a cavallo: € 20,04 nei mesi settembre 2026 e ottobre 2027, fuori da questo periodo.',
    );
  });

  const variants: [string, () => ConguaglioInput][] = [
    ['the fixture', fixtureInput],
    ['a condominium year from May', mayFiscalYear],
    [
      'a bill of 14 months and a commission on the condominium',
      () => {
        const input = fixtureInput();
        input.bills.push(
          bill('bill-lunga', '2026-09-01', '2027-10-31', 14003, { apartmentId: 'apt-nord' }),
        );
        input.matches.push(amountMatch('bill', 'bill-lunga', 14003), {
          ...amountMatch('instalment', 'inst-cond-1', 151),
          id: 'm-cond-commission',
          transactionId: 'tx-cond-commission',
          part: 'commission',
        });
        return input;
      },
    ],
    [
      'a credit note of -20,00 €',
      () => {
        const input = fixtureInput();
        input.bills.push(
          bill('bill-nota', '2026-12-01', '2027-01-31', -2000, { apartmentId: 'apt-nord' }),
        );
        input.matches.push(amountMatch('bill', 'bill-nota', -2000));
        return input;
      },
    ],
  ];

  it.each(variants)(
    'adds up to the tenants and the empty beds of calcConguaglio: %s',
    (_, build) => {
      const input = build();
      const result = calcConguaglio(input);
      const sheet = excelItems(input, result).reduce((sum, i) => sum + i.inPeriod, 0);
      const tenants = result.tenants.reduce(
        (sum, t) => sum + t.spese + t.commissione + t.condominio.rata + t.condominio.conguaglioPrec,
        0,
      );
      expect(sheet).toBe(tenants + result.unassigned);
    },
  );
});

describe('excelItems with condoDifferenceTo owner (plan 8, task 4, R193)', () => {
  it("leaves last year's settlement out of the tenants' part, and the totals still add up", () => {
    const input = fixtureInput();
    input.apartment = { ...input.apartment, condoDifferenceTo: 'owner' };
    const result = calcConguaglio(input);
    const items = excelItems(input, result);
    expect(byId(items, 'inst-cond-1')).toMatchObject({ amount: 26000, inPeriod: 26000 });
    const shared = result.tenants.reduce<number>(
      (sum, t) => sum + t.spese + t.condominio.rata + t.condominio.conguaglioPrec + t.commissione,
      result.unassigned,
    );
    expect(items.reduce((sum, i) => sum + i.inPeriod, 0)).toBe(shared);
  });
});
