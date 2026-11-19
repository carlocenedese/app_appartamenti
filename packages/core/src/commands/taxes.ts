// IMU, taxes and payables (plan 24, R386): `imu-atteso`, `imu-f24`, `imu`, `tasse-stima`,
// `tasse-copia`, `tasse-assegna`, `tasse-conferma`, `tasse`, `scadenze`, `scadenza-nuova`,
// `scadenza-ripeti`, `scadenza-pagata`.
import { loadRentYears } from '../contract-store';
import { loadImuRates } from '../imu';
import { assignImuF24, setImuYear } from '../imu-store';
import { loadScadenzario } from '../payables';
import { repeatPayable, savePayable, setPayablePaid } from '../payable-store';
import type { Store } from '../store/store';
import {
  assignTaxPayment,
  confirmTaxDiscrepancy,
  copyPreviousTaxYear,
  loadTaxTable,
  setTaxEstimate,
} from '../tax-store';
import { COMMAND_MESSAGES as MESSAGES } from './messages';
import { CommandStop as Stop } from './stop';
import type { CommandContext } from './stop';
import { optional } from './util';

/** `imu-atteso`. */
export async function setImuYearCommand(
  store: Store,
  input: Parameters<typeof setImuYear>[1],
  ctx: CommandContext,
) {
  const result = await setImuYear(store, input, ctx.who, ctx.clock, ctx.newId);
  if (result.status === 'refused' && result.reason === 'has-dependents') {
    throw new Stop('rejected', result.reason, {
      message: MESSAGES['imu-has-assignments'],
      recordIds: result.recordIds,
    });
  }
  if (result.status === 'refused') throw new Stop('rejected', result.reason);
  return {
    status: result.status,
    imuYearId: result.imuYearId,
    ...(result.status === 'saved' ? { operationId: result.operationId } : {}),
  };
}

/** `imu-f24`. */
export async function assignImuF24Command(
  store: Store,
  input: Parameters<typeof assignImuF24>[1],
  ctx: CommandContext,
) {
  const result = await assignImuF24(store, input, ctx.who, ctx.clock, ctx.newId);
  if (result.status === 'refused') throw new Stop('rejected', result.reason);
  if (result.status === 'unchanged') return { status: 'unchanged', classId: result.classId };
  return {
    status: 'assigned',
    operationId: result.operationId,
    classId: result.classId,
    ...(result.ruleId === undefined ? {} : { ruleId: result.ruleId }),
  };
}

/** `imu`: group, year, index and state; amounts, dates and the movement with `details` (R107). */
export async function imuRatesCommand(
  store: Store,
  input: Parameters<typeof loadImuRates>[1],
  options: { details: boolean },
) {
  const result = await loadImuRates(store, input);
  if (result.status === 'refused') throw new Stop('rejected', result.reason);
  const rates = result.rates.map((r) => ({
    f24Group: r.f24Group,
    year: r.year,
    rateIndex: r.rateIndex,
    status: r.status,
    f24: r.transactionId === undefined ? 0 : 1,
    ...(r.status === 'da-riconciliare' ? { message: MESSAGES['imu-to-reconcile'] } : {}),
    ...(options.details
      ? {
          expected: r.expected,
          paid: r.paid,
          difference:
            r.paid === undefined || r.expected === undefined ? undefined : r.paid - r.expected,
          dueDate: r.dueDate,
          transactionId: r.transactionId,
          annual: r.annual,
        }
      : {}),
  }));
  return {
    status: 'ok',
    rates,
    toReconcile: rates.filter((r) => r.status === 'da-riconciliare').length,
  };
}

/** `tasse-stima`. */
export async function setTaxEstimateCommand(
  store: Store,
  input: Parameters<typeof setTaxEstimate>[1],
  ctx: CommandContext,
) {
  const result = await setTaxEstimate(store, input, ctx.who, ctx.clock, ctx.newId);
  if (result.status === 'refused') throw new Stop('rejected', result.reason);
  return {
    status: result.status,
    estimateId: result.estimateId,
    ...(result.status === 'saved' ? { operationId: result.operationId } : {}),
  };
}

/** `tasse-copia`. */
export async function copyTaxYearCommand(
  store: Store,
  input: Parameters<typeof copyPreviousTaxYear>[1],
  ctx: CommandContext,
) {
  const result = await copyPreviousTaxYear(store, input, ctx.who, ctx.clock, ctx.newId);
  if (result.status === 'refused') throw new Stop('rejected', result.reason);
  return {
    status: result.status,
    estimateIds: result.estimateIds,
    ...(result.status === 'copied' ? { operationId: result.operationId } : {}),
  };
}

/** `tasse-assegna`. */
export async function assignTaxCommand(
  store: Store,
  input: Parameters<typeof assignTaxPayment>[1],
  ctx: CommandContext,
) {
  const result = await assignTaxPayment(store, input, ctx.who, ctx.clock, ctx.newId);
  if (result.status === 'refused') throw new Stop('rejected', result.reason);
  return {
    status: result.status,
    taxPaymentId: result.taxPaymentId,
    ...(result.status === 'assigned' ? { operationId: result.operationId } : {}),
  };
}

/**
 * `tasse-conferma` (plan 17, R304): a discrepancy confirmed with a note no longer warns (undone
 * with annulla-riconciliazione). The note is not echoed: it is free text.
 */
export async function confirmTaxCommand(
  store: Store,
  input: Parameters<typeof confirmTaxDiscrepancy>[1],
  ctx: CommandContext,
) {
  const result = await confirmTaxDiscrepancy(store, input, ctx.who, ctx.clock, ctx.newId);
  if (result.status === 'refused') throw new Stop('rejected', result.reason);
  return {
    status: result.status,
    confirmationId: result.confirmationId,
    ...(result.status === 'confirmed' ? { operationId: result.operationId } : {}),
  };
}

/**
 * `tasse`: voce, state, reasons and ids only; amounts and the taxpayer (a name) with `details`
 * (R107).
 */
export async function taxTableCommand(
  store: Store,
  input: Parameters<typeof loadTaxTable>[1],
  options: { details: boolean },
) {
  const result = await loadTaxTable(store, input);
  if (result.status === 'refused') throw new Stop('rejected', result.reason);
  const details = options.details;
  return {
    status: 'ok',
    year: input.year,
    tables: result.tables.map((t) => ({
      apartmentIds: t.apartmentIds,
      ...(details ? { taxpayer: t.taxpayer } : {}),
      rows: t.rows.map((r) => ({
        voce: r.voce,
        state: r.state,
        reasons: r.reasons,
        ...(r.state === 'discrepanza' ? { message: MESSAGES['tax-discrepancy'] } : {}),
        ...(r.reasons.includes('no-expected-source')
          ? { message: MESSAGES['tax-no-payable'] }
          : {}),
        ...(details
          ? {
              estimate: r.estimate,
              paid: r.paid,
              expected: r.expected,
              difference: r.difference,
              ...(r.annualDifference === undefined ? {} : { annualDifference: r.annualDifference }),
              ...(r.cedolareProposals === undefined
                ? {}
                : {
                    cedolareProposals: r.cedolareProposals,
                    proposalMessage: MESSAGES['cedolare-estimate'],
                  }),
            }
          : {}),
      })),
    })),
    warnings: result.warnings.map((w) => ({ ...w, message: MESSAGES['tax-year-empty'] })),
  };
}

/**
 * `scadenze`: the owner's payables, filtered by state and kind. Dates, amounts, movements and names
 * only with `details` (R107), with the cedolare estimates beside the list.
 */
export async function payablesCommand(
  store: Store,
  input: Parameters<typeof loadScadenzario>[1] & { state?: string; kind?: string },
  options: { details: boolean },
) {
  const { state: stato, kind: tipo, ...query } = input;
  const result = await loadScadenzario(store, query);
  if (result.status === 'refused') throw new Stop('rejected', result.reason);
  const details = options.details;
  const years = details ? await loadRentYears(store, {}) : undefined;
  if (years?.status === 'refused') throw new Stop('rejected', years.reason);
  return {
    status: 'ok',
    items: result.items
      .filter(
        (i) =>
          (stato === undefined || i.state === stato) && (tipo === undefined || i.kind === tipo),
      )
      .map((i) => ({
        source: i.source,
        id: i.id,
        kind: i.kind,
        apartmentIds: i.apartmentIds,
        state: i.state,
        ...optional('check', i.check),
        ...optional('repeatYearly', i.repeatYearly),
        ...optional('taxYear', i.taxYear),
        ...optional('repeated', i.repeated),
        ...(details
          ? {
              taxpayers: i.taxpayers,
              ...optional('dueDate', i.dueDate),
              ...optional('expected', i.expected),
              ...optional('paidOn', i.paidOn),
              ...optional('transactionId', i.transactionId),
            }
          : {}),
      })),
    contractEnds: result.contractEnds.map((c) => ({
      contractId: c.contractId,
      apartmentId: c.apartmentId,
      ...(details ? { end: c.end } : {}),
    })),
    // The cedolare estimate is shown beside the list, never an item (plan 9, question 4).
    ...(years === undefined
      ? {}
      : {
          estimates: years.rentYears
            .filter((y) => y.cedolareExpected !== undefined)
            .map((y) => ({
              apartmentId: y.apartmentId,
              year: y.year,
              cedolareExpected: y.cedolareExpected,
              message: MESSAGES['cedolare-estimate'],
            })),
        }),
  };
}

/** `scadenza-nuova`. */
export async function savePayableCommand(
  store: Store,
  input: Parameters<typeof savePayable>[1],
  ctx: CommandContext,
) {
  const result = await savePayable(store, input, ctx.who, ctx.clock, ctx.newId);
  if (result.status === 'refused') throw new Stop('rejected', result.reason);
  // Ruling (E3): the same payable again is that payable; a second identical one needs --id.
  if (result.status === 'unchanged' && input.id === undefined) {
    return { ...result, message: MESSAGES['already-recorded'] };
  }
  return result;
}

/** `scadenza-ripeti`. */
export async function repeatPayableCommand(
  store: Store,
  input: Parameters<typeof repeatPayable>[1],
  ctx: CommandContext,
) {
  const result = await repeatPayable(store, input, ctx.who, ctx.clock, ctx.newId);
  if (result.status === 'refused') throw new Stop('rejected', result.reason);
  return result;
}

/** `scadenza-pagata`. */
export async function payablePaidCommand(
  store: Store,
  input: Parameters<typeof setPayablePaid>[1],
  ctx: CommandContext,
) {
  const result = await setPayablePaid(store, input, ctx.who, ctx.clock, ctx.newId);
  if (result.status === 'refused') throw new Stop('rejected', result.reason);
  return result;
}
