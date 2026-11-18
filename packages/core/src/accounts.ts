/**
 * Bank accounts and bank profiles in the folder (plan 3a, task 6), and the path where the original
 * statement is filed. Each save is one operation of the journal, so `undoOperation` takes it back.
 */
import { commitChange } from './journal';
import type { Operation } from './journal';
import { normaliseIban } from './iban';
import { AccountSchema, ApartmentSchema, BankProfileSchema } from './model';
import type { Account, Apartment, BankProfile } from './model';
import { parseOrThrow } from './parse';
import { annualitaOf } from './period';
import type { ISODate } from './period';
import { safeWord } from './proposal';
import { loadAll } from './store/load';
import { recordPath } from './store/records';
import type { Store } from './store/store';

/** Writes a bank profile (new, or a new revision of the one with the same `id`), one `bank-profile.save`. */
export async function saveBankProfile(
  store: Store,
  profile: BankProfile,
  profileId: string,
  clock: () => string,
  newId: () => string,
): Promise<Operation | undefined> {
  const checked = parseOrThrow(BankProfileSchema, profile, 'bankProfile');
  const existing = (
    await loadAll(store, 'bankProfile', BankProfileSchema, { includeDeleted: true })
  ).records.find((p) => p.id === checked.id);
  // E8: the same profile, live, writes nothing (`undefined`): a rerun is unchanged.
  const content = (p: BankProfile) => JSON.stringify({ ...p, v: 0, rev: 0 });
  if (
    existing !== undefined &&
    existing.deleted !== true &&
    content(existing) === content(checked)
  ) {
    return undefined;
  }
  return commitChange(
    store,
    {
      profileId,
      kind: 'bank-profile.save',
      summary: 'Profilo della banca salvato',
      changes: [{ path: recordPath('bankProfile', checked.id), before: existing, after: checked }],
    },
    clock,
    newId,
  );
}

export type SaveAccountResult =
  | { status: 'saved'; account: Account; operationId: string }
  | { status: 'unchanged'; account: Account }
  | {
      status: 'rejected';
      reason: 'unknown-apartment' | 'unknown-bank-profile' | 'bad-iban' | 'iban-in-use';
    };

/**
 * Writes a new account, one `account.save`; the IBAN is stored normalised and is unique among live
 * accounts. A live account with the same apartment, profile, label and IBAN is `unchanged`.
 */
export async function saveAccount(
  store: Store,
  draft: Omit<Account, 'id' | 'v' | 'rev'>,
  profileId: string,
  clock: () => string,
  newId: () => string,
): Promise<SaveAccountResult> {
  const apartments = await loadAll(store, 'apartment', ApartmentSchema);
  if (!apartments.records.some((a) => a.id === draft.apartmentId)) {
    return { status: 'rejected', reason: 'unknown-apartment' };
  }
  const profiles = await loadAll(store, 'bankProfile', BankProfileSchema);
  if (!profiles.records.some((p) => p.id === draft.bankProfileId)) {
    return { status: 'rejected', reason: 'unknown-bank-profile' };
  }
  let iban: string | undefined;
  const accounts = (await loadAll(store, 'account', AccountSchema)).records;
  if (draft.iban !== undefined) {
    iban = normaliseIban(draft.iban);
    if (iban === undefined) return { status: 'rejected', reason: 'bad-iban' };
  }
  // E9, E10: the same apartment, profile, label and IBAN as a live account is a rerun: unchanged.
  const same = accounts.find(
    (a) =>
      a.apartmentId === draft.apartmentId &&
      a.bankProfileId === draft.bankProfileId &&
      a.label === draft.label &&
      a.iban === iban,
  );
  if (same !== undefined) return { status: 'unchanged', account: same };
  if (iban !== undefined && accounts.some((a) => a.iban === iban)) {
    return { status: 'rejected', reason: 'iban-in-use' };
  }
  const account = parseOrThrow(
    AccountSchema,
    { ...draft, ...(iban === undefined ? {} : { iban }), id: newId(), v: 1, rev: 1 },
    'account',
  );
  const operation = await commitChange(
    store,
    {
      profileId,
      kind: 'account.save',
      summary: 'Conto salvato',
      changes: [{ path: recordPath('account', account.id), before: undefined, after: account }],
    },
    clock,
    newId,
  );
  return {
    status: 'saved',
    account: parseOrThrow(AccountSchema, operation.changes[0]?.after, 'account'),
    operationId: operation.id,
  };
}

/** Longest apartment folder name (Windows paths stop at 260 characters in all). */
const MAX_FOLDER = 60;
const RESERVED = /^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])$/i;

/** The apartment's folder name: words kept apart by `_` (`Appartamento_A_Nord`), each one safe; never a Windows reserved name. */
export function apartmentFolder(name: string): string {
  const parts = name
    .split('_')
    .map((part) => safeWord(part, '', 30))
    .filter((part) => part !== '');
  const joined = parts
    .join('_')
    .slice(0, MAX_FOLDER)
    .replace(/[_-]+$/, '');
  const folder = joined === '' ? 'Appartamento' : joined;
  return RESERVED.test(folder) ? `Appartamento_${folder}` : folder;
}

/**
 * Where the original statement is filed (section 20):
 * `Riservato_proprietari/Estratti_conto/<Appartamento>/<annualità>/AAAA-MM-GG_Estratto_<Banca>_AAAA-MM.<ext>`,
 * with `to` the last day of the period; the month is the one of `to`. Built from the date strings
 * alone, so it is the same in every time zone.
 */
export function statementFilePath(input: {
  apartment: Pick<Apartment, 'name' | 'annualitaStart'>;
  to: ISODate;
  bank: string;
  ext: 'xlsx' | 'csv';
}): string {
  const year = annualitaOf(input.to, input.apartment.annualitaStart);
  const bank = safeWord(input.bank, 'Banca', 30);
  return (
    `Riservato_proprietari/Estratti_conto/${apartmentFolder(input.apartment.name)}/${year}/` +
    `${input.to}_Estratto_${bank}_${input.to.slice(0, 7)}.${input.ext}`
  );
}
