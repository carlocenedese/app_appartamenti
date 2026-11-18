// The commands added by the review of 18 November 2026 (missing functions): undo of accounts,
// tenants, bank profiles and supplies, the `riferimenti` diagnosis, the messages of the new
// refusal codes. In process (`main()` of estratti.mjs), invented data only.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FsStore } from '../packages/store-fs/src/fs-store.ts';
import {
  DATA_FORMAT,
  commitChange,
  loadAll,
  readJournal,
  recordPath,
  recordSchemas,
} from '../packages/core/src/index.ts';
import { ibanEndingWith } from '../packages/core/test/helpers/iban-build.ts';
import { COMMAND_HELP } from './estratti-aiuto.mjs';
import * as excelTool from './excel.mjs';
import * as moduliTool from './moduli.mjs';
import { COMMAND_NAMES, MESSAGES, main } from './estratti.mjs';

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

describe('rata-condominio (I3, E4)', () => {
  const rata = (...extra) =>
    cli(
      'rata-condominio',
      '--id',
      'rata-x-1',
      '--appartamento',
      'apt-x',
      '--esercizio',
      '2025-26',
      '--rata',
      '1/3',
      '--scadenza',
      '2025-10-10',
      '--importo',
      '150,00',
      '--quota-proprieta',
      '18,00',
      '--conguaglio-prec',
      '-48,00',
      ...extra,
    );
  it('scrive la rata con i suoi mesi, rilanciata non scrive, si annulla', async () => {
    await apartment();
    const r = await rata();
    expect(r.code, r.out).toBe(0);
    expect(r.json).toMatchObject({ status: 'saved', instalmentId: 'rata-x-1' });
    expect(r.out).not.toMatch(/15000|1800|4800/);
    const [saved] = (await loadAll(new FsStore(dir), 'instalment', recordSchemas.instalment))
      .records;
    expect(saved).toMatchObject({
      kind: 'condominio',
      rata: 15000,
      quotaProprieta: 1800,
      conguaglioPrec: -4800,
      coversFrom: '2025-10',
      coversTo: '2026-01',
    });
    expect((await rata()).json).toEqual({ status: 'unchanged', instalmentId: 'rata-x-1' });
    const second = await cli(
      'rata-condominio',
      '--id',
      'rata-x-2',
      '--appartamento',
      'apt-x',
      '--esercizio',
      '2025-26',
      '--rata',
      '2/3',
      '--scadenza',
      '2026-01-10',
      '--importo',
      '150,00',
      '--quota-proprieta',
      '24,00',
    );
    expect(second.json.warnings).toEqual([
      {
        code: 'owner-share-differs',
        instalmentIds: ['rata-x-1', 'rata-x-2'],
        message: expect.stringMatching(/^Attenzione: /),
      },
    ]);
    for (const op of [second.json.operationId, r.json.operationId]) {
      expect((await cli('annulla-riconciliazione', '--operazione', op)).code).toBe(0);
    }
    expect(
      (await loadAll(new FsStore(dir), 'instalment', recordSchemas.instalment)).records,
    ).toEqual([]);
  });
  it('rifiuti: senza esercizio del condominio, rata non valida, argomenti', async () => {
    await cli(
      'appartamento',
      '--id',
      'apt-x',
      '--nome',
      'X',
      '--locatore',
      'L',
      '--posti',
      '2',
      '--annualita',
      '10-01',
      '--differenza-condominio',
      'inquilini',
    );
    expect((await rata()).json.reason).toBe('missing-condominio-start');
    await apartment();
    expect((await rata('--rata', '2/3')).code).toBe(2);
    const bad = await cli(
      'rata-condominio',
      '--id',
      'rata-x-1',
      '--appartamento',
      'apt-x',
      '--esercizio',
      '2025',
      '--rata',
      '1/5',
      '--scadenza',
      '2025-10-10',
      '--importo',
      '150,00',
    );
    expect(bad.json.reason).toBe('esercizio-format');
    expect(bad.json.message).toMatch(/2026-27/);
    expect((await cli('rata-condominio', '--id', 'r')).code).toBe(2);
  });
});

describe('impostazioni (I9)', () => {
  it('legge il predefinito, lo cambia, rilanciata non scrive, torna al predefinito, si annulla', async () => {
    const read = await cli('impostazioni');
    expect(read.json).toEqual({
      status: 'ok',
      settings: { imuTolerance: { basisPoints: 100, isDefault: true } },
    });
    const set = await cli('impostazioni', '--tolleranza-imu', '1,5');
    expect(set.json).toMatchObject({
      status: 'saved',
      settings: { imuTolerance: { basisPoints: 150, isDefault: false } },
    });
    expect((await cli('impostazioni', '--tolleranza-imu', '1,50')).json.status).toBe('unchanged');
    expect((await cli('impostazioni', '--tolleranza-imu', 'tanto')).code).toBe(2);
    // 0 = no tolerance, as the schema allows.
    const zero = await cli('impostazioni', '--tolleranza-imu', '0');
    expect(zero.json.settings.imuTolerance).toEqual({ basisPoints: 0, isDefault: false });
    await cli('annulla-riconciliazione', '--operazione', zero.json.operationId);
    const back = await cli('impostazioni', '--tolleranza-imu', 'predefinita');
    expect(back.json.settings.imuTolerance).toEqual({ basisPoints: 100, isDefault: true });
    for (const op of [back.json.operationId, set.json.operationId]) {
      expect((await cli('annulla-riconciliazione', '--operazione', op)).code).toBe(0);
    }
    expect((await cli('impostazioni')).json.settings.imuTolerance.isDefault).toBe(true);
  });
});

describe('chiudi-periodo e conguaglio-supplementare (I2, R5)', () => {
  // Invented: one bed, one tenant all year (450,00 + 30,00 a month), a bill of 90,00 paid.
  const MONTHS = Array.from({ length: 12 }, (_, i) => {
    const n = 2025 * 12 + 9 + i;
    return `${String(Math.floor(n / 12))}-${String((n % 12) + 1).padStart(2, '0')}`;
  });
  const bill = (id, dueDate) => ({
    id,
    v: 1,
    rev: 1,
    apartmentId: 'apt-x',
    category: 'elettricita',
    supplier: 'Fornitore inventato',
    dueDate,
    periodStart: '2026-07-01',
    periodEnd: '2026-09-30',
    amount: 9000,
    includedInConguaglio: true,
    sharedWithTenants: true,
    fileHash: `hash-${id}`,
    filePath: `bollette/${id}.pdf`,
  });
  const matchOf = (b) => ({
    id: `m-${b.id}`,
    v: 1,
    rev: 1,
    itemType: 'bill',
    itemId: b.id,
    transactionId: `tx-${b.id}`,
    transactionDate: b.dueDate,
    amount: 9000,
    part: 'amount',
    confirmed: true,
    by: 'manual',
  });
  async function seed(records) {
    await commitChange(
      new FsStore(dir),
      {
        profileId: 'cli',
        kind: 'test.seed',
        summary: 'dati inventati',
        changes: records.map(([kind, r]) => ({
          path: recordPath(kind, r.id),
          after: recordSchemas[kind].parse(r),
        })),
      },
      () => ORA,
      newId,
    );
  }
  async function closable(months = MONTHS) {
    await cli(
      'appartamento',
      '--id',
      'apt-x',
      '--nome',
      'X',
      '--locatore',
      'L',
      '--posti',
      '1',
      '--annualita',
      '10-01',
      '--differenza-condominio',
      'inquilini',
    );
    await cli('inquilino', '--id', 't-x', '--nome', 'Nome Inventato');
    const b = bill('b-lug', '2026-10-10');
    await seed([
      [
        'contract',
        {
          id: 'ctr-x',
          v: 1,
          rev: 1,
          apartmentId: 'apt-x',
          type: '1+1',
          start: '2025-10',
          end: '2026-09',
          settlement: 'annuale',
        },
      ],
      [
        'tenancy',
        {
          id: 'tcy-x',
          v: 1,
          rev: 1,
          apartmentId: 'apt-x',
          tenantId: 't-x',
          from: '2025-10',
          monthlyRent: 45000,
          monthlyForfait: 3000,
        },
      ],
      ['bill', b],
      ['match', matchOf(b)],
      ...months.map((m) => [
        'payment',
        {
          id: `pay-${m}`,
          v: 1,
          rev: 1,
          apartmentId: 'apt-x',
          tenantId: 't-x',
          date: `${m}-05`,
          amount: 48000,
          confirmed: true,
          kind: 'canone',
          forMonth: m,
          source: 'csv',
        },
      ]),
    ]);
  }
  const args = ['--appartamento', 'apt-x', '--periodo', '2025-26'];

  it('rifiuta con un mese non pagato: mesi e codici, importi solo con --dettagli', async () => {
    await closable(MONTHS.slice(0, 11));
    const r = await cli('chiudi-periodo', ...args);
    expect(r.code).toBe(1);
    expect(r.json).toMatchObject({
      reason: 'cannot-close',
      missing: [
        { tenantId: 't-x', month: '2026-09', kind: 'rent' },
        { tenantId: 't-x', month: '2026-09', kind: 'forfait' },
      ],
    });
    expect(r.out).not.toMatch(/45000|3000\b/);
    const d = await cli('chiudi-periodo', ...args, '--dettagli');
    expect(d.json.missing[0].amount).toBe(45000);
    expect((await cli('conguaglio-supplementare', ...args)).json).toEqual({ status: 'open' });
  });

  it('chiude, il cruscotto dice «chiuso», una bolletta tardiva dà il supplementare, l’annullo riapre', async () => {
    await closable();
    expect(
      (await cli('cruscotto', '--periodo-conguaglio', 'apt-x:2025-26')).json.settlements,
    ).toEqual([{ apartmentId: 'apt-x', periodLabel: '2025-26', pending: 0, state: 'provvisorio' }]);
    const closed = await cli('chiudi-periodo', ...args);
    expect(closed.json).toMatchObject({ status: 'closed', closeId: 'chiusura-apt-x-2025-26' });
    expect((await cli('chiudi-periodo', ...args)).json.reason).toBe('already-closed');
    const board = await cli('cruscotto', '--periodo-conguaglio', 'apt-x:2025-26');
    expect(board.json.settlements[0].state).toBe('chiuso');
    const late = bill('b-tardiva', '2026-11-10');
    await seed([
      ['bill', late],
      ['match', matchOf(late)],
    ]);
    const sup = await cli('conguaglio-supplementare', ...args);
    expect(sup.json).toMatchObject({
      status: 'closed',
      changed: true,
      tenants: [{ tenantId: 't-x', departed: false, action: 'da-pagare' }],
    });
    expect(sup.json.tenants[0].delta).toBeUndefined();
    expect(
      (await cli('conguaglio-supplementare', ...args, '--dettagli')).json.tenants[0].delta,
    ).toBe(9000);
    const counts = (await cli('cruscotto', '--periodo-conguaglio', 'apt-x:2025-26')).json
      .apartments[0].counts;
    expect(counts['conguaglio:supplementare']).toBe(1);
    // The supplementary is due: undoing the closing would lose it.
    const refused = await cli('annulla-riconciliazione', '--operazione', closed.json.operationId);
    expect(refused.json.reason).toBe('closing-changed');
  });

  it('una scrittura dentro un periodo chiuso lo dice nell’esito, senza rifiutare', async () => {
    await closable();
    await cli('chiudi-periodo', ...args);
    const r = await cli('fine-presenza', '--presenza', 'tcy-x', '--mese', '2026-08');
    expect(r.code, r.out).toBe(0);
    expect(r.json.closedPeriods).toEqual([{ apartmentId: 'apt-x', periodLabel: '2025-26' }]);
    expect(r.json.closedPeriodMessage).toMatch(/conguaglio supplementare/);
    // A write that does not touch the period says nothing.
    const other = await cli('inquilino', '--id', 't-z', '--nome', 'Terzo Inventato');
    expect(other.json).not.toHaveProperty('closedPeriods');
    // The data changed (one month less of flat charge): the undo of the closing is refused.
    const sup = await cli('conguaglio-supplementare', ...args);
    expect(sup.json.dataChanged || sup.json.changed).toBe(true);
    const closeOp = (await readJournal(new FsStore(dir))).operations.find(
      (o) => o.kind === 'period.close',
    );
    const refused = await cli('annulla-riconciliazione', '--operazione', closeOp.id);
    expect(refused.json.reason).toBe('closing-changed');
    expect(refused.json.message).toMatch(/conguaglio-supplementare/);
  });

  it('l’annullo della chiusura è rifiutato anche quando il conguaglio non si calcola', async () => {
    await closable();
    const closed = await cli('chiudi-periodo', ...args);
    // A second stay of the same tenant in the same months: the settlement cannot be computed.
    await seed([
      [
        'tenancy',
        {
          id: 'tcy-x2',
          v: 1,
          rev: 1,
          apartmentId: 'apt-x',
          tenantId: 't-x',
          from: '2026-01',
          monthlyRent: 45000,
          monthlyForfait: 3000,
        },
      ],
    ]);
    const r = await cli('annulla-riconciliazione', '--operazione', closed.json.operationId);
    expect(r.json.reason).toBe('closing-unknown');
    expect(r.json.message).toMatch(/^Rifiutato: /);
  });

  it('senza cambiamenti l’annullo della chiusura riapre il periodo', async () => {
    await closable();
    const closed = await cli('chiudi-periodo', ...args);
    const u = await cli('annulla-riconciliazione', '--operazione', closed.json.operationId);
    expect(u.code, u.out).toBe(0);
    expect((await cli('conguaglio-supplementare', ...args)).json).toEqual({ status: 'open' });
  });
});

describe('aiuto (Q9)', () => {
  const plain = async (...argv) => {
    const r = await main(argv, { now: () => ORA, newId });
    return { code: r.code, json: JSON.parse(r.output) };
  };
  it('ogni comando accettato ha una riga di descrizione, e nessuna descrizione è di troppo', () => {
    for (const name of COMMAND_NAMES) {
      expect([name, typeof COMMAND_HELP[name]]).toEqual([name, 'string']);
      expect(COMMAND_HELP[name].length, name).toBeGreaterThan(10);
    }
    expect(Object.keys(COMMAND_HELP).sort()).toEqual([...COMMAND_NAMES].sort());
  });
  it('--help elenca i comandi; <comando> --help e aiuto <comando> le opzioni, senza --cartella', async () => {
    const all = await plain('--help');
    expect(all.code).toBe(0);
    expect(all.json.commands.map((c) => c.command)).toEqual(COMMAND_NAMES);
    expect((await plain('aiuto')).json).toEqual(all.json);
    const one = await plain('rata-condominio', '--help');
    expect(one.code).toBe(0);
    expect(one.json).toMatchObject({
      status: 'help',
      command: 'rata-condominio',
      description: COMMAND_HELP['rata-condominio'],
    });
    expect(one.json.options).toEqual(
      expect.arrayContaining(['--appartamento', '--esercizio', '--rata', '--quota-proprieta']),
    );
    expect(one.json.options).not.toContain('--prova');
    expect(one.json.otherOptions).toContain('--cartella');
    expect((await plain('aiuto', 'rata-condominio')).json).toEqual(one.json);
  });
  it('un comando sconosciuto o mancante suggerisce l’aiuto (codice 2)', async () => {
    for (const argv of [['inventato'], []]) {
      const r = await plain(...argv);
      expect(r.code).toBe(2);
      expect(r.json.message).toMatch(/pnpm estratti --help/);
    }
    expect((await plain('saldi')).json.message).toMatch(/--help/);
  });
});

describe('aiuto di excel e moduli (Q9)', () => {
  it('--help elenca ogni opzione con una riga; ogni opzione ha la sua descrizione', async () => {
    for (const tool of [excelTool, moduliTool]) {
      expect(Object.keys(tool.OPTION_HELP).sort()).toEqual(Object.keys(tool.OPTIONS).sort());
      const r = await tool.main(['--help']);
      expect(r.code).toBe(0);
      const json = JSON.parse(r.output);
      expect(json.status).toBe('help');
      expect(json.options.map((o) => o.option)).toEqual(
        Object.keys(tool.OPTIONS).map((o) => `--${o}`),
      );
      for (const o of json.options) expect(o.description.length, o.option).toBeGreaterThan(10);
      const bad = JSON.parse((await tool.main(['--sconosciuta'])).output);
      expect(bad.message).toMatch(/--help/);
    }
  });
});

describe('formato dei dati della cartella (revisione dei dati, G3)', () => {
  const workspace = (schemaVersion) =>
    writeFileSync(
      join(dir, '_app', 'workspace.json'),
      JSON.stringify({
        workspaceId: 'ws-prova',
        name: 'Cartella di prova',
        schemaVersion,
        minAppVersion: '0.1.0',
        createdAt: ORA,
      }),
    );
  const declared = () =>
    JSON.parse(readFileSync(join(dir, '_app', 'workspace.json'), 'utf8')).schemaVersion;
  beforeEach(() => mkdirSync(join(dir, '_app'), { recursive: true }));

  it('una cartella del formato precedente si alza alla prima scrittura, una volta sola', async () => {
    workspace(DATA_FORMAT - 1);
    // A read writes nothing and leaves the format as it is.
    expect((await cli('riferimenti')).json).not.toHaveProperty('dataFormat');
    expect(declared()).toBe(DATA_FORMAT - 1);
    const first = await cli('inquilino', '--id', 't-x', '--nome', 'Nome Inventato');
    expect(first.code, first.out).toBe(0);
    expect(first.json.dataFormat).toBe('raised');
    expect(declared()).toBe(DATA_FORMAT);
    const second = await cli('inquilino', '--id', 't-y', '--nome', 'Altro Inventato');
    expect(second.json).not.toHaveProperty('dataFormat');
  });

  it('una cartella di un formato più nuovo rifiuta le scritture: aggiornare l’app', async () => {
    workspace(DATA_FORMAT + 1);
    const r = await cli('inquilino', '--id', 't-x', '--nome', 'Nome Inventato');
    expect(r.code).toBe(1);
    expect(r.json).toMatchObject({ reason: 'newer-data' });
    expect(r.json.message).toMatch(/aggiornare l’app/);
    expect(declared()).toBe(DATA_FORMAT + 1);
    expect(existsSync(join(dir, '_app', 'dati', 'tenant'))).toBe(false);
  });
});
