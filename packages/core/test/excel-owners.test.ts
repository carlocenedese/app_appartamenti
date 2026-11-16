import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  OWNERS_HEADERS,
  OWNERS_SHEET,
  buildOwnersWorkbook,
  cents,
  isoDate,
  writeXlsx,
} from '../src/index';
import type { ConguaglioInput, XlsxCell } from '../src/index';
import { mulberry32, shuffled } from './helpers/conguaglio-builders';
import { fixtureInput } from './helpers/excel-fixture';

type Instalment = ConguaglioInput['instalments'][number];
type Match = ConguaglioInput['matches'][number];
const plain = (cell: XlsxCell | null | undefined) => cell?.value ?? null;
const rowsOf = (input: ConguaglioInput) =>
  (buildOwnersWorkbook(input).sheets[0]?.rows ?? []).map((r) => r.map(plain));

const base = fixtureInput();
const cond = base.instalments.find((i) => i.id === 'inst-cond-1') as Instalment;
const extra = (id: string, fields: Partial<Instalment>): Instalment => ({ ...cond, id, ...fields });
const match = (itemId: string, fields: Partial<Match>): Match => ({
  id: `m-${itemId}`,
  v: 1,
  rev: 1,
  itemType: 'instalment',
  itemId,
  transactionId: `tx-${itemId}`,
  transactionDate: isoDate('2027-02-03'),
  amount: cents(10000),
  part: 'amount',
  confirmed: true,
  by: 'auto',
  ...fields,
});

describe('buildOwnersWorkbook', () => {
  it('has one sheet with the headers of OWNERS_HEADERS', () => {
    const book = buildOwnersWorkbook(fixtureInput());
    expect(book.sheets.map((s) => s.name)).toEqual([OWNERS_SHEET]);
    expect(rowsOf(fixtureInput())[0]).toEqual([...OWNERS_HEADERS]);
  });

  it('writes the whole instalment with the owner share in its own column (R8)', () => {
    const rows = rowsOf(fixtureInput());
    expect(rows.slice(1)).toEqual([
      [
        '2026-27',
        'Rata 1 di 3',
        null,
        '2026-10-01',
        '2027-01-31',
        '2026-10-05',
        30000,
        6000,
        4000,
        36000,
        36000,
        0,
        '06/10/2026',
        'pagata',
      ],
      ['Totale', null, null, null, null, null, 30000, 6000, 4000, 36000, 36000, 0],
    ]);
  });

  it('writes extraordinary, pending, assumed and settlement-only instalments', () => {
    const input = fixtureInput();
    input.instalments.push(
      extra('inst-str', {
        straordinaria: true,
        rata: cents(50000),
        conguaglioPrec: cents(0),
        rateIndex: 1,
        rateCount: 1,
        coversFrom: '2027-02' as Instalment['coversFrom'],
        coversTo: '2027-02' as Instalment['coversTo'],
      }),
      extra('inst-wait', {
        rateIndex: 2,
        conguaglioPrec: cents(0),
        coversFrom: '2027-02' as Instalment['coversFrom'],
        coversTo: '2027-05' as Instalment['coversTo'],
      }),
      extra('inst-ass', {
        rateIndex: 3,
        conguaglioPrec: cents(0),
        coversFrom: '2027-06' as Instalment['coversFrom'],
        coversTo: '2027-09' as Instalment['coversTo'],
      }),
      extra('inst-zero', { rata: cents(0), conguaglioPrec: cents(-2000) }),
    );
    input.matches.push(
      match('inst-str', { amount: cents(50000) }),
      match('inst-str', { id: 'm-c', part: 'commission', amount: cents(80) }),
      match('inst-ass', { amount: cents(30000), by: 'assumed' }),
    );
    const rows = rowsOf(input);
    expect(rows.map((r) => r[1])).toEqual([
      'Rata',
      'Rata 1 di 3',
      'Rata 1 di 3',
      'Rata 1 di 1',
      'Rata 2 di 3',
      'Rata 3 di 3',
      null,
    ]);
    const byStart = rows.slice(1, -1);
    const [first, zero, str, wait, ass] = byStart;
    expect(first?.[13]).toBe('pagata');
    expect(zero?.slice(6, 14)).toEqual([
      0,
      -2000,
      0,
      -2000,
      null,
      0,
      null,
      'in attesa di pagamento',
    ]);
    expect(str?.slice(2, 14)).toEqual([
      'sì',
      '2027-02-01',
      '2027-02-28',
      '2026-10-05',
      50000,
      0,
      50000,
      50000,
      50000,
      80,
      '03/02/2027',
      'pagata',
    ]);
    expect(wait?.slice(8, 14)).toEqual([4000, 30000, null, 0, null, 'in attesa di pagamento']);
    expect(ass?.slice(10, 14)).toEqual([null, 0, null, 'assunta, non verificata']);
    expect(rows.at(-1)?.slice(6)).toEqual([140000, 4000, 62000, 144000, 86000, 80]);
  });

  it('leaves the total debited empty when nothing is debited', () => {
    const input = fixtureInput();
    input.matches = input.matches.filter((m) => m.itemId !== 'inst-cond-1');
    const totale = rowsOf(input).at(-1);
    expect(totale?.[0]).toBe('Totale');
    expect(totale?.[9]).toBe(36000);
    expect(totale?.[10]).toBeNull();
  });

  it('leaves out the TARI, other apartments and deleted instalments', () => {
    const input = fixtureInput();
    input.instalments.push(
      extra('inst-sud', { apartmentId: 'apt-sud' }),
      extra('inst-del', { deleted: true }),
      extra('inst-old', {
        conguaglioPrec: cents(0),
        coversFrom: '2025-10' as Instalment['coversFrom'],
        coversTo: '2026-01' as Instalment['coversTo'],
      }),
    );
    expect(rowsOf(input).map((r) => r[1])).toEqual(['Rata', 'Rata 1 di 3', null]);
  });

  it('holds nothing about the tenants', () => {
    const input = fixtureInput();
    const texts = rowsOf(input)
      .flat()
      .filter((v): v is string => typeof v === 'string');
    for (const tenant of input.tenants) expect(texts.join(' ')).not.toContain(tenant.name);
    // Tenancies that do not allow a settlement do not stop this file.
    input.tenancies.push({
      ...(input.tenancies[0] as ConguaglioInput['tenancies'][number]),
      id: 'dup',
    });
    expect(() => buildOwnersWorkbook(input)).not.toThrow();
  });
});

describe('the bytes of the owners file', () => {
  const bytes = writeXlsx(buildOwnersWorkbook(fixtureInput()));

  it('do not depend on the order of the input', () => {
    const next = mulberry32(5);
    const input = fixtureInput();
    const mixed = {
      ...input,
      instalments: shuffled(input.instalments, next),
      matches: shuffled(input.matches, next),
    };
    expect(writeXlsx(buildOwnersWorkbook(mixed))).toEqual(bytes);
  });

  it('are the same in every time zone', () => {
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      'dd288bac789dd71b7047929f7b30dcbfc94b0391bc289320c44238669c79cbe4',
    );
  });
});
