// Apartments, condominium and address book (plan 24, R386): `appartamento`,
// `condominio-documento`, `recupero`, `condominio`, `condominio-stima`, `contatto`, `contatti`.
import { saveApartment } from '../apartment-store';
import {
  loadCondo,
  loadCondoEstimate,
  saveCondoDocument,
  saveTenantRecovery,
} from '../condo-store';
import { loadContacts, saveContact } from '../contact-store';
import type { Store } from '../store/store';
import { COMMAND_MESSAGES as MESSAGES } from './messages';
import { CommandStop as Stop } from './stop';
import type { CommandContext } from './stop';
import { clockDay, optional } from './util';

/**
 * `appartamento`: creates (every field and the condominium difference, the question at creation)
 * or updates the fields given (plan 8, task 2).
 */
export async function saveApartmentCommand(
  store: Store,
  input: Parameters<typeof saveApartment>[1],
  ctx: CommandContext,
  options: { confirmed: boolean },
) {
  const result = await saveApartment(store, input, ctx.who, ctx.clock, ctx.newId, options);
  if (result.status === 'refused' && result.reason === 'rooms-in-use') {
    throw new Stop('rejected', result.reason, {
      rooms: result.rooms,
      tenancyIds: result.tenancyIds,
    });
  }
  if (result.status === 'refused' && result.reason === 'beds-conflict') {
    throw new Stop('rejected', result.reason, {
      message:
        MESSAGES[
          result.code === 'unknown-room' ? 'apartment-unknown-room' : 'apartment-beds-conflict'
        ],
      code: result.code,
      ...optional('month', result.month),
      tenancyIds: result.tenancyIds,
    });
  }
  if (result.status === 'refused') throw new Stop('rejected', result.reason);
  return {
    status: result.status,
    apartmentId: result.apartmentId,
    ...(result.status === 'unchanged' ? {} : { operationId: result.operationId }),
  };
}

/** `condominio-documento`. */
export async function saveCondoDocumentCommand(
  store: Store,
  input: Parameters<typeof saveCondoDocument>[1],
  ctx: CommandContext,
) {
  const result = await saveCondoDocument(store, input, ctx.who, ctx.clock, ctx.newId);
  if (result.status === 'refused') {
    // R310: which documents have the other form (ids only).
    throw new Stop(
      'rejected',
      result.reason,
      result.reason === 'esercizio-format' ? { documentIds: result.documentIds } : {},
    );
  }
  return {
    status: result.status,
    documentId: result.documentId,
    ...(result.status === 'saved' ? { operationId: result.operationId } : {}),
  };
}

/**
 * `recupero`: the part of an extraordinary expense to recover from tenants chosen by user1, with
 * their shares (plan 8, group B; plan 17, R300).
 */
export async function saveRecoveryCommand(
  store: Store,
  input: Parameters<typeof saveTenantRecovery>[1],
  ctx: CommandContext,
) {
  const result = await saveTenantRecovery(store, input, ctx.who, ctx.clock, ctx.newId);
  if (result.status === 'refused') throw new Stop('rejected', result.reason);
  return {
    status: result.status,
    recoveryId: result.recoveryId,
    ...(result.status === 'saved' ? { operationId: result.operationId } : {}),
  };
}

/**
 * `condominio`: the owners' check of the condominium expenses (section 12) and the differences
 * consuntivo − preventivo; amounts and dates only with `details` (R107, R194).
 */
export async function condoCommand(
  store: Store,
  input: { apartmentId?: string; esercizio?: string },
  ctx: CommandContext,
  options: { details: boolean },
) {
  const result = await loadCondo(store, {
    asOf: clockDay(ctx.clock),
    ...optional('apartmentId', input.apartmentId),
    ...optional('esercizio', input.esercizio),
  });
  if (result.status === 'refused') throw new Stop('rejected', result.reason);
  const details = options.details;
  const rates = result.rates.map((r) => ({
    instalmentId: r.instalmentId,
    apartmentId: r.apartmentId,
    esercizio: r.esercizio,
    rateIndex: r.rateIndex,
    rateCount: r.rateCount,
    straordinaria: r.straordinaria,
    status: r.status,
    ...(details
      ? { expected: r.expected, debited: r.debited, dueDate: r.dueDate, debitDates: r.debitDates }
      : {}),
  }));
  return {
    status: 'ok',
    rates,
    anomalies: rates.filter((r) =>
      ['senza-addebito', 'importo-diverso', 'duplicato'].includes(r.status),
    ).length,
    differences: result.differences.map((d) => ({
      apartmentId: d.apartmentId,
      esercizio: d.esercizio,
      to: d.to,
      conduttore: d.conduttore === undefined ? 0 : 1,
      ...(details
        ? {
            preventivo: d.preventivo,
            consuntivo: d.consuntivo,
            difference: d.difference,
            ...optional('conduttoreDetails', d.conduttore),
          }
        : {}),
    })),
    recoveries: result.recoveries.map((r) => ({
      recoveryId: r.id,
      apartmentId: r.apartmentId,
      ...optional('instalmentId', r.instalmentId),
      ...optional('transactionId', r.transactionId),
      status: r.status,
      ...optional('periodLabel', r.periodLabel),
      tenants: r.shares.length,
      ...(details ? { amount: r.amount, shares: r.shares } : {}),
    })),
    warnings: result.warnings.map((w) => ({ ...w, message: MESSAGES[w.code] })),
  };
}

/**
 * `condominio-stima` (plan 14, R250): the estimate of a fiscal year; the source always, amounts
 * only with `details`.
 */
export async function condoEstimateCommand(
  store: Store,
  input: Parameters<typeof loadCondoEstimate>[1],
  options: { details: boolean },
) {
  const result = await loadCondoEstimate(store, input);
  if (result.status === 'refused') throw new Stop('rejected', result.reason);
  const e = result.estimate;
  if (e === undefined) return { status: 'ok' };
  return {
    status: 'ok',
    estimate: {
      apartmentId: e.apartmentId,
      esercizio: e.esercizio,
      source: e.source,
      fromEsercizio: e.fromEsercizio,
      fromKind: e.fromKind,
      ...(e.source === 'copiata' ? { message: MESSAGES['condo-estimate-copied'] } : {}),
      ...(options.details
        ? { total: e.total, quotaConduttore: e.quotaConduttore, lines: e.lines }
        : {}),
    },
  };
}

/** `contatto` (plan 14, R253): every field replaced, a field left out is removed. */
export async function saveContactCommand(
  store: Store,
  input: Parameters<typeof saveContact>[1],
  ctx: CommandContext,
) {
  const result = await saveContact(store, input, ctx.who, ctx.clock, ctx.newId);
  if (result.status === 'refused') throw new Stop('rejected', result.reason);
  return {
    status: result.status,
    contactId: result.contactId,
    ...(result.status === 'saved' ? { operationId: result.operationId } : {}),
  };
}

/** `contatti`: ids, role and links; the name and the contacts only with `details` (R107). */
export async function contactsCommand(
  store: Store,
  input: Parameters<typeof loadContacts>[1],
  options: { details: boolean },
) {
  const result = await loadContacts(store, input);
  if (result.status === 'refused') throw new Stop('rejected', result.reason);
  return {
    status: 'ok',
    contacts: result.contacts.map((c) => ({
      contactId: c.id,
      role: c.role,
      apartmentIds: c.apartmentIds,
      supplyIds: c.supplyIds ?? [],
      categories: c.categories ?? [],
      ...(options.details
        ? { name: c.name, phone: c.phone, email: c.email, notes: c.notes }
        : {
            phone: c.phone === undefined ? 0 : 1,
            email: c.email === undefined ? 0 : 1,
            notes: c.notes === undefined ? 0 : 1,
          }),
    })),
  };
}
