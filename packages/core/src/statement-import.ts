/**
 * Importing a bank statement (plan 3a, task 7). One import is one operation of the journal: the
 * `statement` record (its `id` is the SHA-256 of the file) and the movements it adds. Rows that
 * are not booked, and rows that may be a movement already written under other words, are not
 * written: they wait in `statement.held` until a person decides (`resolveHeld`). Nothing is ever
 * excluded without that decision. `undoImport` takes back the statement and only the movements it
 * wrote.
 */
import { hashBytes, keyTransactions } from './dedupe';
import { commitChange, dependentsOf, readJournal, undoOperation, undoTargetOf } from './journal';
import type { Operation } from './journal';
import {
  AccountSchema,
  ApartmentSchema,
  BankProfileSchema,
  BankTransactionSchema,
  StatementSchema,
} from './model';
import type { BankTransaction, Statement } from './model';
import { parseOrThrow } from './parse';
import type { ISODate } from './period';
import { readStatementTable } from './statement-read';
import type { StatementTable } from './statement-table';
import { statementFilePath } from './accounts';
import { loadAll } from './store/load';
import { recordPath } from './store/records';
import type { Store } from './store/store';

export type ImportResult =
  | {
      status: 'imported';
      statement: Statement;
      added: number;
      alreadyKnown: number;
      held: number;
      operationId: string;
    }
  | { status: 'already-imported'; statementId: string }
  | {
      status: 'rejected';
      reason:
        | 'unknown-account'
        | 'wrong-profile'
        | 'wrong-account'
        | 'bad-declared-account'
        | 'masked-account'
        | 'needs-period'
        | 'period-mismatch'
        | 'row-outside-period';
      row?: number;
    };

const TRANSACTION_DIR = recordPath('transaction', 'x').slice(0, -'x.json'.length);

/** Constant text: no name, IBAN, description or amount ever goes into the journal. */
function importSummary(added: number, held: number): string {
  const nuovi = added === 1 ? 'movimento nuovo' : 'movimenti nuovi';
  return `Importato un estratto conto: ${String(added)} ${nuovi}, ${String(held)} da rivedere.`;
}

/**
 * Imports `fileBytes`, read as `table`, into the account `accountId`. The period is the one the
 * file declares, or else `period` (given by the user): never the dates of the rows. Checks, in
 * order: the account and its bank profile (`bankProfileId`, when given, must be the account's),
 * the same file already imported (on any account), what the file says about the account (must be
 * part of the IBAN), the period, and every row inside the period. A rejection writes nothing.
 * Errors of `readStatementTable` are thrown.
 */
/** Shortest declared account number that is compared with the IBAN (`includes`). */
const MIN_DECLARED_ACCOUNT = 6;

export async function importStatement(
  store: Store,
  input: {
    accountId: string;
    fileBytes: Uint8Array;
    fileName: string;
    table: StatementTable;
    period?: { from: ISODate; to: ISODate };
    bankProfileId?: string;
  },
  profileId: string,
  clock: () => string,
  newId: () => string,
): Promise<ImportResult> {
  const account = (await loadAll(store, 'account', AccountSchema)).records.find(
    (a) => a.id === input.accountId,
  );
  const apartment = (await loadAll(store, 'apartment', ApartmentSchema)).records.find(
    (a) => a.id === account?.apartmentId,
  );
  if (account === undefined || apartment === undefined) {
    return { status: 'rejected', reason: 'unknown-account' };
  }
  const bankProfile = (await loadAll(store, 'bankProfile', BankProfileSchema)).records.find(
    (p) => p.id === account.bankProfileId,
  );
  if (
    bankProfile === undefined ||
    (input.bankProfileId !== undefined && input.bankProfileId !== bankProfile.id)
  ) {
    return { status: 'rejected', reason: 'wrong-profile' };
  }

  const statementHash = await hashBytes(input.fileBytes);
  const statements = await loadAll(store, 'statement', StatementSchema, { includeDeleted: true });
  const known = statements.records.find((s) => s.id === statementHash);
  if (known !== undefined && known.deleted !== true) {
    return { status: 'already-imported', statementId: known.id };
  }

  const read = readStatementTable(input.table, bankProfile);
  const dec = read.declaredAccount;
  // A masked number cannot be compared; an empty or short capture (`IT60`) would be contained in
  // almost any IBAN (R106, R108).
  if (dec !== undefined && /[*•#]/.test(dec)) {
    return { status: 'rejected', reason: 'masked-account' };
  }
  if (dec !== undefined && dec.length < MIN_DECLARED_ACCOUNT) {
    return { status: 'rejected', reason: 'bad-declared-account' };
  }
  if (dec !== undefined && (account.iban === undefined || !account.iban.includes(dec))) {
    return { status: 'rejected', reason: 'wrong-account' };
  }
  const declared = read.declaredPeriod;
  if (
    declared !== undefined &&
    input.period !== undefined &&
    (declared.from !== input.period.from || declared.to !== input.period.to)
  ) {
    return { status: 'rejected', reason: 'period-mismatch' };
  }
  const period = declared ?? input.period;
  if (period === undefined) return { status: 'rejected', reason: 'needs-period' };
  const outside = read.rows.find((r) => r.date < period.from || r.date > period.to);
  if (outside !== undefined) {
    return { status: 'rejected', reason: 'row-outside-period', row: outside.row };
  }

  // Every row is keyed, held ones too, so the occurrence of identical rows follows the file.
  const keyed = await keyTransactions(
    read.rows.map((r) => ({
      apartmentId: apartment.id,
      accountId: account.id,
      date: r.date,
      amount: r.amount,
      description: r.description,
      statementHash,
      ...(r.dispCode === undefined ? {} : { dispCode: r.dispCode }),
      ...(r.counterparty === undefined ? {} : { counterparty: r.counterparty }),
      ...(r.booked ? {} : { booked: false }),
    })),
  );

  const transactions = await loadAll(store, 'transaction', BankTransactionSchema, {
    includeDeleted: true,
  });
  const stored = new Map(transactions.records.map((t) => [t.id, t]));
  const fileIds = new Set(keyed.map((t) => t.id));
  // A day is covered when a statement of this account has it inside its period.
  const covered = (date: ISODate): boolean =>
    statements.records.some(
      (s) => s.deleted !== true && s.accountId === account.id && s.from <= date && date <= s.to,
    );
  // The movements that a row of this file already accounts for cannot be the twin of another row.
  const candidates = transactions.records.filter(
    (t) => t.deleted !== true && t.accountId === account.id && !fileIds.has(t.id),
  );

  const written: BankTransaction[] = [];
  const held: Statement['held'] = [];
  const transactionIds: string[] = [];
  let alreadyKnown = 0;
  keyed.forEach((t, i) => {
    const row = read.rows[i]?.row ?? i + 1;
    const existing = stored.get(t.id);
    if (existing !== undefined && existing.deleted !== true) {
      alreadyKnown += 1;
      transactionIds.push(t.id);
    } else if (t.booked === false) {
      held.push({ row, reason: 'pending', transaction: t });
    } else if (
      covered(t.date) &&
      candidates.some((c) => c.date === t.date && c.amount === t.amount)
    ) {
      held.push({ row, reason: 'possible-duplicate', transaction: t });
    } else {
      written.push(t);
      transactionIds.push(t.id);
    }
  });

  const statement = parseOrThrow(
    StatementSchema,
    {
      id: statementHash,
      v: 1,
      rev: 1,
      accountId: account.id,
      bankProfileId: bankProfile.id,
      fileName: input.fileName,
      suggestedPath: statementFilePath({
        apartment,
        to: period.to,
        bank: bankProfile.bank,
        ext: bankProfile.container,
      }),
      from: period.from,
      to: period.to,
      periodSource: declared === undefined ? 'manual' : 'file',
      rowCount: read.rows.length,
      transactionIds,
      held,
    },
    'statement',
  );

  const operation = await commitChange(
    store,
    {
      profileId,
      kind: 'statement.import',
      apartmentId: apartment.id,
      summary: importSummary(written.length, held.length),
      changes: [
        // The statement goes last: an interruption leaves movements without it, and repeating
        // the import finds them already known and completes it.
        ...written.map((t) => ({
          path: recordPath('transaction', t.id),
          before: stored.get(t.id),
          after: t,
        })),
        { path: recordPath('statement', statement.id), before: known, after: statement },
      ],
    },
    clock,
    newId,
  );
  return {
    status: 'imported',
    statement: parseOrThrow(StatementSchema, operation.changes.at(-1)?.after, 'statement'),
    added: written.length,
    alreadyKnown,
    held: held.length,
    operationId: operation.id,
  };
}

/**
 * The decision of a person on a held row (`row` is the row of the file). `keep` writes the
 * movement; `exclude` writes none. Either way the decision is recorded in the statement, in one
 * operation. A row that is not held, or already decided, throws `RangeError`.
 */
export async function resolveHeld(
  store: Store,
  statementId: string,
  row: number,
  decision: 'keep' | 'exclude',
  profileId: string,
  clock: () => string,
  newId: () => string,
): Promise<Operation> {
  const statement = (await loadAll(store, 'statement', StatementSchema)).records.find(
    (s) => s.id === statementId,
  );
  if (statement === undefined) throw new RangeError('Unknown statement');
  const entry = statement.held.find((h) => h.row === row);
  if (entry === undefined) throw new RangeError(`Row ${String(row)} is not held`);
  if (entry.decision !== undefined) throw new RangeError(`Row ${String(row)} is already decided`);

  const id = entry.transaction.id;
  const existing = (
    await loadAll(store, 'transaction', BankTransactionSchema, { includeDeleted: true })
  ).records.find((t) => t.id === id);
  const write = decision === 'keep' && (existing === undefined || existing.deleted === true);
  const updated: Statement = {
    ...statement,
    held: statement.held.map((h) => (h.row === row ? { ...h, decision } : h)),
    transactionIds:
      decision === 'keep' && !statement.transactionIds.includes(id)
        ? [...statement.transactionIds, id]
        : statement.transactionIds,
  };
  const account = (await loadAll(store, 'account', AccountSchema)).records.find(
    (a) => a.id === statement.accountId,
  );
  return commitChange(
    store,
    {
      profileId,
      kind: 'statement.resolve',
      ...(account === undefined ? {} : { apartmentId: account.apartmentId }),
      summary:
        decision === 'keep' ? 'Movimento dell’estratto tenuto' : 'Movimento dell’estratto escluso',
      changes: [
        // The movement first, the decision last: repeating an interrupted keep completes it.
        ...(write
          ? [{ path: recordPath('transaction', id), before: existing, after: entry.transaction }]
          : []),
        { path: recordPath('statement', statement.id), before: statement, after: updated },
      ],
    },
    clock,
    newId,
  );
}

/**
 * Takes back an import: the statement and the movements it wrote (and the ones kept from its
 * held rows), never the movements it only found already there. Refused, writing nothing, when
 * another statement that is not deleted lists one of the movements that would be deleted.
 */
export async function undoImport(
  store: Store,
  statementId: string,
  profileId: string,
  clock: () => string,
  newId: () => string,
): Promise<
  | { status: 'undone'; operation: Operation }
  | { status: 'refused'; reason: 'shared-transactions' | 'held-duplicates' | 'later-changes' }
> {
  const path = recordPath('statement', statementId);
  const { operations } = await readJournal(store);
  const target = operations
    .filter((o) => o.kind === 'statement.import' && o.changes.some((c) => c.path === path))
    .flatMap((o) => undoTargetOf(operations, o) ?? [])
    // The first import in force: after an interrupted import and its resume, the first one alone
    // holds the movements written before the interruption; the later ones go with it.
    .at(0);
  if (target === undefined) throw new RangeError('No import of this statement to undo');

  const dependents = await dependentsOf(store, target.id);
  const decisions = dependents.filter(
    (o) =>
      o.kind === 'statement.resolve' ||
      (o.kind === 'statement.import' && o.changes.some((c) => c.path === path)),
  );
  const going = new Set(
    [target, ...decisions].flatMap((o) =>
      o.changes.filter((c) => c.path.startsWith(TRANSACTION_DIR)).map((c) => c.path),
    ),
  );
  const statements = await loadAll(store, 'statement', StatementSchema);
  const shared = statements.records.some(
    (s) =>
      s.id !== statementId &&
      s.transactionIds.some((id) => going.has(recordPath('transaction', id))),
  );
  if (shared) return { status: 'refused', reason: 'shared-transactions' };

  // A held row of another statement of the same account that looks like a movement going away
  // (waiting, or excluded) leans on it: deleting it would lose the payment.
  const account = (await loadAll(store, 'statement', StatementSchema)).records.find(
    (x) => x.id === statementId,
  )?.accountId;
  const goingTx = (await loadAll(store, 'transaction', BankTransactionSchema)).records.filter((t) =>
    going.has(recordPath('transaction', t.id)),
  );
  const twinned = statements.records.some(
    (x) =>
      x.id !== statementId &&
      x.accountId === account &&
      x.held.some(
        (h) =>
          h.reason === 'possible-duplicate' &&
          h.decision !== 'keep' &&
          goingTx.some((t) => t.date === h.transaction.date && t.amount === h.transaction.amount),
      ),
  );
  if (twinned) return { status: 'refused', reason: 'held-duplicates' };
  if (dependents.length !== decisions.length) return { status: 'refused', reason: 'later-changes' };

  // Later decisions on this statement go first; any other dependent makes `undoOperation` throw.
  const operation = await undoOperation(store, target.id, profileId, clock, newId, {
    cascade: decisions.length > 0,
  });
  return { status: 'undone', operation };
}
