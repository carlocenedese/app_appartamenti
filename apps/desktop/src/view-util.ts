/** Basis points from what the user typed («33,33»): at most two decimals, empty means 0. */
export function parsePercent(text: string): number | undefined {
  const t = text.trim();
  if (t === '') return 0;
  const match = /^(\d{1,3})(?:[,.](\d{1,2}))?$/.exec(t);
  if (match === null) return undefined;
  const basisPoints = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return basisPoints > 10000 ? undefined : basisPoints;
}

/** Display only: basis points as «33,33%». */
export function formatPercent(basisPoints: number): string {
  return `${Math.trunc(basisPoints / 100)},${String(basisPoints % 100).padStart(2, '0')}%`;
}

/** The message under a failed save; the text of the error is never shown. */
export function saveErrorMessage(error: unknown): string {
  return error instanceof Error && error.name === 'StaleWriteError'
    ? "Un'altra persona ha cambiato questa utenza. Ricarica e riprova."
    : 'Non è stato possibile salvare.';
}

/** Creates an element with a class and text. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text = '',
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== '') node.className = className;
  if (text !== '') node.textContent = text;
  return node;
}

export function button(label: string, onClick: () => void, primary = false): HTMLButtonElement {
  const b = el('button', primary ? 'primary' : '', label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}
