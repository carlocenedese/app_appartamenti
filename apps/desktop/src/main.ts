import { CORE_VERSION } from '@bollette/core';
import { isTauri } from '@tauri-apps/api/core';

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

// Updates panel, inside the app only (plan 16b): one check at start if the switch is on.
if (typeof document !== 'undefined' && isTauri()) {
  void Promise.all([import('./updates'), import('./updates-tauri'), import('./machine-settings')])
    .then(([updates, tauri, settings]) => {
      const section = document.createElement('section');
      section.className = 'updates';
      document.querySelector('main')?.append(section);
      return updates.renderUpdatesPanel(section, {
        settings: settings.tauriSettingsBackend,
        updater: tauri.tauriUpdateBackend,
        checkAtStart: true,
      });
    })
    .catch(() => {
      // Only a fixed message: the error may hold paths.
      console.error('Pannello degli aggiornamenti non disponibile.');
    });
}

// Local demo of the two supply screens (invented data), reached only with #utenze-demo in development builds.
if (import.meta.env.DEV && typeof document !== 'undefined' && location.hash === '#utenze-demo') {
  void import('./demo').then((m) => m.showDemo(document.querySelector('main') as HTMLElement));
}

const seedFiles = import.meta.glob<unknown>('../../../python/seed-profiles/*.json', {
  eager: true,
  import: 'default',
});

// First start, still being built: reached only with #primo-avvio in development builds.
if (import.meta.env.DEV && typeof document !== 'undefined' && location.hash === '#primo-avvio') {
  void Promise.all([
    import('./first-run'),
    import('./machine-settings'),
    import('./tauri-store'),
  ]).then(([firstRun, settings, tauri]) => {
    const main = document.querySelector('main') as HTMLElement;
    firstRun.renderFirstRun(main, {
      settings: settings.tauriSettingsBackend,
      pickFolder: tauri.pickFolder,
      openStore: (folder) => new tauri.TauriStore(folder, tauri.tauriFsBackend),
      // The same files the installer bundles (R83), taken from the repository at build time: no network.
      seeds: () => Promise.resolve(Object.values(seedFiles)),
      clock: () => new Date().toISOString(),
      newId: () => crypto.randomUUID(),
      schedule: (ms, tick) => {
        const handle = setInterval(tick, ms);
        return () => clearInterval(handle);
      },
      onReady: () => {
        main.replaceChildren(document.createTextNode('Cartella pronta.'));
      },
    });
  });
}
