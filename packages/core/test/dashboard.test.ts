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
    codes: ['profile'],
  });
  // Waiting no more: a bill of the same file is registered.
  await put('pendingDocument', {
    ...base,
    id: 'doc-2',
    apartmentId: 'apt-1',
    fileHash: 'H2',
    documentKind: 'bill',
    codes: ['profile'],
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
        },
        {
          apartmentId: 'apt-2',
          counts: { 'movimento-senza-uso': 1, 'scadenza:in-ritardo': 1 },
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
  it('reports the settlement period given and the checks of contracts and condominium', async () => {
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
    const [row] = result.settlements;
    expect(row).toMatchObject({ apartmentId: 'apt-nord', periodLabel: '2026-27' });
    expect(row?.problem).toBeUndefined();
    expect(typeof row?.pending).toBe('number');
    const counts = result.apartments.find((a) => a.apartmentId === 'apt-nord')?.counts ?? {};
    expect(Object.values(counts).every((n) => n > 0)).toBe(true);
  });
});
