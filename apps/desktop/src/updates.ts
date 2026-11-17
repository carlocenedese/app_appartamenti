/**
 * Updates (plan 16b): the «Aggiornamenti» panel. The check is the app's only network call (spec
 * section 28): never made while the switch in the machine settings is off, and an update is
 * installed only after the user's click. The updater plugin checks the signature. Plain markup:
 * the look is someone else's job.
 */
import { loadMachineSettings, saveMachineSettings } from './machine-settings';
import type { SettingsBackend } from './machine-settings';
import { button, el } from './view-util';

export interface AvailableUpdate {
  version: string;
  currentVersion: string;
  /** Downloads, verifies the signature and installs. */
  install(): Promise<void>;
  /** Frees the plugin's resource for an update that will not be installed. */
  close(): Promise<void>;
}

/** The updater, injected so the panel is tested without Tauri (real one: updates-tauri.ts). */
export interface UpdateBackend {
  /** `null` when there is nothing newer. */
  check(): Promise<AvailableUpdate | null>;
  restart(): Promise<void>;
}

export type CheckResult =
  | { kind: 'off' }
  | { kind: 'none' }
  | { kind: 'error' }
  | { kind: 'available'; update: AvailableUpdate };

/**
 * Whether the switch is on, read raw from the settings file: on only when the file is a JSON
 * object whose `checkUpdates` is missing or true. A missing, unreadable or corrupt file means off
 * (no network): the first start writes the file before the next launch checks (R286).
 */
export async function updatesOn(settings: SettingsBackend): Promise<boolean> {
  try {
    const parsed: unknown = JSON.parse(await settings.readText());
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return false;
    const value = (parsed as { checkUpdates?: unknown }).checkUpdates;
    return value === undefined || value === true;
  } catch {
    return false;
  }
}

const discard = (update: AvailableUpdate | undefined) => {
  void update?.close().catch(() => undefined);
};

/** Asks for a newer version, unless the switch is off; never throws. */
export async function checkForUpdate(
  settings: SettingsBackend,
  updater: UpdateBackend,
): Promise<CheckResult> {
  if (!(await updatesOn(settings))) return { kind: 'off' };
  try {
    const update = await updater.check();
    if (update === null) return { kind: 'none' };
    // The plugin offers only newer versions; the same one again is ignored all the same.
    if (update.version === update.currentVersion) {
      discard(update);
      return { kind: 'none' };
    }
    return { kind: 'available', update };
  } catch {
    // The error text is neither shown nor logged: it may hold paths or addresses.
    return { kind: 'error' };
  }
}

const TEXT = {
  off: 'Controllo degli aggiornamenti disattivato.',
  checking: 'Controllo in corso…',
  none: 'Stai usando la versione più recente.',
  checkError:
    'Non è stato possibile controllare gli aggiornamenti. Controlla la connessione a internet e riprova più tardi.',
  installing: 'Scaricamento e installazione in corso…',
  installError:
    "Non è stato possibile installare l'aggiornamento. L'app resta com'era: riprova più tardi.",
  restartError: "Aggiornamento installato: chiudi e riapri l'app.",
  saveError: 'Non è stato possibile salvare.',
};

export interface UpdatesPanelInput {
  settings: SettingsBackend;
  updater: UpdateBackend;
  /** One check as the panel opens (at app start), if the switch is on. */
  checkAtStart?: boolean;
}

/** Fills `root` with the panel; resolves after the check at start, if any. */
export async function renderUpdatesPanel(
  root: HTMLElement,
  input: UpdatesPanelInput,
): Promise<void> {
  const { settings, updater } = input;
  const toggle = el('input');
  toggle.type = 'checkbox';
  const label = el('label');
  label.append(
    toggle,
    " Controlla gli aggiornamenti all'avvio (l'unica connessione a internet dell'app)",
  );
  const status = el('p', 'updates-status');
  status.setAttribute('aria-live', 'polite');
  const actions = el('p');
  const checkNow = button('Controlla ora', () => void runCheck());
  root.replaceChildren(el('h2', '', 'Aggiornamenti'), label, actions, status);

  /** The update on offer, closed when it is replaced or the switch goes off. */
  let offered: AvailableUpdate | undefined;
  let installButton: HTMLButtonElement | undefined;
  const show = (text: string, ...buttons: HTMLButtonElement[]) => {
    status.textContent = text;
    actions.replaceChildren(checkNow, ...buttons);
  };
  const dropOffer = () => {
    discard(offered);
    offered = installButton = undefined;
  };
  /** Nothing can be clicked while a check, an installation or a save runs. */
  const busy = (on: boolean) => {
    toggle.disabled = on;
    checkNow.disabled = on || !toggle.checked;
    if (installButton !== undefined) installButton.disabled = on;
  };

  async function runCheck(): Promise<void> {
    dropOffer();
    busy(true);
    show(TEXT.checking);
    const result = await checkForUpdate(settings, updater);
    busy(false);
    // The switch is read again after the wait: an offer never outlives it.
    if (result.kind === 'off' || !toggle.checked) {
      if (result.kind === 'available') discard(result.update);
      show(TEXT.off);
      return;
    }
    if (result.kind === 'available') {
      const update = result.update;
      offered = update;
      const install = button('Installa e riavvia', () => void runInstall(update), true);
      installButton = install;
      show(
        `È disponibile la versione ${update.version} (in uso: ${update.currentVersion}).`,
        install,
      );
    } else {
      show({ none: TEXT.none, error: TEXT.checkError }[result.kind]);
    }
  }

  async function runInstall(update: AvailableUpdate) {
    busy(true);
    status.textContent = TEXT.installing;
    try {
      await update.install();
    } catch {
      busy(false);
      status.textContent = TEXT.installError;
      return;
    }
    offered = undefined;
    // Windows: the installer has already closed the app. macOS: start the new version.
    try {
      await updater.restart();
    } catch {
      status.textContent = TEXT.restartError;
    }
  }

  toggle.addEventListener('change', () => {
    void (async () => {
      const on = toggle.checked;
      busy(true);
      try {
        // Read again and merge: the first start writes the same file.
        await saveMachineSettings(settings, {
          ...(await loadMachineSettings(settings)),
          checkUpdates: on,
        });
      } catch {
        toggle.checked = !on;
        busy(false);
        status.textContent = TEXT.saveError;
        return;
      }
      if (!on) dropOffer();
      busy(false);
      if (!on) show(TEXT.off);
      else if (offered === undefined) show('');
    })();
  });

  const on = await updatesOn(settings);
  toggle.checked = on;
  busy(false);
  show(on ? '' : TEXT.off);
  if (on && input.checkAtStart === true) await runCheck();
}
