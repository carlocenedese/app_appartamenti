import { describe, expect, it } from 'vitest';
import {
  ExtractionResultSchema,
  addSupplyNote,
  InstalmentSchema,
  StaleWriteError,
  SupplySchema,
  TenancySchema,
  commitChange,
  liveSupplies,
  linkSupply,
  loadAll,
  notesFor,
  proposalFromExtraction,
  readJournal,
  recordPath,
  removeSupply,
  saveSupply,
  updateSupply,
} from '../src/index';
import type { SupplyDraft } from '../src/index';
import { MemoryStore } from './helpers/memory-store';

const clock = () => '2026-11-13T09:00:00.000Z';
function ids(prefix = 'id'): () => string {
  let n = 0;
  return () => `${prefix}-${String(++n)}`;
}
const draft = (over: Partial<SupplyDraft> = {}): SupplyDraft => ({
  label: 'Appartamento A',
  rows: [
    { apartmentId: 'apt-b', basisPoints: 6000 },
    { apartmentId: 'apt-l', basisPoints: 4000 },
  ],
  note: '',
  ...over,
});
const files = (store: MemoryStore) => store.list('_app/journal');

describe('linkSupply', () => {
  it('writes the supply and its note in one operation', async () => {
    const store = new MemoryStore();
    const supply = await linkSupply(
      store,
      draft({ note: '  contatore in cortile ' }),
      'p1',
      clock,
      ids(),
    );
    expect(supply).toMatchObject({ id: 'id-1', label: 'Appartamento A', rev: 1 });
    expect(supply.apartments).toEqual([
      { apartmentId: 'apt-b', weight: 6000 },
      { apartmentId: 'apt-l', weight: 4000 },
    ]);
    const { operations } = await readJournal(store);
    expect(operations).toHaveLength(1);
    expect(operations[0]?.kind).toBe('supply.link');
    expect(operations[0]?.changes).toHaveLength(2);
    const notes = await notesFor(store, 'supply', supply.id);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      text: 'contatore in cortile',
      profileId: 'p1',
      at: clock(),
      visibleToTenants: false,
    });
  });

  it('writes no note for a blank one', async () => {
    const store = new MemoryStore();
    await linkSupply(store, draft({ note: '   ' }), 'p1', clock, ids());
    expect((await readJournal(store)).operations[0]?.changes).toHaveLength(1);
  });

  it('writes nothing for an invalid draft or an empty label', async () => {
    const store = new MemoryStore();
    const bad = draft({ rows: [{ apartmentId: 'apt-b', basisPoints: 5000 }] });
    await expect(linkSupply(store, bad, 'p1', clock, ids())).rejects.toThrow();
    await expect(linkSupply(store, draft({ label: '' }), 'p1', clock, ids())).rejects.toThrow();
    expect(await files(store)).toEqual([]);
    expect(await store.list('_app/dati/supply')).toEqual([]);
  });
});

describe('linkSupply duplicate label', () => {
  it('refuses a second live supply with the same label, ignoring case', async () => {
    const store = new MemoryStore();
    await linkSupply(store, draft(), 'p1', clock, ids('a'));
    await expect(
      linkSupply(store, draft({ label: 'APPARTAMENTO A' }), 'p1', clock, ids('b')),
    ).rejects.toThrow("Esiste già un'utenza con questa etichetta.");
    expect(await files(store)).toHaveLength(1);
  });

  it('allows the label again once the first supply is removed', async () => {
    const store = new MemoryStore();
    const first = await linkSupply(store, draft(), 'p1', clock, ids('a'));
    await removeSupply(store, first, 'p1', clock, ids('r'));
    await expect(linkSupply(store, draft(), 'p1', clock, ids('b'))).resolves.toBeDefined();
  });
});

describe('addSupplyNote', () => {
  it('writes one supply.note operation with a trimmed private note', async () => {
    const store = new MemoryStore();
    const supply = await linkSupply(store, draft(), 'p1', clock, ids('a'));
    const note = await addSupplyNote(
      store,
      supply,
      '  Contatore in cortile ',
      'p1',
      clock,
      ids('n'),
    );
    expect(note).toMatchObject({
      targetType: 'supply',
      targetId: supply.id,
      text: 'Contatore in cortile',
      profileId: 'p1',
      visibleToTenants: false,
    });
    const ops = (await readJournal(store)).operations;
    expect(ops.map((o) => o.kind).sort()).toEqual(['supply.link', 'supply.note']);
    expect(await notesFor(store, 'supply', supply.id)).toHaveLength(1);
  });

  it('refuses an empty or too long text before writing anything', async () => {
    const store = new MemoryStore();
    const supply = await linkSupply(store, draft(), 'p1', clock, ids('a'));
    for (const text of ['', '   ', 'x'.repeat(2001)]) {
      await expect(addSupplyNote(store, supply, text, 'p1', clock, ids('n'))).rejects.toThrow(
        RangeError,
      );
    }
    expect(await files(store)).toHaveLength(1);
    expect(await notesFor(store, 'supply', supply.id)).toEqual([]);
  });
});

describe('updateSupply', () => {
  it('replaces label and apartments in one operation', async () => {
    const store = new MemoryStore();
    const supply = await linkSupply(store, draft(), 'p1', clock, ids('a'));
    const next = await updateSupply(
      store,
      supply,
      draft({ label: 'Appartamento A bis', rows: [{ apartmentId: 'apt-b', basisPoints: 10000 }] }),
      'p1',
      clock,
      ids('b'),
    );
    expect(next).toMatchObject({ id: supply.id, label: 'Appartamento A bis', rev: 2 });
    expect(next.apartments).toEqual([{ apartmentId: 'apt-b', weight: 10000 }]);
    const ops = (await readJournal(store)).operations;
    expect(ops.map((o) => o.kind).sort()).toEqual(['supply.link', 'supply.update']);
  });

  it('refuses a bad sum and leaves the record as it was', async () => {
    const store = new MemoryStore();
    const supply = await linkSupply(store, draft(), 'p1', clock, ids('a'));
    const before = store.getRaw(recordPath('supply', supply.id));
    const bad = draft({ rows: [{ apartmentId: 'apt-b', basisPoints: 9000 }] });
    await expect(updateSupply(store, supply, bad, 'p1', clock, ids('b'))).rejects.toThrow();
    expect(store.getRaw(recordPath('supply', supply.id))).toBe(before);
    expect(await files(store)).toHaveLength(1);
  });

  it('gives StaleWriteError to the second of two concurrent updates', async () => {
    const store = new MemoryStore();
    const supply = await linkSupply(store, draft(), 'p1', clock, ids('a'));
    const one = draft({ label: 'Uno' });
    await updateSupply(store, supply, one, 'p1', clock, ids('b'));
    await expect(
      updateSupply(store, supply, draft({ label: 'Due' }), 'p2', clock, ids('c')),
    ).rejects.toBeInstanceOf(StaleWriteError);
    expect(await files(store)).toHaveLength(2);
  });
});

describe('removeSupply and liveSupplies', () => {
  it('marks the supply deleted and stops listing it', async () => {
    const store = new MemoryStore();
    const a = await linkSupply(store, draft(), 'p1', clock, ids('a'));
    const b = await linkSupply(store, draft({ label: 'Appartamento B' }), 'p1', clock, ids('b'));
    expect((await liveSupplies(store)).map((s) => s.id)).toEqual([a.id, b.id]);
    const gone = await removeSupply(store, a, 'p1', clock, ids('c'));
    expect(gone).toMatchObject({ deleted: true, rev: 2 });
    expect((await liveSupplies(store)).map((s) => s.id)).toEqual([b.id]);
    const ops = (await readJournal(store)).operations;
    expect(ops.some((o) => o.kind === 'supply.remove')).toBe(true);
    expect(
      SupplySchema.parse(JSON.parse(store.getRaw(recordPath('supply', a.id)) ?? '')),
    ).toBeTruthy();
  });

  it('refuses a broken file instead of leaving a supply out (G6)', async () => {
    const store = new MemoryStore();
    await linkSupply(store, draft(), 'p1', clock, ids('a'));
    store.putRaw('_app/dati/supply/broken.json', '{ not json');
    await expect(liveSupplies(store)).rejects.toMatchObject({ name: 'UnreadableRecordsError' });
  });

  it('makes the label unknown again for a proposal and leaves registered instalments alone', async () => {
    const store = new MemoryStore();
    const source = { page: 1, box: [10, 20, 110, 40], text: 't' };
    const f = (value: unknown) => ({ value, confidence: 'high', source });
    const result = ExtractionResultSchema.parse({
      v: 1,
      engineVersion: '0.1.0',
      fileHash: 'a'.repeat(64),
      fileName: 'tari.pdf',
      pages: 1,
      pageRange: [1, 1],
      status: 'riconosciuta',
      profileId: 'prof-1',
      profileRev: 1,
      kind: 'tari',
      documentKind: 'tari',
      category: null,
      fields: {
        supplier: f('Comune di Esempio'),
        number: f('2026/1/00001'),
        issueDate: f('2026-02-20'),
        dueDate: f('2026-03-16'),
        periodStart: f('2026-01-01'),
        periodEnd: f('2026-04-30'),
        amount: f(10075),
      },
      parts: [{ label: 'Appartamento A', amount: 10075, source }],
      identifiers: [],
      checks: [{ code: 'total-matches-items', ok: true, message: 'ok' }],
      warnings: [],
      textSource: 'pdf',
      ocrPages: [],
    });
    const tenancies = [
      TenancySchema.parse({
        id: 't1',
        v: 1,
        rev: 1,
        apartmentId: 'apt-b',
        tenantId: 'tt',
        from: '2025-01',
        monthlyRent: 40000,
        monthlyForfait: 5000,
      }),
    ];
    const build = async () =>
      proposalFromExtraction(
        result,
        {
          apartment: { id: 'apt-b', knownCodes: [] },
          bills: [],
          instalments: [],
          tenancies,
          thresholds: { consumptionAnomalyPercent: 30 },
          supplies: (await liveSupplies(store)).map(({ id, label, apartments, deleted }) => ({
            id,
            label,
            apartments,
            deleted,
          })),
        },
        ids('i'),
      );
    const supply = await linkSupply(
      store,
      draft({ rows: [{ apartmentId: 'apt-b', basisPoints: 10000 }] }),
      'p1',
      clock,
      ids('s'),
    );
    const before = await build();
    if (before.kind !== 'tari') throw new Error('expected tari');
    expect(before.checks.map((c) => c.code)).not.toContain('unknown-part');
    const [first] = before.instalments;
    const record = InstalmentSchema.parse({ ...first, v: 1, rev: 1, fileHash: 'a'.repeat(64) });
    await commitChange(
      store,
      {
        profileId: 'p1',
        kind: 'instalment.register',
        summary: 'rata',
        changes: [{ path: recordPath('instalment', record.id), before: undefined, after: record }],
      },
      clock,
      ids('o'),
    );
    const stored = store.getRaw(recordPath('instalment', record.id));

    await removeSupply(store, supply, 'p1', clock, ids('r'));
    const after = await build();
    expect(after.checks.find((c) => c.code === 'unknown-part')?.severity).toBe('fail');
    expect(store.getRaw(recordPath('instalment', record.id))).toBe(stored);
    expect((await loadAll(store, 'instalment', InstalmentSchema)).records).toHaveLength(1);
  });
});

describe('saveSupply (CLI, review of 18 Nov 2026, E5)', () => {
  const apt = (id: string) => ({
    id,
    v: 1,
    rev: 1,
    name: `Appartamento ${id}`,
    locatore: 'L',
    posti: 2,
    annualitaStart: { month: 10, day: 1 },
  });
  async function withApartments() {
    const store = new MemoryStore();
    for (const id of ['apt-b', 'apt-l']) {
      await store.writeJsonAtomic(recordPath('apartment', id), apt(id));
    }
    return store;
  }
  it('links once; the same request again is unchanged; the same label otherwise is refused', async () => {
    const store = await withApartments();
    const first = await saveSupply(store, draft(), 'p1', clock, ids());
    expect(first).toMatchObject({ status: 'saved', supplyId: 'id-1' });
    expect(await saveSupply(store, draft(), 'p1', clock, ids('x'))).toEqual({
      status: 'unchanged',
      supplyId: 'id-1',
    });
    expect(
      await saveSupply(
        store,
        draft({ label: 'appartamento a', rows: [{ apartmentId: 'apt-b', basisPoints: 10000 }] }),
        'p1',
        clock,
        ids('y'),
      ),
    ).toEqual({ status: 'refused', reason: 'label-in-use', supplyId: 'id-1' });
    expect((await readJournal(store)).operations).toHaveLength(1);
  });
  it('gives the id of its own operation, also when another one sorts after it', async () => {
    const store = await withApartments();
    await commitChange(
      store,
      { profileId: 'p1', kind: 'test.seed', summary: 'x', changes: [] },
      clock,
      () => 'zz-later',
    );
    const saved = await saveSupply(store, draft(), 'p1', clock, ids('aa'));
    const op = (await readJournal(store)).operations.find((o) => o.kind === 'supply.link');
    expect(saved).toMatchObject({ status: 'saved', operationId: op?.id });
  });

  it('refuses an unknown apartment and a draft that does not add up', async () => {
    const store = await withApartments();
    expect(
      await saveSupply(
        store,
        draft({ rows: [{ apartmentId: 'apt-z', basisPoints: 10000 }] }),
        'p1',
        clock,
        ids(),
      ),
    ).toEqual({ status: 'refused', reason: 'unknown-apartment' });
    expect(
      await saveSupply(
        store,
        draft({ rows: [{ apartmentId: 'apt-b', basisPoints: 9000 }] }),
        'p1',
        clock,
        ids(),
      ),
    ).toEqual({ status: 'refused', reason: 'invalid-supply' });
    expect(await saveSupply(store, draft({ label: ' ' }), 'p1', clock, ids())).toEqual({
      status: 'refused',
      reason: 'invalid-supply',
    });
  });
});
