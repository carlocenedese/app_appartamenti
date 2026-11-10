/**
 * Fingerprints that tell whether a document or a bank debit is already known.
 *
 * - A bill is a file: the SHA-256 of its bytes (`hashBytes`) says whether the same file was
 *   registered before. The same bill downloaded again can have other bytes (a new PDF, a different
 *   metadata block), so `registerBill` also compares what the bill says and reports a
 *   `possible-duplicate` for a person to decide, instead of registering it or refusing it.
 * - A bank debit has no file and no number. Its `id` is a fingerprint of what the statement says
 *   (`transactionKey`), so the same debit read from two statements that overlap gets the same
 *   `id` and is written over itself instead of twice. Two identical debits on the same day are
 *   two debits: `keyTransactions` tells them apart by their order of appearance.
 *
 * SHA-256 comes from Web Crypto, which exists in Node, in the Tauri webview and on the phone.
 */
import type { ZodType } from 'zod';
import { commitChange } from './journal';
import { BankTransactionSchema, BillSchema } from './model';
import type { BankTransaction, Bill } from './model';
import type { Cents } from './money';
import type { ISODate } from './period';
import { loadAll } from './store/load';
import { recordPath } from './store/records';
import type { Store } from './store/store';

const utf8 = new TextEncoder();

/** The SHA-256 of `bytes` as 64 lowercase hexadecimal digits. Only the bytes a view covers count. */
export async function hashBytes(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Text as it is compared: NFC (the same text typed on macOS and on Windows), runs of whitespace
 * (non-breaking spaces and line breaks included) as one space, no space at either end, lowercase.
 * Statements and bills write the same name with other spaces and capitals.
 */
function foldText(text: string): string {
  return text.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** `schema.parse` with an error that names the fields at fault and leaves their values out. */
function parseOrThrow<T>(schema: ZodType<T>, value: unknown, what: string): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  const issues = parsed.error.issues
    .map((issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
  throw new Error(`Not a valid ${what} (${issues})`, { cause: parsed.error });
}

// --- Bills -----------------------------------------------------------------------------------

export type RegisterBillResult =
  | { status: 'registered'; bill: Bill }
  /** The same file is already registered, as the bill `existingId`. Nothing was written. */
  | { status: 'duplicate'; existingId: string }
  /** Another file says the same as the bill `existingId`. Nothing was written. */
  | { status: 'possible-duplicate'; existingId: string };

/** Whether two bills say the same: apartment, supplier, number, period and amount. */
function sameBill(a: Bill, b: Bill): boolean {
  return (
    a.apartmentId === b.apartmentId &&
    foldText(a.supplier) === foldText(b.supplier) &&
    a.number === b.number && // two bills without a number have the same number
    a.periodStart === b.periodStart &&
    a.periodEnd === b.periodEnd &&
    a.amount === b.amount
  );
}

/**
 * Registers a bill and the file it comes from: the record in `_app/dati/bill/` and one operation
 * (`register-bill`) in the journal, written with `commitChange`. `bill` is everything but what the
 * function fills in: `fileHash` is the hash of `bytes`, and the record starts at `v` 1 and `rev` 1.
 * `bill.id` is the id of the new record; `newId` makes the id of the operation, and `clock` its time.
 *
 * Before it writes, it looks at the bills that are not deleted. In this order:
 *
 * 1. a bill with the same `fileHash` is the same document: `duplicate`;
 * 2. a bill of the same apartment with the same supplier (NFC, spaces and capitals do not count),
 *    number (none equals none), period and amount, in other bytes, is `possible-duplicate`: the
 *    same bill downloaded again, or a bill that only looks like another one. A person decides, so
 *    nothing is registered.
 *
 * Neither writes anything: no record, no operation, and `newId` is not called. With several
 * matches, the bill with the smallest `id` is the one reported. A bill that is not valid (a
 * period that ends before it starts, an empty supplier, an unsafe `id`) throws first, whatever
 * is already registered; so does an `id` that is taken (`StaleWriteError`).
 */
export async function registerBill(
  store: Store,
  bill: Omit<Bill, 'fileHash' | 'rev' | 'v'>,
  bytes: Uint8Array,
  profileId: string,
  clock: () => string,
  newId: () => string,
): Promise<RegisterBillResult> {
  const fileHash = await hashBytes(bytes);
  const record = parseOrThrow(BillSchema, { ...bill, v: 1, rev: 1, fileHash }, 'bill');
  const path = recordPath('bill', record.id);

  // `loadAll` sorts by id, so `find` gives the smallest id among the matches.
  const { records } = await loadAll(store, 'bill', BillSchema);
  const sameFile = records.find((existing) => existing.fileHash === fileHash);
  if (sameFile !== undefined) return { status: 'duplicate', existingId: sameFile.id };
  const sameDetails = records.find((existing) => sameBill(existing, record));
  if (sameDetails !== undefined) {
    return { status: 'possible-duplicate', existingId: sameDetails.id };
  }

  await commitChange(
    store,
    {
      profileId,
      kind: 'register-bill',
      apartmentId: record.apartmentId,
      summary: `Registrata bolletta ${record.supplier} ${record.periodStart}–${record.periodEnd}`,
      changes: [{ path, before: undefined, after: record }],
    },
    clock,
    newId,
  );
  return { status: 'registered', bill: record };
}

// --- Bank debits -----------------------------------------------------------------------------

/** What makes a debit the same debit: where it is, when, how much, and what the bank wrote. */
type DebitIdentity = {
  apartmentId: string;
  date: ISODate;
  amount: Cents;
  description: string;
};

/**
 * The text a debit is told apart by. The parts go through `JSON.stringify` as strings, so a part
 * that contains a separator, a quote or a digit cannot run into the next one.
 */
function identityParts({ apartmentId, date, amount, description }: DebitIdentity): string[] {
  return [apartmentId, date, String(amount), foldText(description)];
}

/**
 * The fingerprint of a debit: the SHA-256 (lowercase hexadecimal) of its apartment, date, amount,
 * description (as `foldText` writes it: case, spaces and the way an accent is written do not
 * count) and `occurrence`, which is 0 for the first of the identical debits of a day, 1 for the
 * second, and so on. It is used as the `id` of the `BankTransaction`, so it is made of characters
 * that are safe in a file name. `occurrence` must be a non-negative integer (`RangeError`).
 */
export async function transactionKey(t: DebitIdentity, occurrence: number): Promise<string> {
  if (!Number.isSafeInteger(occurrence) || occurrence < 0) {
    throw new RangeError(
      `Not an occurrence number: ${String(occurrence)} (expected a non-negative integer)`,
    );
  }
  const text = JSON.stringify([...identityParts(t), String(occurrence)]);
  return hashBytes(utf8.encode(text));
}

/**
 * Turns the rows of a statement into records whose `id` is the fingerprint of the debit, in the
 * order of the rows. Each row gets its `occurrence` among the rows that are the same debit (same
 * apartment, date, amount and description in the sense of `transactionKey`), in order of
 * appearance: the first is 0. Records are `v` 1 and `rev` 1, and come back validated with
 * `BankTransactionSchema` (a row that is not valid throws, naming the fields at fault).
 *
 * The same list keyed twice, or two lists that overlap, give the same `id` to the same debit, as
 * long as each list has all the identical debits of the days it covers: a list that stops in the
 * middle of a day would count from 0 again after the cut.
 */
export async function keyTransactions(
  rows: Omit<BankTransaction, 'id' | 'v' | 'rev' | 'deleted'>[],
): Promise<BankTransaction[]> {
  const seen = new Map<string, number>();
  const numbered = rows.map((row) => {
    const identical = JSON.stringify(identityParts(row));
    const occurrence = seen.get(identical) ?? 0;
    seen.set(identical, occurrence + 1);
    return { row, occurrence };
  });
  return Promise.all(
    numbered.map(async ({ row, occurrence }, index) => {
      const id = await transactionKey(row, occurrence);
      return parseOrThrow(
        BankTransactionSchema,
        { ...row, id, v: 1, rev: 1 },
        `bank transaction (row ${String(index + 1)})`,
      );
    }),
  );
}
