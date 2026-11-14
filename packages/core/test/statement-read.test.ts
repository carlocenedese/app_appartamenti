import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BankProfileSchema, type BankProfile } from '../src/model';
import { isoDate } from '../src/period';
import { StatementReadError, readStatementTable } from '../src/statement-read';
import type { StatementCell, StatementTable } from '../src/statement-table';

const base = BankProfileSchema.parse(
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../../../fixtures/bank/profilo-sintetico.json', import.meta.url)),
      'utf8',
    ),
  ),
);
// Variant: the synthetic profile with its own overrides (no dispCodePattern: codes are kept as written).
const profile = (over: Record<string, unknown> = {}): BankProfile =>
  BankProfileSchema.parse({ ...base, ...over });

const s = (v: string): StatementCell => ({ t: 's', v });
const n = (v: string): StatementCell => ({ t: 'n', v });
const d = (v: string): StatementCell => ({ t: 'd', v: isoDate(v) });
const HEADER = [
  'Data contabile',
  'Descrizione',
  'Causale',
  'Importo',
  'Segno',
  'Codice',
  'Stato',
].map(s);
const table = (...rows: StatementCell[][]): StatementTable => ({
  v: 1,
  sheets: [{ name: 'x', rows }],
});
const line = (
  date: StatementCell,
  desc: StatementCell,
  cause: StatementCell,
  amount: StatementCell,
  sign: StatementCell = null,
  code: StatementCell = null,
  state: StatementCell = null,
) => [date, desc, cause, amount, sign, code, state];

function failure(t: StatementTable, p: BankProfile = base): StatementReadError {
  try {
    readStatementTable(t, p);
  } catch (e) {
    if (e instanceof StatementReadError) return e;
    throw e;
  }
  throw new Error('did not throw');
}

describe('readStatementTable', () => {
  it('reads a row with a date cell, a number cell and a code', () => {
    const r = readStatementTable(
      table(
        HEADER,
        line(d('2026-10-27'), s('Addebito'), s('HERA COMM'), n('-92.81'), null, s('123')),
      ),
      base,
    );
    expect(r.rows).toEqual([
      {
        row: 2,
        date: '2026-10-27',
        amount: -9281,
        description: 'Addebito - HERA COMM',
        dispCode: '123',
        booked: true,
      },
    ]);
  });

  it('reads a text date and a text amount', () => {
    const r = readStatementTable(
      table(HEADER, line(s('27/10/2026'), s('Bonifico'), null, s('-1.234,56'))),
      base,
    );
    expect(r.rows[0]).toMatchObject({
      date: '2026-10-27',
      amount: -123456,
      description: 'Bonifico',
    });
    const iso = readStatementTable(
      table(HEADER, line(s('2026-10-27'), s('x'), null, s('1,5'))),
      profile({ dateFormat: 'YYYY-MM-DD' }),
    );
    expect(iso.rows[0]?.amount).toBe(150);
  });

  it('rejects a bad date with the row', () => {
    for (const cell of [s('31/02/2026'), s('2026-10-27'), n('5'), null]) {
      const e = failure(
        table(
          HEADER,
          line(d('2026-10-27'), s('a'), null, n('1')),
          line(cell, s('a'), null, n('1')),
        ),
      );
      expect([e.code, e.row]).toEqual(['bad-date', 3]);
    }
  });

  it('rejects malformed number cells, and tells 1.234 apart as ambiguous', () => {
    const bad = failure(table(HEADER, line(d('2026-10-27'), s('a'), null, n('1e5'))));
    expect([bad.code, bad.row]).toEqual(['bad-amount', 2]);
    const amb = failure(table(HEADER, line(d('2026-10-27'), s('a'), null, n('1.234'))));
    expect([amb.code, amb.row]).toEqual(['ambiguous-number', 2]);
    const text = failure(table(HEADER, line(d('2026-10-27'), s('a'), null, s('abc'), s('D'))));
    expect(text.code).toBe('bad-amount');
    expect(n('1.2')).toBeTruthy();
    expect(
      readStatementTable(table(HEADER, line(d('2026-10-27'), s('a'), null, n('1.2'), s('A'))), base)
        .rows[0]?.amount,
    ).toBe(120);
  });

  it('takes the sign from the Segno column', () => {
    const t = (sign: StatementCell) =>
      table(HEADER, line(d('2026-10-27'), s('a'), null, n('92.81'), sign));
    expect(readStatementTable(t(s('D')), base).rows[0]?.amount).toBe(-9281);
    expect(readStatementTable(t(s('A')), base).rows[0]?.amount).toBe(9281);
    expect(failure(t(s('X'))).code).toBe('unknown-sign');
    expect(readStatementTable(t(null), base).rows[0]?.amount).toBe(9281);
  });

  it('takes the sign from the cell when there is no sign column', () => {
    const p = profile({ columns: { ...base.columns, sign: undefined }, signValues: undefined });
    const t = (v: string) => table(HEADER, line(d('2026-10-27'), s('a'), null, n(v)));
    expect(readStatementTable(t('-5.00'), p).rows[0]?.amount).toBe(-500);
    expect(readStatementTable(t('5'), p).rows[0]?.amount).toBe(500);
    expect(failure(t('0'), p).code).toBe('zero-amount');
    expect(failure(table(HEADER, line(d('2026-10-27'), s('a'), null, null)), p).code).toBe(
      'no-amount',
    );
  });

  it('reads debit and credit columns', () => {
    const p = profile({
      header: { allOf: ['Data contabile', 'Dare', 'Avere'] },
      columns: {
        date: 'Data contabile',
        description: ['Descrizione'],
        debit: 'Dare',
        credit: 'Avere',
      },
      signValues: undefined,
    });
    const head = ['Data contabile', 'Descrizione', 'Dare', 'Avere'].map(s);
    const t = (debit: StatementCell, credit: StatementCell) =>
      table(head, [d('2026-10-27'), s('a'), debit, credit]);
    expect(readStatementTable(t(n('10.50'), null), p).rows[0]?.amount).toBe(-1050);
    expect(readStatementTable(t(null, s('2,00')), p).rows[0]?.amount).toBe(200);
    expect(failure(t(n('1'), n('1')), p).code).toBe('debit-and-credit');
    expect(failure(t(null, null), p).code).toBe('no-amount');
    expect(failure(t(n('0'), null), p).code).toBe('zero-amount');
  });

  it('marks pending rows as not booked', () => {
    const p = profile({ pendingValues: ['In attesa'] });
    const r = readStatementTable(
      table(
        HEADER,
        line(d('2026-10-27'), s('a'), null, n('1'), s('A'), null, s(' IN  attesa ')),
        line(d('2026-10-27'), s('a'), null, n('1'), s('A'), null, s('Contabilizzato')),
        line(d('2026-10-27'), s('a'), null, n('1'), s('A'), null, null),
      ),
      p,
    );
    expect(r.rows.map((x) => x.booked)).toEqual([false, true, true]);
  });

  it('reads counterparty and IBAN from the description; an invalid IBAN stays out', () => {
    const r = readStatementTable(
      table(
        HEADER,
        line(
          d('2026-10-27'),
          s('Bonifico'),
          s('da Mario Rossi, IT60X0542811101000000123456'),
          n('1'),
          s('A'),
        ),
        line(
          d('2026-10-27'),
          s('Bonifico'),
          s('da Mario Rossi, IT00X0542811101000000123456'),
          n('1'),
          s('A'),
        ),
        line(d('2026-10-27'), s('Bonifico'), s('niente'), n('1'), s('A')),
      ),
      base,
    );
    expect(r.rows[0]?.counterparty).toEqual({
      name: 'Mario Rossi',
      iban: 'IT60X0542811101000000123456',
    });
    expect(r.rows[1]?.counterparty).toEqual({ name: 'Mario Rossi' });
    expect(r.rows[2]?.counterparty).toBeUndefined();
  });

  it('reads period and account above the header', () => {
    const r = readStatementTable(
      table(
        [s('Estratto conto ABC123')],
        [s('dal 01/10/2026 al 31/10/2026')],
        HEADER,
        line(d('2026-10-27'), s('a'), null, n('1'), s('A')),
      ),
      base,
    );
    expect(r.declaredPeriod).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(r.declaredAccount).toBe('ABC123');
    const r2 = readStatementTable(
      table([s('numero conto IT60X0542811101000000123456')], HEADER),
      base,
    );
    expect(r2.declaredAccount).toBe('IT60X0542811101000000123456');
    expect(r2.rows).toEqual([]);
  });

  it('rejects an inverted or impossible period', () => {
    for (const text of ['dal 31/10/2026 al 01/10/2026', 'dal 31/02/2026 al 01/03/2026']) {
      const e = failure(table([s(text)], HEADER));
      expect([e.code, e.row]).toEqual(['bad-period', 1]);
    }
  });

  it('finds the header row and reports a missing header or column', () => {
    const r = readStatementTable(
      table(
        [s('x')],
        [s(' data  CONTABILE'), s('descrizione'), s('Importo'), s('segno')],
        line(d('2026-10-27'), s('a'), n('1'), s('A')),
      ),
      profile({
        columns: {
          ...base.columns,
          description: ['Descrizione'],
          dispCode: undefined,
          pending: undefined,
        },
        pendingValues: undefined,
      }),
    );
    expect(r.rows).toHaveLength(1);
    expect(failure(table([s('Data contabile'), s('Importo')])).code).toBe('no-header');
    const e = failure(
      table(HEADER.slice(0, 5)),
      profile({ columns: { ...base.columns, dispCode: 'Nessuna' } }),
    );
    expect(e.code).toBe('missing-column');
    expect(e.column).toBe('dispCode');
  });

  it('skips blank rows', () => {
    const r = readStatementTable(
      table(HEADER, [null, s('  '), null], line(d('2026-10-27'), s('a'), null, n('1'), s('A'))),
      base,
    );
    expect(r.rows.map((x) => x.row)).toEqual([3]);
  });

  it('never puts the cell in a message', () => {
    const secret = 'SEGRETO-9999';
    const cases: StatementTable[] = [
      table(HEADER, line(s(secret), s('a'), null, n('1'), s('A'))),
      table(HEADER, line(d('2026-10-27'), s('a'), null, s(secret), s('A'))),
      table(HEADER, line(d('2026-10-27'), s('a'), null, n('1'), s(secret))),
      table([s(`dal 31/10/2026 al 01/10/2026 ${secret}`)], HEADER),
      table([s(secret)]),
    ];
    for (const t of cases) {
      const e = failure(t);
      expect(e.message).not.toContain(secret);
      expect(JSON.stringify(e)).not.toContain(secret);
    }
  });

  describe('ReDoS', () => {
    const hostile = 'a'.repeat(40) + '!';
    it('rejects patterns with nested quantifiers', () => {
      for (const field of ['accountPattern', 'periodPattern'] as const) {
        const p = {
          ...base,
          [field]: field === 'periodPattern' ? '((a+)+)(b)' : '(a+)+$',
        } as BankProfile;
        const e = failure(table([s(hostile)], HEADER), p);
        expect(e.code).toBe('unsafe-pattern');
        expect(e.message).not.toContain('a+');
      }
      for (const bad of ['(a*)*', '(a+)*', '(a{1,5})+', '(x(a+)y)+', '(a+){2,}']) {
        const p = { ...base, counterparty: { name: bad } } as BankProfile;
        expect(
          failure(table(HEADER, line(d('2026-10-27'), s('a'), null, n('1'), s('A'))), p).code,
        ).toBe('unsafe-pattern');
      }
    });
    it('accepts safe patterns, including escaped and bracketed quantifiers', () => {
      for (const ok of ['(a+)b', '(\\+a)+', '([+*])+', '(ab)+', '(a{2})+', '(a)?b+']) {
        const p = { ...base, accountPattern: ok } as BankProfile;
        expect(() => readStatementTable(table([s('x')], HEADER), p)).not.toThrow();
      }
    });
    it('does not run a pattern on an overlong cell', () => {
      const long = `conto ${'A'.repeat(100_000)}`;
      const t0 = Date.now();
      const r = readStatementTable(table([s(long)], HEADER), base);
      expect(r.declaredAccount).toBeUndefined();
      expect(Date.now() - t0).toBeLessThan(1000);
    });
  });
});
