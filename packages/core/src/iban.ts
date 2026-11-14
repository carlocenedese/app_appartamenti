/** IBAN normalisation and the ISO 13616 mod-97 check. */

// Checked before upper-casing: `toUpperCase` turns non-ASCII letters ("ſ", "ı") into ASCII ones.
const SHAPE = /^[A-Za-z]{2}[0-9]{2}[A-Za-z0-9]{11,30}$/;

/** The IBAN without spaces and in capitals, or `undefined` when its shape or check digits are wrong. */
export function normaliseIban(text: string): string | undefined {
  const stripped = text.replace(/\s+/g, '');
  if (!SHAPE.test(stripped)) return undefined;
  const iban = stripped.toUpperCase();
  const moved = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const char of moved) {
    // Letters are 10..35; the remainder stays small by folding in one character at a time.
    const digits = char >= 'A' ? String(char.charCodeAt(0) - 55) : char;
    for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1 ? iban : undefined;
}
