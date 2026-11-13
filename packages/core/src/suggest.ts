import type { Apartment } from './model';
import type { ExtractionResult } from './extraction';
import { foldText } from './text';

type Property = ExtractionResult['parts'][number]['property'];

export interface ApartmentSuggestion {
  apartmentId: string;
  origin: 'catasto' | 'indirizzo';
}

const STREET_TYPES = new Set(['via', 'v', 'galleria', 'gal', 'viale', 'piazza', 'pza']);

/** Street (without its type word) and first number group, or undefined when there is no number. */
function addressKey(address: string): string | undefined {
  const text = foldText(address)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\./g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  const match = /^(.*?)\s*(\d+)/u.exec(text);
  if (match === null) return undefined;
  const words = (match[1] as string).split(' ').filter((w) => w !== '');
  if (words.length > 0 && STREET_TYPES.has(words[0] as string)) words.shift();
  return words.length === 0 ? undefined : `${words.join(' ')}|${match[2] as string}`;
}

/** Apartments the property written in a notice points to: cadastre first, then address. */
export function suggestApartments(
  property: Property,
  apartments: Pick<Apartment, 'id' | 'address' | 'cadastre'>[],
): ApartmentSuggestion[] {
  if (property === undefined) return [];
  const { sheet, parcel, sub } = property;
  const key = addressKey(property.address);
  const result: ApartmentSuggestion[] = [];
  for (const { id, address, cadastre } of apartments) {
    if (
      sheet !== undefined &&
      parcel !== undefined &&
      sub !== undefined &&
      (cadastre ?? []).some((c) => c.sheet === sheet && c.parcel === parcel && c.sub === sub)
    ) {
      result.push({ apartmentId: id, origin: 'catasto' });
    } else if (key !== undefined && address !== undefined && addressKey(address) === key) {
      result.push({ apartmentId: id, origin: 'indirizzo' });
    }
  }
  return result;
}
