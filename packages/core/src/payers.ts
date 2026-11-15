/** Who pays: the key of a payer, the payers valid on a day, and the name as it appears in text. */
import { normaliseIban } from './iban';
import type { Payer, PayerKey, Tenancy, Tenant } from './model';
import type { ISODate } from './period';
import { compareText, foldText } from './text';

const WORDS = /[\p{L}\p{N}]+/gu;

/** `name:<folded name>`, also when there is an IBAN; `undefined` for a blank or missing name. */
export function nameKeyOf(counterparty?: { name?: string }): PayerKey | undefined {
  const name = foldText(counterparty?.name ?? '');
  return name === '' ? undefined : `name:${name}`;
}

/** `iban:<IBAN>` when the IBAN is valid, else the name key, else `undefined`. */
export function payerKeyOf(counterparty?: { name?: string; iban?: string }): PayerKey | undefined {
  const iban = counterparty?.iban === undefined ? undefined : normaliseIban(counterparty.iban);
  return iban === undefined ? nameKeyOf(counterparty) : `iban:${iban}`;
}

/**
 * Live payers with this key valid on `date` (both ends included), one per tenant, by `tenantId`.
 * A payer of a deleted tenant is left out, as if it were not there (Carlo, 15 Nov 2026, R119).
 */
export function validPayers(
  payers: Payer[],
  key: PayerKey,
  date: ISODate,
  tenants: Tenant[],
): Payer[] {
  const gone = new Set(tenants.filter((t) => t.deleted === true).map((t) => t.id));
  const byTenant = new Map<string, Payer>();
  // By id first, so the record kept for a tenant does not depend on the loading order.
  for (const p of [...payers].sort((a, b) => compareText(a.id, b.id))) {
    if (p.deleted === true || p.key !== key || gone.has(p.tenantId)) continue;
    if (p.validFrom > date || (p.validTo !== undefined && p.validTo < date)) continue;
    if (!byTenant.has(p.tenantId)) byTenant.set(p.tenantId, p);
  }
  return [...byTenant.values()].sort((a, b) => compareText(a.tenantId, b.tenantId));
}

/** True when every word of `name` is a whole word of the texts (any order, any text). */
export function nameInText(name: string, texts: string[]): boolean {
  const wanted = foldText(name).match(WORDS) ?? [];
  if (wanted.length === 0) return false;
  const have = new Set(foldText(texts.join(' ')).match(WORDS) ?? []);
  return wanted.every((word) => have.has(word));
}

/** The first day of the oldest live presence of the tenant in the apartment. */
export function firstPresenceDay(
  tenancies: Tenancy[],
  tenantId: string,
  apartmentId: string,
): ISODate | undefined {
  let first: string | undefined;
  for (const t of tenancies) {
    if (t.deleted === true || t.tenantId !== tenantId || t.apartmentId !== apartmentId) continue;
    if (first === undefined || t.from < first) first = t.from;
  }
  return first === undefined ? undefined : (`${first}-01` as ISODate);
}
