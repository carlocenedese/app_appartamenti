// The reconciliation and its undo (plan 24, R386): `riconcilia`, `conferma`, `abbina`, `escludi`,
// `annulla-pagamento`, `uscita`, `annulla-uscita`, `uscita-inquilino`, `giroconto`,
// `giroconto-manuale`, `saldi`, `annulla-riconciliazione`, `ripara`, `scegli-versione`,
// `riferimenti`.
import { loadAccountBalances } from '../balances';
import { closeMarks } from '../closing';
import { ClosingUndoError } from '../closed-period-guard';
import { cancelAutomaticPayment, confirmIncome, confirmRentExcess } from '../income-store';
import {
  checkConsistency,
  forkVersions,
  readJournal,
  repairDiverged,
  resolveFork,
  undoOperation,
} from '../journal';
import { confirmMatch, confirmPastYear } from '../match-store';
import {
  AccountSchema,
  BankProfileSchema,
  BankTransactionSchema,
  PeriodCloseSchema,
  TenantSchema,
} from '../model';
import { excludeMovement, undoBlockedBy, undoDependents } from '../movements';
import { cancelAutomaticClass, confirmOutgoing, confirmTenantOutgoing } from '../outgoing-store';
import { runReconciliation } from '../reconcile';
import { countByType, referenceProblems } from '../references';
import { loadAll } from '../store/load';
import type { Store } from '../store/store';
import { confirmTransfer, recordManualTransfer } from '../transfer-store';
import { COMMAND_MESSAGES as MESSAGES, RECONCILE_KINDS } from './messages';
import { CommandStop as Stop } from './stop';
import type { CommandContext } from './stop';
import { optional } from './util';

/** `riconcilia` (R126): every phase; names, dates and amounts only with `details`. */
export async function reconcileCommand(
  store: Store,
  input: { dryRun: boolean },
  ctx: CommandContext,
  options: { details: boolean },
) {
  const run = await runReconciliation(store, ctx.who, ctx.clock, ctx.newId, {
    dryRun: input.dryRun,
  });
  if (run.status === 'refused') throw new Stop('rejected', run.reason);
  const { income: result, match, transfers, outgoing } = run;
  type WithTransaction = { transactionId?: string };
  let extra: (p: WithTransaction & { tenantIds: string[] }) => Record<string, unknown> = () => ({});
  let arrearExtra: (a: { tenantId: string }) => Record<string, unknown> = () => ({});
  let txExtra: (p: WithTransaction) => Record<string, unknown> = () => ({});
  if (options.details) {
    const all = { includeDeleted: true };
    const txs = (await loadAll(store, 'transaction', BankTransactionSchema, all)).records;
    const tenants = (await loadAll(store, 'tenant', TenantSchema, all)).records;
    txExtra = (p) => {
      const tx = txs.find((t) => t.id === p.transactionId);
      return {
        transactionId: p.transactionId,
        date: tx?.date,
        amount: tx?.amount,
        description: tx?.description,
      };
    };
    arrearExtra = (a) => ({
      tenantId: a.tenantId,
      tenantName: tenants.find((t) => t.id === a.tenantId)?.name ?? a.tenantId,
    });
    extra = (p) => {
      const tx = txs.find((t) => t.id === p.transactionId);
      return {
        tenantIds: p.tenantIds,
        date: tx?.date,
        amount: tx?.amount,
        description: tx?.description,
        tenantNames: p.tenantIds.map((id) => tenants.find((t) => t.id === id)?.name ?? id),
      };
    };
  }
  // No F24 is recognised while the profile of the account has no f24Pattern (R129): say so.
  const profiles = (await loadAll(store, 'bankProfile', BankProfileSchema)).records;
  const notes = (await loadAll(store, 'account', AccountSchema)).records
    .filter((a) => profiles.find((p) => p.id === a.bankProfileId)?.f24Pattern === undefined)
    .map((a) => ({
      accountId: a.id,
      f24PatternMissing: true,
      message: MESSAGES['f24-pattern-missing'],
    }));
  return {
    status: 'reconciled',
    written: result.written,
    proposals: result.proposals.map((p) => ({
      id: p.id,
      step: p.step,
      reason: p.reason,
      // Ids are chosen by the user (they could be real names): only a count without --dettagli.
      tenantCount: p.tenantIds.length,
      ...(p.month === undefined ? {} : { month: p.month }),
      ...extra(p),
    })),
    skipped: result.skipped,
    // Only id and reason: the movement id, the date and the amount stay out (R124).
    exclusions: run.exclusions.map((e) => ({
      id: e.id,
      reason: e.reason,
    })),
    // Month and apartment (its id is always shown, user1, 15 Nov 2026, R117); the tenant,
    // whose id is chosen by the user like tenantIds, only with --dettagli.
    arrears: result.arrears.map((a) => ({
      month: a.month,
      apartmentId: a.apartmentId,
      ...arrearExtra(a),
    })),
    // B5: rent paid in excess, the months it would cover and whether a credit is left to give
    // back («da rimborsare»); amounts and the tenant only with --dettagli.
    excesses: result.excesses.map((e) => ({
      id: e.id,
      apartmentId: e.apartmentId,
      month: e.month,
      months: e.targets.map((t) => t.month),
      ...(e.credit > 0 ? { refund: true } : {}),
      ...(options.details
        ? { ...arrearExtra(e), excess: e.excess, targets: e.targets, credit: e.credit }
        : {}),
    })),
    ...(result.operationId === undefined ? {} : { operationId: result.operationId }),
    // Ids, reasons and counts only (R107, R126).
    match: {
      written: match.written,
      yielded: match.yielded,
      proposals: match.proposals.map((p) => ({ id: p.id, reason: p.reason })),
      pending: match.pending.length,
      unverified: match.unverified.length,
      invalidGroups: match.invalidGroups.length,
      // E1: a shared notice registered before the fix has no paying account on its rates.
      ...(match.invalidGroups.length > 0 ? { message: MESSAGES['invalid-shared-notice'] } : {}),
      ...(match.operationId === undefined ? {} : { operationId: match.operationId }),
    },
    // Ids, reasons and counts only (R132); the movements and the legs with --dettagli.
    transfers: {
      written: transfers.written,
      completed: transfers.completed,
      proposals: transfers.proposals.map((p) => ({
        id: p.id,
        reason: p.reason,
        legCount: p.legIds.length,
        // Movement ids, as inside `p-giro-<id>`: `giroconto --gambe` gives them back (R132).
        legIds: p.legIds,
        ...txExtra(p),
      })),
      ...(transfers.operationId === undefined ? {} : { operationId: transfers.operationId }),
    },
    outgoing: {
      written: outgoing.written,
      proposals: outgoing.proposals.map((p) => ({
        id: p.id,
        step: p.step,
        reason: p.reason,
        ...(p.suggestedKind === undefined ? {} : { suggestedKind: p.suggestedKind }),
        // Group, year and index only (plan 3d, task 5): always to confirm with imu-f24.
        ...(p.imuSuggestion === undefined ? {} : { imuSuggestion: p.imuSuggestion }),
        ...txExtra(p),
      })),
      missingDocument: outgoing.missingDocument.length,
      ...(outgoing.operationId === undefined ? {} : { operationId: outgoing.operationId }),
    },
    notes,
  };
}

/** `uscita`. */
export async function confirmOutgoingCommand(
  store: Store,
  input: Parameters<typeof confirmOutgoing>[1],
  ctx: CommandContext,
) {
  const result = await confirmOutgoing(store, input, ctx.who, ctx.clock, ctx.newId);
  if (result.status === 'refused') throw new Stop('rejected', result.reason);
  return {
    status: 'confirmed',
    operationId: result.operationId,
    classId: result.classId,
    ...(result.ruleId === undefined ? {} : { ruleId: result.ruleId }),
  };
}

/** `annulla-uscita`. */
export async function cancelOutgoingCommand(
  store: Store,
  transactionId: string,
  ctx: CommandContext,
) {
  const result = await cancelAutomaticClass(store, transactionId, ctx.who, ctx.clock, ctx.newId);
  if (result.status === 'refused' && result.reason === 'not-automatic') {
    // The reason is the core's; the message is the one of a class, not of a payment.
    throw new Stop('rejected', result.reason, { message: MESSAGES['class-not-automatic'] });
  }
  if (result.status === 'refused' && result.reason === 'has-dependents') {
    // Plan 10: a tax payment on the movement.
    throw new Stop('rejected', result.reason, {
      message: MESSAGES['movement-has-dependents'],
      recordIds: result.recordIds,
    });
  }
  if (result.status === 'refused') throw new Stop('rejected', result.reason);
  return { status: 'cancelled', operationId: result.operationId };
}

/** `uscita-inquilino`. */
export async function confirmTenantOutgoingCommand(
  store: Store,
  input: Parameters<typeof confirmTenantOutgoing>[1],
  ctx: CommandContext,
) {
  const result = await confirmTenantOutgoing(store, input, ctx.who, ctx.clock, ctx.newId);
  if (result.status === 'refused' && result.reason === 'no-rent-credit') {
    // G4-I1: the message names the months with an open credit (none: «nessuno»).
    throw new Stop('rejected', result.reason, {
      months: result.months,
      message:
        `Rifiutato: l’inquilino non ha un credito di canone versato in più nel mese ` +
        `${input.forMonth}. Mesi con un credito aperto: ` +
        `${result.months.length === 0 ? 'nessuno' : result.months.join(', ')}.`,
    });
  }
  if (result.status === 'refused') throw new Stop('rejected', result.reason);
  return { status: 'confirmed', operationId: result.operationId, paymentId: result.paymentId };
}

/** `giroconto`. */
export async function confirmTransferCommand(
  store: Store,
  input: Parameters<typeof confirmTransfer>[1],
  ctx: CommandContext,
) {
  const result = await confirmTransfer(store, input, ctx.who, ctx.clock, ctx.newId);
  if (result.status === 'refused') throw new Stop('rejected', result.reason);
  return { status: 'confirmed', operationId: result.operationId, transferId: result.transferId };
}

/** `giroconto-manuale`. */
export async function manualTransferCommand(
  store: Store,
  input: Parameters<typeof recordManualTransfer>[1],
  ctx: CommandContext,
) {
  const result = await recordManualTransfer(store, input, ctx.who, ctx.clock, ctx.newId);
  if (result.status === 'refused') throw new Stop('rejected', result.reason);
  // Ruling (E2): the same transfer again is that transfer; a second identical one needs --id.
  if (result.status === 'unchanged') {
    return input.id === undefined ? { ...result, message: MESSAGES['already-recorded'] } : result;
  }
  return { status: 'recorded', operationId: result.operationId, transferId: result.transferId };
}

/** `saldi`: without `details` only the apartments of each pair and counts (R132). */
export async function balancesCommand(store: Store, options: { details: boolean }) {
  const result = await loadAccountBalances(store);
  if (result.status === 'refused') throw new Stop('rejected', result.reason);
  const toSplitImu = result.toSplit.filter((t) => t.imu !== undefined).length;
  if (options.details) {
    return {
      status: 'ok',
      pairs: result.pairs,
      toSplit: result.toSplit,
      toSplitImu,
      unverified: result.unverified,
      mixedF24: result.mixedF24,
    };
  }
  return {
    status: 'ok',
    pairs: result.pairs.map((p) => ({
      creditorApartmentId: p.creditorApartmentId,
      debtorApartmentId: p.debtorApartmentId,
      items: p.items.length,
    })),
    toSplit: result.toSplit.length,
    toSplitImu,
    unverified: result.unverified.length,
    // Plan 17, R307: the part of a mixed F24 that is no IMU, out of the balance (to check).
    ...(result.mixedF24.length > 0
      ? { mixedF24: result.mixedF24.length, message: MESSAGES['mixed-f24-out'] }
      : {}),
  };
}

/** `abbina`. */
export async function confirmMatchCommand(
  store: Store,
  input: Parameters<typeof confirmMatch>[1],
  ctx: CommandContext,
) {
  const result = await confirmMatch(store, input, ctx.who, ctx.clock, ctx.newId);
  if (result.status === 'refused') {
    // The errors of invalid-matches are codes and ids only, no amount.
    throw new Stop('rejected', result.reason, 'errors' in result ? { errors: result.errors } : {});
  }
  // amountDiffers: bill ids confirmed for the debit, not the document amount (R2: «importo
  // diverso», an id only, no amount).
  return {
    status: 'confirmed',
    operationId: result.operationId,
    matchIds: result.matchIds,
    ...optional('amountDiffers', result.amountDiffers),
  };
}

/** `conferma`. */
export async function confirmIncomeCommand(
  store: Store,
  input: Parameters<typeof confirmIncome>[1],
  ctx: CommandContext,
) {
  const result = await confirmIncome(store, input, ctx.who, ctx.clock, ctx.newId);
  if (result.status === 'refused') throw new Stop('rejected', result.reason);
  return {
    status: 'confirmed',
    operationId: result.operationId,
    paymentIds: result.paymentIds,
    ...(result.payerId === undefined ? {} : { payerId: result.payerId }),
    // B17: codes and months only (no amount): a rent month outside the presence or paid twice.
    ...optional(
      'warnings',
      result.warnings?.map((w) => ({ ...w, message: MESSAGES[w.code] })),
    ),
  };
}

/** `eccedenza-canone` (B5): confirms one proposal of `excesses`; ids only. */
export async function confirmRentExcessCommand(
  store: Store,
  proposalId: string,
  ctx: CommandContext,
) {
  const result = await confirmRentExcess(store, proposalId, ctx.who, ctx.clock, ctx.newId);
  if (result.status === 'refused') {
    throw new Stop(
      'rejected',
      result.reason,
      result.reason === 'no-month-to-cover' ? { message: MESSAGES['no-month-to-cover'] } : {},
    );
  }
  return { status: 'confirmed', operationId: result.operationId, paymentIds: result.paymentIds };
}

/**
 * `conferma-anno` (item 6 of plan 25): the items «da verificare» of a past year confirmed paid by
 * hand in one operation; the count and the sum of their expected amounts.
 */
export async function confirmPastYearCommand(
  store: Store,
  input: { year: string; today: string },
  ctx: CommandContext,
) {
  const result = await confirmPastYear(store, input, ctx.who, ctx.clock, ctx.newId);
  if (result.status === 'refused') {
    const message = MESSAGES[`hand-${result.reason}`];
    throw new Stop('rejected', result.reason, {
      ...(message === undefined ? {} : { message }),
      ...('skippedApartmentIds' in result && result.skippedApartmentIds !== undefined
        ? { skippedApartmentIds: result.skippedApartmentIds }
        : {}),
    });
  }
  return result;
}

/** `annulla-riconciliazione` (and `annulla-incassi`): one operation of `RECONCILE_KINDS`. */
export async function undoOperationCommand(store: Store, operationId: string, ctx: CommandContext) {
  const { operations } = await readJournal(store);
  const target = operations.find((o) => o.id === operationId);
  if (target === undefined) throw new Stop('rejected', 'unknown-operation');
  if (!RECONCILE_KINDS.includes(target.kind)) {
    throw new Stop('rejected', 'not-reconcile-operation');
  }
  // A cancellation whose movement has had another use since: undoing it would give a second one;
  // an imu.expected under an assigned F24 would change its rate (plan 3d).
  const recordIds = await undoBlockedBy(store, target.id);
  // U8: records pointing at what the operation created, with the counts by kind (no names).
  const created = recordIds.length > 0 ? await undoDependents(store, target.id) : [];
  if (created.length > 0 && target.kind !== 'imu.expected') {
    throw new Stop('rejected', 'has-dependents', {
      message: MESSAGES['record-has-dependents'],
      counts: countByType(created),
      recordIds,
    });
  }
  if (recordIds.length > 0) {
    throw new Stop('rejected', 'has-dependents', {
      message:
        MESSAGES[
          target.kind === 'imu.expected'
            ? 'imu-has-assignments'
            : target.kind.startsWith('tenancy.')
              ? 'tenancy-has-dependents'
              : 'movement-has-dependents'
        ],
      recordIds,
    });
  }
  try {
    const undone = await undoOperation(store, target.id, ctx.who, ctx.clock, ctx.newId);
    return { status: 'undone', operationId: undone.id };
  } catch (error) {
    // Finding 9: the core refuses an undo that would close a period without a new snapshot.
    if (error instanceof ClosingUndoError) throw new Stop('rejected', error.reason);
    const text = error instanceof Error ? error.message : '';
    if (text.includes('was already undone')) throw new Stop('rejected', 'already-undone');
    if (text.includes('depend on it')) throw new Stop('rejected', 'has-dependents');
    if (text.startsWith('Cannot undo:')) throw new Stop('rejected', 'journal-not-aligned');
    throw error;
  }
}

/** `annulla-pagamento`. */
export async function cancelPaymentCommand(store: Store, paymentId: string, ctx: CommandContext) {
  const result = await cancelAutomaticPayment(store, paymentId, ctx.who, ctx.clock, ctx.newId);
  if (result.status === 'refused') throw new Stop('rejected', result.reason);
  return { status: 'cancelled', operationId: result.operationId };
}

/** `escludi`. */
export async function excludeMovementCommand(
  store: Store,
  input: Parameters<typeof excludeMovement>[1],
  ctx: CommandContext,
) {
  const result = await excludeMovement(store, input, ctx.who, ctx.clock, ctx.newId);
  if (result.status === 'refused' && result.reason === 'has-dependents') {
    // The reason is the core's; the message is the one of a movement, not of an operation.
    throw new Stop('rejected', result.reason, {
      message: MESSAGES['movement-has-dependents'],
      recordIds: result.recordIds,
    });
  }
  if (result.status === 'refused') throw new Stop('rejected', result.reason);
  return { status: 'excluded', operationId: result.operationId };
}

/**
 * `ripara`: repairs every diverged record it can and reports the rest (a fork, a record newer on
 * disk, a conflict copy): those need a person (revisione 2026-11-18).
 */
export async function repairCommand(store: Store) {
  const problems = await checkConsistency(store);
  let repaired = 0;
  const left: { path: string; reason: string }[] = [];
  for (const problem of problems) {
    if (problem.reason === 'diverged') {
      try {
        await repairDiverged(store, problem.path);
        repaired += 1;
        continue;
      } catch {
        left.push({ path: problem.path, reason: 'repair-refused' });
        continue;
      }
    }
    left.push({ path: problem.path, reason: problem.reason });
  }
  return { status: 'repaired', repaired, ...(left.length > 0 ? { left } : {}) };
}

/**
 * `scegli-versione`: the versions of a forked file (operation ids, times and profile ids; the
 * content with `details`), or the one chosen.
 */
export async function chooseVersionCommand(
  store: Store,
  input: { file: string; operationId?: string },
  ctx: CommandContext,
  options: { details: boolean },
) {
  const versions = await forkVersions(store, input.file);
  if (input.operationId === undefined) {
    if (versions.length === 0) throw new Stop('rejected', 'not-forked');
    return {
      status: 'versions',
      versions: versions.map((op) => {
        const after = op.changes.find((change) => change.path === input.file)?.after;
        // Finding 6: the marks of each version of a closing, so that choosing loses none unseen.
        const close = PeriodCloseSchema.safeParse(after);
        return {
          operationId: op.id,
          at: op.at,
          profileId: op.profileId,
          ...(close.success ? { marks: closeMarks(close.data) } : {}),
          ...(options.details ? { record: after } : {}),
        };
      }),
    };
  }
  if (!versions.some((op) => op.id === input.operationId)) throw new Stop('rejected', 'not-forked');
  const operation = await resolveFork(
    store,
    input.file,
    input.operationId,
    ctx.who,
    ctx.clock,
    ctx.newId,
  );
  return { status: 'resolved', operationId: operation.id };
}

/**
 * `riferimenti` (review of 18 Nov 2026, annullo, point 2): the live records pointing at a missing
 * or deleted one; kinds, ids and the field only, never a value.
 */
export async function referencesCommand(store: Store) {
  const problems = (await referenceProblems(store)).map(({ from, field, to }) => ({
    from,
    field,
    to,
    message: `${from.type} ${from.id}: ${field} punta a ${to.type} ${to.id}, che non c’è o è cancellato.`,
  }));
  return {
    status: 'ok',
    problems,
    ...(problems.length === 0 ? { message: MESSAGES['no-references'] } : {}),
  };
}
