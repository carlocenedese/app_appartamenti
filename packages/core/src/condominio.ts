/**
 * Condominium documents and the owners' check of the condominium expenses (plan 8, section 12).
 * Pure: the date of today (`asOf`) is an argument.
 */
import type { CondoDocument } from './model';
import { cents } from './money';
import type { Cents } from './money';

/**
 * The tenants' share a document gives (plan 8, decision 2: the administrator's document wins):
 * its own `quotaConduttore`, else the sum of its lines' when every line gives one, else none.
 */
export function documentQuotaConduttore(doc: CondoDocument): Cents | undefined {
  if (doc.quotaConduttore !== undefined) return doc.quotaConduttore;
  const lines = doc.lines ?? [];
  if (lines.length === 0 || lines.some((l) => l.quotaConduttore === undefined)) return undefined;
  return cents(lines.reduce((sum, l) => sum + (l.quotaConduttore ?? 0), 0));
}
