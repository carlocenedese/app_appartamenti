import { CORE_VERSION } from '@bollette/core';

/** The line the window shows: the app name and the version of the calculation engine. */
export function renderVersion(): string {
  return `App Bollette, motore ${CORE_VERSION}`;
}

/** Writes the version line into `element`, replacing what it showed before. */
export function showVersion(element: { textContent: string | null }): void {
  element.textContent = renderVersion();
}

// Entry point of the window. Importing this module outside a browser (the tests run in Node)
// does nothing: there is no document to write into.
if (typeof document !== 'undefined') {
  const element = document.getElementById('version');
  if (element !== null) showVersion(element);
}
