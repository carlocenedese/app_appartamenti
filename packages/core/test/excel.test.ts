import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  EXCEL_HEADERS,
  EXCEL_SHEETS,
  ExcelInputError,
  SettlementInputError,
  buildConguaglioWorkbook,
  calcConguaglio,
  cents,
  isoDate,
  writeXlsx,
  yearMonth,
} from '../src/index';
import type { ExcelInput, XlsxCell, XlsxSheet } from '../src/index';
import { bill, mulberry32, shuffled } from './helpers/conguaglio-builders';
import { fixtureInput } from './helpers/excel-fixture';

type Plain = string | number | null;
const plain = (cell: XlsxCell | null | undefined): Plain => cell?.value ?? null;
const rowsOf = (sheet: XlsxSheet | undefined): Plain[][] =>
  (sheet?.rows ?? []).map((row) => row.map(plain));

function sheets(input: ExcelInput = fixtureInput()) {
  const book = buildConguaglioWorkbook(input);
  const get = (name: string) => book.sheets.find((s) => s.name === name);
  return { book, get };
}

const MONTHS = [
  'ott 2026',
  'nov 2026',
  'dic 2026',
  'gen 2027',
  'feb 2027',
  'mar 2027',
  'apr 2027',
  'mag 2027',
  'giu 2027',
  'lug 2027',
  'ago 2027',
  'set 2027',
];

describe('buildConguaglioWorkbook on the fixture', () => {
  const { book, get } = sheets();

  it('has the four sheets with the headers of EXCEL_HEADERS', () => {
    expect(book.sheets.map((s) => s.name)).toEqual([...EXCEL_SHEETS]);
    expect(rowsOf(get('Bollette'))[0]).toEqual(EXCEL_HEADERS.Bollette);
    expect(rowsOf(get('Conguagli'))[0]).toEqual(EXCEL_HEADERS.Conguagli);
    expect(rowsOf(get('Affitti versati'))[0]).toEqual([
      ...EXCEL_HEADERS['Affitti versati'],
      ...MONTHS,
    ]);
    expect(rowsOf(get('Versamenti conguaglio'))[0]).toEqual(EXCEL_HEADERS['Versamenti conguaglio']);
  });

  it('writes the bills with typed cells', () => {
    const sheet = get('Bollette');
    const internet = sheet?.rows.find((r) => plain(r[0]) === 'Internet');
    expect(internet).toEqual([
      { kind: 'text', value: 'Internet' },
      { kind: 'text', value: 'Rete Esempio' },
      { kind: 'text', value: 'INT-2026-10' },
      { kind: 'date', value: '2026-10-01' },
      { kind: 'date', value: '2026-11-30' },
      { kind: 'date', value: '2026-12-10' },
      { kind: 'text', value: '10/12/2026' },
      { kind: 'euro', value: 6000 },
      { kind: 'euro', value: 80 },
      { kind: 'euro', value: 6080 },
      { kind: 'text', value: 'internet-2026-10.pdf' },
      null,
    ]);
    const rows = rowsOf(sheet);
    expect(rows.map((r) => r[0])).toEqual([
      'Tipo',
      'Elettricità',
      'Internet',
      'TARI',
      'Condominio',
      'Gas',
      'Totale',
    ]);
    expect(rows.find((r) => r[0] === 'Gas')?.[6]).toBe('assunta, non verificata');
    expect(rows.find((r) => r[0] === 'Elettricità')?.[11]).toBe(
      'Bolletta a cavallo: € 60,00 nei mesi agosto–settembre 2026, fuori da questo periodo.',
    );
    expect(rows.find((r) => r[0] === 'Condominio')?.slice(1, 3)).toEqual([
      null,
      'Rata 1 di 3, 2026-27',
    ]);
  });

  it('writes one row per tenant in the order of the beds, with the values of calcConguaglio', () => {
    const result = calcConguaglio(fixtureInput());
    const rows = rowsOf(get('Conguagli')).slice(1);
    expect(rows.map((r) => r.slice(0, 4))).toEqual([
      ['A', 'Anna Prova', 'ott – set', 12],
      ['B', 'Bruno Prova', 'ott – set', 12],
      ['C', 'Elena Prova', 'ott – feb', 5],
      ['C', 'Carla Prova', 'mar – set', 7],
      ['D', 'Dario Prova', 'gen – set', 9],
      ['Posti vuoti (proprietà)', null, null, null],
      ['Totale', null, null, null],
    ]);
    const order = ['ten-a', 'ten-b', 'ten-e', 'ten-c', 'ten-d'];
    const expected = order.map((id) => {
      const t = result.tenants.find((r) => r.tenantId === id);
      if (t === undefined) throw new Error(id);
      return [
        t.spese + t.commissione,
        t.condominio.rata + t.condominio.conguaglioPrec,
        t.forfaitIncassato,
        t.due,
      ];
    });
    expect(rows.slice(0, 5).map((r) => r.slice(4))).toEqual(expected);
    const empty = result.unassignedByBucket;
    expect(rows[5]?.slice(4)).toEqual([
      empty.spese + empty.commissione,
      empty.rata + empty.conguaglioPrec,
    ]);
    const sums = [0, 1, 2, 3].map((i) => expected.reduce((s, e) => s + (e[i] ?? 0), 0));
    expect(rows[6]?.slice(4, 8)).toEqual([
      (sums[0] ?? 0) + empty.spese + empty.commissione,
      (sums[1] ?? 0) + empty.rata + empty.conguaglioPrec,
      sums[2],
      sums[3],
    ]);
  });

  it('makes Spese + Condominio of the total equal to the total of the bills (question 4)', () => {
    const bills = rowsOf(get('Bollette'));
    const billTotal = bills.find((r) => r[0] === 'Totale');
    const items = bills.slice(1, bills.indexOf(billTotal as Plain[]));
    const column = (i: number) => items.reduce((s, r) => s + Number(r[i] ?? 0), 0);
    expect(billTotal?.slice(7, 10)).toEqual([column(7), column(8), column(9)]);
    const totale = rowsOf(get('Conguagli')).find((r) => r[0] === 'Totale');
    expect(Number(totale?.[4]) + Number(totale?.[5])).toBe(billTotal?.[9]);
    expect(Number(totale?.[4]) + Number(totale?.[5])).not.toBe(0);
  });

  it('writes the dates of the rent payments of each month of presence', () => {
    const rows = rowsOf(get('Affitti versati')).slice(1);
    expect(rows.map((r) => r.slice(0, 3))).toEqual([
      ['A', 'Anna Prova', 48000],
      ['B', 'Bruno Prova', 45000],
      ['C', 'Elena Prova', 43000],
      ['C', 'Carla Prova', 44000],
      ['D', 'Dario Prova', 46000],
    ]);
    const [anna, bruno, elena] = rows;
    expect(anna?.slice(3, 6)).toEqual(['09 ott, 20 ott', '09 nov', null]);
    // An unconfirmed payment is no payment.
    expect(bruno?.slice(3, 5)).toEqual(['05 ott', null]);
    expect(elena?.[3]).toBe('03 ott');
    expect(elena?.[8]).toBeNull();
  });

  it('lists the settlement payments with their sign, never a deposit', () => {
    expect(rowsOf(get('Versamenti conguaglio')).slice(1)).toEqual([
      ['Anna Prova', '2026-11-20', 5000, 'nov 2026', 'estratto conto'],
      ['Bruno Prova', '2026-12-03', -1200, null, 'a mano'],
    ]);
  });

  it('writes only what is decided (questions 1, 3, 6)', () => {
    const cells = book.sheets.flatMap((s) => s.rows.flat());
    const texts = cells.flatMap((c) => (c?.kind === 'text' ? [c.value] : []));
    expect(texts.filter((t) => t.startsWith('='))).toEqual([]);
    const headers = book.sheets
      .flatMap((s) => rowsOf(s)[0] ?? [])
      .join(' | ')
      .toLowerCase();
    for (const word of ['versato', 'residuo', 'stato', 'caparra', 'posti vuoti']) {
      expect(headers).not.toContain(word);
    }
    expect(texts.some((t) => /provvisorio/i.test(t))).toBe(false);
    // The bill waiting for its debit is in no sheet.
    expect(texts.some((t) => t.includes('Acqua') || t.includes('acqua-2027'))).toBe(false);
    expect(cells.some((c) => c?.kind === 'euro' && c.value === -53840)).toBe(false);
  });
});

describe('buildConguaglioWorkbook variants', () => {
  it('writes a credit as a negative amount', () => {
    const input = fixtureInput();
    input.bills.push(
      bill('bill-nota', '2026-10-01', '2026-10-31', -80000, { apartmentId: 'apt-nord' }),
    );
    input.matches.push({
      id: 'm-nota',
      v: 1,
      rev: 1,
      itemType: 'bill',
      itemId: 'bill-nota',
      transactionId: 'tx-nota',
      transactionDate: isoDate('2026-11-02'),
      amount: cents(-80000),
      part: 'amount',
      confirmed: true,
      by: 'auto',
    });
    const anna = sheets(input).get('Conguagli')?.rows[1];
    const due = anna?.[7];
    expect(due?.kind).toBe('euro');
    expect(Number(due?.value)).toBeLessThan(0);
  });

  it('leaves out unconfirmed and deleted settlement payments', () => {
    const input = fixtureInput();
    const base = input.payments.find((p) => p.id === 'pay-a-conguaglio');
    if (base === undefined) throw new Error('no payment');
    input.payments.push(
      { ...base, id: 'pay-x-1', confirmed: false },
      { ...base, id: 'pay-x-2', deleted: true },
    );
    expect(rowsOf(sheets(input).get('Versamenti conguaglio'))).toHaveLength(3);
  });

  it('writes the years and every presence when the period is longer than a year', () => {
    const input = fixtureInput();
    input.period = { label: '2026-28', from: yearMonth('2026-10'), to: yearMonth('2027-11') };
    input.tenancies = input.tenancies.map((t) =>
      t.id === 'tcy-b' ? { ...t, to: yearMonth('2027-03') } : t,
    );
    input.tenancies.push({
      ...(input.tenancies.find((t) => t.id === 'tcy-b') as ExcelInput['tenancies'][number]),
      id: 'tcy-b2',
      room: 'D',
      from: yearMonth('2027-10'),
      to: undefined,
    });
    input.tenancies = input.tenancies.map((t) =>
      t.id === 'tcy-d' ? { ...t, to: yearMonth('2027-09') } : t,
    );
    const bruno = rowsOf(sheets(input).get('Conguagli')).find((r) => r[1] === 'Bruno Prova');
    expect(bruno?.slice(0, 4)).toEqual([
      'B, D',
      'Bruno Prova',
      'ott 2026 – mar 2027; ott 2027 – nov 2027',
      8,
    ]);
  });

  it('refuses a tenant without a record, with its id only', () => {
    const input = fixtureInput();
    input.tenants = input.tenants.filter((t) => t.id !== 'ten-c');
    expect(() => buildConguaglioWorkbook(input)).toThrow(ExcelInputError);
    try {
      buildConguaglioWorkbook(input);
    } catch (error) {
      expect(error).toMatchObject({ code: 'missing-tenant', tenantIds: ['ten-c'] });
      expect((error as Error).message).not.toContain('ten-c');
    }
  });

  it('lets an overlap of tenancies through as a SettlementInputError', () => {
    const input = fixtureInput();
    input.tenancies.push({
      ...(input.tenancies.find((t) => t.id === 'tcy-a') as ExcelInput['tenancies'][number]),
      id: 'tcy-a2',
      room: 'D',
    });
    expect(() => buildConguaglioWorkbook(input)).toThrow(SettlementInputError);
    expect(() => buildConguaglioWorkbook(input)).toThrow(
      expect.objectContaining({ code: 'tenant-overlap' }),
    );
  });
});

describe('the bytes of the Excel', () => {
  const bytes = writeXlsx(buildConguaglioWorkbook(fixtureInput()));

  it('do not depend on the order of the input', () => {
    const next = mulberry32(11);
    const input = fixtureInput();
    const mixed: ExcelInput = {
      ...input,
      bills: shuffled(input.bills, next),
      instalments: shuffled(input.instalments, next),
      matches: shuffled(input.matches, next),
      tenancies: shuffled(input.tenancies, next),
      payments: shuffled(input.payments, next),
      tenants: shuffled(input.tenants, next),
    };
    expect(writeXlsx(buildConguaglioWorkbook(mixed))).toEqual(bytes);
  });

  it('are the same in every time zone', () => {
    // Run under TZ=Pacific/Auckland and TZ=America/Los_Angeles too: the hash must not move.
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      '0975bc1cfb7a070061c81b5023cd6c6f4df2cb7592a8e320e5f74fb93e177532',
    );
  });
});
