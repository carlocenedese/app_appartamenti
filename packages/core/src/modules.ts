/**
 * The forms of section 26 (plan 12, R231): which fields the app fills from its records, which ones
 * each form asks the user for, the starter template and where a generated document goes. No text,
 * clause or amount of the real forms is here: the owners write those in their own templates.
 */
import { apartmentFolder } from './accounts';
import { docxPlaceholders, fillDocx } from './docx';
import type { DocxRefusal, InflateRaw } from './docx';
import { formatEuro, cents } from './money';
import { safeWord } from './proposal';
import type { Apartment, Contract, Tenancy, Tenant } from './model';
import type { ISODate } from './period';
import { escapeXml } from './xlsx-write';
import { zipStored } from './zip';

export const MODULE_KINDS = [
  'promessa',
  'subentro',
  'conferma-cauzione',
  'impegno-canone',
  'aumento-prezzi',
  'conferma-disdetta',
  'restituzione',
  'contratto',
] as const;
export type ModuleKind = (typeof MODULE_KINDS)[number];

/** The names of section 26. */
export const MODULE_TITLES: Record<ModuleKind, string> = {
  promessa: 'Cauzione e impegno (promessa di contratto)',
  subentro: 'Subentro e cauzione',
  'conferma-cauzione': 'Cauzione o conferma',
  'impegno-canone': 'Impegno canone',
  'aumento-prezzi': 'Comunicazione aumento prezzi',
  'conferma-disdetta': 'Conferma disdetta',
  restituzione: 'Restituzione cauzione e consegna chiavi',
  contratto: 'Contratto di locazione per studenti',
};

/** The fields the app fills from its records, with their label. */
export const APP_FIELDS = {
  data_documento: 'Data del documento',
  appartamento: 'Appartamento',
  locatore: 'Locatore',
  indirizzo: 'Indirizzo',
  posti: 'Posti',
  dati_catastali: 'Dati catastali',
  iban: 'IBAN',
  inquilino: 'Inquilino',
  posto: 'Posto',
  ingresso: 'Ingresso',
  uscita_prevista: 'Uscita prevista',
  affitto_mensile: 'Affitto mensile',
  forfait_mensile: 'Forfait mensile',
  canone_camera: 'Canone mensile della camera',
  tipo_contratto: 'Tipo di contratto',
  inizio_contratto: 'Inizio del contratto',
  fine_contratto: 'Fine del contratto',
  durata_contratto_mesi: 'Durata del contratto (mesi)',
  firmato_il: 'Firmato il',
  codice_registrazione: 'Codice di registrazione',
  registrato_il: 'Registrato il',
  regime_fiscale: 'Regime fiscale',
  durata_residua_mesi: 'Durata residua (mesi)',
  importo_caparra: 'Importo della caparra',
} as const;
export type AppField = keyof typeof APP_FIELDS;

const PROMISE_FIELDS = [
  'codice_fiscale',
  'documento_numero',
  'documento_ente',
  'documento_rilascio',
  'documento_scadenza',
  'firma_entro',
  'decorrenza',
  'tipo_promessa',
  'inquilino_uscente',
  'scadenza_versamento',
] as const;

/** The fields each form asks for (section 26, «Dati richiesti»): free text, never checked. */
export const ASKED_FIELDS: Record<ModuleKind, readonly string[]> = {
  promessa: PROMISE_FIELDS,
  subentro: [...PROMISE_FIELDS, 'codice_contratto_cessione'],
  'conferma-cauzione': ['nuovo_canone', 'durata_mesi', 'decorrenza', 'caparra_versata'],
  'impegno-canone': ['canone_massimo', 'periodo'],
  'aumento-prezzi': ['nuovo_canone'],
  'conferma-disdetta': ['data_recesso', 'mezzo_disdetta', 'data_disdetta', 'fine_anticipata'],
  restituzione: [
    'data_consegna_chiavi',
    'stato_locali',
    'caparra',
    'interessi_legali',
    'quota_bollette',
    'quota_adempimento',
    'quota_pulizia',
    'saldo',
  ],
  contratto: [
    'codice_fiscale',
    'luogo_nascita',
    'data_nascita',
    'residenza',
    'corso_studi',
    'deposito',
    // Question 10: which advance (contract, room, month) is not decided, so it is typed by hand.
    'acconto_spese_mensile',
    'classe_energetica',
    'superficie',
    'caratteristiche_alloggio',
    'accordo_territoriale',
  ],
};

/** What the store gives for one tenancy (`loadModuleData`). */
export interface ModuleData {
  apartment: Apartment;
  tenant: Tenant;
  tenancy: Tenancy;
  /** The live contract that links the tenancy, if any. */
  contract?: Contract;
  /** The distinct IBANs of the live accounts of the apartment. */
  ibans: readonly string[];
}

const day = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;
const month = (ym: string) => `${ym.slice(5, 7)}/${ym.slice(0, 4)}`;
const monthIndex = (ym: string) => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7));

/** The app fields the records give, as text; a field with no data is left out. */
export function moduleValues(data: ModuleData, today: ISODate): Partial<Record<AppField, string>> {
  const { apartment, tenant, tenancy, contract } = data;
  const values: Partial<Record<AppField, string>> = {
    data_documento: day(today),
    appartamento: apartment.name,
    locatore: apartment.locatore,
    indirizzo: apartment.address,
    posti: String(apartment.posti),
    dati_catastali: apartment.cadastre
      ?.map((c) => `foglio ${c.sheet}, particella ${c.parcel}, sub ${c.sub}`)
      .join('; '),
    iban: data.ibans.length === 1 ? data.ibans[0] : undefined,
    inquilino: tenant.name,
    posto: tenancy.room,
    ingresso: month(tenancy.from),
    uscita_prevista: tenancy.to === undefined ? undefined : month(tenancy.to),
    affitto_mensile: formatEuro(tenancy.monthlyRent),
    forfait_mensile: formatEuro(tenancy.monthlyForfait),
    // Section 26: the price of the room includes the flat charge.
    canone_camera: formatEuro(cents(tenancy.monthlyRent + tenancy.monthlyForfait)),
    // The deposit user1 typed for this tenancy (plan 11, R220): data only, never computed.
    importo_caparra:
      tenancy.expectedDeposit === undefined ? undefined : formatEuro(tenancy.expectedDeposit),
  };
  if (contract !== undefined) {
    // Provisional (question 9): counted from the entry only when nothing else could be meant, a
    // document prepared before the entry for a tenancy inside the contract; otherwise typed by hand.
    const plain =
      contract.start <= tenancy.from &&
      tenancy.from <= contract.end &&
      today.slice(0, 7) <= tenancy.from;
    const remaining = monthIndex(contract.end) - monthIndex(tenancy.from) + 1;
    Object.assign(values, {
      tipo_contratto: contract.type,
      inizio_contratto: month(contract.start),
      fine_contratto: month(contract.end),
      durata_contratto_mesi: contract.durationMonths?.toString(),
      firmato_il: contract.signedOn === undefined ? undefined : day(contract.signedOn),
      codice_registrazione: contract.registration?.code,
      registrato_il:
        contract.registration?.date === undefined ? undefined : day(contract.registration.date),
      regime_fiscale: contract.taxRegime,
      durata_residua_mesi: plain ? String(remaining) : undefined,
    });
  }
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));
}

export type GenerateModuleResult =
  | {
      status: 'ok';
      bytes: Uint8Array;
      /** Placeholders filled: all, from the records, from the supplied values. */
      fields: number;
      appFields: number;
      askedFields: number;
    }
  | DocxRefusal
  | { status: 'refused'; reason: 'unknown-fields' | 'field-from-app'; fields: string[] }
  /** Keys of the values file the form does not know: only their count, a key could be a value. */
  | { status: 'refused'; reason: 'unknown-values'; count: number };

/**
 * The document of `kind` from the owners' `template`: app fields from `data`, the others from
 * `supplied`. Refused: supplied keys the form does not know (`unknown-values`, their count only),
 * placeholders the form does not know (`unknown-fields`, names sorted), a supplied value for a
 * field the records already fill
 * (`field-from-app`: the data come from the records), and every refusal of `fillDocx`.
 */
export function generateModule(input: {
  kind: ModuleKind;
  template: Uint8Array;
  data: ModuleData;
  supplied: Readonly<Record<string, string>>;
  today: ISODate;
  inflateRaw: InflateRaw;
}): GenerateModuleResult {
  const known = new Set<string>([...Object.keys(APP_FIELDS), ...ASKED_FIELDS[input.kind]]);
  const placeholders = docxPlaceholders(input.template, input.inflateRaw);
  if (placeholders.status !== 'ok') return placeholders;
  const strangers = Object.keys(input.supplied).filter((f) => !known.has(f)).length;
  if (strangers > 0) return { status: 'refused', reason: 'unknown-values', count: strangers };
  const unknown = placeholders.fields.filter((f) => !known.has(f));
  if (unknown.length > 0) return { status: 'refused', reason: 'unknown-fields', fields: unknown };
  const app: Record<string, string> = moduleValues(input.data, input.today);
  const clash = Object.keys(input.supplied)
    .filter((f) => Object.hasOwn(app, f))
    .sort();
  if (clash.length > 0) return { status: 'refused', reason: 'field-from-app', fields: clash };
  const filled = fillDocx(input.template, { ...input.supplied, ...app }, input.inflateRaw);
  if (filled.status !== 'ok') return filled;
  const fromApp = placeholders.fields.filter((f) => Object.hasOwn(app, f)).length;
  return {
    status: 'ok',
    bytes: filled.bytes,
    fields: placeholders.fields.length,
    appFields: fromApp,
    askedFields: placeholders.fields.length - fromApp,
  };
}

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const DOC_REL =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/**
 * A starter template of `kind`: the title, one line of text that says it is invented, and every
 * field of the form as `Label: {{campo}}`. No clause and no legal text (section 26: the owners
 * write the texts). The same bytes every time; no `docProps`.
 */
export function starterDocx(kind: ModuleKind): Uint8Array {
  const paragraph = (text: string) =>
    `<w:p><w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
  const lines = [
    `${MODULE_TITLES[kind]} (modello di prova)`,
    'Testo inventato: i proprietari sostituiscono questo modello con il testo del modulo.',
    'Dati dalla scheda:',
    ...Object.entries(APP_FIELDS).map(([field, label]) => `${label}: {{${field}}}`),
    'Dati da inserire:',
    ...ASKED_FIELDS[kind].map((field) => `${field.replaceAll('_', ' ')}: {{${field}}}`),
  ];
  const encoder = new TextEncoder();
  const part = (path: string, xml: string) => ({ path, data: encoder.encode(XML_HEAD + xml) });
  return zipStored([
    part(
      '[Content_Types].xml',
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>',
    ),
    part(
      '_rels/.rels',
      `<Relationships xmlns="${PKG_REL}"><Relationship Id="rId1" Type="${DOC_REL}" Target="word/document.xml"/></Relationships>`,
    ),
    part(
      'word/document.xml',
      `<w:document xmlns:w="${W}"><w:body>${lines.map(paragraph).join('')}</w:body></w:document>`,
    ),
  ]);
}

/**
 * Where a generated document goes (sections 20 and 26):
 * `<Appartamento>/Contratti/<Inquilino>/<AAAA-MM-GG>_<modulo>.docx`, with the safe folder names of
 * `apartmentFolder`. `undefined` when the tenant's name has no ASCII letter or digit: no folder
 * name is made up for them (the caller asks for an explicit output). The path holds the tenant's
 * name: never in a log or an output.
 */
export function moduleFilePath(
  apartment: Pick<Apartment, 'name'>,
  tenant: Pick<Tenant, 'name'>,
  kind: ModuleKind,
  today: ISODate,
): string | undefined {
  if (safeWord(tenant.name, '', 60) === '') return undefined;
  return `${apartmentFolder(apartment.name)}/Contratti/${apartmentFolder(tenant.name)}/${today}_${kind}.docx`;
}
