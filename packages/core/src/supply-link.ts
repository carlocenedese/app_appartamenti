import type { Supply } from './model';

export interface SupplyDraft {
  label: string;
  rows: { apartmentId: string; basisPoints: number }[];
  note: string;
}

/** Basis points as an Italian percentage with two decimals: 3333 -> «33,33%». */
function percent(basisPoints: number): string {
  return `${Math.trunc(basisPoints / 100)},${String(basisPoints % 100).padStart(2, '0')}%`;
}

/** One row at 100% for a single suggestion, otherwise empty rows (one per suggestion). */
export function newDraft(label: string, suggested: { apartmentId: string }[]): SupplyDraft {
  const rows =
    suggested.length === 1
      ? [{ apartmentId: (suggested[0] as { apartmentId: string }).apartmentId, basisPoints: 10000 }]
      : suggested.map(() => ({ apartmentId: '', basisPoints: 0 }));
  return { label, rows, note: '' };
}

export function draftTotal(draft: SupplyDraft): number {
  return draft.rows.reduce((sum, r) => sum + r.basisPoints, 0);
}

/** The first thing wrong with the draft, in Italian, or undefined when it can be saved. */
export function draftProblem(draft: SupplyDraft): string | undefined {
  if (draft.rows.length === 0) return 'Scegli almeno un appartamento.';
  if (draft.rows.some((r) => r.apartmentId === '')) return "Scegli l'appartamento di ogni riga.";
  if (new Set(draft.rows.map((r) => r.apartmentId)).size !== draft.rows.length) {
    return 'Lo stesso appartamento compare due volte.';
  }
  if (draft.rows.some((r) => !Number.isInteger(r.basisPoints) || r.basisPoints < 1)) {
    return 'Ogni riga deve avere almeno 0,01%.';
  }
  const total = draftTotal(draft);
  if (total < 10000) {
    return `Il totale è ${percent(total)}: manca il ${percent(10000 - total)}`;
  }
  if (total > 10000) {
    return `Il totale è ${percent(total)}: sono ${percent(total - 10000)} di troppo`;
  }
  return undefined;
}

/** The supply to write (the note is a separate record, written by the caller). */
export function draftToSupply(
  draft: SupplyDraft,
  ids: { newId: () => string },
): Omit<Supply, 'v' | 'rev'> {
  const problem = draftProblem(draft);
  if (problem !== undefined) throw new RangeError(problem);
  return {
    id: ids.newId(),
    label: draft.label,
    apartments: draft.rows.map((r) => ({ apartmentId: r.apartmentId, weight: r.basisPoints })),
  };
}
