import { describe, expect, it } from 'vitest';
import { commitChange, isoDate, loadDashboard, recordPath, writeRecord } from '../src/index';
import type { RecordKind } from '../src/index';
import { fixtureRecords } from './helpers/excel-fixture';
import type { StoreRecords } from './helpers/excel-fixture';
import { MemoryStore } from './helpers/memory-store';

// Invented apartments, amounts and movements.
const base = { v: 1, rev: 1 };
const apartment = (id: string) => ({
  ...base,
  id,
  name: `Appartamento ${id}`,
  locatore: 'user1',
  posti: 2,
  annualitaStart: { month: 10, day: 1 },
});

async function store() {
  const s = new MemoryStore();
  const put = (kind: string, record: { id: string } & Record<string, unknown>) =>
    s.writeJsonAtomic(recordPath(kind, record.id), record);
  await put('apartment', apartment('apt-1'));
  await put('apartment', apartment('apt-2'));
  await put('pendingDocument', {
    ...base,
    id: 'doc-1',
    apartmentId: 'apt-1',
    fileHash: 'H1',
    documentKind: 'bill',
  });
  // Waiting no more: a bill of the same file is registered.
  await put('pendingDocument', {
    ...base,
    id: 'doc-2',
    apartmentId: 'apt-1',
    fileHash: 'H2',
    documentKind: 'bill',
  });
  await put('bill', {
    ...base,
    id: 'bill-2',
    apartmentId: 'apt-1',
    category: 'gas',
    supplier: 'Fornitore Gas',
    periodStart: '2026-01-01',
    periodEnd: '2026-02-28',
    amount: 5000,
    includedInConguaglio: true,
    sharedWithTenants: true,
    fileHash: 'H2',
    filePath: 'Bollette/Gas/2026/x.pdf',
  });
  const tx = (id: string, extra: Record<string, unknown> = {}) => ({
    ...base,
    id,
    apartmentId: 'apt-2',
    date: '2026-11-02',
    amount: -1234,
    description: 'ADDEBITO DIRETTO',
    statementHash: 'S1',
    ...extra,
  });
  await put('transaction', tx('tx-free'));
  await put('transaction', tx('tx-pending', { booked: false }));
  await put('transaction', tx('tx-used'));
  await put('movementClass', {
    ...base,
    id: 'mc-tx-used',
    transactionId: 'tx-used',
    kind: 'escluso',
    excludeReason: 'non-reale',
  });
  await put('tenancy', {
    ...base,
    id: 'ten-1',
    apartmentId: 'apt-2',
    tenantId: 't-1',
    from: '2026-01',
    monthlyRent: 40000,
    monthlyForfait: 5000,
    expectedDeposit: 80000,
  });
  await put('contract', {
    ...base,
    id: 'ctr-1',
    apartmentId: 'apt-2',
    type: '1+1',
    start: '2026-01',
    end: '2027-12',
    settlement: 'annuale',
    agreedRent: true,
    forStudents: true,
    durationMonths: 12,
    signedOn: '2025-12-20',
    taxRegime: 'cedolare',
    cedolareRateBp: 1000,
    tenancyIds: ['ten-1', 'ten-missing'],
  });
  await put('instalment', {
    ...base,
    id: 'inst-1',
    apartmentId: 'apt-2',
    kind: 'condominio',
    esercizio: '2026-27',
    rateIndex: 1,
    rateCount: 4,
    dueDate: '2026-10-01',
    rata: 30000,
    quotaProprieta: 0,
    conguaglioPrec: 0,
    coversFrom: '2026-10',
    coversTo: '2026-12',
  });
  await put('payable', {
    ...base,
    id: 'scad-1',
    apartmentId: 'apt-2',
    kind: 'registro',
    dueDate: '2026-11-01',
    expected: 6700,
  });
  return s;
}

describe('loadDashboard', () => {
  it('counts by code and apartment, nothing decided', async () => {
    const s = await store();
    const result = await loadDashboard(s, {
      today: isoDate('2026-11-17'),
      settlements: [{ apartmentId: 'apt-1', periodLabel: '2025-26' }],
    });
    expect(result).toEqual({
      status: 'computed',
      apartments: [
        {
          apartmentId: 'apt-1',
          counts: { 'conguaglio:non-calcolabile': 1, 'documento-da-rivedere': 1 },
          consumptionThresholds: false,
        },
        {
          apartmentId: 'apt-2',
          counts: {
            'caparra:mancante': 1,
            // The same instalment in both lists: the two families are not to be summed (R264).
            'condominio:da-verificare': 1,
            'contratto:tenancy-outside-contract': 1,
            'contratto:unknown-tenancy': 1,
            'movimento-senza-uso': 1,
            'scadenza-controllo:periodo-senza-estratto': 1,
            'scadenza:in-ritardo': 2,
          },
          consumptionThresholds: false,
        },
      ],
      settlements: [{ apartmentId: 'apt-1', periodLabel: '2025-26', problem: 'unknown-period' }],
    });
  });

  it('adds the taxes of a year when asked, refuses a bad year', async () => {
    const s = await store();
    const result = await loadDashboard(s, { today: isoDate('2026-01-10'), taxYear: '2026' });
    expect(result.status === 'computed' && result.apartments[0]?.counts).toMatchObject({
      'tasse:stima-mancante': 1,
    });
    expect(await loadDashboard(s, { today: isoDate('2026-01-10'), taxYear: 'xx' })).toEqual({
      status: 'refused',
      reason: 'bad-year',
    });
  });

  it('counts the consumption alarms by level, with the state of the thresholds (R331)', async () => {
    const s = await store();
    // The gas of the year before cost half for the same days: amount +100 %.
    await s.writeJsonAtomic(recordPath('bill', 'gas-prev'), {
      ...base,
      id: 'gas-prev',
      apartmentId: 'apt-1',
      category: 'gas',
      supplier: 'Fornitore Gas',
      periodStart: '2025-01-01',
      periodEnd: '2025-02-28',
      amount: 2500,
      includedInConguaglio: true,
      sharedWithTenants: true,
      fileHash: 'H0',
      filePath: 'Bollette/Gas/2025/x.pdf',
    });
    const board = async () => {
      const r = await loadDashboard(s, { today: isoDate('2026-11-17') });
      if (r.status !== 'computed') throw new Error(r.reason);
      return r.apartments.map((a) => [
        a.consumptionThresholds,
        Object.keys(a.counts).filter((c) => c.startsWith('consumi:')),
      ]);
    };
    expect(await board()).toEqual([
      [false, []],
      [false, []],
    ]);
    const settings = (id: string, extra: Record<string, unknown>) =>
      s.writeJsonAtomic(recordPath('consumptionSettings', id), { ...base, id, ...extra });
    await settings('soglie-consumi-apt-1', { apartmentId: 'apt-1', giallo: { amount: 3000 } });
    expect(await board()).toEqual([
      [true, ['consumi:giallo']],
      [false, []],
    ]);
    await settings('soglie-consumi', { rosso: { amount: 9000 } });
    await settings('soglie-consumi-apt-1', {
      apartmentId: 'apt-1',
      rev: 2,
      giallo: { amount: 3000 },
      rosso: { amount: 9000 },
    });
    expect(await board()).toEqual([
      [true, ['consumi:rosso']],
      [true, []],
    ]);
    const counts = async () => {
      const r = await loadDashboard(s, { today: isoDate('2026-11-17') });
      return r.status === 'computed' ? r.apartments[0]?.counts['consumi:rosso'] : -1;
    };
    // A long history, every year double the one before: still only the last bill counts.
    const gas = (id: string, year: string, amount: number, extra: Record<string, unknown> = {}) =>
      s.writeJsonAtomic(recordPath('bill', id), {
        ...base,
        id,
        apartmentId: 'apt-1',
        category: 'gas',
        supplier: 'Fornitore Gas',
        periodStart: `${year}-01-01`,
        periodEnd: `${year}-02-28`,
        amount,
        includedInConguaglio: true,
        sharedWithTenants: true,
        fileHash: `H-${id}`,
        filePath: `Bollette/Gas/${year}/x.pdf`,
        ...extra,
      });
    await gas('gas-2023', '2023', 625);
    await gas('gas-2024', '2024', 1250);
    expect(await counts()).toBe(1);
    // The next bill is normal: nothing to count; deleted, the one before counts again.
    await gas('gas-2027', '2027', 5000);
    expect(await counts()).toBeUndefined();
    await gas('gas-2027', '2027', 5000, { rev: 2, deleted: true });
    expect(await counts()).toBe(1);
  });

  it('refuses an inconsistent store', async () => {
    const s = await store();
    await commitChange(
      s,
      {
        profileId: 'user1',
        kind: 'test',
        summary: 'Prova',
        changes: [
          { path: recordPath('apartment', 'apt-3'), before: undefined, after: apartment('apt-3') },
        ],
      },
      () => '2026-11-17T09:00:00.000Z',
      () => 'op-x',
    );
    await s.writeJsonAtomic(recordPath('apartment', 'apt-3'), { broken: true });
    expect(await loadDashboard(s, { today: isoDate('2026-11-17') })).toMatchObject({
      status: 'refused',
    });
  });
});

describe('loadDashboard on the Excel fixture', () => {
  it('reports the settlement period given', async () => {
    const s = new MemoryStore();
    for (const [kind, list] of Object.entries(fixtureRecords()) as [
      RecordKind,
      StoreRecords[RecordKind],
    ][]) {
      for (const record of list ?? []) {
        await writeRecord(s, recordPath(kind, record.id), record, { expectedRev: null });
      }
    }
    const result = await loadDashboard(s, {
      today: isoDate('2027-10-15'),
      soonDays: 30,
      settlements: [{ apartmentId: 'apt-nord', periodLabel: '2026-27' }],
    });
    if (result.status !== 'computed') throw new Error(result.reason);
    expect(result.settlements).toEqual([
      { apartmentId: 'apt-nord', periodLabel: '2026-27', pending: 2, unassigned: 8891 },
    ]);
    expect(result.apartments).toEqual([
      {
        apartmentId: 'apt-nord',
        counts: { 'conguaglio:posti-vuoti': 1, 'conguaglio:voci-in-attesa': 2 },
        consumptionThresholds: false,
      },
      { apartmentId: 'apt-sud', counts: {}, consumptionThresholds: false },
    ]);
    // Without periods given, the one in course of each apartment (R316).
    const current = await loadDashboard(s, { today: isoDate('2027-01-15'), soonDays: 30 });
    if (current.status !== 'computed') throw new Error(current.reason);
    expect(current.settlements.map((r) => [r.apartmentId, r.periodLabel])).toEqual([
      ['apt-nord', '2026-27'],
    ]);
  });
});
