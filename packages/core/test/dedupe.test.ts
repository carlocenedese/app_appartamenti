import { describe, expect, it } from 'vitest';
import {
  BankTransactionSchema,
  BillSchema,
  StaleWriteError,
  cents,
  checkConsistency,
  hashBytes,
  isoDate,
  keyTransactions,
  readJournal,
  recordPath,
  registerBill,
  samePages,
  transactionKey,
} from '../src/index';
import type { Bill } from '../src/index';
import { MemoryStore } from './helpers/memory-store';

const encoder = new TextEncoder();
const bytes = (text: string): Uint8Array => encoder.encode(text);

const SHA256_EMPTY = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const SHA256_ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
const HEX_64 = /^[0-9a-f]{64}$/;

/** A clock that moves one millisecond at each call, so later operations are really later. */
function tickingClock(): () => string {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 10, 10, 20, 0, 0, tick++)).toISOString();
}

/** Ids that sort in the order they are handed out ("op-001", "op-002", ...). */
function idSequence(prefix = 'op'): () => string {
  let count = 0;
  return () => `${prefix}-${String(++count).padStart(3, '0')}`;
}

type NewBill = Omit<Bill, 'fileHash' | 'rev' | 'v'>;

function newBill(id: string, extra: Partial<NewBill> = {}): NewBill {
  return {
    id,
    apartmentId: 'apt-1',
    category: 'elettricita',
    supplier: 'Fornitore Luce',
    number: '2026/0042',
    periodStart: isoDate('2025-12-01'),
    periodEnd: isoDate('2026-01-31'),
    amount: cents(9846),
    includedInConguaglio: true,
    sharedWithTenants: true,
    filePath: 'bollette/2026-02-luce.pdf',
    ...extra,
  };
}

/** A stored bill, as written by a previous run of the app (written straight to the store). */
async function putBill(store: MemoryStore, id: string, fields: Record<string, unknown> = {}) {
  await store.writeJsonAtomic(recordPath('bill', id), {
    ...newBill(id),
    v: 1,
    rev: 1,
    fileHash: `hash-of-${id}`,
    ...fields,
  });
}

async function billFiles(store: MemoryStore): Promise<string[]> {
  return store.list('_app/dati/bill');
}

async function journalSize(store: MemoryStore): Promise<number> {
  return (await readJournal(store)).operations.length;
}

describe('hashBytes', () => {
  it('gives the SHA-256 of the bytes as lowercase hexadecimal', async () => {
    expect(await hashBytes(new Uint8Array(0))).toBe(SHA256_EMPTY);
    expect(await hashBytes(bytes('abc'))).toBe(SHA256_ABC);
  });

  it('gives the same hash for the same bytes and different hashes for different bytes', async () => {
    const first = await hashBytes(bytes('bolletta-a'));
    expect(await hashBytes(bytes('bolletta-a'))).toBe(first);
    expect(await hashBytes(bytes('bolletta-b'))).not.toBe(first);
    expect(first).toMatch(HEX_64);
  });

  it('hashes only the bytes a view covers, not the buffer behind it', async () => {
    const view = bytes('xxabcyy').subarray(2, 5);
    expect(await hashBytes(view)).toBe(SHA256_ABC);
  });
});

describe('registerBill', () => {
  it('writes the record and one operation, and returns the bill as stored', async () => {
    const store = new MemoryStore();
    const pdf = bytes('pdf-1');

    const result = await registerBill(
      store,
      newBill('bill-1'),
      pdf,
      'carlo',
      tickingClock(),
      idSequence(),
    );

    expect(result.status).toBe('registered');
    if (result.status !== 'registered') return;
    expect(result.bill).toMatchObject({
      id: 'bill-1',
      v: 1,
      rev: 1,
      fileHash: await hashBytes(pdf),
      supplier: 'Fornitore Luce',
      amount: 9846,
    });

    const stored = BillSchema.parse(await store.readJson(recordPath('bill', 'bill-1')));
    expect(stored).toEqual(result.bill);
    expect(await billFiles(store)).toEqual(['bill-1.json']);

    const { operations, problems } = await readJournal(store);
    expect(problems).toEqual([]);
    expect(operations).toHaveLength(1);
    const [operation] = operations;
    expect(operation).toMatchObject({
      id: 'op-001',
      profileId: 'carlo',
      kind: 'register-bill',
      apartmentId: 'apt-1',
      summary: 'Registrata bolletta Fornitore Luce 2025-12-01–2026-01-31',
    });
    expect(operation?.changes).toHaveLength(1);
    expect(operation?.changes[0]).toMatchObject({
      path: recordPath('bill', 'bill-1'),
      after: { id: 'bill-1', v: 1, rev: 1, fileHash: await hashBytes(pdf) },
    });
    expect(operation?.changes[0]?.before).toBeUndefined();
    expect(await checkConsistency(store)).toEqual([]);
  });

  it('refuses the same file a second time: duplicate, with the id of the first, nothing written', async () => {
    const store = new MemoryStore();
    const pdf = bytes('pdf-1');
    await registerBill(store, newBill('bill-1'), pdf, 'carlo', tickingClock(), idSequence());
    const newId = idSequence('later');

    // Even with other details: the same bytes are the same document.
    const second = await registerBill(
      store,
      newBill('bill-2', { supplier: 'Altro', amount: cents(1) }),
      pdf,
      'carlo',
      tickingClock(),
      newId,
    );

    expect(second).toEqual({ status: 'duplicate', existingId: 'bill-1' });
    expect(await billFiles(store)).toEqual(['bill-1.json']);
    expect(await journalSize(store)).toBe(1);
    expect(newId()).toBe('later-001'); // the id generator was not used up by the refused call
  });

  it('says possible-duplicate for the same bill in other bytes, and writes nothing', async () => {
    const store = new MemoryStore();
    await registerBill(
      store,
      newBill('bill-1'),
      bytes('pdf-1'),
      'carlo',
      tickingClock(),
      idSequence(),
    );

    // A re-downloaded PDF: other bytes, same apartment, supplier, number, period and amount.
    const second = await registerBill(
      store,
      newBill('bill-2'),
      bytes('pdf-1, downloaded again'),
      'carlo',
      tickingClock(),
      idSequence('later'),
    );

    expect(second).toEqual({ status: 'possible-duplicate', existingId: 'bill-1' });
    expect(await billFiles(store)).toEqual(['bill-1.json']);
    expect(await journalSize(store)).toBe(1);
  });

  it('compares the supplier after NFC, trim and case folding, and the numbers as they are', async () => {
    const store = new MemoryStore();
    await putBill(store, 'bill-1', { supplier: 'Società Elettrica' });
    const attempt = (id: string, extra: Partial<NewBill>) =>
      registerBill(
        store,
        newBill(id, extra),
        bytes(`pdf-of-${id}`),
        'carlo',
        tickingClock(),
        idSequence(`op-${id}`),
      );

    // The accent as a combining mark (NFD), other case, spaces around: the same supplier.
    expect(await attempt('bill-2', { supplier: ' SOCIETA\u0300 ELETTRICA ' })).toEqual({
      status: 'possible-duplicate',
      existingId: 'bill-1',
    });

    // A different number is a different bill.
    expect(
      (await attempt('bill-3', { supplier: 'Società Elettrica', number: '2026/0043' })).status,
    ).toBe('registered');
    // No number is not the same as a number.
    expect(
      (await attempt('bill-4', { supplier: 'Società Elettrica', number: undefined })).status,
    ).toBe('registered');
  });

  it('counts two bills without a number as having the same number', async () => {
    const store = new MemoryStore();
    await putBill(store, 'bill-1', { number: undefined });

    const result = await registerBill(
      store,
      newBill('bill-2', { number: undefined }),
      bytes('pdf-2'),
      'carlo',
      tickingClock(),
      idSequence(),
    );

    expect(result).toEqual({ status: 'possible-duplicate', existingId: 'bill-1' });
  });

  it.each<[string, Partial<NewBill>]>([
    ['another apartment', { apartmentId: 'apt-2' }],
    ['another supplier', { supplier: 'Fornitore Gas' }],
    ['another period start', { periodStart: isoDate('2025-12-02') }],
    ['another period end', { periodEnd: isoDate('2026-02-28') }],
    ['another amount', { amount: cents(9847) }],
    ['another number', { number: '2026/0099' }],
  ])('registers a bill that differs in a field that counts: %s', async (_label, extra) => {
    const store = new MemoryStore();
    await putBill(store, 'bill-1');

    const result = await registerBill(
      store,
      newBill('bill-2', extra),
      bytes('pdf-2'),
      'carlo',
      tickingClock(),
      idSequence(),
    );

    expect(result.status).toBe('registered');
    expect(await billFiles(store)).toEqual(['bill-1.json', 'bill-2.json']);
    expect(await journalSize(store)).toBe(1);
  });

  it('says possible-duplicate when the bills differ only in fields that do not count', async () => {
    const store = new MemoryStore();
    await putBill(store, 'bill-1');

    // Category, issue date and file name are not part of the comparison: the fields that are
    // still match, so it is a possible duplicate.
    const result = await registerBill(
      store,
      newBill('bill-2', {
        category: 'gas',
        filePath: 'bollette/altro.pdf',
        issueDate: isoDate('2026-02-05'),
      }),
      bytes('pdf-2'),
      'carlo',
      tickingClock(),
      idSequence(),
    );

    expect(result).toEqual({ status: 'possible-duplicate', existingId: 'bill-1' });
  });

  it('checks the file before the fields', async () => {
    const store = new MemoryStore();
    const pdfB = bytes('pdf-b');
    await putBill(store, 'bill-1'); // same fields as the new bill, other bytes
    await putBill(store, 'bill-9', {
      supplier: 'Fornitore Gas',
      fileHash: await hashBytes(pdfB),
    }); // same bytes, other fields

    const result = await registerBill(
      store,
      newBill('bill-new'),
      pdfB,
      'carlo',
      tickingClock(),
      idSequence(),
    );

    expect(result).toEqual({ status: 'duplicate', existingId: 'bill-9' });
  });

  it('names the smallest id when several bills match, whatever the order of writing', async () => {
    const store = new MemoryStore();
    const pdf = bytes('pdf-same');
    const fileHash = await hashBytes(pdf);
    await putBill(store, 'bill-c', { fileHash });
    await putBill(store, 'bill-a', { fileHash });
    await putBill(store, 'bill-b', { fileHash });
    expect(
      await registerBill(store, newBill('bill-new'), pdf, 'carlo', tickingClock(), idSequence()),
    ).toEqual({ status: 'duplicate', existingId: 'bill-a' });

    const other = new MemoryStore();
    await putBill(other, 'bill-z');
    await putBill(other, 'bill-m');
    await putBill(other, 'bill-q');
    expect(
      await registerBill(
        other,
        newBill('bill-new'),
        bytes('x'),
        'carlo',
        tickingClock(),
        idSequence(),
      ),
    ).toEqual({ status: 'possible-duplicate', existingId: 'bill-m' });
  });

  it('ignores deleted bills when it looks for a duplicate', async () => {
    const store = new MemoryStore();
    const pdf = bytes('pdf-1');
    await putBill(store, 'bill-1', { fileHash: await hashBytes(pdf), deleted: true, rev: 2 });

    const result = await registerBill(
      store,
      newBill('bill-2'),
      pdf,
      'carlo',
      tickingClock(),
      idSequence(),
    );

    expect(result.status).toBe('registered');
    expect(await billFiles(store)).toEqual(['bill-1.json', 'bill-2.json']);
  });

  it('throws for a bill that is not valid, before anything is written', async () => {
    const store = new MemoryStore();

    await expect(
      registerBill(
        store,
        newBill('bill-1', { periodStart: isoDate('2026-02-01'), periodEnd: isoDate('2026-01-01') }),
        bytes('pdf-1'),
        'carlo',
        tickingClock(),
        idSequence(),
      ),
    ).rejects.toThrow(/billing period ends before it starts/);
    await expect(
      registerBill(
        store,
        newBill('bill-1', { supplier: '' }),
        bytes('pdf-1'),
        'carlo',
        tickingClock(),
        idSequence(),
      ),
    ).rejects.toThrow(/supplier/);

    expect(await billFiles(store)).toEqual([]);
    expect(await journalSize(store)).toBe(0);
  });

  it('does not overwrite a record that has the same id', async () => {
    const store = new MemoryStore();
    await putBill(store, 'bill-1');
    const before = store.getRaw(recordPath('bill', 'bill-1'));

    await expect(
      registerBill(
        store,
        newBill('bill-1', { supplier: 'Fornitore Gas' }),
        bytes('pdf-2'),
        'carlo',
        tickingClock(),
        idSequence(),
      ),
    ).rejects.toBeInstanceOf(StaleWriteError);

    expect(store.getRaw(recordPath('bill', 'bill-1'))).toBe(before);
    expect(await journalSize(store)).toBe(0);
  });
});

type Row = Parameters<typeof keyTransactions>[0][number];

function row(date: string, amount: number, description: string, extra: Partial<Row> = {}): Row {
  return {
    apartmentId: 'apt-1',
    date: isoDate(date),
    amount: cents(amount),
    description,
    statementHash: 'statement-1',
    ...extra,
  };
}

/** The ids of the rows, in order. */
async function idsOf(rows: Row[]): Promise<string[]> {
  return (await keyTransactions(rows)).map((transaction) => transaction.id);
}

describe('registerBill: kind of the operation', () => {
  it('writes the kind given in opts and returns the id of the operation', async () => {
    const store = new MemoryStore();
    const result = await registerBill(
      store,
      newBill('bill-1'),
      bytes('%PDF luce'),
      'carlo',
      tickingClock(),
      idSequence(),
      { kind: 'bill.register-auto' },
    );
    expect(result).toMatchObject({ status: 'registered', operationId: 'op-001' });
    const { operations } = await readJournal(store);
    expect(operations.map((o) => [o.id, o.kind])).toEqual([['op-001', 'bill.register-auto']]);
  });
});

describe('transactionKey', () => {
  const base = {
    apartmentId: 'apt-1',
    date: isoDate('2026-03-05'),
    amount: cents(-6300),
    description: 'Addebito SDD Fornitore Luce',
  };

  it('is a SHA-256 in lowercase hexadecimal, the same for the same debit', async () => {
    const key = await transactionKey(base, 0);
    expect(key).toMatch(HEX_64);
    expect(await transactionKey({ ...base }, 0)).toBe(key);
  });

  it('keeps the fingerprint of a debit without an account (value pinned before accounts)', async () => {
    expect(await transactionKey(base, 0)).toBe(
      '58cdf85ecbd5c0a78c2ebca21605f124a6d8d150e15d594726e1945c62dbb716',
    );
  });

  it('tells two accounts of one apartment apart, and an account from none', async () => {
    const keys = await Promise.all([
      transactionKey({ ...base, accountId: 'acc-1' }, 0),
      transactionKey({ ...base, accountId: 'acc-2' }, 0),
      transactionKey(base, 0),
    ]);
    expect(new Set(keys).size).toBe(3);
    expect(await transactionKey({ ...base, accountId: 'acc-1' }, 0)).toBe(keys[0]);
  });

  it('changes with each part of the debit and with the occurrence', async () => {
    const keys = await Promise.all([
      transactionKey(base, 0),
      transactionKey(base, 1),
      transactionKey({ ...base, apartmentId: 'apt-2' }, 0),
      transactionKey({ ...base, date: isoDate('2026-03-06') }, 0),
      transactionKey({ ...base, amount: cents(-6301) }, 0),
      transactionKey({ ...base, description: 'Addebito SDD Fornitore Gas' }, 0),
    ]);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('does not depend on case, spaces around the text, or the way an accent is written', async () => {
    const key = await transactionKey({ ...base, description: 'Pagamento Società Elettrica' }, 0);
    for (const description of [
      'PAGAMENTO SOCIETÀ ELETTRICA',
      '  pagamento   società\telettrica \n',
      'Pagamento Societa\u0300 Elettrica', // accent as a combining mark (NFD)
      'Pagamento\u00a0Società\u00a0Elettrica', // non-breaking spaces
    ]) {
      expect(await transactionKey({ ...base, description }, 0)).toBe(key);
    }
    // Words are still words: no space is not the same as one space.
    expect(
      await transactionKey({ ...base, description: 'PagamentoSocietà Elettrica' }, 0),
    ).not.toBe(key);
  });

  it('cannot be fooled by text that looks like the separator between the parts', async () => {
    const a = await transactionKey({ ...base, apartmentId: 'a', description: 'b|c' }, 0);
    const b = await transactionKey({ ...base, apartmentId: 'a|b', description: 'c' }, 0);
    const c = await transactionKey({ ...base, apartmentId: 'a","b', description: 'c' }, 0);
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53])(
    'refuses an occurrence that is not a non-negative integer: %s',
    async (occurrence) => {
      await expect(transactionKey(base, occurrence)).rejects.toThrow(RangeError);
    },
  );
});

describe('keyTransactions', () => {
  it('gives the same ids when the same list is keyed twice', async () => {
    const rows = [
      row('2026-03-05', -6300, 'Addebito SDD Luce'),
      row('2026-03-05', -6300, 'Addebito SDD Luce'),
      row('2026-03-06', -1500, 'Addebito SDD Gas'),
    ];
    expect(await idsOf(rows)).toEqual(await idsOf(rows));
  });

  it('gives the same id to a debit that is in two overlapping lists', async () => {
    // Days 1 to 30, some days with two identical debits, as a bank statement has.
    const all: Row[] = [];
    for (let day = 1; day <= 30; day += 1) {
      const date = `2026-03-${String(day).padStart(2, '0')}`;
      all.push(row(date, -100 * day, 'Addebito SDD Luce'));
      if (day % 5 === 0) all.push(row(date, -100 * day, 'Addebito SDD Luce'));
    }
    const first = all.filter((r) => r.date <= '2026-03-15'); // days 1 to 15
    const second = all.filter((r) => r.date >= '2026-03-10'); // days 10 to 30

    const firstIds = await idsOf(first);
    const secondIds = await idsOf(second);
    const allIds = await idsOf(all);

    // Rows of the overlap (days 10 to 15) are at the end of the first list and at the start of
    // the second: same ids there, and the same ids as in the list that has every day.
    const overlap = first.filter((r) => r.date >= '2026-03-10');
    expect(overlap.length).toBeGreaterThan(6);
    expect(firstIds.slice(-overlap.length)).toEqual(secondIds.slice(0, overlap.length));
    expect(firstIds).toEqual(allIds.slice(0, first.length));
    expect(secondIds).toEqual(allIds.slice(-second.length));
    expect(new Set(allIds).size).toBe(all.length);
  });

  it('gives two identical debits on the same day different ids, in order of appearance', async () => {
    const rows = [
      row('2026-03-05', -6300, 'Addebito SDD Luce'),
      row('2026-03-05', -6300, 'Addebito SDD Luce'),
      row('2026-03-05', -6300, 'Addebito SDD Luce'),
    ];
    const ids = await idsOf(rows);
    expect(new Set(ids).size).toBe(3);

    const debit = {
      apartmentId: 'apt-1',
      date: isoDate('2026-03-05'),
      amount: cents(-6300),
      description: 'Addebito SDD Luce',
    };
    expect(ids).toEqual([
      await transactionKey(debit, 0),
      await transactionKey(debit, 1),
      await transactionKey(debit, 2),
    ]);
  });

  it('numbers identical rows of one account 0, 1, 2 and keeps them when a fourth is added', async () => {
    const same = row('2026-03-05', -6300, 'Addebito SDD Luce', { accountId: 'acc-1' });
    const three = await idsOf([same, same, same]);
    const four = await idsOf([same, same, same, same]);
    const debit = { ...same };
    expect(three).toEqual([
      await transactionKey(debit, 0),
      await transactionKey(debit, 1),
      await transactionKey(debit, 2),
    ]);
    expect(four.slice(0, 3)).toEqual(three);
    expect(new Set(four).size).toBe(4);
    // The same row on another account of the apartment starts again from 0, with another id.
    const other = await idsOf([{ ...same, accountId: 'acc-2' }]);
    expect(other[0]).not.toBe(three[0]);
  });

  it('counts the occurrences within identical debits only, and in input order', async () => {
    const luce = row('2026-03-05', -6300, 'Addebito SDD Luce');
    const gas = row('2026-03-05', -6300, 'Addebito SDD Gas');
    const otherApartment = row('2026-03-05', -6300, 'Addebito SDD Luce', { apartmentId: 'apt-2' });

    const keyed = await keyTransactions([luce, gas, luce, otherApartment, gas, luce]);

    expect(keyed.map((t) => t.description)).toEqual([
      'Addebito SDD Luce',
      'Addebito SDD Gas',
      'Addebito SDD Luce',
      'Addebito SDD Luce',
      'Addebito SDD Gas',
      'Addebito SDD Luce',
    ]);
    expect(keyed.map((t) => t.apartmentId)).toEqual([
      'apt-1',
      'apt-1',
      'apt-1',
      'apt-2',
      'apt-1',
      'apt-1',
    ]);
    // The first of each kind is occurrence 0, whatever came before it.
    expect(keyed[0]?.id).toBe(await transactionKey(luce, 0));
    expect(keyed[1]?.id).toBe(await transactionKey(gas, 0));
    expect(keyed[2]?.id).toBe(await transactionKey(luce, 1));
    expect(keyed[3]?.id).toBe(await transactionKey(otherApartment, 0));
    expect(keyed[4]?.id).toBe(await transactionKey(gas, 1));
    expect(keyed[5]?.id).toBe(await transactionKey(luce, 2));
  });

  it('does not change an id when the description only changes in case or spacing', async () => {
    const plain = await idsOf([row('2026-03-05', -6300, 'Addebito SDD Luce')]);
    const messy = await idsOf([row('2026-03-05', -6300, '  ADDEBITO   sdd\u00a0luce ')]);
    expect(messy).toEqual(plain);

    // The same holds for the occurrence of repeated debits written in different ways.
    const twice = await idsOf([
      row('2026-03-05', -6300, 'Addebito SDD Luce'),
      row('2026-03-05', -6300, 'ADDEBITO SDD LUCE'),
    ]);
    expect(twice[0]).toBe(plain[0]);
    expect(twice[1]).not.toBe(plain[0]);
  });

  it('returns valid records in input order, with the description as it was written', async () => {
    const rows = [
      row('2026-03-06', -1500, 'Addebito  SDD Gas', { dispCode: 'D-7' }),
      row('2026-03-05', -6300, 'Addebito SDD Luce'),
    ];

    const keyed = await keyTransactions(rows);

    expect(keyed).toHaveLength(2);
    expect(keyed[0]).toMatchObject({
      v: 1,
      rev: 1,
      date: '2026-03-06',
      amount: -1500,
      description: 'Addebito  SDD Gas',
      dispCode: 'D-7',
      statementHash: 'statement-1',
    });
    expect(keyed[1]).toMatchObject({ date: '2026-03-05', amount: -6300 });
    for (const record of keyed) {
      expect(record.id).toMatch(HEX_64);
      expect(BankTransactionSchema.parse(JSON.parse(JSON.stringify(record)))).toEqual(record);
    }
  });

  it('gives an empty list for an empty list, and throws for a row that is not valid', async () => {
    expect(await keyTransactions([])).toEqual([]);
    await expect(
      keyTransactions([row('2026-03-05', -6300, 'Addebito SDD Luce', { statementHash: '' })]),
    ).rejects.toThrow(/statementHash/);
  });
});

describe('samePages', () => {
  const doc = (a: number, b: number) => ({
    pages: [a, b] as [number, number],
    documentKind: 'bill' as const,
  });
  it('compares page ranges; a record without one covers the whole file', () => {
    expect(samePages(doc(1, 2), doc(1, 2))).toBe('same');
    expect(samePages(doc(1, 2), doc(2, 3))).toBe('overlap');
    expect(samePages(doc(1, 2), doc(3, 4))).toBe('disjoint');
    expect(samePages(undefined, doc(3, 4))).toBe('overlap');
    expect(samePages(doc(3, 4), undefined)).toBe('overlap');
    expect(samePages(undefined, undefined)).toBe('same');
    // The order of the records does not matter.
    expect(samePages(doc(3, 4), doc(1, 2))).toBe('disjoint');
    expect(samePages(doc(1, 4), doc(2, 3))).toBe('overlap');
    expect(samePages(doc(2, 3), doc(1, 4))).toBe('overlap');
  });
});
