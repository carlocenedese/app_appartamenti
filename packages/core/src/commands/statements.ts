// Bank profiles, accounts, statements and tenants (plan 24, R386): `profilo`, `conto`, `importa`,
// `decidi`, `annulla`, `inquilino`, `scheda-inquilino`.
import { saveAccount, saveBankProfile } from '../accounts';
import { saveTenant, saveTenantCard } from '../income-store';
import { AccountSchema, BankProfileSchema, ISODateSchema } from '../model';
import { CsvError, parseCsv } from '../statement-table';
import { importStatement, resolveHeld, undoImport } from '../statement-import';
import { StatementReadError } from '../statement-read';
import { loadAll } from '../store/load';
import type { Store } from '../store/store';
import { CommandStop, invalidCommand } from './stop';
import type { CommandContext } from './stop';
import { optional } from './util';

const Stop = CommandStop;
const invalid = invalidCommand;

/** `profilo`: the bank profile in the JSON text of a file. */
export async function saveBankProfileCommand(store: Store, json: string, ctx: CommandContext) {
  let profile;
  try {
    profile = BankProfileSchema.parse(JSON.parse(json));
  } catch {
    throw invalid('bad-profile');
  }
  const operation = await saveBankProfile(store, profile, ctx.who, ctx.clock, ctx.newId);
  if (operation === undefined) return { status: 'unchanged', id: profile.id };
  return { status: 'saved', id: profile.id, operationId: operation.id };
}

/** `conto`. */
export async function saveAccountCommand(
  store: Store,
  draft: Parameters<typeof saveAccount>[1],
  ctx: CommandContext,
) {
  const result = await saveAccount(store, draft, ctx.who, ctx.clock, ctx.newId);
  if (result.status === 'rejected') throw new Stop('rejected', result.reason);
  if (result.status === 'unchanged') return { status: 'unchanged', id: result.account.id };
  return { status: 'saved', id: result.account.id, operationId: result.operationId };
}

/** `importa`: the account and its bank profile, before the file is read. */
export async function importTargetOf(store: Store, accountId: string) {
  const account = (await loadAll(store, 'account', AccountSchema)).records.find(
    (a) => a.id === accountId,
  );
  const profile = (await loadAll(store, 'bankProfile', BankProfileSchema)).records.find(
    (p) => p.id === account?.bankProfileId,
  );
  if (account === undefined || profile === undefined) {
    throw new Stop('rejected', account === undefined ? 'unknown-account' : 'wrong-profile');
  }
  return { account, profile };
}

/** The table of a CSV statement: UTF-8 text, the core's reader. */
export function statementCsvTable(bytes: Uint8Array, separator: ',' | ';') {
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw invalid('unreadable-statement');
  }
  try {
    return parseCsv(text, separator);
  } catch (error) {
    if (error instanceof CsvError) {
      throw invalid('unreadable-statement', { code: error.code, row: error.row });
    }
    throw error;
  }
}

/** `importa`: the statement read from its file; the rows held, described with `details`. */
export async function importStatementCommand(
  store: Store,
  input: Parameters<typeof importStatement>[1],
  ctx: CommandContext,
  options: { details: boolean },
) {
  let result;
  try {
    result = await importStatement(store, input, ctx.who, ctx.clock, ctx.newId);
  } catch (error) {
    if (error instanceof StatementReadError) {
      throw invalid('unreadable-statement', {
        code: error.code,
        row: error.row,
        ...(error.column === undefined ? {} : { column: error.column }),
      });
    }
    throw error;
  }
  if (result.status === 'already-imported') {
    throw new Stop('already-imported', 'already-imported', { statementId: result.statementId });
  }
  if (result.status === 'rejected') {
    throw new Stop('rejected', result.reason, result.row === undefined ? {} : { row: result.row });
  }
  const waiting = result.statement.held.filter((h) => h.decision === undefined);
  return {
    status: 'imported',
    statementId: result.statement.id,
    added: result.added,
    alreadyKnown: result.alreadyKnown,
    held: result.held,
    heldRows: waiting.map((h) => h.row),
    ...(options.details
      ? {
          details: waiting.map((h) => ({
            row: h.row,
            date: h.transaction.date,
            amount: h.transaction.amount,
            description: h.transaction.description,
          })),
        }
      : {}),
  };
}

/** `decidi`: a held row kept or excluded. */
export async function resolveHeldCommand(
  store: Store,
  input: { statementId: string; row: number; decision: 'keep' | 'exclude' },
  ctx: CommandContext,
) {
  const { statementId, row, decision } = input;
  try {
    await resolveHeld(store, statementId, row, decision, ctx.who, ctx.clock, ctx.newId);
  } catch (error) {
    if (error instanceof RangeError) throw new Stop('rejected', 'not-decidable');
    throw error;
  }
  return { status: 'decided', statementId, row, decision };
}

/** `annulla`: the import of a statement undone. */
export async function undoImportCommand(store: Store, statementId: string, ctx: CommandContext) {
  try {
    const result = await undoImport(store, statementId, ctx.who, ctx.clock, ctx.newId);
    if (result.status === 'refused') {
      throw new Stop(
        'rejected',
        result.reason,
        result.reason === 'dependent-payments'
          ? { paymentIds: result.paymentIds }
          : result.reason === 'dependent-records'
            ? { recordIds: result.recordIds }
            : {},
      );
    }
    return { status: 'undone', statementId, operationId: result.operation.id };
  } catch (error) {
    if (error instanceof Stop) throw error;
    if (error instanceof RangeError) throw new Stop('rejected', 'no-import');
    // refuseIfDiverged (journal.ts): the folder is not as the journal leaves it (R106, N2).
    if (error instanceof Error && error.message.startsWith('Cannot undo:')) {
      throw new Stop('rejected', 'journal-not-aligned');
    }
    throw error;
  }
}

/** `inquilino`. */
export async function saveTenantCommand(
  store: Store,
  draft: Parameters<typeof saveTenant>[1],
  ctx: CommandContext,
) {
  let operation;
  try {
    operation = await saveTenant(store, draft, ctx.who, ctx.clock, ctx.newId);
  } catch (error) {
    // An id the store refuses (a name reserved on Windows, a bad segment) is a bad argument.
    if (error instanceof RangeError) throw invalid('bad-arguments');
    throw error;
  }
  if (operation === undefined) return { status: 'unchanged', id: draft.id };
  return { status: 'saved', id: draft.id, operationId: operation.id };
}

const CARD_KEYS = [
  'codice_fiscale',
  'luogo_nascita',
  'data_nascita',
  'residenza',
  'documento_numero',
  'documento_ente',
  'documento_rilascio',
  'documento_scadenza',
];

/**
 * `scheda-inquilino` (plan 17, R311): the reserved card of a tenant from the JSON text of a file
 * (never personal data as arguments, never echoed). Keys: codice_fiscale, luogo_nascita,
 * data_nascita, residenza, documento_numero, documento_ente, documento_rilascio,
 * documento_scadenza. Replaces the card.
 */
export async function saveTenantCardCommand(
  store: Store,
  input: { tenantId: string; valuesJson: string },
  ctx: CommandContext,
) {
  let given;
  try {
    given = JSON.parse(input.valuesJson) as unknown;
  } catch {
    throw invalid('bad-values');
  }
  if (
    typeof given !== 'object' ||
    given === null ||
    Array.isArray(given) ||
    Object.entries(given).some(([k, v]) => !CARD_KEYS.includes(k) || typeof v !== 'string')
  ) {
    throw invalid('bad-values');
  }
  const values = given as Partial<Record<string, string>>;
  if (
    values.documento_numero === undefined &&
    Object.keys(values).some((k) => k.startsWith('documento_'))
  ) {
    throw invalid('bad-values');
  }
  const date = (text: string) => (ISODateSchema.safeParse(text).success ? text : null);
  const card = {
    ...optional('taxCode', values.codice_fiscale),
    ...optional('birthPlace', values.luogo_nascita),
    ...optional(
      'birthDate',
      values.data_nascita === undefined ? undefined : date(values.data_nascita),
    ),
    ...optional('residence', values.residenza),
    ...(values.documento_numero === undefined
      ? {}
      : {
          idDocument: {
            number: values.documento_numero,
            ...optional('issuer', values.documento_ente),
            ...optional(
              'issuedOn',
              values.documento_rilascio === undefined ? undefined : date(values.documento_rilascio),
            ),
            ...optional(
              'expiresOn',
              values.documento_scadenza === undefined ? undefined : date(values.documento_scadenza),
            ),
          },
        }),
  };
  const result = await saveTenantCard(
    store,
    // A date that is no date is `null`: `saveTenantCard` refuses it (`invalid-card`).
    { tenantId: input.tenantId, card: card as Parameters<typeof saveTenantCard>[1]['card'] },
    ctx.who,
    ctx.clock,
    ctx.newId,
  );
  if (result.status === 'refused') throw new Stop('rejected', result.reason);
  return result;
}
