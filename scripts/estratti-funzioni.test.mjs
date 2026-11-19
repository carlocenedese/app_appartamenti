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

  it('F5: cambiare ciò che il periodo chiuso contava è rifiutato; un record nuovo lo dice nell’esito', async () => {
    await closable();
    await cli('chiudi-periodo', ...args);
    const r = await cli('fine-presenza', '--presenza', 'tcy-x', '--mese', '2026-08');
    expect(r.code, r.out).toBe(1);
    expect(r.json).toMatchObject({
      status: 'rejected',
      reason: 'closed-period',
      apartmentId: 'apt-x',
      periodLabel: '2025-26',
    });
    expect(r.json.message).toMatch(/2025-26.*riapri il periodo con il motivo/);
    // The end of the stay after the period does not touch it.
    const after = await cli('fine-presenza', '--presenza', 'tcy-x', '--mese', '2027-03');
    expect(after.code, after.out).toBe(0);
    expect(after.json).not.toHaveProperty('closedPeriods');
    // A new record of the period (a credit of the tenant) is accepted and goes into the
    // supplementary settlement: the outcome says so.
    const w = await cli(
      'recupero',
      '--id',
      'rec-x',
      '--appartamento',
      'apt-x',
      '--importo',
      '-15',
      '--inquilini',
      't-x',
      '--periodo',
      '2025-26',
    );
    expect(w.code, w.out).toBe(0);
    expect(w.json.closedPeriods).toEqual([{ apartmentId: 'apt-x', periodLabel: '2025-26' }]);
    expect(w.json.closedPeriodMessage).toMatch(/conguaglio supplementare/);
    // A write that does not touch the period says nothing.
    const other = await cli('inquilino', '--id', 't-z', '--nome', 'Terzo Inventato');
    expect(other.json).not.toHaveProperty('closedPeriods');
    // The costs changed: the undo of the closing is refused.
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
    // A new recovery of a tenant who was not there: the settlement cannot be computed.
    await seed([
      [
        'tenantRecovery',
        {
          id: 'rec-assente',
          v: 1,
          rev: 1,
          apartmentId: 'apt-x',
          amount: -1500,
          shares: [{ tenantId: 't-assente', amount: -1500 }],
          status: 'da-recuperare',
          periodLabel: '2025-26',
        },
      ],
    ]);
    const r = await cli('annulla-riconciliazione', '--operazione', closed.json.operationId);
    expect(r.json.reason).toBe('closing-unknown');
    expect(r.json.message).toMatch(/^Rifiutato: /);
  });

  it('F1, F3: inviato, saldato per inquilino, riaperto con il motivo e chiuso di nuovo', async () => {
    await closable();
    await cli('chiudi-periodo', ...args);
    const state = async () =>
      (await cli('cruscotto', '--periodo-conguaglio', 'apt-x:2025-26')).json.settlements[0].state;
    expect(await state()).toBe('chiuso');
    const sent = await cli('invia-conguaglio', ...args, '--data', '2026-11-20');
    expect(sent.code, sent.out).toBe(0);
    expect(sent.json.status).toBe('saved');
    expect(await state()).toBe('inviato');
    const unknown = await cli(
      'conguaglio-saldato',
      ...args,
      '--inquilino',
      't-no',
      '--data',
      '2026-12-01',
    );
    expect(unknown.json).toMatchObject({ status: 'rejected', reason: 'unknown-tenant' });
    const settled = await cli(
      'conguaglio-saldato',
      ...args,
      '--inquilino',
      't-x',
      '--data',
      '2026-12-01',
    );
    expect(settled.code, settled.out).toBe(0);
    expect(await state()).toBe('saldato');
    const detailed = await cli('conguaglio-supplementare', ...args, '--dettagli');
    expect(detailed.json.tenants[0]).toMatchObject({ total: 0, forfaitPaid: 0, toCheck: 0 });
    expect(detailed.json).not.toHaveProperty('toCheck');
    const sup = await cli('conguaglio-supplementare', ...args);
    expect(sup.json).toMatchObject({
      status: 'closed',
      state: 'saldato',
      sentOn: '2026-11-20',
      tenants: [{ tenantId: 't-x', settled: true }],
    });
    // D: no supplementary to settle yet.
    const noSup = await cli(
      'conguaglio-saldato',
      ...args,
      '--inquilino',
      't-x',
      '--data',
      '2026-12-01',
      '--supplementare',
    );
    expect(noSup.json.reason).toBe('no-supplementary');
    // Marked again while a supplementary is left: refused, pointing at --supplementare.
    const late = bill('b-dopo', '2026-11-10');
    await seed([
      ['bill', late],
      ['match', matchOf(late)],
    ]);
    const markedAgain = await cli(
      'conguaglio-saldato',
      ...args,
      '--inquilino',
      't-x',
      '--data',
      '2026-12-03',
    );
    expect(markedAgain.json.reason).toBe('use-supplementary');
    expect(markedAgain.json.message).toBe(
      'Il conguaglio di questa chiusura è già segnato saldato; resta un conguaglio supplementare di € 90,00: usa --supplementare.',
    );
    const supDone = await cli(
      'conguaglio-saldato',
      ...args,
      '--inquilino',
      't-x',
      '--data',
      '2026-12-03',
      '--supplementare',
    );
    expect(supDone.json.status).toBe('saved');
    // The reason is required.
    expect((await cli('riapri-periodo', ...args, '--data', '2026-12-05')).code).toBe(2);
    const reopened = await cli(
      'riapri-periodo',
      ...args,
      '--data',
      '2026-12-05',
      '--motivo',
      'Uscita anticipata registrata tardi',
    );
    expect(reopened.code, reopened.out).toBe(0);
    expect(reopened.json).not.toHaveProperty('closedPeriods');
    expect((await cli('conguaglio-supplementare', ...args)).json).toMatchObject({
      status: 'reopened',
      state: 'riaperto',
      reopenedOn: '2026-12-05',
    });
    expect((await cli('invia-conguaglio', ...args, '--data', '2026-12-06')).json.reason).toBe(
      'not-closed',
    );
    // Open again: the change inside the period goes through.
    const end = await cli('fine-presenza', '--presenza', 'tcy-x', '--mese', '2026-08');
    expect(end.code, end.out).toBe(0);
    // Undoing the reopening now would close the period without a new snapshot.
    const reopenOp = (await readJournal(new FsStore(dir))).operations.find(
      (o) => o.kind === 'period.reopen',
    );
    const refused = await cli('annulla-riconciliazione', '--operazione', reopenOp.id);
    expect(refused.json.reason).toBe('reopen-changed');
    const again = await cli('chiudi-periodo', ...args);
    expect(again.code, again.out).toBe(0);
    expect(await state()).toBe('chiuso');
    // ~20 CLI spawns in a row: Windows runners need more than the 5 s default.
  }, 60_000);

  it('piano 22: posti nuovi «valido dal» dopo il periodo chiuso passano, dentro sono rifiutati', async () => {
    await closable();
    await cli('chiudi-periodo', ...args);
    const inside = await cli(
      'appartamento',
      '--id',
      'apt-x',
      '--posti',
      '2',
      '--dal',
      '2026-05',
      '--modifica',
    );
    expect(inside.json.reason).toBe('closed-period');
    const after = await cli(
      'appartamento',
      '--id',
      'apt-x',
      '--posti',
      '2',
      '--dal',
      '2026-10',
      '--modifica',
    );
    expect(after.code, after.out).toBe(0);
    expect(after.json.status).toBe('updated');
    const back = await cli(
      'appartamento',
      '--id',
      'apt-x',
      '--posti',
      '3',
      '--dal',
      '2026-09',
      '--modifica',
    );
    expect(back.json.reason).toBe('valid-from-order');
  }, 60_000);

  it('piano 22: forfait-verificato chiude il «da verificare» senza cambiare il dovuto; si annulla', async () => {
    await closable();
    await cli('chiudi-periodo', ...args);
    await cli('riapri-periodo', ...args, '--data', '2026-11-20', '--motivo', 'Forfait di ottobre');
    const store = new FsStore(dir);
    const path = recordPath('payment', 'pay-2025-10');
    const before = await store.readJson(path);
    await commitChange(
      store,
      {
        profileId: 'cli',
        kind: 'test.seed',
        summary: 'dati inventati',
        changes: [{ path, before, after: { ...before, amount: 45000 } }],
      },
      () => ORA,
      newId,
    );
    expect((await cli('chiudi-periodo', ...args)).code).toBe(0);
    const tenant = ['--inquilino', 't-x', '--data', '2026-12-01'];
    expect((await cli('conguaglio-saldato', ...args, ...tenant)).code).toBe(0);
    const flat = ['forfait-verificato', ...args, ...tenant];
    expect((await cli(...flat, '--esito', 'stessi-soldi')).json.reason).toBe('nothing-to-check');
    await seed([
      [
        'payment',
        {
          id: 'pay-ott-dopo',
          v: 1,
          rev: 1,
          apartmentId: 'apt-x',
          tenantId: 't-x',
          date: '2026-12-05',
          amount: 3000,
          confirmed: true,
          kind: 'canone',
          forMonth: '2025-10',
          source: 'manual',
        },
      ],
    ]);
    const sup = async () => (await cli('conguaglio-supplementare', ...args, '--dettagli')).json;
    const was = await sup();
    expect(was.toCheck).toBe(true);
    expect(was.tenants[0].toCheck).toBe(3000);
    expect((await cli(...flat, '--esito', 'forse')).code).toBe(2);
    const done = await cli(...flat, '--esito', 'stessi-soldi');
    expect(done.code, done.out).toBe(0);
    expect(done.json.status).toBe('saved');
    const now = await sup();
    expect(now).not.toHaveProperty('toCheck');
    expect(now.tenants[0]).toMatchObject({ toCheck: 0, remaining: was.tenants[0].remaining });
    const undo = await cli('annulla-riconciliazione', '--operazione', done.json.operationId);
    expect(undo.code, undo.out).toBe(0);
    expect((await sup()).tenants[0].toCheck).toBe(3000);
  }, 60_000);

  it('piano 22: riaperto per un bonifico respinto, si chiude di nuovo con «Canone non incassato»', async () => {
    await closable();
    await cli('chiudi-periodo', ...args);
    await cli('riapri-periodo', ...args, '--data', '2026-11-20', '--motivo', 'Bonifico respinto');
    const store = new FsStore(dir);
    const path = recordPath('payment', 'pay-2025-10');
    const before = await store.readJson(path);
    await commitChange(
      store,
      {
        profileId: 'cli',
        kind: 'test.seed',
        summary: 'dati inventati',
        changes: [{ path, before, after: { ...before, rev: 2, deleted: true } }],
      },
      () => ORA,
      newId,
    );
    const again = await cli('chiudi-periodo', ...args);
    expect(again.code, again.out).toBe(0);
    expect(again.json).toMatchObject({
      status: 'closed',
      rentMissing: [{ tenantId: 't-x', month: '2025-10' }],
    });
    expect(again.json.warning).toMatch(/Canone non incassato/);
    expect(again.out).not.toMatch(/45000/);
    const sup = await cli('conguaglio-supplementare', ...args, '--dettagli');
    expect(sup.json.tenants[0]).toMatchObject({ tenantId: 't-x', rentMissing: 45000 });
    // Answer 2 of user1: marked by hand.
    const tenant = ['--inquilino', 't-x', '--data', '2026-12-01'];
    expect((await cli('canone-non-incassato', ...args, ...tenant, '--esito', 'pagato')).code).toBe(
      2,
    );
    const asked = await cli('canone-non-incassato', ...args, ...tenant, '--esito', 'richiesto');
    expect(asked.code, asked.out).toBe(0);
    const paid = await cli('canone-non-incassato', ...args, ...tenant, '--esito', 'saldato');
    expect(paid.json.status).toBe('saved');
    expect((await cli('conguaglio-supplementare', ...args)).json.tenants[0]).not.toHaveProperty(
      'rentMissing',
    );
    const twice = await cli('canone-non-incassato', ...args, ...tenant, '--esito', 'saldato');
    expect(twice.json.reason).toBe('nothing-to-mark');
    const undo = await cli('annulla-riconciliazione', '--operazione', paid.json.operationId);
    expect(undo.code, undo.out).toBe(0);
  }, 60_000);

  it('F10: caparra già restituita, i conguagli chiusi non saldati sono «da richiedere»', async () => {
    await closable();
    await cli('chiudi-periodo', ...args);
    const deposit = (id, amount, date) => [
      'payment',
      {
        id,
        v: 1,
        rev: 1,
        apartmentId: 'apt-x',
        tenantId: 't-x',
        date,
        amount,
        confirmed: true,
        kind: 'caparra',
        source: 'manual',
      },
    ];
    await seed([
      deposit('dep-x', 50000, '2025-09-20'),
      deposit('dep-x-back', -50000, '2026-10-05'),
    ]);
    const r = await cli('caparra-restituzione', '--appartamento', 'apt-x', '--inquilino', 't-x');
    expect(r.json).toMatchObject({ reason: 'already-returned', toRequest: 1 });
    expect(r.json.warning).toMatch(/da richiedere/);
    expect(r.json).not.toHaveProperty('toRequestLines');
    const d = await cli(
      'caparra-restituzione',
      '--appartamento',
      'apt-x',
      '--inquilino',
      't-x',
      '--dettagli',
    );
    // Signs of a statement and euro (finding 8): a credit of the tenant is positive.
    expect(d.json.toRequestLines).toEqual([
      { label: 'Conguaglio 2025-26 non saldato', amount: '€ 270,00' },
    ]);
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
