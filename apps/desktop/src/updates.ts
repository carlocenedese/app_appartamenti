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

const isOn = async (settings: SettingsBackend) =>
  (await loadMachineSettings(settings)).checkUpdates !== false;

/** Asks for a newer version, unless the switch is off; never throws. */
export async function checkForUpdate(
  settings: SettingsBackend,
  updater: UpdateBackend,
): Promise<CheckResult> {
  if (!(await isOn(settings))) return { kind: 'off' };
  try {
    const update = await updater.check();
    // The plugin offers only newer versions; the same one again is ignored all the same.
    return update === null || update.version === update.currentVersion
      ? { kind: 'none' }
      : { kind: 'available', update };
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

  const show = (text: string, ...buttons: HTMLButtonElement[]) => {
    status.textContent = text;
    actions.replaceChildren(checkNow, ...buttons);
  };

  async function runCheck(): Promise<void> {
    checkNow.disabled = true;
    show(TEXT.checking);
    const result = await checkForUpdate(settings, updater);
    checkNow.disabled = result.kind === 'off';
    if (result.kind === 'available') {
      const { update } = result;
      const installButton = button(
        'Installa e riavvia',
        () => void runInstall(update, installButton),
        true,
      );
      show(
        `È disponibile la versione ${update.version} (in uso: ${update.currentVersion}).`,
        installButton,
      );
    } else {
      show({ off: TEXT.off, none: TEXT.none, error: TEXT.checkError }[result.kind]);
    }
  }

  async function runInstall(update: AvailableUpdate, installButton: HTMLButtonElement) {
    installButton.disabled = checkNow.disabled = true;
    status.textContent = TEXT.installing;
    try {
      await update.install();
    } catch {
      installButton.disabled = checkNow.disabled = false;
      status.textContent = TEXT.installError;
      return;
    }
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
      try {
        // Read again and merge: the first start writes the same file.
        await saveMachineSettings(settings, {
          ...(await loadMachineSettings(settings)),
          checkUpdates: on,
        });
      } catch {
        toggle.checked = !on;
        status.textContent = TEXT.saveError;
        return;
      }
      checkNow.disabled = !on;
      show(on ? '' : TEXT.off);
    })();
  });

  const on = await isOn(settings);
  toggle.checked = on;
  checkNow.disabled = !on;
  show(on ? '' : TEXT.off);
  if (on && input.checkAtStart === true) await runCheck();
}
