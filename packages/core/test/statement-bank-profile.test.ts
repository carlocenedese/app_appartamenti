/**
 * The profile of the bank's "list of operations" (fixtures/bank/profilo-banca-lista-operazioni.json)
 * and the preamble extension of the profile: a table with the shape of the real statement (labels
 * in column B, values in column C, header not on the first row, signed amounts), every value invented.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BankProfileSchema,
  StatementReadError,
  commitChange,
  importStatement,
  isoDate,
  recordPath,
  readStatementTable,
  saveAccount,
  saveBankProfile,
} from '../src/index';
import type { BankProfile, StatementCell, StatementTable } from '../src/index';
import { apartment } from './helpers/conguaglio-builders';
import { ibanEndingWith } from './helpers/iban-build';
import { MemoryStore } from './helpers/memory-store';

const load = (name: string): unknown =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL(`../../../fixtures/bank/${name}`, import.meta.url)), 'utf8'),
  );
const real = BankProfileSchema.parse(load('profilo-banca-lista-operazioni.json'));
const withPreamble = (preamble: unknown): BankProfile =>
  BankProfileSchema.parse({ ...real, preamble });

const s = (v: string): StatementCell => ({ t: 's', v });
const n = (v: string): StatementCell => ({ t: 'n', v });
const d = (v: string): StatementCell => ({ t: 'd', v: isoDate(v) });
const HEAD = [
  'Data',
  'Operazione',
  'Dettagli',
  'Conto o carta',
  'Contabilizzazione',
  'Categoria',
  'Valuta',
  'Importo',
].map(s);
const ACCOUNT = '7654321';
const movement = (k: number): StatementCell[] => [
  d(`2026-10-${String(1 + k).padStart(2, '0')}`),
  s(k % 4 === 0 ? 'Accredito' : 'Bonifico'),
  s(`Dettaglio inventato ${String(k)}`),
  s('Conto di prova'),
  s('Contabilizzato'),
  s(`Categoria ${String(k % 6)}`),
  s('EUR'),
  n(k % 4 === 0 ? `${String(50 + k)}.00` : `-${String(10 + k)}.35`),
];
type Pre = { count?: StatementCell; from?: StatementCell; to?: StatementCell; label?: string };
/** The shape of the real file: preamble in B/C, header on row 18, 16 movements (or `rows`). */
function realShape(pre: Pre = {}, rows = 16, tail: StatementCell[][] = []): StatementTable {
  const top: StatementCell[][] = Array.from({ length: 17 }, () => []);
  top[1] = [null, s('Lista operazioni')];
  top[3] = [null, s('Conti e Carte'), s(`Conto 123456 / ${ACCOUNT}`)];
  top[4] = [null, s('Finanziamento'), s('-')];
  top[5] = [null, s('Investimenti e previdenza'), s('-')];
  if (pre.count !== null)
    top[7] = [null, s(pre.label ?? 'I  movimenti selezionati sono'), pre.count ?? n(String(rows))];
  if (pre.from !== null) top[8] = [null, s('Data inizio periodo'), pre.from ?? d('2026-10-01')];
  if (pre.to !== null) top[9] = [null, s('Data fine periodo'), pre.to ?? d('2026-10-31')];
  const body = Array.from({ length: rows }, (_, k) => movement(k));
  return { v: 1, sheets: [{ name: 'Lista', rows: [...top, HEAD, ...body, ...tail] }] };
}
function failure(t: StatementTable, p: BankProfile = real): StatementReadError {
  try {
    readStatementTable(t, p);
  } catch (e) {
    if (e instanceof StatementReadError) return e;
    throw e;
  }
  throw new Error('did not throw');
}
const code = (t: StatementTable, p: BankProfile = real): [string, number, string | undefined] => {
  const e = failure(t, p);
  return [e.code, e.row, e.column];
};

describe('the profile of the bank list of operations', () => {
  it('reads 16 signed rows, the period, the account and checks the row count', () => {
    const r = readStatementTable(realShape(), real);
    expect(r.rows).toHaveLength(16);
    expect(r.rows[0]).toMatchObject({
      row: 19,
      date: '2026-10-01',
      amount: 5000,
      description: 'Accredito - Dettaglio inventato 0',
      booked: true,
    });
    expect(r.rows[1]).toMatchObject({ row: 20, amount: -1135 });
    expect(r.rows[15]).toMatchObject({ row: 34, amount: -2535 });
    expect(r.rows.every((x) => x.dispCode === undefined && x.counterparty === undefined)).toBe(
      true,
    );
    expect(r.declaredPeriod).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(r.declaredAccount).toBe(ACCOUNT);
  });

  it('has no digits that could be an account, nor a name: only labels and generic patterns', () => {
    const text = JSON.stringify(load('profilo-banca-lista-operazioni.json'));
    expect(text).not.toMatch(/\d{6,}/);
    expect(text).not.toMatch(/IT\d\d/);
  });

  it('matches the label with the same folding as the header (spaces, capitals)', () => {
    // Three spaces, other capitals: a comparison on the raw text would not find the label.
    const odd = realShape({ label: 'I   MOVIMENTI   selezionati   sono', count: n('15') });
    expect(code(odd)).toEqual(['row-count-mismatch', 8, undefined]);
    // The profile may be written with other spaces too.
    const p = withPreamble({
      ...real.preamble,
      rowCount: { label: ' i movimenti  selezionati sono ' },
    });
    expect(code(odd, p)).toEqual(['row-count-mismatch', 8, undefined]);
  });

  it('refuses a row count that differs from the rows read, with the row of the label only', () => {
    for (const rows of [15, 17]) {
      const e = failure(realShape({ count: n('16') }, rows));
      expect([e.code, e.row]).toEqual(['row-count-mismatch', 8]);
      expect(e.message).not.toMatch(/16|15|17/);
    }
    // Trailing empty rows and a footer without date and amount are not movements.
    const footer: StatementCell[][] = [[], [null, s('Totale')]];
    expect(readStatementTable(realShape({}, 16, footer), real).rows).toHaveLength(16);
  });

  it('reads the row count from a number or a text, and refuses anything else', () => {
    expect(readStatementTable(realShape({ count: s(' 16 ') }), real).rows).toHaveLength(16);
    for (const bad of [s('abc'), s('1,5'), n('1.5'), s('-1')]) {
      expect(code(realShape({ count: bad }))).toEqual(['bad-row-count', 8, 'rowCount']);
    }
    const empty = realShape(); // the label is there, its value is not
    (empty.sheets[0]?.rows[7] ?? [])[2] = null;
    expect(code(empty)).toEqual(['bad-row-count', 8, 'rowCount']);
  });

  it('does not check anything when the file has no row count line', () => {
    const t = realShape({ count: null }, 3);
    expect(readStatementTable(t, real).rows).toHaveLength(3);
  });

  it('reads the period from date cells and from DD/MM/YYYY text', () => {
    const fromCells = readStatementTable(realShape(), real).declaredPeriod;
    const fromText = readStatementTable(
      realShape({ from: s('01/10/2026'), to: s(' 31/10/2026 ') }),
      real,
    ).declaredPeriod;
    expect(fromText).toEqual(fromCells);
    expect(fromText).toEqual({ from: '2026-10-01', to: '2026-10-31' });
  });

  it('refuses a period that is bad, backwards or half given, with the row of the label', () => {
    expect(code(realShape({ from: s('31/02/2026') }))).toEqual(['bad-period', 9, 'periodFrom']);
    expect(code(realShape({ to: s('oggi') }))).toEqual(['bad-period', 10, 'periodTo']);
    expect(code(realShape({ from: d('2026-11-01') }))[0]).toBe('bad-period');
    expect(code(realShape({ to: null }))[0]).toBe('bad-period');
    expect(code(realShape({ from: null }))[0]).toBe('bad-period');
    const noValue = realShape();
    (noValue.sheets[0]?.rows[8] ?? [])[2] = null;
    expect(code(noValue)).toEqual(['bad-period', 9, 'periodFrom']);
  });

  it('finds the label in any column and reads the first non-empty cell to its right', () => {
    const t = realShape();
    const rows = t.sheets[0]?.rows ?? [];
    rows[8] = [s('Data inizio periodo'), null, null, d('2026-10-02')];
    expect(readStatementTable(t, real).declaredPeriod?.from).toBe('2026-10-02');
    // A value to the left of the label is never read.
    rows[9] = [d('2026-10-29'), s('Data fine periodo')];
    expect(code(t)).toEqual(['bad-period', 10, 'periodTo']);
  });

  it('refuses an account cell that does not fit the pattern, and never shows it', () => {
    const t = realShape();
    (t.sheets[0]?.rows[3] ?? [])[2] = s('Carta 99 / 12');
    const e = failure(t);
    expect([e.code, e.row, e.column]).toEqual(['bad-account', 4, 'account']);
    expect(e.message).not.toMatch(/99|12/);
    expect(
      readStatementTable(
        realShape(),
        withPreamble({ periodFrom: real.preamble?.periodFrom, periodTo: real.preamble?.periodTo }),
      ).declaredAccount,
    ).toBeUndefined();
  });

  it('does not read the preamble below the header', () => {
    const t = realShape({}, 16, [[null, s('Data inizio periodo'), s('boh')]]);
    expect(readStatementTable(t, real).declaredPeriod?.from).toBe('2026-10-01');
  });

  it('a profile cannot have both periodPattern and preamble dates, nor both account ways', () => {
    expect(() => BankProfileSchema.parse({ ...real, periodPattern: '(a)(b)' })).toThrow(
      /ambiguous-profile/,
    );
    expect(() => BankProfileSchema.parse({ ...real, accountPattern: '(a)' })).toThrow(
      /ambiguous-profile/,
    );
    // Built without the schema, the reader refuses all the same.
    const loose = { ...real, periodPattern: '(a)(b)' } as BankProfile;
    expect(code(realShape(), loose)).toEqual(['ambiguous-profile', 0, 'periodPattern']);
    expect(code(realShape(), { ...real, accountPattern: '(a)' } as BankProfile)).toEqual([
      'ambiguous-profile',
      0,
      'accountPattern',
    ]);
  });

  it('validates the preamble: both dates or none, one group in the account pattern', () => {
    expect(() => withPreamble({ periodFrom: { label: 'x' } })).toThrow();
    expect(() => withPreamble({ account: { label: 'x', pattern: 'conto' } })).toThrow();
    expect(() => withPreamble({ rowCount: { label: '' } })).toThrow();
    expect(withPreamble({}).preamble).toEqual({});
  });
});

describe('importing the bank list of operations', () => {
  const clock = () => '2026-11-14T09:00:00.000Z';
  const ids = (p: string) => {
    let i = 0;
    return () => `${p}-${String((i += 1))}`;
  };
  async function seeded(iban: string) {
    const store = new MemoryStore();
    const apt = apartment();
    await commitChange(
      store,
      {
        profileId: 'p1',
        kind: 'apartment.create',
        summary: 'x',
        changes: [{ path: recordPath('apartment', apt.id), before: undefined, after: apt }],
      },
      clock,
      ids('s'),
    );
    await saveBankProfile(store, real, 'p1', clock, ids('b'));
    const saved = await saveAccount(
      store,
      { apartmentId: apt.id, label: 'Conto', bankProfileId: real.id, iban },
      'p1',
      clock,
      ids('a'),
    );
    if (saved.status !== 'saved') throw new Error('account');
    return { store, accountId: saved.account.id };
  }
  const bytes = new TextEncoder().encode('synthetic');

  it('takes the period from the preamble and recognises the account by its number', async () => {
    const { store, accountId } = await seeded(ibanEndingWith(ACCOUNT));
    const r = await importStatement(
      store,
      { accountId, fileBytes: bytes, fileName: 'a.xlsx', table: realShape() },
      'p1',
      clock,
      ids('op'),
    );
    expect(r).toMatchObject({ status: 'imported', added: 16, held: 0 });
    if (r.status === 'imported')
      expect(r.statement).toMatchObject({
        from: '2026-10-01',
        to: '2026-10-31',
        periodSource: 'file',
      });
  });

  it('refuses another account: its IBAN does not end with the number of the file', async () => {
    const { store, accountId } = await seeded(ibanEndingWith('1234567'));
    const r = await importStatement(
      store,
      { accountId, fileBytes: bytes, fileName: 'a.xlsx', table: realShape() },
      'p1',
      clock,
      ids('op'),
    );
    expect(r).toEqual({ status: 'rejected', reason: 'wrong-account' });
  });

  it('refuses a row count mismatch by throwing, writing nothing', async () => {
    const { store, accountId } = await seeded(ibanEndingWith(ACCOUNT));
    await expect(
      importStatement(
        store,
        { accountId, fileBytes: bytes, fileName: 'a.xlsx', table: realShape({ count: n('17') }) },
        'p1',
        clock,
        ids('op'),
      ),
    ).rejects.toMatchObject({ code: 'row-count-mismatch' });
    expect(await store.list('_app/dati/transaction')).toEqual([]);
  });
});
