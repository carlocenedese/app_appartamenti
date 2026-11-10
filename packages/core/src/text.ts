/**
 * Text as it is compared: NFC (the same text typed on macOS and on Windows), runs of whitespace
 * (non-breaking spaces and line breaks included) as one space, no space at either end, lowercase.
 * Statements and bills write the same name with other spaces and capitals.
 */
export function foldText(text: string): string {
  return text.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Plain code-unit order, the same on every runtime and locale (unlike `localeCompare`). */
export function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
