// Bills, consumption and the Home (plan 24, R386): `bolletta`, `annulla-bolletta`, `cruscotto`,
// `consumi`, `soglie-consumi`. Reading the files and moving the PDF stay with the caller.
import { billFileMove, importBill, undoBillImport } from '../bill-import';
import { loadConsumption, saveConsumptionSettings } from '../consumption-store';
import type { ConsumptionComparison } from '../consumption';
import { loadDashboard } from '../dashboard';
import { hashBytes } from '../dedupe';
import { ExtractionResultSchema } from '../extraction';
import { ApartmentSchema, BillSchema, InstalmentSchema } from '../model';
import type { Apartment } from '../model';
import { loadAll } from '../store/load';
import type { Store } from '../store/store';
import { COMMAND_MESSAGES as MESSAGES } from './messages';
import { CommandStop as Stop, invalidCommand as invalid } from './stop';
import type { CommandContext } from './stop';
import { optional } from './util';

/** `soglie-consumi` (plan 17, R313): the thresholds of the consumption alarm, typed by user1. */
export async function saveConsumptionSettingsCommand(
  store: Store,
  input: Parameters<typeof saveConsumptionSettings>[1],
  ctx: CommandContext,
) {
  const result = await saveConsumptionSettings(store, input, ctx.who, ctx.clock, ctx.newId);
  if (result.status === 'refused') throw new Stop('rejected', result.reason);
  return result;
}

/** `consumi`: differences in basis points and levels; the sides (amounts) with `details`. */
export async function consumptionCommand(
  store: Store,
  billId: string,
  options: { details: boolean },
) {
  const result = await loadConsumption(store, billId);
  if (result.status === 'refused') throw new Stop('rejected', result.reason);
  const side = (c: ConsumptionComparison['recent']) =>
    c === undefined
      ? undefined
      : {
          differences: c.differences,
          ...(options.details ? { reference: c.reference } : {}),
        };
  return {
    status: 'ok',
    thresholds: result.thresholds,
    ...(result.thresholds ? {} : { message: MESSAGES['no-consumption-thresholds'] }),
    yearBefore: side(result.comparison.yearBefore),
    recent: side(result.comparison.recent),
    ...(options.details ? { current: result.comparison.current } : {}),
  };
}

/**
 * `bolletta`: the reading of `python -I -m bollette_pdf extract` (plan 2a), from the JSON text of
 * its file. E15: with `details`, the paths of the fields that do not fit (names, never values).
 */
export function billReadingOf(json: string, options: { details: boolean }) {
  let read;
  try {
    read = ExtractionResultSchema.safeParse(JSON.parse(json));
  } catch {
    throw invalid('bad-reading');
  }
  if (!read.success) {
    throw invalid(
      'bad-reading',
      options.details
        ? { fields: [...new Set(read.error.issues.map((i) => i.path.join('.')))].sort() }
        : {},
    );
  }
  return read.data;
}

/** E14: the PDF of a reading already registered (and moved) is a duplicate, not a missing file. */
export async function refuseRegisteredBill(store: Store, fileHash: string): Promise<void> {
  const registered = [
    ...(await loadAll(store, 'bill', BillSchema)).records,
    ...(await loadAll(store, 'instalment', InstalmentSchema)).records,
  ].find((r) => r.fileHash === fileHash);
  if (registered !== undefined) {
    throw new Stop('rejected', 'duplicate-bill', { existingId: registered.id });
  }
}

/**
 * `bolletta`: registers a bill (or leaves it «da rivedere»). Codes and ids only; the messages hold
 * amounts, months and quantities (R107). `file`, when present, is where the PDF of a whole file
 * registered as a bill goes (plan 17, R315): `billFileMove(apartment, filePath).filed`, or
 * `not-moved`; the caller moves it and adds `file` to the output.
 */
export async function importBillCommand(
  store: Store,
  input: Parameters<typeof importBill>[1],
  ctx: CommandContext,
  options: { details: boolean },
): Promise<{
  body: Record<string, unknown>;
  file?: 'not-moved' | { apartment: Apartment; filePath: string };
}> {
  const result = await importBill(store, input, ctx.who, ctx.clock, ctx.newId);
  const details = options.details;
  const checks = (list: { code: string; severity: string; message: string }[]) =>
    list.map((c) => ({
      code: c.code,
      severity: c.severity,
      ...(details ? { message: c.message } : {}),
    }));
  // The comparison as `consumi`: differences and levels; the sides (amounts) with --dettagli.
  const consumptionOf = (c: (ConsumptionComparison & { thresholds: boolean }) | undefined) => {
    if (c === undefined) return {};
    const side = (x: ConsumptionComparison['recent']) =>
      x === undefined
        ? undefined
        : { differences: x.differences, ...(details ? { reference: x.reference } : {}) };
    return {
      consumption: {
        thresholds: c.thresholds,
        ...(c.thresholds ? {} : { message: MESSAGES['no-consumption-thresholds'] }),
        yearBefore: side(c.yearBefore),
        recent: side(c.recent),
        ...(details ? { current: c.current } : {}),
      },
    };
  };
  if (result.status === 'refused') throw new Stop('rejected', result.reason);
  if (result.status === 'rejected') {
    throw new Stop('rejected', 'bill-rejected', {
      checks: checks(result.checks),
      ...(details ? { detail: result.reason } : {}),
    });
  }
  // `'existingId' in result` is the same test, for the types (`status` is a union there).
  if ('existingId' in result) {
    throw new Stop('rejected', `${result.status}-bill`, { existingId: result.existingId });
  }
  if (result.status === 'da-rivedere') {
    return {
      body: {
        status: result.status,
        pendingId: result.pendingId,
        ...optional('operationId', result.operationId),
        codes: result.codes,
        checks: checks(result.checks),
        ...consumptionOf(result.consumption),
        ...(details ? { reasons: result.reasons } : {}),
      },
    };
  }
  const bills = (await loadAll(store, 'bill', BillSchema)).records;
  const bill = bills.find((b) => result.ids.includes(b.id));
  const apartments = (await loadAll(store, 'apartment', ApartmentSchema)).records;
  const apartment = apartments.find((a) => a.id === input.apartmentId);
  const [first, last] = input.result.pageRange ?? [1, input.result.pages];
  return {
    body: {
      status: result.status,
      ids: result.ids,
      operationId: result.operationId,
      checks: checks(result.checks),
      ...consumptionOf(result.consumption),
    },
    file:
      bill !== undefined && apartment !== undefined && first === 1 && last === input.result.pages
        ? { apartment, filePath: bill.filePath }
        : 'not-moved',
  };
}

/**
 * `annulla-bolletta`: takes back what a PDF created (`pages` picks one document of a file that
 * holds several, R260). `move`, when present, is the move of the PDF back to Da_smistare once
 * nothing of it is registered (plan 17, R315): the caller does it if the file is at `from`, and
 * adds `file` to the output.
 */
export async function undoBillCommand(
  store: Store,
  input: { bytes: Uint8Array; pages?: [number, number] | null },
  ctx: CommandContext,
  options: { details: boolean },
) {
  const fileHash = await hashBytes(input.bytes);
  // Read before the undo: the bill tells where the file is and which Da_smistare it goes to.
  const filed = (await loadAll(store, 'bill', BillSchema)).records.find(
    (b) => b.fileHash === fileHash,
  );
  let result;
  try {
    result = await undoBillImport(
      store,
      fileHash,
      ctx.who,
      ctx.clock,
      ctx.newId,
      optional('pages', input.pages),
    );
  } catch (error) {
    const text = error instanceof Error ? error.message : '';
    if (text.includes('depend on it')) throw new Stop('rejected', 'has-dependents-bill');
    if (text.startsWith('Cannot undo:')) throw new Stop('rejected', 'journal-not-aligned');
    throw error;
  }
  if (result.status === 'refused') {
    if (result.reason === 'several-documents') {
      throw new Stop('rejected', 'several-documents', { documents: result.documents });
    }
    if (result.reason === 'has-dependents') {
      // Counts only: the ids are shown with --dettagli (R107).
      throw new Stop('rejected', 'has-dependents-bill', {
        dependents: result.recordIds.length,
        ...(options.details ? { recordIds: result.recordIds } : {}),
      });
    }
    throw new Stop('rejected', result.reason);
  }
  const left = (await loadAll(store, 'bill', BillSchema)).records.some(
    (b) => b.fileHash === fileHash,
  );
  const apartment =
    filed === undefined
      ? undefined
      : (await loadAll(store, 'apartment', ApartmentSchema)).records.find(
          (a) => a.id === filed.apartmentId,
        );
  let move: { from: string; to: string } | undefined;
  if (filed !== undefined && apartment !== undefined && !left) {
    const plan = billFileMove(apartment, filed.filePath);
    move = { from: plan.filed, to: plan.inbox };
  }
  return {
    body: {
      status: 'undone',
      records: result.records,
      operationIds: result.operations.map((o) => o.id),
    },
    move,
  };
}

/**
 * `cruscotto`: counts by code and apartment for the Home; the share of the empty beds is an
 * amount: only with `details` (R107).
 */
export async function dashboardCommand(
  store: Store,
  input: Parameters<typeof loadDashboard>[1],
  options: { details: boolean },
) {
  const result = await loadDashboard(store, input);
  if (result.status === 'refused') throw new Stop('rejected', result.reason);
  return {
    status: 'ok',
    apartments: result.apartments,
    settlements: result.settlements.map((r) => ({
      apartmentId: r.apartmentId,
      periodLabel: r.periodLabel,
      ...optional('problem', r.problem),
      ...optional('pending', r.pending),
      // R5: «chiuso» when the period has a live closing, else provisional.
      ...(r.problem === undefined ? { state: r.step ?? 'provvisorio' } : {}),
      ...(options.details ? optional('unassigned', r.unassigned) : {}),
    })),
  };
}
