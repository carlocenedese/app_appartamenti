// Contracts, stays and deposits (plan 24, R386): `contratto`, `contratto-canone`, `affitti-anno`,
// `contratti`, `presenza`, `fine-presenza`, `subentro`, `scambio-camera`, `stato-contratti`,
// `tasso-legale`, `caparra-restituzione`.
import {
  loadContractChecks,
  loadContractStatus,
  loadRentYears,
  saveContract,
  setContractRent,
  setRentYear,
} from '../contract-store';
import { loadDepositReturn, saveLegalRate } from '../deposit';
import { formatEuro } from '../money';
import type { Store } from '../store/store';
import { endTenancy, recordRoomSwap, recordTakeover, saveTenancy } from '../tenancy-store';
import { COMMAND_MESSAGES as MESSAGES, SWAP_MESSAGES } from './messages';
import { CommandStop as Stop, invalidCommand as invalid } from './stop';
import type { CommandContext } from './stop';
import { clockMonth, optional } from './util';

/** The month of the clock: later months have no tenancies written yet. */
const monthOf = clockMonth;

/**
 * `contratto`: replaces every field of the contract (rent history aside). An id the store refuses
 * (a name reserved on Windows, a bad segment) is a bad argument.
 */
export async function saveContractCommand(
  store: Store,
  input: Parameters<typeof saveContract>[1],
  ctx: CommandContext,
) {
  let result;
  try {
    result = await saveContract(store, input, ctx.who, ctx.clock, ctx.newId);
  } catch (error) {
    if (error instanceof RangeError) throw invalid('bad-arguments');
    throw error;
  }
  if (result.status === 'refused') throw new Stop('rejected', result.reason);
  return {
    status: result.status,
    contractId: result.contractId,
    ...(result.status === 'saved' ? { operationId: result.operationId } : {}),
  };
}

/** `contratto-canone`. */
export async function setContractRentCommand(
  store: Store,
  input: Parameters<typeof setContractRent>[1],
  ctx: CommandContext,
) {
  const result = await setContractRent(store, input, ctx.who, ctx.clock, ctx.newId);
  if (result.status === 'refused') throw new Stop('rejected', result.reason);
  return {
    status: result.status,
    contractId: result.contractId,
    ...(result.status === 'saved' ? { operationId: result.operationId } : {}),
  };
}

/** `affitti-anno`. */
export async function setRentYearCommand(
  store: Store,
  input: Parameters<typeof setRentYear>[1],
  ctx: CommandContext,
) {
  const result = await setRentYear(store, input, ctx.who, ctx.clock, ctx.newId);
  if (result.status === 'refused') throw new Stop('rejected', result.reason);
  return {
    status: result.status,
    rentYearId: result.rentYearId,
    ...(result.status === 'saved' ? { operationId: result.operationId } : {}),
  };
}

/**
 * `contratti`: codes, ids and months only; amounts, codes, dates and linked ids with `details`
 * (R107).
 */
export async function contractsCommand(
  store: Store,
  input: { apartmentId?: string },
  ctx: CommandContext,
  options: { details: boolean },
) {
  const result = await loadContractChecks(store, {
    asOf: monthOf(ctx.clock),
    ...optional('apartmentId', input.apartmentId),
  });
  if (result.status === 'refused') throw new Stop('rejected', result.reason);
  const years = await loadRentYears(store, optional('apartmentId', input.apartmentId));
  if (years.status === 'refused') throw new Stop('rejected', years.reason);
  const details = options.details;
  return {
    status: 'ok',
    contracts: result.contracts.map((c) => ({
      id: c.id,
      apartmentId: c.apartmentId,
      type: c.type,
      start: c.start,
      end: c.end,
      settlement: c.settlement,
      agreedRent: c.agreedRent,
      forStudents: c.forStudents,
      taxRegime: c.taxRegime,
      tenancies: c.tenancyIds?.length ?? 0,
      deposits: c.depositPaymentIds?.length ?? 0,
      rentEntries: c.rent?.length ?? 0,
      ...(details
        ? {
            durationMonths: c.durationMonths,
            signedOn: c.signedOn,
            registration: c.registration,
            cedolareRateBp: c.cedolareRateBp,
            rent: c.rent,
            tenancyIds: c.tenancyIds,
            depositPaymentIds: c.depositPaymentIds,
          }
        : {}),
    })),
    checks: result.checks.map((c) => ({
      code: c.code,
      contractId: c.contractId,
      otherContractId: c.otherContractId,
      from: c.from,
      to: c.to,
      ...(['rent-differs', 'contract-overlap'].includes(c.code)
        ? { message: MESSAGES[c.code] }
        : {}),
      ...(details
        ? {
            tenancyId: c.tenancyId,
            paymentId: c.paymentId,
            expected: c.expected,
            actual: c.actual,
          }
        : {}),
    })),
    // The rents of the year and the estimate are amounts: only with --dettagli (R107, R182).
    rentYears: years.rentYears.map((y) => ({
      apartmentId: y.apartmentId,
      year: y.year,
      ...(details
        ? {
            totalRent: y.totalRent,
            cedolareRateBp: y.cedolareRateBp,
            cedolareExpected: y.cedolareExpected,
            ...(y.cedolareExpected === undefined ? {} : { message: MESSAGES['cedolare-estimate'] }),
          }
        : {}),
    })),
  };
}

type TenancyResult =
  | Awaited<ReturnType<typeof saveTenancy>>
  | Awaited<ReturnType<typeof endTenancy>>
  | Awaited<ReturnType<typeof recordTakeover>>;

/** A write of a stay: an id the store refuses (a name reserved on Windows) is a bad argument. */
async function tenancyWrite(write: () => Promise<TenancyResult>) {
  let result;
  try {
    result = await write();
  } catch (error) {
    if (error instanceof RangeError) throw invalid('bad-arguments');
    throw error;
  }
  if (result.status === 'refused') {
    const refused = result as {
      reason: string;
      code?: string;
      month?: string;
      recordIds?: string[];
    };
    throw new Stop('rejected', refused.reason, {
      ...optional('code', refused.code),
      ...optional('month', refused.month),
      // Review of 18 Nov 2026 (U4): the payments, recoveries and contracts on the stay (ids).
      ...optional('recordIds', refused.recordIds),
    });
  }
  return {
    status: result.status,
    tenancyId: result.tenancyId,
    ...(result.status === 'saved' ? { operationId: result.operationId } : {}),
  };
}

/** `presenza`. */
export async function saveTenancyCommand(
  store: Store,
  input: Parameters<typeof saveTenancy>[1],
  ctx: CommandContext,
) {
  return tenancyWrite(() => saveTenancy(store, input, ctx.who, ctx.clock, ctx.newId));
}

/** `fine-presenza`. */
export async function endTenancyCommand(
  store: Store,
  input: Parameters<typeof endTenancy>[1],
  ctx: CommandContext,
) {
  return tenancyWrite(() => endTenancy(store, input, ctx.who, ctx.clock, ctx.newId));
}

/** `subentro`. */
export async function takeoverCommand(
  store: Store,
  input: Parameters<typeof recordTakeover>[1],
  ctx: CommandContext,
) {
  return tenancyWrite(() => recordTakeover(store, input, ctx.who, ctx.clock, ctx.newId));
}

/** `scambio-camera` (plan 18): only tenancy ids and codes in the output. */
export async function roomSwapCommand(
  store: Store,
  input: Parameters<typeof recordRoomSwap>[1],
  ctx: CommandContext,
) {
  let result;
  try {
    result = await recordRoomSwap(store, input, ctx.who, ctx.clock, ctx.newId);
  } catch (error) {
    // An id the store refuses (a name reserved on Windows) is a bad argument.
    if (error instanceof RangeError) throw invalid('bad-arguments');
    throw error;
  }
  if (result.status === 'refused') {
    const refused = result as { reason: string; part?: string; code?: string; month?: string };
    throw new Stop('rejected', refused.reason, {
      ...optional('message', SWAP_MESSAGES[refused.reason]),
      ...optional('part', refused.part),
      ...optional('code', refused.code),
      ...optional('month', refused.month),
    });
  }
  return {
    status: result.status,
    tenancyIds: result.tenancyIds,
    ...(result.status === 'saved' ? { operationId: result.operationId } : {}),
    ...(result.warnings === undefined
      ? {}
      : {
          warnings: result.warnings,
          message: result.warnings.map((w) => MESSAGES[w]).join(' '),
        }),
  };
}

/**
 * `stato-contratti`: counts and codes only; tenancies, tenants, months and amounts with `details`
 * (R107).
 */
export async function contractStatusCommand(
  store: Store,
  input: { apartmentId?: string },
  ctx: CommandContext,
  options: { details: boolean },
) {
  const result = await loadContractStatus(store, {
    asOf: monthOf(ctx.clock),
    ...optional('apartmentId', input.apartmentId),
  });
  if (result.status === 'refused') throw new Stop('rejected', result.reason);
  const details = options.details;
  const count = (list: string[], keys: string[]) =>
    Object.fromEntries(keys.map((k) => [k, list.filter((x) => x === k).length]));
  return {
    status: 'ok',
    contracts: result.contracts.map(({ contract, tenancies, deposits, checks }) => ({
      contractId: contract.id,
      apartmentId: contract.apartmentId,
      tenancies: count(
        tenancies.map((t) => t.state),
        ['futura', 'in-corso', 'uscita'],
      ),
      takeovers: contract.takeovers?.length ?? 0,
      deposits: count(
        deposits.map((d) => d.status),
        ['versata', 'diversa', 'mancante', 'non-impostata'],
      ),
      ...(deposits.some((d) => d.status === 'diversa' || d.status === 'mancante')
        ? { message: MESSAGES['deposit-check'] }
        : {}),
      checks: checks.map((c) => c.code),
      ...(details
        ? {
            tenancyList: tenancies.map(({ tenancy: t, state }) => ({
              tenancyId: t.id,
              tenantId: t.tenantId,
              room: t.room,
              from: t.from,
              to: t.to,
              state,
              monthlyRent: t.monthlyRent,
              monthlyForfait: t.monthlyForfait,
              expectedDeposit: t.expectedDeposit,
            })),
            takeoverList: contract.takeovers,
            depositList: deposits,
          }
        : {}),
    })),
  };
}

/** `tasso-legale` (plan 17, R301): the legal rate of a year, typed by user1. */
export async function saveLegalRateCommand(
  store: Store,
  input: Parameters<typeof saveLegalRate>[1],
  ctx: CommandContext,
) {
  const result = await saveLegalRate(store, input, ctx.who, ctx.clock, ctx.newId);
  if (result.status === 'refused') throw new Stop('rejected', result.reason);
  return {
    status: result.status,
    rateId: result.rateId,
    ...(result.status === 'saved' ? { operationId: result.operationId } : {}),
  };
}

/**
 * `caparra-restituzione` (plan 17, R302): the return statement of a deposit, read only. Every line
 * is an amount: only with `details` (R107).
 */
export async function depositReturnCommand(
  store: Store,
  input: Parameters<typeof loadDepositReturn>[1],
  options: { details: boolean },
) {
  const result = await loadDepositReturn(store, input);
  if (result.status === 'refused') {
    // F10: a deposit already returned is not changed: the lines of the closed periods are
    // «da richiedere» (labels and amounts only with --dettagli, R107).
    throw new Stop(
      'rejected',
      result.reason,
      result.reason === 'already-returned' && result.toRequest.length > 0
        ? {
            toRequest: result.toRequest.length,
            warning: MESSAGES['deposit-to-request'],
            // Finding 8: the signs of a statement (a debt is negative), in euro.
            ...(options.details
              ? {
                  toRequestLines: result.toRequest.map(({ label, amount }) => ({
                    label,
                    amount: formatEuro(amount),
                  })),
                }
              : {}),
          }
        : {},
    );
  }
  return {
    status: 'ok',
    lines: result.statement.lines.length,
    message: MESSAGES['deposit-return-draft'],
    ...(result.recoveriesWaiting > 0
      ? { recoveriesWaiting: result.recoveriesWaiting, warning: MESSAGES['recovery-waiting'] }
      : {}),
    // Answer F, fourth round A: shown apart, never in the total.
    ...(result.toCheck.length > 0
      ? {
          toCheck: result.toCheck.length,
          toCheckMessage: MESSAGES['forfait-to-check'],
          ...(options.details
            ? {
                toCheckLines: result.toCheck.map(({ label, amount }) => ({
                  label,
                  amount: formatEuro(amount),
                })),
              }
            : {}),
        }
      : {}),
    ...(options.details ? { statement: result.statement } : {}),
  };
}
