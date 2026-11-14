import { describe, expect, it } from 'vitest';
import { PaymentSchema, confirmIncome, loadAll, runReconcile } from '../src/index';
import { clock, ids, year, yearStore } from './helpers/income-year';

const PARENT = new Set(
  (year.records.transaction as { id: string; counterparty?: { name?: string } }[])
    .filter((t) => t.counterparty?.name === 'Elena Bianchi')
    .map((t) => t.id),
);

const automatic = async (store: Awaited<ReturnType<typeof yearStore>>) =>
  (await loadAll(store, 'payment', PaymentSchema)).records
    .filter((p) => p.id === `pay-${p.transactionId ?? ''}`)
    .map((p) => ({ transactionId: p.transactionId, forMonth: p.forMonth }));

describe('a synthetic year of income', () => {
  it('registers exactly the expected automatic payments, then the later months after one confirmation per payer', async () => {
    const store = await yearStore();
    const newId = ids('op');

    const first = await runReconcile(store, 'p1', clock, newId);
    if (first.status !== 'reconciled') throw new Error('refused');
    expect(await automatic(store)).toEqual(year.expected.initialAutomatic);
    expect(first.written).toBe(year.expected.initialAutomatic.length);

    for (const c of year.expected.confirmations) {
      expect((await confirmIncome(store, c, 'p1', clock, newId)).status).toBe('confirmed');
    }
    const second = await runReconcile(store, 'p1', clock, newId);
    if (second.status !== 'reconciled') throw new Error('refused');
    expect(second.written).toBe(year.expected.afterAutomatic.length);
    expect((await automatic(store)).filter((a) => a.transactionId !== 'tx-anna-2026-01')).toEqual(
      year.expected.afterAutomatic,
    );
    expect(second.proposals.map((p) => p.id)).toEqual(year.expected.afterProposals);
    // No «chi» is left but those of the parent, who pays for two children: never automatic.
    for (const p of second.proposals) {
      expect(p).toMatchObject({ step: 'chi', reason: 'multi-tenant' });
      expect([...p.tenantIds].sort()).toEqual(['t-carla', 't-dario']);
      expect(PARENT.has(p.transactionId)).toBe(true);
    }
    expect((await automatic(store)).some((a) => PARENT.has(a.transactionId ?? ''))).toBe(false);
    expect(second.skipped).toBe(year.expected.skipped.length);
  });
});
