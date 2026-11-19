/** `{ [key]: value }`, or nothing when the value is `undefined` (spread into a result). */
export const optional = <K extends string, V>(
  key: K,
  value: V | undefined,
): Partial<Record<K, V>> => (value === undefined ? {} : { [key]: value }) as Partial<Record<K, V>>;
