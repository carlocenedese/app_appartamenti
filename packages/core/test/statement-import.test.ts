import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  TaxPaymentSchema,
  AccountSchema,
  BankProfileSchema,
  BankTransactionSchema,
  BillMatchSchema,
  MovementClassSchema,
  PaymentSchema,
  StatementReadError,
  StatementSchema,
  TransferSchema,
  checkConsistency,
  commitChange,
  excludedIds,
  importStatement,
  isoDate,
  loadAll,
  readJournal,
  recordPath,
  resolveHeld,
  saveAccount,
  saveBankProfile,
  undoImport,
  undoOperation,
  planMatch,
} from '../src/index';
import type { StatementCell, StatementTable } from '../src/index';
import { apartment, bill } from './helpers/conguaglio-builders';
import { MemoryStore } from './helpers/memory-store';

const clock = () => '2026-11-14T09:00:00.000Z';
function ids(prefix: string): () => string {
  let n = 0;
  return () => `${prefix}-${String(++n)}`;
}
const profile = BankProfileSchema.parse(
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../../../fixtures/bank/profilo-sintetico.json', import.meta.url)),
      'utf8',
    ),
  ),
);
// The documented example IBAN, in pieces: no whole IBAN in the source.
const IBAN = 'IT60X0542' + '811101000000123456';
const OTHER_IBAN = 'GB82WEST' + '12345698765432';

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
/** A movement: `[date, description, amount, state?]`. */
type Mv = [string, string, string, string?];
const line = ([date, desc, amount, state]: Mv): StatementCell[] => [
  d(date),
  s(desc),
  null,
  n(amount),
  null,
  null,
  state === undefined ? null : s(state),
];
function file(
  movements: Mv[],
  top: StatementCell[][] = [],
): { bytes: Uint8Array; table: StatementTable } {
  const rows = [...top, HEADER, ...movements.map(line)];
  return {
    // Any bytes: only their hash counts. The table stands for what the reader made of them.
    bytes: new TextEncoder().encode(JSON.stringify(rows)),
    table: { v: 1, sheets: [{ name: 'x', rows }] },
  };
}
const declared = (from: string, to: string, account?: string): StatementCell[][] => [
  [s(`Estratto dal ${from} al ${to}`)],
  ...(account === undefined ? [] : [[s(`conto ${account}`)]]),
];
const OCT = { from: isoDate('2026-10-01'), to: isoDate('2026-10-31') };

async function seeded(): Promise<{ store: MemoryStore; accountId: string; newId: () => string }> {
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
  await saveBankProfile(store, profile, 'p1', clock, ids('b'));
  const saved = await saveAccount(
    store,
    { apartmentId: apt.id, label: 'Conto', bankProfileId: profile.id, iban: IBAN },
    'p1',
    clock,
    ids('a'),
  );
  if (saved.status !== 'saved') throw new Error('account');
  return { store, accountId: saved.account.id, newId: ids('op') };
}
async function snapshot(store: MemoryStore): Promise<string[]> {
  const out: string[] = [];
  for (const dir of ['_app/dati/transaction', '_app/dati/statement', '_app/journal']) {
    for (const name of await store.list(dir))
      out.push(`${dir}/${name}\n${store.getRaw(`${dir}/${name}`) ?? ''}`);
  }
  return out;
}
const live = async (store: MemoryStore) =>
  (await loadAll(store, 'transaction', BankTransactionSchema)).records;
const statementsOf = async (store: MemoryStore) =>
  (await loadAll(store, 'statement', StatementSchema)).records;

describe('importStatement', () => {
  it('imports a file once: the second time nothing is written, byte for byte', async () => {
    const { store, accountId, newId } = await seeded();
    const f = file([['2026-10-05', 'Alfa', '-10.00']], declared('01/10/2026', '31/10/2026'));
    const input = { accountId, fileBytes: f.bytes, fileName: 'a.csv', table: f.table };
    const first = await importStatement(store, input, 'p1', clock, newId);
    expect(first).toMatchObject({ status: 'imported', added: 1, alreadyKnown: 0, held: 0 });
    if (first.status !== 'imported') return;
    expect(first.statement).toMatchObject({ periodSource: 'file', rowCount: 1, from: OCT.from });
    expect(first.statement.suggestedPath).toContain('Estratto_Banca-Sintetica_2026-10');
    const before = await snapshot(store);
    const again = await importStatement(store, input, 'p1', clock, newId);
    expect(again).toEqual({ status: 'already-imported', statementId: first.statement.id });
    expect(await snapshot(store)).toEqual(before);
  });

  it('refuses the same file on another account, writing nothing', async () => {
    const { store, accountId, newId } = await seeded();
    const second = await saveAccount(
      store,
      { apartmentId: 'apt', label: 'Altro', bankProfileId: profile.id, iban: OTHER_IBAN },
      'p1',
      clock,
      ids('z'),
    );
    if (second.status !== 'saved') throw new Error('account');
    const f = file([['2026-10-05', 'Alfa', '-10.00']]);
    const base = { fileBytes: f.bytes, fileName: 'a.csv', table: f.table, period: OCT };
    await importStatement(store, { ...base, accountId }, 'p1', clock, newId);
    const before = await snapshot(store);
    const r = await importStatement(
      store,
      { ...base, accountId: second.account.id },
      'p1',
      clock,
      newId,
    );
    expect(r.status).toBe('already-imported');
    expect(await snapshot(store)).toEqual(before);
    expect(await live(store)).toHaveLength(1);
  });

  it('keeps the movements of two accounts apart: the same row on each is two movements', async () => {
    const { store, accountId, newId } = await seeded();
    const second = await saveAccount(
      store,
      { apartmentId: 'apt', label: 'Altro', bankProfileId: profile.id, iban: OTHER_IBAN },
      'p1',
      clock,
      ids('z'),
    );
    if (second.status !== 'saved') throw new Error('account');
    const row: Mv = ['2026-10-05', 'Alfa', '-10.00'];
    for (const [id, name] of [
      [accountId, 'a'],
      [second.account.id, 'b'],
    ] as const) {
      const f = file([row, [`2026-10-06`, name, '-1.00']]);
      const r = await importStatement(
        store,
        { accountId: id, fileBytes: f.bytes, fileName: name, table: f.table, period: OCT },
        'p1',
        clock,
        newId,
      );
      expect(r).toMatchObject({ status: 'imported', added: 2, alreadyKnown: 0, held: 0 });
    }
    const all = await live(store);
    expect(all).toHaveLength(4);
    expect(all.filter((t) => t.accountId === accountId)).toHaveLength(2);
    expect(all.every((t) => t.apartmentId === 'apt')).toBe(true);
  });

  it('unites October and 15 October - 15 November without doubles; three equal rows stay three', async () => {
    const { store, accountId, newId } = await seeded();
    const same: Mv[] = [
      ['2026-10-20', 'Uguale', '-5.00'],
      ['2026-10-20', 'Uguale', '-5.00'],
      ['2026-10-20', 'Uguale', '-5.00'],
    ];
    const a = file([['2026-10-05', 'Prima', '-1.00'], ...same, ['2026-10-31', 'Fine', '-2.00']]);
    const b = file([...same, ['2026-10-31', 'Fine', '-2.00'], ['2026-11-10', 'Dopo', '-3.00']]);
    await importStatement(
      store,
      { accountId, fileBytes: a.bytes, fileName: 'a', table: a.table, period: OCT },
      'p1',
      clock,
      newId,
    );
    const r = await importStatement(
      store,
      {
        accountId,
        fileBytes: b.bytes,
        fileName: 'b',
        table: b.table,
        period: { from: isoDate('2026-10-15'), to: isoDate('2026-11-15') },
      },
      'p1',
      clock,
      newId,
    );
    expect(r).toMatchObject({ status: 'imported', added: 1, alreadyKnown: 4, held: 0 });
    const all = await live(store);
    expect(all).toHaveLength(6);
    expect(all.filter((t) => t.description === 'Uguale')).toHaveLength(3);
    expect(new Set(all.map((t) => t.id)).size).toBe(6);
  });

  it('keeps a row with the same day and amount but other words as a possible duplicate', async () => {
    const { store, accountId, newId } = await seeded();
    const a = file([['2026-10-10', 'Bonifico Rossi', '-10.00']]);
    await importStatement(
      store,
      { accountId, fileBytes: a.bytes, fileName: 'a', table: a.table, period: OCT },
      'p1',
      clock,
      newId,
    );
    const b = file([
      ['2026-10-10', 'BON. A FAVORE DI ROSSI', '-10.00'],
      ['2026-10-11', 'Altro', '-1.00'],
    ]);
    const r = await importStatement(
      store,
      { accountId, fileBytes: b.bytes, fileName: 'b', table: b.table, period: OCT },
      'p1',
      clock,
      newId,
    );
    expect(r).toMatchObject({ status: 'imported', added: 1, held: 1 });
    expect(await live(store)).toHaveLength(2);
    const [stmt] = (await statementsOf(store)).filter((x) => x.fileName === 'b');
    expect(stmt?.held).toMatchObject([{ row: 2, reason: 'possible-duplicate' }]);
    // keeping it writes the movement, once, and the decision is recorded
    await resolveHeld(store, stmt?.id ?? '', 2, 'keep', 'p1', clock, newId);
    expect(await live(store)).toHaveLength(3);
  });

  it('does not hold a row when the day is not covered by any statement of the account', async () => {
    const { store, accountId, newId } = await seeded();
    const a = file([['2026-10-10', 'Bonifico Rossi', '-10.00']]);
    await importStatement(
      store,
      { accountId, fileBytes: a.bytes, fileName: 'a', table: a.table, period: OCT },
      'p1',
      clock,
      newId,
    );
    const b = file([['2026-12-10', 'Altro testo', '-10.00']]);
    const r = await importStatement(
      store,
      {
        accountId,
        fileBytes: b.bytes,
        fileName: 'b',
        table: b.table,
        period: { from: isoDate('2026-12-01'), to: isoDate('2026-12-31') },
      },
      'p1',
      clock,
      newId,
    );
    expect(r).toMatchObject({ status: 'imported', added: 1, held: 0 });
  });

  it('does not hold a row for a movement of a day no statement covers, nor for one the file has', async () => {
    const { store, accountId, newId } = await seeded();
    const a = file([['2026-10-10', 'Alfa', '-10.00']]);
    await importStatement(
      store,
      { accountId, fileBytes: a.bytes, fileName: 'a', table: a.table, period: OCT },
      'p1',
      clock,
      newId,
    );
    // a movement of the account on a day that no statement covers (written by hand)
    const orphan = BankTransactionSchema.parse({
      id: 'orphan',
      v: 1,
      rev: 1,
      apartmentId: 'apt',
      accountId,
      date: '2026-12-10',
      amount: -10_00,
      description: 'A mano',
      statementHash: 'x',
    });
    await commitChange(
      store,
      {
        profileId: 'p1',
        kind: 'x',
        summary: 'x',
        changes: [{ path: recordPath('transaction', 'orphan'), before: undefined, after: orphan }],
      },
      clock,
      ids('o'),
    );
    // Alfa is known and accounts for the movement of the day: the other row is a new one
    const b = file([
      ['2026-10-10', 'Alfa', '-10.00'],
      ['2026-10-10', 'Beta', '-10.00'],
      ['2026-12-10', 'Gamma', '-10.00'],
    ]);
    const r = await importStatement(
      store,
      {
        accountId,
        fileBytes: b.bytes,
        fileName: 'b',
        table: b.table,
        period: { from: isoDate('2026-10-01'), to: isoDate('2026-12-31') },
      },
      'p1',
      clock,
      newId,
    );
    expect(r).toMatchObject({ status: 'imported', added: 2, alreadyKnown: 1, held: 0 });
  });

  it('holds a not booked row as pending; exclude writes nothing, keep writes one', async () => {
    const { store, accountId, newId } = await seeded();
    const f = file([
      ['2026-10-05', 'Alfa', '-10.00', 'Prenotato'],
      ['2026-10-06', 'Beta', '-20.00', 'Prenotato'],
      ['2026-10-07', 'Gamma', '-1.00'],
    ]);
    const r = await importStatement(
      store,
      { accountId, fileBytes: f.bytes, fileName: 'a', table: f.table, period: OCT },
      'p1',
      clock,
      newId,
    );
    expect(r).toMatchObject({ status: 'imported', added: 1, held: 2 });
    if (r.status !== 'imported') return;
    expect(await live(store)).toHaveLength(1);
    await resolveHeld(store, r.statement.id, 2, 'exclude', 'p1', clock, newId);
    expect(await live(store)).toHaveLength(1);
    await resolveHeld(store, r.statement.id, 3, 'keep', 'p1', clock, newId);
    const all = await live(store);
    expect(all).toHaveLength(2);
    expect(all.find((t) => t.description === 'Beta')?.booked).toBe(false);
    const [stmt] = await statementsOf(store);
    expect(stmt?.held.map((h) => h.decision)).toEqual(['exclude', 'keep']);
    expect(stmt?.transactionIds).toHaveLength(2);
    await expect(resolveHeld(store, r.statement.id, 2, 'keep', 'p1', clock, newId)).rejects.toThrow(
      RangeError,
    );
    await expect(resolveHeld(store, r.statement.id, 3, 'keep', 'p1', clock, newId)).rejects.toThrow(
      RangeError,
    );
    expect(await live(store)).toHaveLength(2);
  });

  it('rejects without writing: no period, other period, row outside, wrong account, profile', async () => {
    const { store, accountId, newId } = await seeded();
    const before = await snapshot(store);
    const run = (f: ReturnType<typeof file>, extra: Record<string, unknown> = {}) =>
      importStatement(
        store,
        { accountId, fileBytes: f.bytes, fileName: 'a', table: f.table, ...extra },
        'p1',
        clock,
        newId,
      );
    const mv: Mv[] = [['2026-10-05', 'Alfa', '-10.00']];
    expect(await run(file(mv))).toEqual({ status: 'rejected', reason: 'needs-period' });
    expect(
      await run(file(mv, declared('01/10/2026', '31/10/2026')), {
        period: { from: isoDate('2026-10-01'), to: isoDate('2026-10-30') },
      }),
    ).toEqual({ status: 'rejected', reason: 'period-mismatch' });
    // the dates of the rows never make the period: a row outside the one given is refused
    expect(await run(file([...mv, ['2026-11-02', 'Fuori', '-1.00']]), { period: OCT })).toEqual({
      status: 'rejected',
      reason: 'row-outside-period',
      row: 3,
    });
    expect(
      await run(file([['2026-09-30', 'Fuori', '-1.00']], declared('01/10/2026', '31/10/2026'))),
    ).toEqual({ status: 'rejected', reason: 'row-outside-period', row: 3 });
    expect(await run(file(mv, declared('01/10/2026', '31/10/2026', OTHER_IBAN)))).toEqual({
      status: 'rejected',
      reason: 'wrong-account',
    });
    expect(
      await run(file(mv, declared('01/10/2026', '31/10/2026', IBAN)), { bankProfileId: 'altro' }),
    ).toEqual({ status: 'rejected', reason: 'wrong-profile' });
    expect(await snapshot(store)).toEqual(before);
    // the account written in the file, when it is the right one, passes
    expect(await run(file(mv, declared('01/10/2026', '31/10/2026', IBAN)))).toMatchObject({
      status: 'imported',
    });
  });

  it('rejects a deleted account and an unknown one', async () => {
    const { store, accountId, newId } = await seeded();
    const f = file([['2026-10-05', 'Alfa', '-10.00']]);
    const stored = (await loadAll(store, 'account', AccountSchema)).records[0];
    await commitChange(
      store,
      {
        profileId: 'p1',
        kind: 'account.delete',
        summary: 'x',
        changes: [{ path: recordPath('account', accountId), before: stored, after: undefined }],
      },
      clock,
      ids('d'),
    );
    const before = await snapshot(store);
    for (const id of [accountId, 'nope']) {
      expect(
        await importStatement(
          store,
          { accountId: id, fileBytes: f.bytes, fileName: 'a', table: f.table, period: OCT },
          'p1',
          clock,
          newId,
        ),
      ).toEqual({ status: 'rejected', reason: 'unknown-account' });
    }
    expect(await snapshot(store)).toEqual(before);
  });

  it('propagates the error of the reader', async () => {
    const { store, accountId, newId } = await seeded();
    const bad = { v: 1 as const, sheets: [{ name: 'x', rows: [[s('niente')]] }] };
    await expect(
      importStatement(
        store,
        { accountId, fileBytes: new Uint8Array([1]), fileName: 'a', table: bad, period: OCT },
        'p1',
        clock,
        newId,
      ),
    ).rejects.toBeInstanceOf(StatementReadError);
  });

  it('gives the same ids to equal rows in the same relative order, whatever the rest', async () => {
    const run = async (movements: Mv[]) => {
      const { store, accountId, newId } = await seeded();
      const f = file(movements);
      await importStatement(
        store,
        { accountId, fileBytes: f.bytes, fileName: 'a', table: f.table, period: OCT },
        'p1',
        clock,
        newId,
      );
      return (await live(store)).map((t) => t.id).sort();
    };
    const e: Mv = ['2026-10-05', 'Uguale', '-4.00'];
    const x: Mv = ['2026-10-06', 'Altro', '-1.00'];
    expect(await run([e, x, e])).toEqual(await run([x, e, e]));
  });

  it('writes constant summaries: no description, amount or name', async () => {
    const { store, accountId, newId } = await seeded();
    const f = file([
      ['2026-10-05', 'Rossi Mario causale unica', '-1234.56', 'Prenotato'],
      ['2026-10-06', 'Verdi', '-77.77'],
    ]);
    const r = await importStatement(
      store,
      { accountId, fileBytes: f.bytes, fileName: 'segreto.csv', table: f.table, period: OCT },
      'p1',
      clock,
      newId,
    );
    if (r.status !== 'imported') throw new Error('x');
    await resolveHeld(store, r.statement.id, 2, 'keep', 'p1', clock, newId);
    const { operations } = await readJournal(store);
    const sums = operations.filter((o) => o.kind.startsWith('statement.')).map((o) => o.summary);
    expect(sums).toHaveLength(2);
    expect(sums[0]).toBe('Importato un estratto conto: 1 movimento nuovo, 1 da rivedere.');
    for (const t of sums) expect(t).not.toMatch(/Rossi|Verdi|1234|77|segreto|IT60/);
  });
});

describe('undoImport with payments', () => {
  const payIds = ids('pay');
  const pay = async (
    store: MemoryStore,
    id: string,
    transactionId: string,
    deleted?: true,
    source: 'csv' | 'manual' | 'excel' = 'csv',
  ) => {
    const after = PaymentSchema.parse({
      id,
      v: 1,
      rev: 1,
      ...(deleted === undefined ? {} : { deleted }),
      apartmentId: apartment().id,
      tenantId: 't1',
      date: '2026-10-05',
      amount: 1000,
      confirmed: true,
      kind: 'canone',
      source,
      transactionId,
    });
    const op = await commitChange(
      store,
      {
        profileId: 'p1',
        kind: 'income.confirm',
        summary: 'x',
        changes: [{ path: recordPath('payment', id), before: undefined, after }],
      },
      clock,
      payIds,
    );
    return op;
  };
  const imported = async () => {
    const { store, accountId, newId } = await seeded();
    const f = file([
      ['2026-10-05', 'Prima', '-1.00'],
      ['2026-10-06', 'Seconda', '-2.00'],
    ]);
    const r = await importStatement(
      store,
      { accountId, fileBytes: f.bytes, fileName: 'a', table: f.table, period: OCT },
      'p1',
      clock,
      newId,
    );
    if (r.status !== 'imported') throw new Error('x');
    const txs = await live(store);
    return { store, newId, r, txs, accountId, f };
  };

  it('refuses with the ids of the live payments, writing nothing; a deleted one does not count', async () => {
    const { store, newId, r, txs } = await imported();
    const [a, b] = txs.map((t) => t.id).sort();
    if (a === undefined || b === undefined) throw new Error('x');
    await pay(store, 'pay-b', b);
    await pay(store, 'pay-a', a);
    await pay(store, 'pay-gone', a, true);
    const before = await snapshot(store);
    expect(await undoImport(store, r.statement.id, 'p1', clock, newId)).toEqual({
      status: 'refused',
      reason: 'dependent-payments',
      paymentIds: ['pay-a', 'pay-b'],
    });
    expect(await snapshot(store)).toEqual(before);
  });

  it('a live payment of any source on a movement blocks (manual, excel)', async () => {
    const { store, newId, r, txs } = await imported();
    const [a, b] = txs.map((t) => t.id).sort();
    if (a === undefined || b === undefined) throw new Error('x');
    await pay(store, 'pay-m', a, undefined, 'manual');
    await pay(store, 'pay-x', b, undefined, 'excel');
    expect(await undoImport(store, r.statement.id, 'p1', clock, newId)).toEqual({
      status: 'refused',
      reason: 'dependent-payments',
      paymentIds: ['pay-m', 'pay-x'],
    });
  });

  it('undoes once the payments are gone, and a payment on an already-known movement does not block', async () => {
    const { store, newId, r, txs, accountId, f } = await imported();
    const first = txs[0];
    if (first === undefined) throw new Error('x');
    // A second statement that only finds the same movements: it writes none of them.
    const again = await importStatement(
      store,
      {
        accountId,
        fileBytes: new TextEncoder().encode('other'),
        fileName: 'b',
        table: f.table,
        period: OCT,
      },
      'p1',
      clock,
      newId,
    );
    if (again.status !== 'imported') throw new Error('x');
    const op = await pay(store, 'pay-1', first.id);
    expect((await undoImport(store, again.statement.id, 'p1', clock, newId)).status).toBe('undone');
    expect(await undoImport(store, r.statement.id, 'p1', clock, newId)).toMatchObject({
      reason: 'dependent-payments',
    });
    await undoOperation(store, op.id, 'p1', clock, newId);
    expect((await undoImport(store, r.statement.id, 'p1', clock, newId)).status).toBe('undone');
  });

  // Plan 3c, task 4: matches and classes on its movements block too; exclusions do not.
  const put = (
    store: MemoryStore,
    kind: 'match' | 'movementClass' | 'transfer' | 'taxPayment',
    after: { id: string },
  ) =>
    commitChange(
      store,
      {
        profileId: 'p1',
        kind: kind === 'match' ? 'match.confirm' : 'movement.exclude',
        summary: 'x',
        changes: [{ path: recordPath(kind, after.id), before: undefined, after }],
      },
      clock,
      payIds,
    );
  const match = (id: string, transactionId: string, extra = {}) =>
    BillMatchSchema.parse({
      id,
      v: 1,
      rev: 1,
      itemType: 'bill',
      itemId: 'b1',
      transactionId,
      transactionDate: '2026-10-05',
      amount: 100,
      part: 'amount',
      confirmed: true,
      by: 'manual',
      ...extra,
    });
  const cls = (transactionId: string, extra: Record<string, unknown>) =>
    MovementClassSchema.parse({ id: `mc-${transactionId}`, v: 1, rev: 1, transactionId, ...extra });

  it('refuses with dependent-records: live confirmed matches and classes, sorted; nothing written', async () => {
    const { store, newId, r, txs } = await imported();
    const [a, b] = txs.map((t) => t.id).sort();
    if (a === undefined || b === undefined) throw new Error('x');
    await put(store, 'match', match('m-z', a));
    await put(store, 'match', match('m-auto', b, { by: 'auto' }));
    await put(store, 'match', match('m-open', a, { confirmed: false }));
    await put(store, 'match', match('m-gone', b, { deleted: true }));
    await put(store, 'movementClass', cls(b, { kind: 'utenze', apartmentId: apartment().id }));
    const transfer = (id: string, leg: Record<string, string>, extra = {}) =>
      TransferSchema.parse({
        id,
        v: 1,
        rev: 1,
        fromAccountId: 'acc-x',
        toAccountId: 'acc-y',
        amount: 100,
        date: '2026-10-05',
        ...leg,
        purpose: 'saldo',
        source: 'confirmed',
        ...extra,
      });
    await put(
      store,
      'transfer',
      transfer('tr-in', { outTransactionId: 'other', inTransactionId: a }),
    );
    await put(store, 'transfer', transfer('tr-gone', { outTransactionId: b }, { deleted: true }));
    await put(store, 'transfer', transfer('tr-other', { outTransactionId: 'other' }));
    // Plan 10: a live tax payment on a movement going away.
    await put(
      store,
      'taxPayment',
      TaxPaymentSchema.parse({
        id: `taxp-${a}`,
        v: 1,
        rev: 1,
        transactionId: a,
        parts: [{ voce: 'registro', year: '2026', amount: 100 }],
      }),
    );
    const before = await snapshot(store);
    expect(await undoImport(store, r.statement.id, 'p1', clock, newId)).toEqual({
      status: 'refused',
      reason: 'dependent-records',
      recordIds: ['m-auto', 'm-z', `mc-${b}`, `taxp-${a}`, 'tr-in'],
    });
    expect(await snapshot(store)).toEqual(before);
    // The payments are checked first.
    await pay(store, 'pay-a', a);
    expect(await undoImport(store, r.statement.id, 'p1', clock, newId)).toMatchObject({
      reason: 'dependent-payments',
    });
  });

  it('a live exclusion does not block, and survives the undo and a new import of the file', async () => {
    const { store, newId, r, txs, accountId, f } = await imported();
    const [a] = txs.map((t) => t.id).sort();
    if (a === undefined) throw new Error('x');
    await put(store, 'movementClass', cls(a, { kind: 'escluso', excludeReason: 'doppione' }));
    expect((await undoImport(store, r.statement.id, 'p1', clock, newId)).status).toBe('undone');
    const again = await importStatement(
      store,
      { accountId, fileBytes: f.bytes, fileName: 'a', table: f.table, period: OCT },
      'p1',
      clock,
      newId,
    );
    expect(again.status).toBe('imported');
    expect((await live(store)).map((t) => t.id)).toContain(a);
    const classes = (await loadAll(store, 'movementClass', MovementClassSchema)).records;
    expect(classes.map((c) => c.id)).toEqual([`mc-${a}`]);
    expect(excludedIds(classes)).toEqual(new Set([a]));
    expect(await checkConsistency(store)).toEqual([]);
  });
});

describe('undoImport', () => {
  const setup = async () => {
    const { store, accountId, newId } = await seeded();
    const a = file([
      ['2026-10-05', 'Prima', '-1.00'],
      ['2026-10-20', 'Comune', '-5.00'],
    ]);
    const b = file([
      ['2026-10-20', 'Comune', '-5.00'],
      ['2026-11-10', 'Dopo', '-3.00', 'Prenotato'],
      ['2026-11-11', 'Nuovo', '-4.00'],
    ]);
    const ra = await importStatement(
      store,
      { accountId, fileBytes: a.bytes, fileName: 'a', table: a.table, period: OCT },
      'p1',
      clock,
      newId,
    );
    const rb = await importStatement(
      store,
      {
        accountId,
        fileBytes: b.bytes,
        fileName: 'b',
        table: b.table,
        period: { from: isoDate('2026-10-15'), to: isoDate('2026-11-15') },
      },
      'p1',
      clock,
      newId,
    );
    if (ra.status !== 'imported' || rb.status !== 'imported') throw new Error('x');
    return { store, newId, a, b, ra, rb, accountId };
  };

  it('refuses the first import while the second lists its movements, then undoes the second only', async () => {
    const { store, newId, ra, rb } = await setup();
    const before = await snapshot(store);
    expect(await undoImport(store, ra.statement.id, 'p1', clock, newId)).toEqual({
      status: 'refused',
      reason: 'shared-transactions',
    });
    expect(await snapshot(store)).toEqual(before);
    await resolveHeld(store, rb.statement.id, 3, 'keep', 'p1', clock, newId);
    expect(await live(store)).toHaveLength(4);
    const r = await undoImport(store, rb.statement.id, 'p1', clock, newId);
    expect(r.status).toBe('undone');
    // only the first statement's movements are left, and its statement
    expect((await live(store)).map((t) => t.description).sort()).toEqual(['Comune', 'Prima']);
    expect((await statementsOf(store)).map((x) => x.id)).toEqual([ra.statement.id]);
    // now the first can go, and then the same file can be imported again
    expect((await undoImport(store, ra.statement.id, 'p1', clock, newId)).status).toBe('undone');
    expect(await live(store)).toHaveLength(0);
  });

  it('lets the same file be imported again after its import was undone', async () => {
    const { store, newId, ra, b, accountId } = await setup();
    await undoImport(
      store,
      (await statementsOf(store)).find((x) => x.fileName === 'b')?.id ?? '',
      'p1',
      clock,
      newId,
    );
    const input = {
      accountId,
      fileBytes: b.bytes,
      fileName: 'b',
      table: b.table,
      period: { from: isoDate('2026-10-15'), to: isoDate('2026-11-15') },
    };
    expect(await importStatement(store, input, 'p1', clock, newId)).toMatchObject({
      status: 'imported',
      added: 1,
      alreadyKnown: 1,
      held: 1,
    });
    expect((await live(store)).map((t) => t.description).sort()).toEqual([
      'Comune',
      'Nuovo',
      'Prima',
    ]);
    expect(ra.statement.id).toBeDefined();
  });

  it('does not cascade over a later change of someone else to one of its movements', async () => {
    const { store, newId, rb } = await setup();
    const stored = (await live(store)).find((t) => t.description === 'Nuovo');
    const first = stored?.id;
    await commitChange(
      store,
      {
        profileId: 'p1',
        kind: 'x',
        summary: 'x',
        changes: [
          {
            path: recordPath('transaction', first ?? ''),
            before: stored,
            after: { ...stored, description: 'Cambiata' },
          },
        ],
      },
      clock,
      ids('e'),
    );
    const before = await snapshot(store);
    expect(await undoImport(store, rb.statement.id, 'p1', clock, newId)).toEqual({
      status: 'refused',
      reason: 'later-changes',
    });
    expect(await snapshot(store)).toEqual(before);
  });

  it('throws for a statement that was never imported or is already undone', async () => {
    const { store, newId, rb } = await setup();
    await expect(undoImport(store, 'nope', 'p1', clock, newId)).rejects.toThrow(RangeError);
    await undoImport(store, rb.statement.id, 'p1', clock, newId);
    await expect(undoImport(store, rb.statement.id, 'p1', clock, newId)).rejects.toThrow(
      RangeError,
    );
  });
});

/** A store that stops writing after `limit` files: an interruption halfway through an operation. */
class FlakyStore extends MemoryStore {
  limit = Infinity;
  override async writeJsonAtomic(path: string, value: unknown): Promise<void> {
    if (this.limit <= 0) throw new Error('interrupted');
    this.limit -= 1;
    await super.writeJsonAtomic(path, value);
  }
}

describe('after review: interruptions, hidden twins, masked accounts', () => {
  const flaky = async () => {
    const { store: plain, accountId, newId } = await seeded();
    // same folder, flaky writes: copy what the seed wrote
    const store = new FlakyStore();
    for (const dir of [
      '_app/dati/apartment',
      '_app/dati/bankProfile',
      '_app/dati/account',
      '_app/journal',
    ]) {
      for (const name of await plain.list(dir))
        store.putRaw(`${dir}/${name}`, plain.getRaw(`${dir}/${name}`) ?? '');
    }
    return { store, accountId, newId };
  };

  it('resumes an import that stopped after some movements: no loss, no double', async () => {
    const { store, accountId, newId } = await flaky();
    const f = file([
      ['2026-10-05', 'Alfa', '-1.00'],
      ['2026-10-06', 'Beta', '-2.00'],
      ['2026-10-07', 'Gamma', '-3.00'],
    ]);
    const input = { accountId, fileBytes: f.bytes, fileName: 'a', table: f.table, period: OCT };
    store.limit = 3; // the journal file and two movements
    await expect(importStatement(store, input, 'p1', clock, newId)).rejects.toThrow('interrupted');
    expect(await statementsOf(store)).toHaveLength(0);
    store.limit = Infinity;
    const r = await importStatement(store, input, 'p1', clock, newId);
    expect(r).toMatchObject({ status: 'imported', added: 1, alreadyKnown: 2 });
    expect(await live(store)).toHaveLength(3);
    const [stmt] = await statementsOf(store);
    expect(stmt?.transactionIds).toHaveLength(3);
  });

  it('resumes a keep that stopped before the decision was recorded', async () => {
    const { store, accountId, newId } = await flaky();
    const f = file([['2026-10-05', 'Alfa', '-1.00', 'Prenotato']]);
    const r = await importStatement(
      store,
      { accountId, fileBytes: f.bytes, fileName: 'a', table: f.table, period: OCT },
      'p1',
      clock,
      newId,
    );
    if (r.status !== 'imported') throw new Error('x');
    store.limit = 2; // the journal file and the movement, not the statement
    await expect(resolveHeld(store, r.statement.id, 2, 'keep', 'p1', clock, newId)).rejects.toThrow(
      'interrupted',
    );
    expect((await statementsOf(store))[0]?.held[0]?.decision).toBeUndefined();
    store.limit = Infinity;
    await resolveHeld(store, r.statement.id, 2, 'keep', 'p1', clock, newId);
    expect(await live(store)).toHaveLength(1);
    expect((await statementsOf(store))[0]?.held[0]?.decision).toBe('keep');
  });

  it('refuses to undo A when B holds a possible twin of a movement A wrote', async () => {
    const { store, accountId, newId } = await seeded();
    const a = file([['2026-10-10', 'Bonifico Rossi', '-10.00']]);
    const ra = await importStatement(
      store,
      { accountId, fileBytes: a.bytes, fileName: 'a', table: a.table, period: OCT },
      'p1',
      clock,
      newId,
    );
    const b = file([['2026-10-10', 'BON. ROSSI', '-10.00']]);
    const rb = await importStatement(
      store,
      { accountId, fileBytes: b.bytes, fileName: 'b', table: b.table, period: OCT },
      'p1',
      clock,
      newId,
    );
    if (ra.status !== 'imported' || rb.status !== 'imported') throw new Error('x');
    const expected = { status: 'refused', reason: 'held-duplicates' };
    expect(await undoImport(store, ra.statement.id, 'p1', clock, newId)).toEqual(expected);
    await resolveHeld(store, rb.statement.id, 2, 'exclude', 'p1', clock, newId);
    const before = await snapshot(store);
    expect(await undoImport(store, ra.statement.id, 'p1', clock, newId)).toEqual(expected);
    expect(await snapshot(store)).toEqual(before);
    expect(await live(store)).toHaveLength(1);
    // another day or amount is no twin
    const c = file([['2026-10-12', 'Altro', '-10.00']]);
    const rc = await importStatement(
      store,
      { accountId, fileBytes: c.bytes, fileName: 'c', table: c.table, period: OCT },
      'p1',
      clock,
      newId,
    );
    if (rc.status !== 'imported') throw new Error('x');
    expect((await undoImport(store, rc.statement.id, 'p1', clock, newId)).status).toBe('undone');
  });

  it('a twin of another amount does not block, nor does a twin that was kept', async () => {
    const { store, accountId, newId } = await seeded();
    const imp = async (movements: Mv[], name: string) => {
      const f = file(movements);
      const r = await importStatement(
        store,
        { accountId, fileBytes: f.bytes, fileName: name, table: f.table, period: OCT },
        'p1',
        clock,
        newId,
      );
      if (r.status !== 'imported') throw new Error('x');
      return r.statement.id;
    };
    const a = await imp([['2026-10-10', 'Bonifico Rossi', '-10.00']], 'a');
    const b = await imp([['2026-10-10', 'BON. ROSSI', '-10.00']], 'b');
    const c = await imp([['2026-10-10', 'Gamma', '-30.00']], 'c');
    expect((await undoImport(store, c, 'p1', clock, newId)).status).toBe('undone');
    await resolveHeld(store, b, 2, 'keep', 'p1', clock, newId);
    expect((await undoImport(store, a, 'p1', clock, newId)).status).toBe('undone');
    expect((await live(store)).map((t) => t.description)).toEqual(['BON. ROSSI']);
  });

  it('a row of the same day and another amount is not a possible duplicate', async () => {
    const { store, accountId, newId } = await seeded();
    const a = file([['2026-10-10', 'Alfa', '-10.00']]);
    await importStatement(
      store,
      { accountId, fileBytes: a.bytes, fileName: 'a', table: a.table, period: OCT },
      'p1',
      clock,
      newId,
    );
    const b = file([['2026-10-10', 'Beta', '-11.00']]);
    expect(
      await importStatement(
        store,
        { accountId, fileBytes: b.bytes, fileName: 'b', table: b.table, period: OCT },
        'p1',
        clock,
        newId,
      ),
    ).toMatchObject({ added: 1, held: 0 });
  });

  it('period-mismatch also on `from`; a manual period is recorded as manual', async () => {
    const { store, accountId, newId } = await seeded();
    const f = file([['2026-10-05', 'Alfa', '-10.00']], declared('01/10/2026', '31/10/2026'));
    expect(
      await importStatement(
        store,
        {
          accountId,
          fileBytes: f.bytes,
          fileName: 'a',
          table: f.table,
          period: { from: isoDate('2026-10-02'), to: OCT.to },
        },
        'p1',
        clock,
        newId,
      ),
    ).toEqual({ status: 'rejected', reason: 'period-mismatch' });
    const g = file([['2026-10-05', 'Alfa', '-10.00']]);
    const r = await importStatement(
      store,
      { accountId, fileBytes: g.bytes, fileName: 'g', table: g.table, period: OCT },
      'p1',
      clock,
      newId,
    );
    expect(r.status === 'imported' && r.statement.periodSource).toBe('manual');
  });

  it('an account without IBAN cannot confirm an account written in the file', async () => {
    const { store, newId } = await seeded();
    const saved = await saveAccount(
      store,
      { apartmentId: 'apt', label: 'Senza', bankProfileId: profile.id },
      'p1',
      clock,
      ids('n'),
    );
    if (saved.status !== 'saved') throw new Error('x');
    const f = file([['2026-10-05', 'Alfa', '-10.00']], declared('01/10/2026', '31/10/2026', IBAN));
    expect(
      await importStatement(
        store,
        { accountId: saved.account.id, fileBytes: f.bytes, fileName: 'a', table: f.table },
        'p1',
        clock,
        newId,
      ),
    ).toEqual({ status: 'rejected', reason: 'wrong-account' });
  });

  it('a deleted bank profile of the account is wrong-profile', async () => {
    const { store, accountId, newId } = await seeded();
    const stored = (await loadAll(store, 'bankProfile', BankProfileSchema)).records[0];
    await commitChange(
      store,
      {
        profileId: 'p1',
        kind: 'x',
        summary: 'x',
        changes: [
          { path: recordPath('bankProfile', profile.id), before: stored, after: undefined },
        ],
      },
      clock,
      ids('d'),
    );
    const f = file([['2026-10-05', 'Alfa', '-10.00']]);
    expect(
      await importStatement(
        store,
        { accountId, fileBytes: f.bytes, fileName: 'a', table: f.table, period: OCT },
        'p1',
        clock,
        newId,
      ),
    ).toEqual({ status: 'rejected', reason: 'wrong-profile' });
  });

  it('an empty or masked account in the file is refused with its own code', async () => {
    const { store, accountId, newId } = await seeded();
    await saveBankProfile(
      store,
      { ...profile, accountPattern: 'conto ?([A-Z0-9*•#]*)' },
      'p1',
      clock,
      ids('q'),
    );
    const run = (text: string, n: string) => {
      const f = file(
        [['2026-10-05', n, '-10.00']],
        [[s('Estratto dal 01/10/2026 al 31/10/2026')], [s(text)]],
      );
      return importStatement(
        store,
        { accountId, fileBytes: f.bytes, fileName: n, table: f.table },
        'p1',
        clock,
        newId,
      );
    };
    const before = await snapshot(store);
    expect(await run('conto', 'a')).toEqual({ status: 'rejected', reason: 'bad-declared-account' });
    // A short capture is contained in almost any IBAN: refused like an empty one.
    expect(await run('conto IT60', 'e')).toEqual({
      status: 'rejected',
      reason: 'bad-declared-account',
    });
    expect(await run('conto 12345', 'f')).toMatchObject({ reason: 'bad-declared-account' });
    expect(await run('conto ****3456', 'b')).toEqual({
      status: 'rejected',
      reason: 'masked-account',
    });
    expect(await run('conto ••••3456', 'c')).toMatchObject({ reason: 'masked-account' });
    expect(await run('conto ####3456', 'd')).toMatchObject({ reason: 'masked-account' });
    expect(await snapshot(store)).toEqual(before);
  });

  it('after an interrupted import and its resume, undoing leaves no movement behind', async () => {
    for (const limit of [1, 2, 3, 4]) {
      const { store, accountId, newId } = await flaky();
      const f = file([
        ['2026-10-05', 'Alfa', '-1.00'],
        ['2026-10-06', 'Beta', '-2.00'],
        ['2026-10-07', 'Gamma', '-3.00'],
      ]);
      const input = { accountId, fileBytes: f.bytes, fileName: 'a', table: f.table, period: OCT };
      store.limit = limit; // the journal file, then limit - 1 movements; never the statement
      await expect(importStatement(store, input, 'p1', clock, newId)).rejects.toThrow(
        'interrupted',
      );
      store.limit = Infinity;
      const r = await importStatement(store, input, 'p1', clock, newId);
      if (r.status !== 'imported') throw new Error('x');
      expect(await live(store)).toHaveLength(3);
      expect((await undoImport(store, r.statement.id, 'p1', clock, newId)).status).toBe('undone');
      expect(await live(store), `limit ${String(limit)}`).toHaveLength(0);
      expect(await statementsOf(store)).toHaveLength(0);
      expect(await checkConsistency(store)).toEqual([]);
    }
  });

  it('after an interrupted keep and its resume, undoing the import leaves no movement behind', async () => {
    const { store, accountId, newId } = await flaky();
    const f = file([['2026-10-05', 'Alfa', '-1.00', 'Prenotato']]);
    const r = await importStatement(
      store,
      { accountId, fileBytes: f.bytes, fileName: 'a', table: f.table, period: OCT },
      'p1',
      clock,
      newId,
    );
    if (r.status !== 'imported') throw new Error('x');
    store.limit = 2;
    await expect(resolveHeld(store, r.statement.id, 2, 'keep', 'p1', clock, newId)).rejects.toThrow(
      'interrupted',
    );
    store.limit = Infinity;
    await resolveHeld(store, r.statement.id, 2, 'keep', 'p1', clock, newId);
    expect((await undoImport(store, r.statement.id, 'p1', clock, newId)).status).toBe('undone');
    expect(await live(store)).toHaveLength(0);
    expect(await checkConsistency(store)).toEqual([]);
  });

  it('a possible twin held on another account does not block the undo', async () => {
    const { store, accountId, newId } = await seeded();
    const second = await saveAccount(
      store,
      { apartmentId: 'apt', label: 'Altro', bankProfileId: profile.id, iban: OTHER_IBAN },
      'p1',
      clock,
      ids('z'),
    );
    if (second.status !== 'saved') throw new Error('account');
    const imp = async (id: string, movements: Mv[], name: string) => {
      const f = file(movements);
      const r = await importStatement(
        store,
        { accountId: id, fileBytes: f.bytes, fileName: name, table: f.table, period: OCT },
        'p1',
        clock,
        newId,
      );
      if (r.status !== 'imported') throw new Error('x');
      return r.statement.id;
    };
    const a = await imp(accountId, [['2026-10-10', 'Bonifico Rossi', '-10.00']], 'a');
    await imp(
      second.account.id,
      [
        ['2026-10-10', 'Bonifico Rossi', '-10.00'],
        ['2026-10-11', 'Altro', '-1.00'],
      ],
      'b',
    );
    await imp(second.account.id, [['2026-10-10', 'BON. ROSSI', '-10.00']], 'c');
    expect((await statementsOf(store)).some((x) => x.held.length > 0)).toBe(true);
    expect((await undoImport(store, a, 'p1', clock, newId)).status).toBe('undone');
  });
});

describe('C1 after an undone statement (review of 18 Nov 2026, point 7)', () => {
  it('the movements of an undone statement are no candidates: the gap item is assumed again', async () => {
    const { store, accountId, newId } = await seeded();
    // Invented: a bill due 31/01, the statement from 01/02 with its debit on 03/02.
    const late = bill('b-late', '2025-11-01', '2025-12-31', 21460, {
      dueDate: isoDate('2026-01-31'),
    });
    await commitChange(
      store,
      {
        profileId: 'p1',
        kind: 'test.seed',
        summary: 'x',
        changes: [{ path: recordPath('bill', late.id), after: late }],
      },
      clock,
      ids('seed'),
    );
    const f = file(
      [['2026-02-03', 'ADDEBITO Fornitore luce', '-214.60']],
      declared('01/02/2026', '28/02/2026'),
    );
    const imported = await importStatement(
      store,
      { accountId, fileBytes: f.bytes, fileName: 'feb.csv', table: f.table },
      'p1',
      clock,
      newId,
    );
    if (imported.status !== 'imported') throw new Error('import');
    const plan = async () => {
      const { run, written } = await planMatch(store);
      if (run.status !== 'matched') throw new Error('refused');
      return { assumed: run.assumed, written: written.map((m) => [m.itemId, m.transactionId]) };
    };
    const [tx] = await live(store);
    expect(await plan()).toEqual({ assumed: [], written: [['b-late', tx?.id]] });
    expect(await undoImport(store, imported.statement.id, 'p1', clock, newId)).toMatchObject({
      status: 'undone',
    });
    expect(await plan()).toEqual({
      assumed: [{ itemType: 'bill', itemId: 'b-late' }],
      written: [],
    });
    expect(await live(store)).toEqual([]);
  });
});
