import type { Apartment } from './model';
import type { ExtractionResult } from './extraction';
import { foldText } from './text';

type Property = ExtractionResult['parts'][number]['property'];

export interface ApartmentSuggestion {
  apartmentId: string;
  origin: 'catasto' | 'indirizzo';
}

// Abbreviation (written without dots) to the canonical street type; a different type is a different street.
const STREET_TYPES = new Map<string, string>([
  ...[
    'via',
    'galleria',
    'viale',
    'piazza',
    'corso',
    'largo',
    'riva',
    'salita',
    'androna',
    'calle',
    'campo',
  ].map((t): [string, string] => [t, t]),
  ['v', 'via'],
  ['gal', 'galleria'],
  ['pza', 'piazza'],
  ['cso', 'corso'],
]);

interface AddressKey {
  type: string | undefined;
  rest: string;
}

/** Street type, street name and first number group, or undefined when there is no number. */
function addressKey(address: string): AddressKey | undefined {
  const text = foldText(address)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\./g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  const match = /^(.*?)\s*(\d+)/u.exec(text);
  if (match === null) return undefined;
  const words = (match[1] as string).split(' ').filter((w) => w !== '');
  const type = STREET_TYPES.get(words[0] ?? '');
  if (type !== undefined) words.shift();
  return words.length === 0
    ? undefined
    : { type, rest: `${words.join(' ')}|${match[2] as string}` };
}

// An address without a street type word matches a typed one (ruling).
function sameAddress(a: AddressKey, b: AddressKey): boolean {
  return a.rest === b.rest && (a.type === undefined || b.type === undefined || a.type === b.type);
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
    } else {
      const other = address === undefined ? undefined : addressKey(address);
      if (key !== undefined && other !== undefined && sameAddress(other, key)) {
        result.push({ apartmentId: id, origin: 'indirizzo' });
      }
    }
  }
  const exact = result.filter((r) => r.origin === 'catasto');
  return exact.length > 0 ? exact : result;
}
