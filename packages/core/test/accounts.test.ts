import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  AccountSchema,
  BankProfileSchema,
  commitChange,
  isoDate,
  loadAll,
  readJournal,
  recordPath,
  saveAccount,
  saveBankProfile,
  statementFilePath,
  undoOperation,
} from '../src/index';
import type { Account, Apartment } from '../src/index';
import { apartment } from './helpers/conguaglio-builders';
import { MemoryStore } from './helpers/memory-store';

const clock = () => '2026-11-14T09:00:00.000Z';
function ids(prefix = 'id'): () => string {
  let n = 0;
  return () => `${prefix}-${String(++n)}`;
}
const profile = BankProfileSchema.parse(
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../../../fixtures/bank/profilo-sintetico.json', import.meta.url)),
      'utf8',
    ),
  ),
);
// The documented example IBAN, written in pieces and with spaces: no whole IBAN in the source.
const SPACED = 'it60 X054 2811 1010 0000 0123 456';
const NORMAL = 'IT60X0542811101000000123456';
const draft = (over: Partial<Omit<Account, 'id' | 'v' | 'rev'>> = {}) => ({
  apartmentId: 'apt',
  label: 'Conto di prova',
  bankProfileId: profile.id,
  iban: SPACED,
  ...over,
});
async function seeded(): Promise<MemoryStore> {
  const store = new MemoryStore();
  const apt = apartment();
  await commitChange(
    store,
    {
      profileId: 'p1',
      kind: 'apartment.create',
      summary: 'x',
      changes: [{ path: recordPath('apartment', apt.id), before: undefined, after: apt }],
    },
    clock,
    ids('s'),
  );
  await saveBankProfile(store, profile, 'p1', clock, ids('b'));
  return store;
}

describe('saveBankProfile', () => {
  it('writes the profile in one bank-profile.save, a second save is a new rev', async () => {
    const store = await seeded();
    const { records } = await loadAll(store, 'bankProfile', BankProfileSchema);
    expect(records).toHaveLength(1);
    expect(records[0]?.rev).toBe(1);
    const op = await saveBankProfile(store, { ...profile, bank: 'Altra' }, 'p1', clock, ids('c'));
    expect(op.kind).toBe('bank-profile.save');
    const again = await loadAll(store, 'bankProfile', BankProfileSchema);
    expect(again.records[0]).toMatchObject({ bank: 'Altra', rev: 2 });
  });

  it('saves again a profile that was deleted, on top of its rev', async () => {
    const store = await seeded();
    const [stored] = (await loadAll(store, 'bankProfile', BankProfileSchema)).records;
    if (stored === undefined) throw new Error('missing');
    await commitChange(
      store,
      {
        profileId: 'p1',
        kind: 'bank-profile.remove',
        summary: 'x',
        changes: [{ path: recordPath('bankProfile', stored.id), before: stored, after: undefined }],
      },
      clock,
      ids('r'),
    );
    await saveBankProfile(store, profile, 'p1', clock, ids('c'));
    const { records } = await loadAll(store, 'bankProfile', BankProfileSchema);
    expect(records[0]?.rev).toBe(3);
  });

  it('refuses a profile that is not valid, writing nothing', async () => {
    const store = new MemoryStore();
    await expect(
      saveBankProfile(store, { ...profile, bank: '' }, 'p1', clock, ids()),
    ).rejects.toThrow();
    expect(await store.list('_app/journal')).toEqual([]);
  });
});

describe('saveAccount', () => {
  it('saves the IBAN normalised, as one undoable operation', async () => {
    const store = await seeded();
    const result = await saveAccount(store, draft(), 'p1', clock, ids('a'));
    expect(result.status).toBe('saved');
    if (result.status !== 'saved') return;
    expect(result.account).toMatchObject({ iban: NORMAL, rev: 1, v: 1, apartmentId: 'apt' });
    const { operations } = await readJournal(store);
    const op = operations.find((o) => o.kind === 'account.save');
    expect(op?.id).toBe(result.operationId);
    await undoOperation(store, result.operationId, 'p1', clock, ids('u'));
    expect((await loadAll(store, 'account', AccountSchema)).records).toEqual([]);
  });

  it('saves an account without IBAN, twice', async () => {
    const store = await seeded();
    const bare = draft({ iban: undefined });
    expect((await saveAccount(store, bare, 'p1', clock, ids('a'))).status).toBe('saved');
    expect((await saveAccount(store, bare, 'p1', clock, ids('b'))).status).toBe('saved');
  });

  it('rejects the same IBAN on a second account, however it is written', async () => {
    const store = await seeded();
    await saveAccount(store, draft(), 'p1', clock, ids('a'));
    expect(await saveAccount(store, draft({ iban: NORMAL }), 'p1', clock, ids('b'))).toEqual({
      status: 'rejected',
      reason: 'iban-in-use',
    });
    expect((await store.list('_app/dati/account')).length).toBe(1);
  });

  it('rejects a wrong IBAN, an unknown or deleted apartment, an unknown profile', async () => {
    const store = await seeded();
    const bad = `IT${'00'}X0542811101000000123456`;
    expect(await saveAccount(store, draft({ iban: bad }), 'p1', clock, ids('a'))).toEqual({
      status: 'rejected',
      reason: 'bad-iban',
    });
    expect(await saveAccount(store, draft({ apartmentId: 'nope' }), 'p1', clock, ids('b'))).toEqual(
      { status: 'rejected', reason: 'unknown-apartment' },
    );
    expect(
      await saveAccount(store, draft({ bankProfileId: 'nope' }), 'p1', clock, ids('c')),
    ).toEqual({ status: 'rejected', reason: 'unknown-bank-profile' });
    const apt = apartment();
    await commitChange(
      store,
      {
        profileId: 'p1',
        kind: 'apartment.remove',
        summary: 'x',
        changes: [{ path: recordPath('apartment', apt.id), before: apt, after: undefined }],
      },
      clock,
      ids('d'),
    );
    expect(await saveAccount(store, draft(), 'p1', clock, ids('e'))).toEqual({
      status: 'rejected',
      reason: 'unknown-apartment',
    });
    expect(await store.list('_app/dati/account')).toEqual([]);
  });

  it('frees the IBAN of a deleted account', async () => {
    const store = await seeded();
    const first = await saveAccount(store, draft(), 'p1', clock, ids('a'));
    if (first.status !== 'saved') throw new Error('not saved');
    await commitChange(
      store,
      {
        profileId: 'p1',
        kind: 'account.remove',
        summary: 'x',
        changes: [
          {
            path: recordPath('account', first.account.id),
            before: first.account,
            after: undefined,
          },
        ],
      },
      clock,
      ids('r'),
    );
    expect((await saveAccount(store, draft(), 'p1', clock, ids('b'))).status).toBe('saved');
  });
});

describe('statementFilePath', () => {
  const apt = (over: Partial<Apartment> = {}) => ({ ...apartment(), name: 'Berchet_3', ...over });
  const path = (over: Partial<Parameters<typeof statementFilePath>[0]> = {}) =>
    statementFilePath({
      apartment: apt(),
      to: isoDate('2026-10-31'),
      bank: 'Banca',
      ext: 'xlsx',
      ...over,
    });

  it('files the statement by apartment, lease year and month', () => {
    expect(path()).toBe(
      'Riservato_proprietari/Estratti_conto/Berchet_3/2026-27/2026-10-31_Estratto_Banca_2026-10.xlsx',
    );
  });

  it('puts the month before the lease-year start in the previous year', () => {
    expect(path({ to: isoDate('2027-09-30'), ext: 'csv' })).toBe(
      'Riservato_proprietari/Estratti_conto/Berchet_3/2026-27/2027-09-30_Estratto_Banca_2027-09.csv',
    );
    expect(path({ to: isoDate('2026-09-30') })).toContain('/2025-26/');
  });

  it('makes names safe: no colon, accent or Windows forbidden character, NFC, no reserved name', () => {
    const p = path({ apartment: apt({ name: 'Città: "Nord"?' }), bank: 'Banca d’Italia: <sede>*' });
    expect(p).toBe(
      'Riservato_proprietari/Estratti_conto/Citta-Nord/2026-27/2026-10-31_Estratto_Banca-d-Italia-sede_2026-10.xlsx',
    );
    expect(p).toMatch(/^[A-Za-z0-9_\-/.]+$/);
    expect(path({ apartment: apt({ name: 'CON' }) })).toContain('/Appartamento_CON/');
    expect(path({ apartment: apt({ name: '???' }) })).toContain('/Appartamento/');
    expect(path({ bank: '' })).toContain('_Estratto_Banca_');
  });
});
