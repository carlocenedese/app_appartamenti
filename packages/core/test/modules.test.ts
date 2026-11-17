import { describe, expect, it } from 'vitest';
import { docxPlaceholders, readZip } from '../src/docx';
import { ApartmentSchema, ContractSchema, TenancySchema, TenantSchema } from '../src/model';
import {
  APP_FIELDS,
  ASKED_FIELDS,
  MODULE_KINDS,
  generateModule,
  moduleFilePath,
  moduleValues,
  starterDocx,
} from '../src/modules';
import type { ModuleData } from '../src/modules';
import { isoDate } from '../src/period';
import { docx, inflateRaw } from './helpers/docx';

// Invented data: names, codes and amounts of no real person or contract.
const apartment = ApartmentSchema.parse({
  id: 'apt-nord',
  v: 1,
  rev: 1,
  name: 'Casa Nord',
  locatore: 'user1',
  posti: 2,
  rooms: ['A', 'B'],
  annualitaStart: { month: 10, day: 1 },
  address: 'Via Inventata 1',
  cadastre: [{ sheet: '1', parcel: '2', sub: '3' }],
});
const tenant = TenantSchema.parse({ id: 'ten-1', v: 1, rev: 1, name: 'Anna Prova' });
const tenancy = TenancySchema.parse({
  id: 'pres-1',
  v: 1,
  rev: 1,
  apartmentId: 'apt-nord',
  tenantId: 'ten-1',
  room: 'A',
  from: '2026-08',
  to: '2027-09',
  monthlyRent: 30000,
  monthlyForfait: 8000,
  expectedDeposit: 50000,
});
const contract = ContractSchema.parse({
  id: 'ctr-1',
  v: 1,
  rev: 1,
  apartmentId: 'apt-nord',
  type: '4+4',
  start: '2023-10',
  end: '2027-09',
  settlement: 'annuale',
  durationMonths: 48,
  signedOn: '2023-09-20',
  registration: { code: 'COD-INVENTATO', date: '2023-09-25' },
  taxRegime: 'cedolare',
  tenancyIds: ['pres-1'],
  rent: [
    { from: '2023-10', monthlyRent: 100000, monthlyAdvance: 20000 },
    { from: '2026-10', monthlyRent: 110000, monthlyAdvance: 25000 },
  ],
});
const data: ModuleData = { apartment, tenant, tenancy, contract, ibans: ['IT00INVENTATO'] };
const today = isoDate('2026-11-16');

describe('moduleValues', () => {
  it('fills the app fields from the records, in Italian formats', () => {
    expect(moduleValues(data, today)).toEqual({
      data_documento: '16/11/2026',
      appartamento: 'Casa Nord',
      locatore: 'user1',
      indirizzo: 'Via Inventata 1',
      posti: '2',
      dati_catastali: 'foglio 1, particella 2, sub 3',
      iban: 'IT00INVENTATO',
      inquilino: 'Anna Prova',
      posto: 'A',
      ingresso: '08/2026',
      uscita_prevista: '09/2027',
      affitto_mensile: '€ 300,00',
      forfait_mensile: '€ 80,00',
      canone_camera: '€ 380,00',
      tipo_contratto: '4+4',
      inizio_contratto: '10/2023',
      fine_contratto: '09/2027',
      durata_contratto_mesi: '48',
      firmato_il: '20/09/2023',
      codice_registrazione: 'COD-INVENTATO',
      registrato_il: '25/09/2023',
      regime_fiscale: 'cedolare',
      importo_caparra: '€ 500,00',
      // From 08/2026, the later of entry and start, to 09/2027 (R312).
      durata_residua_mesi: '14',
      // The advance of the contract in the month of the document (R312).
      acconto_spese_mensile: '€ 250,00',
    });
  });

  it('remaining duration from the later of entry and contract start, to the end (R312)', () => {
    // From 08/2026 to 09/2027: 14 months, whatever the day of the document.
    expect(moduleValues(data, isoDate('2026-07-20')).durata_residua_mesi).toBe('14');
    expect(moduleValues(data, today).durata_residua_mesi).toBe('14');
    // A tenancy before the start of the contract: from the start, 10/2023 to 09/2027.
    const early = TenancySchema.parse({ ...tenancy, from: '2023-09' });
    expect(moduleValues({ ...data, tenancy: early }, today).durata_residua_mesi).toBe('48');
    // An entry after the end: nothing.
    const late = TenancySchema.parse({ ...tenancy, from: '2027-10', to: undefined });
    expect(moduleValues({ ...data, tenancy: late }, today)).not.toHaveProperty(
      'durata_residua_mesi',
    );
  });

  it('the advance of the contract in the month of the document; none before its first entry', () => {
    expect(moduleValues(data, isoDate('2026-09-30')).acconto_spese_mensile).toBe('€ 200,00');
    expect(moduleValues(data, isoDate('2023-09-30'))).not.toHaveProperty('acconto_spese_mensile');
  });

  it('fills the asked fields of the tenant card when it has them (R311)', () => {
    const card = TenantSchema.parse({
      ...tenant,
      personal: {
        taxCode: 'CODICE-PROVA',
        birthPlace: 'Città Inventata',
        birthDate: '2005-02-03',
        residence: 'Via Finta 2',
        idDocument: { number: 'DOC-PROVA', issuer: 'Comune Inventato', expiresOn: '2030-01-31' },
      },
    });
    expect(moduleValues({ ...data, tenant: card }, today)).toMatchObject({
      codice_fiscale: 'CODICE-PROVA',
      luogo_nascita: 'Città Inventata',
      data_nascita: '03/02/2005',
      residenza: 'Via Finta 2',
      documento_numero: 'DOC-PROVA',
      documento_ente: 'Comune Inventato',
      documento_scadenza: '31/01/2030',
    });
    const typed = generateModule({
      kind: 'promessa',
      template: starterDocx('promessa'),
      data: { ...data, tenant: card },
      supplied: { codice_fiscale: 'ALTRO' },
      today,
      inflateRaw,
    });
    expect(typed).toEqual({
      status: 'refused',
      reason: 'field-from-app',
      fields: ['codice_fiscale'],
    });
  });

  it('an advance typed instead of the contract one needs a note (R312)', () => {
    const run = (supplied: Record<string, string>) =>
      generateModule({
        kind: 'aumento-prezzi',
        template: starterDocx('aumento-prezzi'),
        data,
        supplied: { nuovo_canone: 'x', ...supplied },
        today,
        inflateRaw,
      }).status;
    expect(run({ acconto_spese_mensile: '€ 30,00' })).toBe('refused');
    expect(run({ acconto_spese_mensile: '€ 30,00', nota_acconto: 'Accordo del 1° novembre' })).toBe(
      'ok',
    );
  });

  it('leaves out what the records do not have', () => {
    const bare = moduleValues(
      {
        apartment: ApartmentSchema.parse({ ...apartment, address: undefined, cadastre: undefined }),
        tenant,
        tenancy: TenancySchema.parse({
          ...tenancy,
          room: undefined,
          to: undefined,
          expectedDeposit: undefined,
        }),
        ibans: ['IT01', 'IT02'],
      },
      today,
    );
    expect(Object.keys(bare).sort()).toEqual([
      'affitto_mensile',
      'appartamento',
      'canone_camera',
      'data_documento',
      'forfait_mensile',
      'ingresso',
      'inquilino',
      'locatore',
      'posti',
    ]);
  });

  it('has no remaining duration when the tenancy starts after the contract end', () => {
    const late = TenancySchema.parse({ ...tenancy, from: '2027-10', to: undefined });
    expect(
      moduleValues({ ...data, tenancy: late }, isoDate('2027-01-01')).durata_residua_mesi,
    ).toBeUndefined();
  });

  it('only names app fields it knows', () => {
    expect(Object.keys(moduleValues(data, today)).every((k) => k in APP_FIELDS)).toBe(true);
  });
});

describe('generateModule', () => {
  const run = (template: Uint8Array, supplied: Record<string, string> = {}) =>
    generateModule({ kind: 'promessa', template, data, supplied, today, inflateRaw });

  it('fills app and asked fields', () => {
    const template = docx([['{{inquilino}} {{codice_fiscale}} {{canone_camera}}']]);
    const result = run(template, { codice_fiscale: 'XXXINVENTATO' });
    if (result.status !== 'ok') throw new Error(result.reason);
    expect(result).toMatchObject({ fields: 3, appFields: 2, askedFields: 1 });
    const body = readZip(result.bytes, inflateRaw).find((e) => e.path === 'word/document.xml');
    expect(new TextDecoder().decode(body?.data)).toContain('Anna Prova XXXINVENTATO € 380,00');
  });

  it('refuses a placeholder the module does not know', () => {
    expect(run(docx([['{{nome_a_caso}} {{saldo}}']]))).toEqual({
      status: 'refused',
      reason: 'unknown-fields',
      fields: ['nome_a_caso', 'saldo'],
    });
  });

  it('refuses supplied keys the module does not know with their count only', () => {
    // A tax code and a phone number written as keys by mistake: never echoed back.
    const result = run(docx([['{{inquilino}}']]), {
      rssmra80a01h501u: 'codice_fiscale',
      '3331234567': 'telefono',
    });
    expect(result).toEqual({ status: 'refused', reason: 'unknown-values', count: 2 });
    expect(JSON.stringify(result)).not.toMatch(/rssmra|333123/);
  });

  it('refuses a supplied value for a field the app already fills', () => {
    expect(run(docx([['{{inquilino}}']]), { inquilino: 'Altro' })).toEqual({
      status: 'refused',
      reason: 'field-from-app',
      fields: ['inquilino'],
    });
  });

  it('accepts a supplied value for an app field the records lack', () => {
    const noAddress = {
      ...data,
      apartment: ApartmentSchema.parse({ ...apartment, address: undefined }),
    };
    const result = generateModule({
      kind: 'restituzione',
      template: docx([['{{indirizzo}} {{saldo}}']]),
      data: noAddress,
      supplied: { indirizzo: 'Via Scritta 2', saldo: '€ 1,00' },
      today,
      inflateRaw,
    });
    expect(result).toMatchObject({ status: 'ok', appFields: 0, askedFields: 2 });
  });

  it('refuses missing values with the field names', () => {
    expect(run(docx([['{{codice_fiscale}} {{indirizzo}}']]))).toEqual({
      status: 'refused',
      reason: 'missing-fields',
      fields: ['codice_fiscale'],
    });
  });

  it('passes the template refusals through', () => {
    expect(run(new Uint8Array(3))).toMatchObject({ reason: 'bad-template' });
  });
});

describe('starterDocx', () => {
  it('is a template with every field of the module and no legal text', () => {
    for (const kind of MODULE_KINDS) {
      const result = docxPlaceholders(starterDocx(kind), inflateRaw);
      expect(result).toEqual({
        status: 'ok',
        fields: [...Object.keys(APP_FIELDS), ...ASKED_FIELDS[kind]].sort(),
      });
    }
  });

  it('fills with generateModule once every asked field is given', () => {
    const supplied = Object.fromEntries(ASKED_FIELDS.promessa.map((f) => [f, 'x']));
    const full = {
      ...supplied,
    };
    const result = generateModule({
      kind: 'promessa',
      template: starterDocx('promessa'),
      data,
      supplied: full,
      today,
      inflateRaw,
    });
    expect(result.status).toBe('ok');
  });
});

describe('moduleFilePath', () => {
  it('puts the document in Contratti, in the tenant folder, with safe names', () => {
    expect(moduleFilePath(apartment, tenant, 'conferma-disdetta', today)).toBe(
      'Casa-Nord/Contratti/Anna-Prova/2026-11-16_conferma-disdetta.docx',
    );
    expect(moduleFilePath({ name: 'CON' }, { name: 'Zoë: è/ok?' }, 'promessa', today)).toBe(
      'Appartamento_CON/Contratti/Zoe-e-ok/2026-11-16_promessa.docx',
    );
  });

  it('gives no path for a tenant name with no ASCII letter or digit', () => {
    expect(moduleFilePath(apartment, { name: '李 明' }, 'promessa', today)).toBeUndefined();
    expect(moduleFilePath(apartment, { name: '___' }, 'promessa', today)).toBeUndefined();
  });
});
