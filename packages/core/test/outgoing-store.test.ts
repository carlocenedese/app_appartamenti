import { describe, expect, it } from 'vitest';
import {
  MovementClassSchema,
  MovementRuleSchema,
  PaymentSchema,
  cancelAutomaticClass,
  confirmOutgoing,
  confirmTenantOutgoing,
  excludeMovement,
  loadAll,
  planIncome,
  readJournal,
  recordPath,
  recordSchemas,
  runOutgoing,
  runReconciliation,
  undoOperation,
} from '../src/index';
import type { OutgoingKind, RecordKind } from '../src/index';
import type { YearMonth } from '../src/period';
import { clock, ids, snapshot } from './helpers/income-year';
import { MemoryStore } from './helpers/memory-store';

// Synthetic records only: the own accounts and the invented supplier of fixtures/README.md.
const BERCHET = 'IT85X0542811101000000000301';
const PULCI = 'IT52A9999999999000000000001';
const SUPPLIER = 'IT04X0542811101000000000401';
const TENANT = 'IT09X0542811101000000000311';
const base = { v: 1, rev: 1 };
const apartment = (id: string) => ({
  ...base,
  id,
  name: id,
  locatore: 'Locatore fittizio',
  posti: 2,
  annualitaStart: { month: 1, day: 1 },
});
const account = (id: string, iban: string) => ({
  ...base,
  id: `acc-${id}`,
  apartmentId: id,
  label: 'Conto',
  bankProfileId: 'bp',
  iban,
});
const tx = (
  id: string,
  date: string,
  amount: number,
  counterparty?: { name?: string; iban?: string },
  where = 'berchet',
) => ({
  ...base,
  id,
  apartmentId: where,
  accountId: `acc-${where}`,
  date,
  amount,
  description: 'ADDEBITO FORNITORE INVENTATO',
  statementHash: 's',
  ...(counterparty === undefined ? {} : { counterparty }),
});
const supplier = { name: 'Fornitore Inventato', iban: SUPPLIER };

async function put(
  store: MemoryStore,
  kind: RecordKind,
  records: ({ id: string } & Record<string, unknown>)[],
) {
  for (const r of records) {
    await store.writeJsonAtomic(recordPath(kind, r.id), recordSchemas[kind].parse(r));
  }
}
async function storeWith(...transactions: ReturnType<typeof tx>[]) {
  const store = new MemoryStore();
  await put(store, 'apartment', [apartment('berchet'), apartment('pulci')]);
  await put(store, 'account', [account('berchet', BERCHET), account('pulci', PULCI)]);
  await put(store, 'transaction', transactions);
  return store;
}

const runRaw = (store: MemoryStore, prefix = 'r', dryRun = false) =>
  runOutgoing(store, 'p1', clock, ids(prefix), { dryRun });
async function run(store: MemoryStore, prefix = 'r', dryRun = false) {
  const result = await runRaw(store, prefix, dryRun);
  if (result.status !== 'reconciled') throw new Error('refused');
  return result;
}
const confirm = (
  store: MemoryStore,
  proposalId: string,
  kind: OutgoingKind = 'altro',
  extra: { apartmentId?: string; rememberRule?: boolean; f24?: boolean } = {},
  prefix = 'c',
) =>
  confirmOutgoing(
    store,
    { proposalId, kind, apartmentId: 'berchet', rememberRule: true, ...extra },
    'p1',
    clock,
    ids(prefix),
  );
const classes = async (store: MemoryStore) =>
  (await loadAll(store, 'movementClass', MovementClassSchema, { includeDeleted: true })).records;
const rules = async (store: MemoryStore) =>
  (await loadAll(store, 'movementRule', MovementRuleSchema, { includeDeleted: true })).records;
/** A store the journal no longer explains: a class edited by hand after its confirmation. */
async function diverge(store: MemoryStore, transactionId: string) {
  await confirm(store, `p-uscita-${transactionId}`, 'altro', { rememberRule: false }, 'd');
  const path = recordPath('movementClass', `mc-${transactionId}`);
  store.putRaw(path, (store.getRaw(path) ?? '').replace('altro', 'tasse'));
}
/** No name, IBAN, description or amount in what a run or a confirmation says (R107). */
function expectNoPersonalData(value: unknown) {
  const text = JSON.stringify(value);
  for (const word of ['Fornitore', 'FORNITORE', SUPPLIER, '0401', '4000', '4200', '40,00']) {
    expect(text).not.toContain(word);
  }
}

describe('runOutgoing and confirmOutgoing (plan 3c, task 6, question 1)', () => {
  it('confirmed once with its rule, the next year automatic; on another account a proposal', async () => {
    const store = await storeWith(tx('x', '2027-02-10', -4000, supplier));
    const empty = await snapshot(store);
    const first = await run(store);
    expect(first).toEqual({
      status: 'reconciled',
      written: 0,
      classified: [],
      proposals: [
        { id: 'p-uscita-x', transactionId: 'x', step: 'uscita', reason: 'new-counterparty' },
      ],
      missingDocument: [],
    });
    expect(await snapshot(store)).toEqual(empty);

    const confirmed = await confirm(store, 'p-uscita-x');
    expect(confirmed).toEqual({
      status: 'confirmed',
      operationId: 'c-1',
      classId: 'mc-x',
      ruleId: 'rule-x',
    });
    expectNoPersonalData(confirmed);
    expect(await classes(store)).toEqual([
      { ...base, id: 'mc-x', transactionId: 'x', kind: 'altro', apartmentId: 'berchet' },
    ]);
    expect(await rules(store)).toEqual([
      {
        ...base,
        id: 'rule-x',
        direction: 'out',
        accountId: 'acc-berchet',
        key: `iban:${SUPPLIER}`,
        kind: 'altro',
        apartmentId: 'berchet',
      },
    ]);
    const [op] = (await readJournal(store)).operations;
    expect(op).toMatchObject({ kind: 'outgoing.confirm', summary: 'Classificato un movimento.' });
    // The rule last: an interrupted confirmation never leaves a rule without its class.
    expect(op?.changes.map((c) => c.path)).toEqual([
      recordPath('movementClass', 'mc-x'),
      recordPath('movementRule', 'rule-x'),
    ]);

    await put(store, 'transaction', [
      tx('y', '2028-02-10', -4200, supplier),
      tx('z', '2028-02-10', -4200, supplier, 'pulci'),
    ]);
    const second = await run(store);
    expect(second).toEqual({
      status: 'reconciled',
      written: 1,
      classified: ['y'],
      proposals: [
        { id: 'p-uscita-z', transactionId: 'z', step: 'uscita', reason: 'new-counterparty' },
      ],
      missingDocument: [],
      operationId: 'r-1',
    });
    expectNoPersonalData(second);
    expect((await classes(store)).find((c) => c.id === 'mc-y')).toEqual({
      ...base,
      id: 'mc-y',
      transactionId: 'y',
      kind: 'altro',
      apartmentId: 'berchet',
      ruleId: 'rule-x',
    });
    const ops = (await readJournal(store)).operations;
    expect(ops.find((o) => o.id === 'r-1')).toMatchObject({
      kind: 'outgoing.reconcile',
      apartmentId: 'berchet',
      summary: 'Classificate le uscite: 1 automatica, 1 da rivedere.',
    });
    expectNoPersonalData(ops.map((o) => o.summary));

    const once = await snapshot(store);
    expect(await run(store, 's')).not.toHaveProperty('operationId');
    expect(await snapshot(store)).toEqual(once);
  });

  it('a dry run writes nothing and says what the run writes', async () => {
    const store = await storeWith(tx('x', '2027-02-10', -4000, supplier));
    await confirm(store, 'p-uscita-x');
    await put(store, 'transaction', [tx('y', '2028-02-10', -4200, supplier)]);
    const before = await snapshot(store);
    const dry = await run(store, 'd', true);
    expect(await snapshot(store)).toEqual(before);
    const real = await run(store);
    expect({ ...dry, operationId: 'r-1' }).toEqual(real);
  });

  it('«solo questa volta» saves no rule; no counterparty never saves one (review focus 4)', async () => {
    const store = await storeWith(
      tx('x', '2027-02-10', -4000, supplier),
      tx('none', '2027-02-11', -4000),
      tx('blank', '2027-02-12', -4000, { name: '   ', iban: ' ' }),
    );
    expect((await run(store)).proposals.map((p) => [p.id, p.reason])).toEqual([
      ['p-uscita-blank', 'no-counterparty'],
      ['p-uscita-none', 'no-counterparty'],
      ['p-uscita-x', 'new-counterparty'],
    ]);
    expect(await confirm(store, 'p-uscita-x', 'altro', { rememberRule: false })).toEqual({
      status: 'confirmed',
      operationId: 'c-1',
      classId: 'mc-x',
    });
    expect(await confirm(store, 'p-uscita-none', 'utenze', {}, 'n')).toEqual({
      status: 'confirmed',
      operationId: 'n-1',
      classId: 'mc-none',
    });
    expect(await confirm(store, 'p-uscita-blank', 'utenze', {}, 'b')).toEqual({
      status: 'confirmed',
      operationId: 'b-1',
      classId: 'mc-blank',
    });
    expect(await rules(store)).toEqual([]);
    await put(store, 'transaction', [tx('y', '2028-02-10', -4200, supplier)]);
    expect((await run(store)).proposals.map((p) => p.id)).toEqual(['p-uscita-y']);
  });

  it('an undone movement confirmed with another category closes the old rule (user1, 6-bis)', async () => {
    const store = await storeWith(
      tx('x', '2027-02-10', -4000, supplier),
      tx('w', '2027-03-10', -4000, supplier),
    );
    await confirm(store, 'p-uscita-x', 'altro');
    // The rule of x classifies w; cancelled by itself, w is confirmed with another category.
    expect(await run(store, 'a')).toMatchObject({ written: 1, classified: ['w'] });
    await cancelAutomaticClass(store, 'w', 'p1', clock, ids('k'));
    expect(await confirm(store, 'p-uscita-w', 'utenze', {}, 'h')).toEqual({
      status: 'confirmed',
      operationId: 'h-1',
      classId: 'mc-w',
      ruleId: 'rule-w',
    });
    const saved = await rules(store);
    expect(saved.find((r) => r.id === 'rule-x')).toMatchObject({ rev: 2, validTo: '2027-03-09' });
    expect(saved.find((r) => r.id === 'rule-w')).toMatchObject({
      kind: 'utenze',
      validFrom: '2027-03-10',
    });
    // From then on the newer rule holds alone.
    await put(store, 'transaction', [tx('y', '2028-02-10', -4200, supplier)]);
    expect(await run(store)).toMatchObject({ written: 1, classified: ['y'] });
    expect((await classes(store)).find((c) => c.id === 'mc-y')).toMatchObject({
      kind: 'utenze',
      ruleId: 'rule-w',
    });
  });

  describe('a rule-conflict confirmed (user1, 15 Nov 2026, task 6-bis)', () => {
    const rule = (id: string, kind: OutgoingKind, extra: Record<string, unknown> = {}) => ({
      ...base,
      id,
      direction: 'out',
      accountId: 'acc-berchet',
      key: `iban:${SUPPLIER}`,
      kind,
      apartmentId: 'berchet',
      ...extra,
    });
    async function conflicted(date = '2028-02-10', extra: Record<string, unknown> = {}) {
      const store = await storeWith(tx('y', date, -4200, supplier));
      await put(store, 'movementRule', [rule('rule-a', 'altro'), rule('rule-b', 'utenze', extra)]);
      expect(await run(store, 'q')).toMatchObject({
        written: 0,
        proposals: [{ id: 'p-uscita-y', reason: 'rule-conflict' }],
      });
      return store;
    }

    it('with rememberRule: the old rules in conflict close the day before, the next run is automatic', async () => {
      const store = await conflicted();
      expect(await confirm(store, 'p-uscita-y', 'condominio')).toEqual({
        status: 'confirmed',
        operationId: 'c-1',
        classId: 'mc-y',
        ruleId: 'rule-y',
      });
      expect((await rules(store)).map((r) => [r.id, r.rev, r.validFrom, r.validTo])).toEqual([
        ['rule-a', 2, undefined, '2028-02-09'],
        ['rule-b', 2, undefined, '2028-02-09'],
        ['rule-y', 1, '2028-02-10', undefined],
      ]);
      const [op] = (await readJournal(store)).operations;
      // The class first, the closed rules, the new rule last.
      expect(op?.changes.map((c) => c.path)).toEqual([
        recordPath('movementClass', 'mc-y'),
        recordPath('movementRule', 'rule-a'),
        recordPath('movementRule', 'rule-b'),
        recordPath('movementRule', 'rule-y'),
      ]);
      await put(store, 'transaction', [tx('z', '2028-03-10', -4200, supplier)]);
      expect(await run(store)).toMatchObject({ written: 1, classified: ['z'], proposals: [] });
      expect((await classes(store)).find((c) => c.id === 'mc-z')).toMatchObject({
        kind: 'condominio',
        ruleId: 'rule-y',
      });
      // An older movement imported later: the old rules still hold for it (still a conflict).
      await put(store, 'transaction', [tx('old', '2028-01-10', -4200, supplier)]);
      expect((await run(store, 's')).proposals).toEqual([
        { id: 'p-uscita-old', transactionId: 'old', step: 'uscita', reason: 'rule-conflict' },
      ]);
      const once = await snapshot(store);
      await run(store, 't');
      expect(await snapshot(store)).toEqual(once);
    });

    it('a rule with the same category and apartment stays as it is', async () => {
      const store = await conflicted();
      await confirm(store, 'p-uscita-y', 'utenze');
      expect((await rules(store)).map((r) => [r.id, r.rev, r.validTo])).toEqual([
        ['rule-a', 2, '2028-02-09'],
        ['rule-b', 1, undefined],
        ['rule-y', 1, undefined],
      ]);
    });

    it('undone, the old rules open again and the conflict is back', async () => {
      const store = await conflicted();
      await confirm(store, 'p-uscita-y', 'condominio');
      await undoOperation(store, 'c-1', 'p1', clock, ids('u'));
      const after = await rules(store);
      expect(after.map((r) => [r.id, r.deleted === true, r.validTo])).toEqual([
        ['rule-a', false, undefined],
        ['rule-b', false, undefined],
        ['rule-y', true, undefined],
      ]);
      expect((await run(store)).proposals.map((p) => [p.id, p.reason])).toEqual([
        ['p-uscita-y', 'rule-conflict'],
      ]);
    });

    it('without rememberRule nothing changes but the class', async () => {
      const store = await conflicted();
      expect(await confirm(store, 'p-uscita-y', 'condominio', { rememberRule: false })).toEqual({
        status: 'confirmed',
        operationId: 'c-1',
        classId: 'mc-y',
      });
      expect((await rules(store)).map((r) => [r.id, r.rev, r.validTo])).toEqual([
        ['rule-a', 1, undefined],
        ['rule-b', 1, undefined],
      ]);
      await put(store, 'transaction', [tx('z', '2028-03-10', -4200, supplier)]);
      expect((await run(store)).proposals.map((p) => p.reason)).toEqual(['rule-conflict']);
    });

    it('a movement on or before the validFrom of an old rule: rule-conflict-dates, nothing written', async () => {
      const store = await conflicted('2028-02-10', { validFrom: '2028-02-10' });
      const before = await snapshot(store);
      expect(await confirm(store, 'p-uscita-y', 'condominio')).toEqual({
        status: 'refused',
        reason: 'rule-conflict-dates',
      });
      expect(await snapshot(store)).toEqual(before);
      // «Solo questa volta» closes nothing, so it is never refused for the dates.
      expect(
        await confirm(store, 'p-uscita-y', 'condominio', { rememberRule: false }),
      ).toMatchObject({ status: 'confirmed' });

      // The day after the validFrom: the old rule closes on its validFrom.
      const next = await conflicted('2028-02-11', { validFrom: '2028-02-10' });
      expect(await confirm(next, 'p-uscita-y', 'condominio')).toMatchObject({
        status: 'confirmed',
        ruleId: 'rule-y',
      });
      expect((await rules(next)).find((r) => r.id === 'rule-b')).toMatchObject({
        validFrom: '2028-02-10',
        validTo: '2028-02-10',
      });
    });
  });

  it('refuses a changed state, an unknown apartment and a diverged store, writing nothing', async () => {
    const store = await storeWith(
      tx('x', '2027-02-10', -4000, supplier),
      tx('e', '2027-02-11', -4000, supplier),
    );
    expect(await run(store)).toMatchObject({
      proposals: [{ id: 'p-uscita-e' }, { id: 'p-uscita-x' }],
    });
    // Excluded after the proposal (review focus 2).
    await excludeMovement(store, { transactionId: 'e', reason: 'doppione' }, 'p1', clock, ids('x'));
    const before = await snapshot(store);
    expect(await confirm(store, 'p-uscita-e')).toEqual({
      status: 'refused',
      reason: 'unknown-proposal',
    });
    expect(await confirm(store, 'p-uscita-nessuno')).toEqual({
      status: 'refused',
      reason: 'unknown-proposal',
    });
    expect(await confirm(store, 'p-uscita-x', 'altro', { apartmentId: 'nessuno' })).toEqual({
      status: 'refused',
      reason: 'unknown-apartment',
    });
    expect(await snapshot(store)).toEqual(before);
    // Classified since: the proposal is gone.
    await confirm(store, 'p-uscita-x');
    expect(await confirm(store, 'p-uscita-x', 'utenze', {}, 'again')).toEqual({
      status: 'refused',
      reason: 'unknown-proposal',
    });

    const diverged = await storeWith(
      tx('x', '2027-02-10', -4000, supplier),
      tx('v', '2027-02-11', -4000, supplier),
    );
    await diverge(diverged, 'v');
    const broken = await snapshot(diverged);
    const refused = { status: 'refused', reason: 'inconsistent-store' };
    expect(await runRaw(diverged)).toEqual(refused);
    expect(await confirm(diverged, 'p-uscita-x')).toEqual(refused);
    expect(await cancelAutomaticClass(diverged, 'v', 'p1', clock, ids('k'))).toEqual(refused);
    expect(await snapshot(diverged)).toEqual(broken);
  });

  it('a class utenze without its bill is missingDocument and changes no other record (question 8)', async () => {
    const store = await storeWith(tx('x', '2027-02-10', -4000, supplier));
    const files = async () => (await snapshot(store)).map((s) => s.split('\n')[0] ?? '');
    const before = await files();
    await confirm(store, 'p-uscita-x', 'utenze');
    const added = (await files()).filter((f) => !before.includes(f));
    expect(added.filter((f) => !f.startsWith('_app/journal/'))).toEqual([
      '_app/dati/movementClass/mc-x.json',
      '_app/dati/movementRule/rule-x.json',
    ]);
    expect((await run(store)).missingDocument).toEqual(['x']);
  });
});

describe('cancelAutomaticClass and the undo chain (plan 3c, task 6, review focus 5)', () => {
  async function classified() {
    const store = await storeWith(tx('x', '2027-02-10', -4000, supplier));
    await confirm(store, 'p-uscita-x');
    await put(store, 'transaction', [tx('y', '2028-02-10', -4200, supplier)]);
    expect(await run(store)).toMatchObject({ written: 1, operationId: 'r-1' });
    return store;
  }

  it('cancelled by itself: undone, never automatic again; refusals', async () => {
    const store = await classified();
    expect(await cancelAutomaticClass(store, 'y', 'p1', clock, ids('k'))).toEqual({
      status: 'cancelled',
      operationId: 'k-1',
    });
    expect((await readJournal(store)).operations.find((o) => o.id === 'k-1')).toMatchObject({
      kind: 'outgoing.cancel-auto',
      summary: 'Annullata una classificazione automatica.',
    });
    const proposals = (await run(store, 's')).proposals;
    expect(proposals).toEqual([
      { id: 'p-uscita-y', transactionId: 'y', step: 'uscita', reason: 'undone' },
    ]);
    expect(await cancelAutomaticClass(store, 'y', 'p1', clock, ids('k2'))).toEqual({
      status: 'refused',
      reason: 'unknown-class',
    });
    expect(await cancelAutomaticClass(store, 'nessuno', 'p1', clock, ids('k2'))).toEqual({
      status: 'refused',
      reason: 'unknown-class',
    });
    // Confirmed by hand: not automatic.
    expect(await cancelAutomaticClass(store, 'x', 'p1', clock, ids('k2'))).toEqual({
      status: 'refused',
      reason: 'not-automatic',
    });
    // Confirmed by hand from the undone proposal: fine, and no second rule is needed.
    expect(await confirm(store, 'p-uscita-y', 'altro', { rememberRule: false }, 'h')).toMatchObject(
      {
        status: 'confirmed',
      },
    );
  });

  it('cancel-auto undone: the class is live again and not undone', async () => {
    const store = await classified();
    await cancelAutomaticClass(store, 'y', 'p1', clock, ids('k'));
    await undoOperation(store, 'k-1', 'p1', clock, ids('u'));
    expect((await classes(store)).find((c) => c.id === 'mc-y')).toMatchObject({
      ruleId: 'rule-x',
    });
    expect((await classes(store)).find((c) => c.id === 'mc-y')).not.toHaveProperty('deleted');
    expect(await run(store, 's')).toMatchObject({ written: 0, proposals: [] });
    // As R121: the latest change is an undo, so it is no longer automatic for cancel-auto.
    expect(await cancelAutomaticClass(store, 'y', 'p1', clock, ids('k2'))).toEqual({
      status: 'refused',
      reason: 'not-automatic',
    });
  });

  it('the whole run undone: automatic again at the next run', async () => {
    const store = await classified();
    await undoOperation(store, 'r-1', 'p1', clock, ids('u'));
    expect(await run(store, 's')).toMatchObject({ written: 1, classified: ['y'], proposals: [] });
  });

  it('a confirmation undone takes its rule away as well', async () => {
    const store = await storeWith(tx('x', '2027-02-10', -4000, supplier));
    await confirm(store, 'p-uscita-x');
    await undoOperation(store, 'c-1', 'p1', clock, ids('u'));
    expect((await rules(store)).map((r) => [r.id, r.deleted])).toEqual([['rule-x', true]]);
    await put(store, 'transaction', [tx('y', '2028-02-10', -4200, supplier)]);
    expect((await run(store)).proposals.map((p) => [p.id, p.reason])).toEqual([
      ['p-uscita-x', 'new-counterparty'],
      ['p-uscita-y', 'new-counterparty'],
    ]);
  });
});

describe('incoming movements without a payer (plan 3c, task 6, question 2)', () => {
  async function refunds() {
    const store = await storeWith(
      tx('r1', '2027-02-10', 1230, supplier, 'pulci'),
      tx('rent', '2027-02-05', 50000, { name: 'Inquilino Inventato', iban: TENANT }, 'pulci'),
      tx('n1', '2027-02-11', 700, { name: 'Genitore Inventato' }, 'pulci'),
    );
    await put(store, 'tenant', [{ ...base, id: 't-mario', name: 'Mario Inventato' }]);
    await put(store, 'payer', [
      {
        ...base,
        id: 'pr-mario',
        key: `iban:${TENANT}`,
        tenantId: 't-mario',
        validFrom: '2027-01-01',
        source: 'confirmed',
      },
    ]);
    return store;
  }
  const reconcile = (store: MemoryStore, prefix = 'r') =>
    runReconciliation(store, 'p1', clock, ids(prefix));

  it('confirmed from the «chi» of the income, the next refund is automatic and no «chi»', async () => {
    const store = await refunds();
    const first = await reconcile(store);
    if (first.status !== 'reconciled') throw new Error('refused');
    expect(first.income.proposals.map((p) => [p.id, p.reason])).toContainEqual([
      'p-chi-r1',
      'new-payer',
    ]);
    expect(first.outgoing).toMatchObject({ written: 0, proposals: [] });

    // A «chi» with a name key only is never an outgoing to confirm.
    expect(await confirm(store, 'p-chi-n1', 'altro', { apartmentId: 'pulci' })).toEqual({
      status: 'refused',
      reason: 'unknown-proposal',
    });
    expect(await confirm(store, 'p-cosa-rent', 'altro', { apartmentId: 'pulci' })).toEqual({
      status: 'refused',
      reason: 'unknown-proposal',
    });
    expect(await confirm(store, 'p-chi-r1', 'utenze', { apartmentId: 'pulci' })).toEqual({
      status: 'confirmed',
      operationId: 'c-1',
      classId: 'mc-r1',
      ruleId: 'rule-r1',
    });
    expect((await rules(store))[0]).toMatchObject({
      direction: 'in',
      accountId: 'acc-pulci',
      key: `iban:${SUPPLIER}`,
      kind: 'utenze',
      apartmentId: 'pulci',
    });

    await put(store, 'transaction', [tx('r2', '2027-03-10', 810, supplier, 'pulci')]);
    const second = await reconcile(store, 's');
    if (second.status !== 'reconciled') throw new Error('refused');
    expect(second.outgoing).toMatchObject({ written: 1, classified: ['r2'] });
    const ids2 = second.income.proposals.map((p) => p.transactionId);
    expect(ids2).not.toContain('r2');
    expect(ids2).not.toContain('r1');
    expect((await classes(store)).find((c) => c.id === 'mc-r2')).toMatchObject({
      kind: 'utenze',
      apartmentId: 'pulci',
      ruleId: 'rule-r1',
    });
    // The rent of the tenant is never classified.
    expect((await classes(store)).map((c) => c.transactionId)).not.toContain('rent');
    expectNoPersonalData(second.outgoing);
  });

  it('the «chi» changed since (a payer saved with that key): unknown-proposal', async () => {
    const store = await refunds();
    await put(store, 'payer', [
      {
        ...base,
        id: 'pr-fornitore',
        key: `iban:${SUPPLIER}`,
        tenantId: 't-mario',
        validFrom: '2027-01-01',
        source: 'manual',
      },
    ]);
    expect(await confirm(store, 'p-chi-r1', 'utenze', { apartmentId: 'pulci' })).toEqual({
      status: 'refused',
      reason: 'unknown-proposal',
    });
  });

  it('an incoming movement is never an F24: f24-not-outgoing, nothing written (R129)', async () => {
    const store = await refunds();
    await reconcile(store);
    const before = await snapshot(store);
    expect(await confirm(store, 'p-chi-r1', 'tasse', { apartmentId: 'pulci', f24: true })).toEqual({
      status: 'refused',
      reason: 'f24-not-outgoing',
    });
    expect(await snapshot(store)).toEqual(before);
  });
});

describe('F24 (plan 3c, task 7, decision 5, question 5)', () => {
  // An invented description: the real text of an F24 at the bank is not verified yet (R129).
  const profile = (f24Pattern?: string) => ({
    ...base,
    id: 'bp',
    bank: 'Banca inventata',
    validFrom: '2020-01-01',
    container: 'csv',
    header: { allOf: ['Data'] },
    columns: { date: 'Data', description: ['Descrizione'], amount: 'Importo' },
    dateFormat: 'DD/MM/YYYY',
    ...(f24Pattern === undefined ? {} : { f24Pattern }),
  });
  async function f24Store(f24Pattern?: string) {
    const store = await storeWith({
      ...tx('f', '2028-02-10', -6700, supplier),
      description: 'PAGAMENTO F24 DELEGA 0001',
    });
    await put(store, 'apartment', [apartment('lovarini')]);
    await put(store, 'bankProfile', [profile(f24Pattern)]);
    return store;
  }
  const f24 = (store: MemoryStore, proposalId: string, kind: OutgoingKind, isF24: boolean) =>
    confirmOutgoing(
      store,
      { proposalId, kind, apartmentId: 'lovarini', rememberRule: true, f24: isF24 },
      'p1',
      clock,
      ids('c'),
    );

  it('a p-f24- proposal, even with a valid rule: the run writes nothing', async () => {
    const store = await f24Store('^PAGAMENTO F24\\b');
    await put(store, 'movementRule', [
      {
        ...base,
        id: 'rule-old',
        direction: 'out',
        accountId: 'acc-berchet',
        key: `iban:${SUPPLIER}`,
        kind: 'tasse',
        apartmentId: 'berchet',
      },
    ]);
    const before = await snapshot(store);
    expect(await run(store)).toEqual({
      status: 'reconciled',
      written: 0,
      classified: [],
      proposals: [
        { id: 'p-f24-f', transactionId: 'f', step: 'f24', reason: 'f24', suggestedKind: 'tasse' },
      ],
      missingDocument: [],
    });
    expect(await snapshot(store)).toEqual(before);
  });

  it('confirmed tasse for Lovarini on the account of Berchet: f24 true, no rule', async () => {
    const store = await f24Store('^PAGAMENTO F24\\b');
    const confirmed = await f24(store, 'p-f24-f', 'tasse', true);
    expect(confirmed).toEqual({ status: 'confirmed', operationId: 'c-1', classId: 'mc-f' });
    expectNoPersonalData(confirmed);
    expect(await classes(store)).toEqual([
      {
        ...base,
        id: 'mc-f',
        transactionId: 'f',
        kind: 'tasse',
        apartmentId: 'lovarini',
        f24: true,
      },
    ]);
    expect(await rules(store)).toEqual([]);
    expect((await run(store)).proposals).toEqual([]);
  });

  it('f24 with another category is f24-not-tasse, nothing written', async () => {
    const store = await f24Store('^PAGAMENTO F24\\b');
    const before = await snapshot(store);
    expect(await f24(store, 'p-f24-f', 'altro', true)).toEqual({
      status: 'refused',
      reason: 'f24-not-tasse',
    });
    expect(await snapshot(store)).toEqual(before);
  });

  it('a p-uscita- confirmed by hand as F24 is one; a p-f24- confirmed with f24 false is not', async () => {
    const plain = await f24Store();
    expect((await run(plain)).proposals.map((p) => p.id)).toEqual(['p-uscita-f']);
    expect(await f24(plain, 'p-uscita-f', 'tasse', true)).toMatchObject({ status: 'confirmed' });
    expect(await classes(plain)).toMatchObject([{ id: 'mc-f', kind: 'tasse', f24: true }]);
    expect(await rules(plain)).toEqual([]);

    // A wrong pattern: an ordinary outgoing, with its rule.
    const wrong = await f24Store('^PAGAMENTO F24\\b');
    expect(await f24(wrong, 'p-f24-f', 'altro', false)).toEqual({
      status: 'confirmed',
      operationId: 'c-1',
      classId: 'mc-f',
      ruleId: 'rule-f',
    });
    const [cls] = await classes(wrong);
    expect(cls).toMatchObject({ kind: 'altro', apartmentId: 'lovarini' });
    expect(cls).not.toHaveProperty('f24');
  });

  it('an undone movement recognised later as an F24 is a p-f24- proposal', async () => {
    const store = await f24Store();
    await put(store, 'movementRule', [
      {
        ...base,
        id: 'rule-old',
        direction: 'out',
        accountId: 'acc-berchet',
        key: `iban:${SUPPLIER}`,
        kind: 'altro',
        apartmentId: 'berchet',
      },
    ]);
    expect((await run(store)).classified).toEqual(['f']);
    expect(await cancelAutomaticClass(store, 'f', 'p1', clock, ids('x'))).toMatchObject({
      status: 'cancelled',
    });
    expect((await run(store, 'r2')).proposals).toMatchObject([
      { id: 'p-uscita-f', reason: 'undone' },
    ]);
    await put(store, 'bankProfile', [profile('^PAGAMENTO F24\\b')]);
    expect((await run(store, 'r3')).proposals).toEqual([
      { id: 'p-f24-f', transactionId: 'f', step: 'f24', reason: 'f24', suggestedKind: 'tasse' },
    ]);
  });
});

describe('uscite verso gli inquilini (plan 3c, task 8, question 9)', () => {
  const tenant = (id: string, extra: Record<string, unknown> = {}) => ({
    ...base,
    id,
    name: 'Inquilino Inventato',
    ...extra,
  });
  const tenancy = (id: string, tenantId: string) => ({
    ...base,
    id,
    apartmentId: 'berchet',
    tenantId,
    from: '2026-01',
    monthlyRent: 50000,
    monthlyForfait: 0,
  });
  async function withTenants(...transactions: ReturnType<typeof tx>[]) {
    const store = await storeWith(...transactions);
    await put(store, 'tenant', [tenant('t1'), tenant('t2'), tenant('t3', { deleted: true })]);
    await put(store, 'tenancy', [tenancy('n1', 't1'), tenancy('n3', 't3')]);
    return store;
  }
  const give = (
    store: MemoryStore,
    proposalId: string,
    tenantId = 't1',
    kind: 'caparra' | 'conguaglio' | 'altro' = 'caparra',
  ) =>
    confirmTenantOutgoing(
      store,
      { proposalId, tenantId, kind, forMonth: '2027-03' as YearMonth },
      'p1',
      clock,
      ids('t'),
    );
  const payments = async (store: MemoryStore) =>
    (await loadAll(store, 'payment', PaymentSchema, { includeDeleted: true })).records;

  it('caparra 600,00 + 5,40 - 67,00: a -538,40 payment, one use, nothing left to propose', async () => {
    const store = await withTenants(tx('x', '2027-03-05', -53840, { name: 'Inquilino Inventato' }));
    const result = await give(store, 'p-uscita-x');
    expect(result).toEqual({ status: 'confirmed', operationId: 't-1', paymentId: 'pay-x-1' });
    expect(await payments(store)).toMatchObject([
      {
        id: 'pay-x-1',
        apartmentId: 'berchet',
        tenantId: 't1',
        date: '2027-03-05',
        amount: -53840,
        confirmed: true,
        kind: 'caparra',
        forMonth: '2027-03',
        source: 'csv',
        transactionId: 'x',
      },
    ]);
    const op = (await readJournal(store)).operations.find((o) => o.id === 't-1');
    expect(op).toMatchObject({
      kind: 'outgoing.tenant',
      apartmentId: 'berchet',
      summary: "Registrata un'uscita verso un inquilino.",
    });
    const again = await run(store);
    expect(again.proposals).toEqual([]);
    expect(again.written).toBe(0);
    expect((await planIncome(store)).result.proposals).toEqual([]);
    expect(await give(store, 'p-uscita-x')).toEqual({
      status: 'refused',
      reason: 'unknown-proposal',
    });
    expect(await confirm(store, 'p-uscita-x')).toEqual({
      status: 'refused',
      reason: 'unknown-proposal',
    });
    expect(
      await excludeMovement(
        store,
        { transactionId: 'x', reason: 'doppione' },
        'p1',
        clock,
        ids('e'),
      ),
    ).toEqual({ status: 'refused', reason: 'has-dependents', recordIds: ['pay-x-1'] });
  });

  it('refusals write nothing: tenant without presence or deleted, unknown proposal, F24, income', async () => {
    const store = await withTenants(
      tx('x', '2027-03-05', -53840),
      tx('i', '2027-03-06', 1000, { iban: SUPPLIER }),
    );
    const before = await snapshot(store);
    for (const tenantId of ['t2', 't3', 'nessuno']) {
      expect(await give(store, 'p-uscita-x', tenantId)).toEqual({
        status: 'refused',
        reason: 'tenant-not-allowed',
      });
    }
    for (const id of ['p-uscita-nessuno', 'p-uscita-i', 'p-f24-x', 'p-chi-i']) {
      expect(await give(store, id)).toEqual({ status: 'refused', reason: 'unknown-proposal' });
    }
    expect(await snapshot(store)).toEqual(before);
  });

  it('never from a rule: a rule on the counterparty makes a class, not a payment', async () => {
    const store = await withTenants(
      tx('a', '2027-01-10', -1000, supplier),
      tx('b', '2027-02-10', -1000, supplier),
    );
    await confirm(store, 'p-uscita-a');
    await run(store, 'r2');
    expect(await payments(store)).toEqual([]);
    expect((await classes(store)).map((c) => c.id)).toEqual(['mc-a', 'mc-b']);
    // A movement with a class is used: no tenant outgoing any more.
    expect(await give(store, 'p-uscita-b')).toEqual({
      status: 'refused',
      reason: 'unknown-proposal',
    });
  });

  it('inconsistent store: refused, and kind canone is no type', async () => {
    const store = await diverged();
    expect(await give(store, 'p-uscita-x')).toEqual({
      status: 'refused',
      reason: 'inconsistent-store',
    });
    const input = { proposalId: 'p-uscita-x', tenantId: 't1', forMonth: '2027-03' as YearMonth };
    const rent = { ...input, kind: 'canone' } as const;
    // canone is the rent: not an outgoing to a tenant
    // @ts-expect-error not assignable to the kinds of an outgoing
    void confirmTenantOutgoing(await withTenants(), rent, 'p1', clock, ids('k'));
  });
  async function diverged() {
    const store = await withTenants(tx('x', '2027-03-05', -53840));
    await diverge(store, 'x');
    return store;
  }
});
