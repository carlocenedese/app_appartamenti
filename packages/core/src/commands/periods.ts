// Settlement periods, supplies, condominium instalments and settings (plan 24, R386):
// `chiudi-periodo`, `conguaglio-supplementare`, `invia-conguaglio`, `conguaglio-saldato`,
// `riapri-periodo`, `forfait-verificato`, `canone-non-incassato`, `utenza`, `rata-condominio`,
// `impostazioni`.
import { saveCondoInstalment } from '../condo-store';
import { ISODateSchema } from '../model';
import type { CloseMissing } from '../conguaglio';
import { formatEuro } from '../money';
import type { Cents } from '../money';
import {
  closePeriod,
  loadPeriodClosing,
  markFlatChecked,
  markPeriodSent,
  markRentMissing,
  markTenantSettled,
  reopenPeriod,
} from '../period-close';
import { loadSettings, saveSettings } from '../settings-store';
import type { Store } from '../store/store';
import { saveSupply } from '../supply-store';
import { COMMAND_MESSAGES as MESSAGES } from './messages';
import { CommandStop as Stop } from './stop';
import type { CommandContext } from './stop';
import { optional } from './util';

type PeriodQuery = { apartmentId: string; periodLabel: string };

/**
 * `chiudi-periodo` (I2, R5): the closing of a settlement period with its snapshot. Ids, months and
 * codes; amounts only with `details`.
 */
export async function closePeriodCommand(
  store: Store,
  query: PeriodQuery,
  ctx: CommandContext,
  options: { details: boolean },
) {
  const details = options.details;
  const result = await closePeriod(store, query, ctx.who, ctx.clock, ctx.newId);
  if (result.status === 'refused') {
    throw new Stop(
      'rejected',
      result.reason,
      result.reason === 'tari-december-missing'
        ? { month: result.month }
        : result.reason === 'cannot-close'
          ? {
              missing: result.missing.map((x) => {
                // An item has no amount: `amount` is undefined there.
                const { amount, ...m } = x as CloseMissing & { amount?: Cents };
                return details && amount !== undefined ? { ...m, amount } : m;
              }),
            }
          : result.reason === 'settlement-error'
            ? { code: result.code, message: MESSAGES['period-settlement-error'] }
            : result.reason === 'ambiguous-period'
              ? { message: MESSAGES['ambiguous-period-label'] }
              : {},
    );
  }
  // Plan 22: the rent not collected of a reopened period closed again, as a warning.
  if (result.rentMissing === undefined) return result;
  return {
    ...result,
    rentMissing: result.rentMissing.map(({ amount, ...m }) => (details ? { ...m, amount } : m)),
    warning: MESSAGES['rent-missing'],
  };
}

/**
 * `conguaglio-supplementare`: the closing of a period and the supplementary settlement of what
 * changed since. Ids, months and codes; amounts only with `details`.
 */
export async function periodClosingCommand(
  store: Store,
  query: PeriodQuery,
  ctx: CommandContext,
  options: { details: boolean },
) {
  const details = options.details;
  const result = await loadPeriodClosing(
    store,
    query,
    ISODateSchema.parse(ctx.clock().slice(0, 10)),
  );
  if (result.status === 'refused') {
    const message =
      result.reason === 'ambiguous-period'
        ? 'ambiguous-period-label'
        : result.reason === 'settlement-error'
          ? 'period-settlement-error'
          : result.reason;
    throw new Stop('rejected', result.reason, {
      ...optional('code', 'code' in result ? result.code : undefined),
      message: MESSAGES[message],
    });
  }
  if (result.status === 'open') return { status: 'open' };
  const settledIds = new Set(result.settled.map((s) => s.tenantId));
  return {
    status: result.status,
    // F1, F3: the step of the closing.
    state: result.state,
    closedAt: result.closedAt,
    ...optional('sentOn', result.sentOn),
    ...(result.reopened === undefined ? {} : { reopenedOn: result.reopened.on }),
    changed: result.changed,
    dataChanged: result.dataChanged,
    tenants: result.tenants.map(
      ({
        delta,
        forfaitDelta,
        total,
        remaining,
        mainRemaining,
        forfaitPaid,
        toCheck,
        rentMissing,
        rentAsked,
        rentLost,
        flatCredit,
        ...t
      }) => ({
        ...t,
        settled: settledIds.has(t.tenantId),
        // Plan 22: the row «Canone non incassato» (amount only with --dettagli).
        ...(rentMissing === 0 ? {} : { rentMissing: details ? rentMissing : true }),
        ...(details && rentAsked !== 0 ? { rentAsked } : {}),
        ...(details && rentLost !== 0 ? { rentLost } : {}),
        // F11: the flat charge no longer collected is a line of its own; fourth round A, B: the
        // supplementary computed once (`total`) and the flat charge «da verificare» (`toCheck`).
        ...(details
          ? {
              delta,
              forfaitDelta,
              total,
              remaining,
              mainRemaining,
              forfaitPaid,
              toCheck,
              // Plan 22: the flat charge checked as a credit, still to check.
              flatCredit,
            }
          : {}),
      }),
    ),
    ...(result.toCheck ? { toCheck: true, warning: MESSAGES['forfait-to-check'] } : {}),
    ...(details ? { unassignedDelta: result.unassignedDelta } : {}),
  };
}

/** The refusals of the marks on a closing, with the message of their reason. */
function refuseMark(result: { reason: string }, messages: Record<string, string>): never {
  const message = messages[result.reason];
  throw new Stop(
    'rejected',
    result.reason,
    message === undefined ? {} : { message: MESSAGES[message] },
  );
}

const SETTLE_MESSAGES: Record<string, string> = {
  'unknown-tenant': 'unknown-tenant-in-close',
  'unknown-movement': 'unknown-movement-in-close',
  'no-supplementary': 'no-supplementary',
  'invalid-input': 'invalid-close-input',
};

/** F1, F3: `invia-conguaglio`, `conguaglio-saldato`, `riapri-periodo` (refusals and result). */
function settleOutcome<R extends { status: string }>(result: R): R {
  const refused = result as unknown as { status: string; reason: string; amount?: Cents };
  if (refused.status === 'refused' && refused.reason === 'use-supplementary') {
    // The main is already settled and a supplementary is left: the amount, in euro.
    const amount = formatEuro(Math.abs(refused.amount ?? 0) as Cents);
    throw new Stop('rejected', refused.reason, {
      message:
        (refused.amount ?? 0) < 0
          ? `Il conguaglio di questa chiusura è già segnato saldato; resta un conguaglio supplementare a favore dell’inquilino di ${amount}: usa --supplementare.`
          : `Il conguaglio di questa chiusura è già segnato saldato; resta un conguaglio supplementare di ${amount}: usa --supplementare.`,
    });
  }
  if (refused.status === 'refused') refuseMark(refused, SETTLE_MESSAGES);
  return result;
}

/** `invia-conguaglio`. */
export async function markPeriodSentCommand(
  store: Store,
  input: Parameters<typeof markPeriodSent>[1],
  ctx: CommandContext,
) {
  return settleOutcome(await markPeriodSent(store, input, ctx.who, ctx.clock, ctx.newId));
}

/** `conguaglio-saldato`. */
export async function markTenantSettledCommand(
  store: Store,
  input: Parameters<typeof markTenantSettled>[1],
  ctx: CommandContext,
) {
  return settleOutcome(await markTenantSettled(store, input, ctx.who, ctx.clock, ctx.newId));
}

/** `riapri-periodo`. */
export async function reopenPeriodCommand(
  store: Store,
  input: Parameters<typeof reopenPeriod>[1],
  ctx: CommandContext,
) {
  return settleOutcome(await reopenPeriod(store, input, ctx.who, ctx.clock, ctx.newId));
}

const MARK_MESSAGES: Record<string, string> = {
  'unknown-tenant': 'unknown-tenant-in-close',
  'unknown-movement': 'unknown-movement-in-close',
  'nothing-to-check': 'nothing-to-check',
  'nothing-to-mark': 'nothing-to-mark',
  'invalid-input': 'invalid-close-input',
};

/**
 * Plan 22 (decision 3 and answer 2 of user1, 19 Nov 2026): `forfait-verificato`, the flat charge
 * «da verificare» checked by user1 with its outcome. Ids only in the output.
 */
export async function markFlatCheckedCommand(
  store: Store,
  input: Parameters<typeof markFlatChecked>[1],
  ctx: CommandContext,
) {
  const result = await markFlatChecked(store, input, ctx.who, ctx.clock, ctx.newId);
  if (result.status === 'refused') refuseMark(result, MARK_MESSAGES);
  return result;
}

/** Plan 22: `canone-non-incassato`, the rent not collected marked with its outcome. */
export async function markRentMissingCommand(
  store: Store,
  input: Parameters<typeof markRentMissing>[1],
  ctx: CommandContext,
) {
  const result = await markRentMissing(store, input, ctx.who, ctx.clock, ctx.newId);
  if (result.status === 'refused') refuseMark(result, MARK_MESSAGES);
  return result;
}

/**
 * `utenza` (E5): a supply of a shared notice and the apartments it belongs to; undone with
 * annulla-riconciliazione. Ids only in the output.
 */
export async function saveSupplyCommand(
  store: Store,
  draft: Parameters<typeof saveSupply>[1],
  ctx: CommandContext,
  options: Parameters<typeof saveSupply>[5] = {},
) {
  const result = await saveSupply(store, draft, ctx.who, ctx.clock, ctx.newId, options);
  if (result.status === 'refused') {
    throw new Stop(
      'rejected',
      result.reason,
      optional('supplyId', 'supplyId' in result ? result.supplyId : undefined),
    );
  }
  return {
    status: result.status,
    supplyId: result.supplyId,
    ...optional('operationId', 'operationId' in result ? result.operationId : undefined),
  };
}

/**
 * `rata-condominio` (I3, E4): a condominium instalment of the plan of a fiscal year, as the
 * administrator's documents give it (R3). Ids and codes only in the output.
 */
export async function saveCondoInstalmentCommand(
  store: Store,
  input: Parameters<typeof saveCondoInstalment>[1],
  ctx: CommandContext,
) {
  const result = await saveCondoInstalment(store, input, ctx.who, ctx.clock, ctx.newId);
  if (result.status === 'refused') {
    throw new Stop(
      'rejected',
      result.reason,
      result.reason === 'esercizio-format'
        ? {
            documentIds: result.documentIds,
            ...(result.documentIds.length === 0
              ? { message: MESSAGES['instalment-esercizio-format'] }
              : {}),
          }
        : result.reason === 'instalment-in-use'
          ? { recordIds: result.recordIds }
          : result.reason === 'id-collision'
            ? { message: MESSAGES['instalment-id-collision'] }
            : {},
    );
  }
  return {
    status: result.status,
    instalmentId: result.instalmentId,
    ...optional('operationId', 'operationId' in result ? result.operationId : undefined),
    ...optional(
      'warnings',
      'warnings' in result
        ? result.warnings?.map((w) => ({ ...w, message: MESSAGES[w.code] }))
        : undefined,
    ),
  };
}

/**
 * `impostazioni` (I9): the workspace settings, read, or set first when `imuToleranceBp` is given
 * (`null` takes it back to the default of the code).
 */
export async function settingsCommand(
  store: Store,
  input: { imuToleranceBp?: number | null },
  ctx: CommandContext,
) {
  let written;
  if (input.imuToleranceBp !== undefined) {
    const result = await saveSettings(
      store,
      { imuToleranceBp: input.imuToleranceBp },
      ctx.who,
      ctx.clock,
      ctx.newId,
    );
    if (result.status === 'refused') throw new Stop('rejected', result.reason);
    written = result;
  }
  const settings = await loadSettings(store);
  return {
    status: written?.status ?? 'ok',
    ...optional(
      'operationId',
      written !== undefined && 'operationId' in written ? written.operationId : undefined,
    ),
    settings: {
      // Basis points (100 is 1%): no amount-like text in the output.
      imuTolerance: {
        basisPoints: settings.imuToleranceBp.value,
        isDefault: settings.imuToleranceBp.isDefault,
      },
    },
  };
}
