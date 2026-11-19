import { describe, expect, it } from 'vitest';
import {
  CommandStop,
  FAILED_BODY,
  billReadingOf,
  cancelOutgoingCommand,
  changedClosedPeriods,
  chooseVersionCommand,
  closedPeriodStates,
  commandRefusal,
  confirmMatchCommand,
  importTargetOf,
  reconcileCommand,
  refuseRegisteredBill,
  repairCommand,
  saveBankProfileCommand,
  saveTenantCardCommand,
  statementCsvTable,
  stopBody,
  undoBillCommand,
  undoImportCommand,
} from '../src/commands';
import { NewerDataError } from '../src/store/store';
import { MemoryStore } from './helpers/memory-store';

// Plan 24 (R386): the commands moved from scripts/estratti.mjs are tested through the command
// line; these cover the refusals that the in-process tests of the command line do not reach.

const ctx = {
  who: 'test',
  clock: () => '2026-11-19T10:00:00.000Z',
  newId: () => 'id-1',
};

async function stopOf(promise: Promise<unknown> | (() => unknown)) {
  try {
    await (typeof promise === 'function' ? promise() : promise);
  } catch (error) {
    if (error instanceof CommandStop) return { status: error.status, reason: error.reason };
    throw error;
  }
  throw new Error('no stop');
}

describe('commands of the core', () => {
  it('refuses a bank profile that is not JSON or not a profile', async () => {
    const store = new MemoryStore();
    expect(await stopOf(saveBankProfileCommand(store, '{', ctx))).toEqual({
      status: 'invalid',
      reason: 'bad-profile',
    });
    expect(await stopOf(saveBankProfileCommand(store, '{"id":1}', ctx))).toMatchObject({
      reason: 'bad-profile',
    });
  });

  it('refuses an unknown account, a statement that is not UTF-8 and an undo without import', async () => {
    const store = new MemoryStore();
    expect(await stopOf(importTargetOf(store, 'none'))).toEqual({
      status: 'rejected',
      reason: 'unknown-account',
    });
    expect(await stopOf(() => statementCsvTable(new Uint8Array([0xff, 0xfe]), ';'))).toEqual({
      status: 'invalid',
      reason: 'unreadable-statement',
    });
    expect(await stopOf(undoImportCommand(store, 'none', ctx))).toEqual({
      status: 'rejected',
      reason: 'no-import',
    });
  });

  it('refuses the values of a tenant card that are not an object of texts', async () => {
    const store = new MemoryStore();
    for (const valuesJson of ['nope', '[]', '{"altro":"x"}', '{"documento_ente":"x"}']) {
      expect(
        await stopOf(saveTenantCardCommand(store, { tenantId: 't', valuesJson }, ctx)),
      ).toEqual({ status: 'invalid', reason: 'bad-values' });
    }
  });

  it('reconciles, repairs and lists versions of an empty folder', async () => {
    const store = new MemoryStore();
    const run = await reconcileCommand(store, { dryRun: true }, ctx, { details: true });
    expect(run).toMatchObject({ status: 'reconciled', notes: [] });
    expect(await repairCommand(store)).toEqual({ status: 'repaired', repaired: 0 });
    expect(
      await stopOf(chooseVersionCommand(store, { file: 'a.json' }, ctx, { details: false })),
    ).toEqual({ status: 'rejected', reason: 'not-forked' });
    expect(
      await stopOf(
        chooseVersionCommand(store, { file: 'a.json', operationId: 'op' }, ctx, { details: false }),
      ),
    ).toEqual({ status: 'rejected', reason: 'not-forked' });
  });

  it('refuses the confirmations of what is not there', async () => {
    const store = new MemoryStore();
    expect(await stopOf(cancelOutgoingCommand(store, 'none', ctx))).toMatchObject({
      status: 'rejected',
    });
    expect(await stopOf(confirmMatchCommand(store, { parts: [] }, ctx))).toMatchObject({
      status: 'rejected',
    });
  });

  it('refuses a bill reading that is not JSON or not a reading, and an undo of a file never registered', async () => {
    const store = new MemoryStore();
    expect(await stopOf(() => billReadingOf('{', { details: false }))).toEqual({
      status: 'invalid',
      reason: 'bad-reading',
    });
    expect(await stopOf(() => billReadingOf('{}', { details: true }))).toEqual({
      status: 'invalid',
      reason: 'bad-reading',
    });
    await expect(refuseRegisteredBill(store, 'hash')).resolves.toBeUndefined();
    // Nothing registered from the file: nothing undone and nothing to move.
    expect(
      await undoBillCommand(store, { bytes: new Uint8Array([1]) }, ctx, { details: false }),
    ).toEqual({ body: { status: 'undone', records: 0, operationIds: [] }, move: undefined });
  });

  it('gives the output of a stop, of a typed refusal and of a failure', async () => {
    expect(stopBody(new CommandStop('rejected', 'unknown-account', { id: 'a' }))).toEqual({
      status: 'rejected',
      reason: 'unknown-account',
      message: 'Rifiutato: conto sconosciuto.',
      id: 'a',
    });
    expect(commandRefusal(new NewerDataError('_app/dati/x/a.json'))).toMatchObject({
      status: 'rejected',
      reason: 'newer-data',
      paths: ['_app/dati/x/a.json'],
    });
    expect(commandRefusal(new Error('x'))).toBeUndefined();
    expect(FAILED_BODY.status).toBe('failed');
  });

  it('warns only for a closed period whose state changed', async () => {
    const query = { apartmentId: 'a', periodLabel: 'p' };
    const before = new Map([['c', { query, state: '1' }]]);
    expect(changedClosedPeriods(before, new Map([['c', { query, state: '1' }]]))).toBeUndefined();
    expect(changedClosedPeriods(before, new Map([['c', { query, state: '2' }]]))).toMatchObject({
      closedPeriods: [query],
    });
    expect((await closedPeriodStates(new MemoryStore(), '2026-11-19' as never)).size).toBe(0);
  });
});
