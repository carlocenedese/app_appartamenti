// The commands added by the review of 18 November 2026 (missing functions): undo of accounts,
// tenants, bank profiles and supplies, the `riferimenti` diagnosis, the messages of the new
// refusal codes. In process (`main()` of estratti.mjs), invented data only.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FsStore } from '../packages/store-fs/src/fs-store.ts';
import {
  commitChange,
  loadAll,
  readJournal,
  recordPath,
  recordSchemas,
} from '../packages/core/src/index.ts';
import { ibanEndingWith } from '../packages/core/test/helpers/iban-build.ts';
import { MESSAGES, main } from './estratti.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PROFILE = {
  ...JSON.parse(readFileSync(join(ROOT, 'fixtures', 'bank', 'profilo-sintetico.json'), 'utf8')),
  id: 'bp-f',
};
const ORA = '2026-11-18T09:00:00.000Z';

let dir;
let counter = 0;
const newId = () => `f-${String((counter += 1)).padStart(4, '0')}`;
/** One command line in process; the output parsed. */
async function cli(name, ...args) {
  const r = await main([name, '--cartella', dir, '--ora', ORA, ...args], {
    now: () => ORA,
    newId,
  });
  return { code: r.code, json: JSON.parse(r.output), out: r.output };
}
const lastOperation = async () => (await readJournal(new FsStore(dir))).operations.at(-1);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'funzioni-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const apartment = (id = 'apt-x', ...extra) =>
  cli(
    'appartamento',
    '--id',
    id,
    '--nome',
    `Appartamento ${id}`,
    '--locatore',
    'Locatore-Inventato',
    '--posti',
    '2',
    '--annualita',
    '10-01',
    '--esercizio-condominio',
    '10-01',
    '--differenza-condominio',
    'inquilini',
    ...extra,
  );

describe('annullo di conto, profilo, inquilino (revisione annullo, punto 1)', () => {
  it('un appartamento creato per errore con il suo conto si toglie: prima il conto, poi il resto', async () => {
    const profile = join(dir, '..', `profilo-${String(process.pid)}.json`);
    writeFileSync(profile, JSON.stringify(PROFILE));
    try {
      expect((await cli('profilo', profile)).code).toBe(0);
    } finally {
      rmSync(profile, { force: true });
    }
    expect((await apartment()).code).toBe(0);
    expect((await cli('inquilino', '--id', 't-x', '--nome', 'Nome Inventato')).code).toBe(0);
    const account = await cli(
      'conto',
      '--appartamento',
      'apt-x',
      '--profilo',
      'bp-f',
      '--etichetta',
      'Conto-inventato',
      '--iban',
      ibanEndingWith('7100001'),
    );
    expect(account.code).toBe(0);
    const journal = (await readJournal(new FsStore(dir))).operations;
    const kinds = journal.map((o) => o.kind);
    expect(kinds).toEqual(['bank-profile.save', 'apartment.save', 'tenant.save', 'account.save']);
    // The apartment has an account: its undo is refused, with the counts by kind.
    const early = await cli('annulla-riconciliazione', '--operazione', journal[1].id);
    expect(early.code).toBe(1);
    expect(early.json.reason).toBe('has-dependents');
    expect(early.json.counts).toEqual({ account: 1 });
    expect(early.json.message).toMatch(/dipendono da ciò che questa operazione ha creato/);
    // In reverse order everything goes.
    for (const op of [...journal].reverse()) {
      const r = await cli('annulla-riconciliazione', '--operazione', op.id);
      expect(r.code, r.out).toBe(0);
    }
    const store = new FsStore(dir);
    for (const kind of ['apartment', 'account', 'tenant', 'bankProfile']) {
      expect((await loadAll(store, kind, recordSchemas[kind])).records).toEqual([]);
    }
  });

  it('un inquilino con una presenza non si toglie (has-dependents, conteggi)', async () => {
    await apartment();
    await cli('inquilino', '--id', 't-x', '--nome', 'Nome Inventato');
    const tenantOp = await lastOperation();
    expect(
      (
        await cli(
          'presenza',
          '--id',
          'tcy-x',
          '--appartamento',
          'apt-x',
          '--inquilino',
          't-x',
          '--dal',
          '2025-10',
          '--affitto',
          '300,00',
          '--forfait',
          '30,00',
        )
      ).code,
    ).toBe(0);
    const r = await cli('annulla-riconciliazione', '--operazione', tenantOp.id);
    expect(r.code).toBe(1);
    expect(r.json.counts).toEqual({ tenancy: 1 });
    expect(r.out).not.toMatch(/Nome Inventato/);
  });
});

describe('riferimenti (diagnosi)', () => {
  it('vuoto: «Nessun riferimento pendente.»', async () => {
    await apartment();
    const r = await cli('riferimenti');
    expect(r.code).toBe(0);
    expect(r.json).toMatchObject({
      status: 'ok',
      problems: [],
      message: 'Nessun riferimento pendente.',
    });
  });

  it('una presenza di un inquilino che non c’è: solo tipi, id e campo', async () => {
    await apartment();
    const tenancy = recordSchemas.tenancy.parse({
      id: 'tcy-orfana',
      v: 1,
      rev: 1,
      apartmentId: 'apt-x',
      tenantId: 't-mancante',
      from: '2025-10',
      monthlyRent: 30000,
      monthlyForfait: 3000,
    });
    await commitChange(
      new FsStore(dir),
      {
        profileId: 'cli',
        kind: 'test.seed',
        summary: 'presenza inventata',
        changes: [{ path: recordPath('tenancy', tenancy.id), after: tenancy }],
      },
      () => ORA,
      newId,
    );
    const r = await cli('riferimenti');
    expect(r.code).toBe(0);
    expect(r.json.problems).toEqual([
      {
        from: { type: 'tenancy', id: 'tcy-orfana' },
        field: 'tenantId',
        to: { type: 'tenant', id: 't-mancante' },
        message:
          'tenancy tcy-orfana: tenantId punta a tenant t-mancante, che non c’è o è cancellato.',
      },
    ]);
  });
});

describe('messaggi dei codici nuovi', () => {
  it('rooms-in-use, tenancy-in-use: un messaggio italiano e gli id', async () => {
    await apartment('apt-x', '--posti-nomi', 'a,b');
    await apartment('apt-y');
    await cli('inquilino', '--id', 't-x', '--nome', 'Nome Inventato');
    await cli('inquilino', '--id', 't-y', '--nome', 'Altro Inventato');
    const stay = (...extra) =>
      cli(
        'presenza',
        '--id',
        'tcy-x',
        '--appartamento',
        'apt-x',
        '--inquilino',
        't-x',
        '--dal',
        '2025-10',
        '--affitto',
        '300,00',
        '--forfait',
        '30,00',
        '--posto',
        'a',
        ...extra,
      );
    expect((await stay()).code).toBe(0);
    const rooms = await apartment('apt-x', '--posti-nomi', 'c,b');
    expect(rooms.code).toBe(1);
    expect(rooms.json).toMatchObject({
      reason: 'rooms-in-use',
      rooms: ['a'],
      tenancyIds: ['tcy-x'],
    });
    expect(rooms.json.message).toMatch(/^Rifiutato: i posti/);
  });

  it('ogni codice nuovo ha il suo messaggio', () => {
    for (const code of [
      'rooms-in-use',
      'tenancy-in-use',
      'apartment-unknown-room',
      'record-has-dependents',
    ]) {
      expect(MESSAGES[code], code).toMatch(/^Rifiutato: /);
    }
  });
});

describe('utenza (E5)', () => {
  it('collega, rilanciata non scrive, si annulla; quote che non fanno 100% rifiutate', async () => {
    await apartment('apt-x');
    await apartment('apt-y');
    const r = await cli('utenza', '--etichetta', 'UTENZA-X', '--ripartizione', 'apt-x:60;apt-y:40');
    expect(r.code, r.out).toBe(0);
    expect(r.json).toMatchObject({ status: 'saved', supplyId: expect.any(String) });
    const again = await cli(
      'utenza',
      '--etichetta',
      'UTENZA-X',
      '--ripartizione',
      'apt-x:60;apt-y:40',
    );
    expect(again.json).toEqual({ status: 'unchanged', supplyId: r.json.supplyId });
    const other = await cli('utenza', '--etichetta', 'utenza-x', '--appartamento', 'apt-x');
    expect(other.json).toMatchObject({ reason: 'label-in-use', supplyId: r.json.supplyId });
    expect(
      (await cli('utenza', '--etichetta', 'U2', '--ripartizione', 'apt-x:60')).json.reason,
    ).toBe('invalid-supply');
    expect((await cli('utenza', '--etichetta', 'U2', '--appartamento', 'apt-z')).json.reason).toBe(
      'unknown-apartment',
    );
    expect((await cli('utenza', '--etichetta', 'U2')).code).toBe(2);
    expect(r.out).not.toMatch(/UTENZA/);
    const u = await cli('annulla-riconciliazione', '--operazione', r.json.operationId);
    expect(u.code, u.out).toBe(0);
    const { records } = await loadAll(new FsStore(dir), 'supply', recordSchemas.supply);
    expect(records).toEqual([]);
  });
});
