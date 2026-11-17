import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MachineSettings, SettingsBackend } from '../src/machine-settings';
import { checkForUpdate, renderUpdatesPanel, updatesOn } from '../src/updates';
import type { UpdateBackend } from '../src/updates';

let saved: string | undefined;
const settings: SettingsBackend = {
  readText: () =>
    saved === undefined ? Promise.reject(new Error('missing')) : Promise.resolve(saved),
  writeText: (text) => {
    saved = text;
    return Promise.resolve();
  },
};
const stored = (): MachineSettings => (saved === undefined ? {} : JSON.parse(saved));
const save = (s: MachineSettings) => {
  saved = JSON.stringify(s);
};

const install = vi.fn(() => Promise.resolve());
const restart = vi.fn(() => Promise.resolve());
const close = vi.fn(() => Promise.resolve());
/** A fake updater that offers `offer` (or nothing, or fails). */
function fakeUpdater(offer: { version: string; currentVersion: string } | null | Error) {
  const updater: UpdateBackend = {
    check: vi.fn(() =>
      offer instanceof Error
        ? Promise.reject(offer)
        : Promise.resolve(offer === null ? null : { ...offer, install, close }),
    ),
    restart,
  };
  return updater;
}

let root: HTMLElement;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const status = () => root.querySelector('.updates-status')?.textContent ?? '';
const buttonNamed = (label: string) =>
  [...root.querySelectorAll('button')].find((b) => b.textContent === label);
const click = (label: string) => {
  const b = buttonNamed(label);
  if (b === undefined) throw new Error(`no button ${label}`);
  b.click();
};
const toggle = () => {
  const t = root.querySelector<HTMLInputElement>('input[type=checkbox]');
  if (t === null) throw new Error('no switch');
  return t;
};

beforeEach(() => {
  // The first start has written the settings file, without the switch.
  saved = '{}';
  close.mockReset().mockResolvedValue(undefined);
  install.mockReset().mockResolvedValue(undefined);
  restart.mockReset().mockResolvedValue(undefined);
  root = document.createElement('section');
});

describe('checkForUpdate', () => {
  it('makes no call when the switch is off', async () => {
    save({ checkUpdates: false });
    const updater = fakeUpdater({ version: '0.2.0', currentVersion: '0.1.0' });
    expect(await checkForUpdate(settings, updater)).toEqual({ kind: 'off' });
    expect(updater.check).not.toHaveBeenCalled();
  });

  it('checks when the switch is missing from the file (on by default, open question)', async () => {
    const updater = fakeUpdater({ version: '0.2.0', currentVersion: '0.1.0' });
    expect((await checkForUpdate(settings, updater)).kind).toBe('available');
  });

  it('is off, with no call, for a missing, corrupt or odd settings file', async () => {
    const updater = fakeUpdater({ version: '0.2.0', currentVersion: '0.1.0' });
    for (const text of [undefined, '{"checkUpdates": ', '[]', 'null', '{"checkUpdates": "si"}']) {
      saved = text;
      expect(await updatesOn(settings)).toBe(false);
      expect(await checkForUpdate(settings, updater)).toEqual({ kind: 'off' });
    }
    expect(updater.check).not.toHaveBeenCalled();
  });

  it('reads the switch raw, whatever the other settings look like', async () => {
    saved = '{"folder": 7, "checkUpdates": true}';
    expect(await updatesOn(settings)).toBe(true);
    saved = '{"folder": 7, "checkUpdates": false}';
    expect(await updatesOn(settings)).toBe(false);
  });

  it('proposes nothing for the version in use, and frees what the plugin returned', async () => {
    expect(await checkForUpdate(settings, fakeUpdater(null))).toEqual({ kind: 'none' });
    const same = fakeUpdater({ version: '0.1.0', currentVersion: '0.1.0' });
    expect(await checkForUpdate(settings, same)).toEqual({ kind: 'none' });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('turns a network error into a result, not an exception', async () => {
    const updater = fakeUpdater(new Error('dns error: 192.0.2.1'));
    expect(await checkForUpdate(settings, updater)).toEqual({ kind: 'error' });
  });
});

describe('renderUpdatesPanel', () => {
  it('makes no network call at start when the switch is off, and «Controlla ora» is disabled', async () => {
    save({ checkUpdates: false });
    const updater = fakeUpdater({ version: '0.2.0', currentVersion: '0.1.0' });
    await renderUpdatesPanel(root, { settings, updater, checkAtStart: true });
    expect(updater.check).not.toHaveBeenCalled();
    expect(toggle().checked).toBe(false);
    expect(buttonNamed('Controlla ora')?.disabled).toBe(true);
    expect(status()).toMatch(/disattivato/);
  });

  it('checks at start, shows the new version and installs only after the click', async () => {
    const updater = fakeUpdater({ version: '0.2.0', currentVersion: '0.1.0' });
    await renderUpdatesPanel(root, { settings, updater, checkAtStart: true });
    expect(updater.check).toHaveBeenCalledTimes(1);
    expect(status()).toBe('È disponibile la versione 0.2.0 (in uso: 0.1.0).');
    expect(install).not.toHaveBeenCalled();
    expect(restart).not.toHaveBeenCalled();

    click('Installa e riavvia');
    await flush();
    expect(install).toHaveBeenCalledTimes(1);
    expect(restart).toHaveBeenCalledTimes(1);
  });

  it('does not check at start unless asked; «Controlla ora» checks', async () => {
    const updater = fakeUpdater(null);
    await renderUpdatesPanel(root, { settings, updater });
    expect(updater.check).not.toHaveBeenCalled();
    expect(buttonNamed('Installa e riavvia')).toBeUndefined();
    click('Controlla ora');
    await flush();
    expect(updater.check).toHaveBeenCalledTimes(1);
    expect(status()).toBe('Stai usando la versione più recente.');
    expect(buttonNamed('Installa e riavvia')).toBeUndefined();
  });

  it('shows a clear message on a network error, without the error text', async () => {
    await renderUpdatesPanel(root, {
      settings,
      updater: fakeUpdater(new Error('dns error: 192.0.2.1')),
      checkAtStart: true,
    });
    expect(status()).toMatch(/^Non è stato possibile controllare gli aggiornamenti/);
    expect(status()).not.toMatch(/dns/);
  });

  it('keeps the app as it was when the installation fails', async () => {
    install.mockRejectedValue(new Error('signature mismatch'));
    const updater = fakeUpdater({ version: '0.2.0', currentVersion: '0.1.0' });
    await renderUpdatesPanel(root, { settings, updater, checkAtStart: true });
    click('Installa e riavvia');
    await flush();
    expect(restart).not.toHaveBeenCalled();
    expect(status()).toMatch(/^Non è stato possibile installare l'aggiornamento/);
    expect(buttonNamed('Installa e riavvia')?.disabled).toBe(false);
  });

  it('asks to reopen the app by hand when the restart fails after the installation', async () => {
    restart.mockRejectedValue(new Error('restart'));
    const updater = fakeUpdater({ version: '0.2.0', currentVersion: '0.1.0' });
    await renderUpdatesPanel(root, { settings, updater, checkAtStart: true });
    click('Installa e riavvia');
    await flush();
    expect(install).toHaveBeenCalledTimes(1);
    expect(status()).toBe("Aggiornamento installato: chiudi e riapri l'app.");
  });

  it('locks the switch and the buttons while a check runs', async () => {
    let answer: (value: null) => void = () => undefined;
    const updater: UpdateBackend = {
      check: () => new Promise((resolve) => (answer = resolve)),
      restart,
    };
    await renderUpdatesPanel(root, { settings, updater });
    click('Controlla ora');
    await flush();
    expect(toggle().disabled).toBe(true);
    expect(buttonNamed('Controlla ora')?.disabled).toBe(true);
    answer(null);
    await flush();
    expect(toggle().disabled).toBe(false);
    expect(buttonNamed('Controlla ora')?.disabled).toBe(false);
  });

  it('locks the switch and both buttons while installing', async () => {
    let done: () => void = () => undefined;
    install.mockImplementation(() => new Promise<void>((resolve) => (done = resolve)));
    const updater = fakeUpdater({ version: '0.2.0', currentVersion: '0.1.0' });
    await renderUpdatesPanel(root, { settings, updater, checkAtStart: true });
    click('Installa e riavvia');
    await flush();
    expect(toggle().disabled).toBe(true);
    expect(buttonNamed('Controlla ora')?.disabled).toBe(true);
    expect(buttonNamed('Installa e riavvia')?.disabled).toBe(true);
    done();
    await flush();
    expect(restart).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
  });

  it('frees an offered update when a new check replaces it', async () => {
    const updater = fakeUpdater({ version: '0.2.0', currentVersion: '0.1.0' });
    await renderUpdatesPanel(root, { settings, updater, checkAtStart: true });
    click('Controlla ora');
    await flush();
    expect(updater.check).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledTimes(1);
    expect(buttonNamed('Installa e riavvia')).toBeDefined();
  });

  it('keeps the switch as it was when saving fails', async () => {
    const failing: SettingsBackend = {
      readText: settings.readText,
      writeText: () => Promise.reject(new Error('disk')),
    };
    await renderUpdatesPanel(root, { settings: failing, updater: fakeUpdater(null) });
    toggle().checked = false;
    toggle().dispatchEvent(new Event('change'));
    await flush();
    expect(toggle().checked).toBe(true);
    expect(toggle().disabled).toBe(false);
    expect(status()).toBe('Non è stato possibile salvare.');
  });

  it('saves the switch without losing the other machine settings', async () => {
    save({ folder: '/Dropbox/Gruppo', userId: 'u-1' });
    const updater = fakeUpdater({ version: '0.2.0', currentVersion: '0.1.0' });
    await renderUpdatesPanel(root, { settings, updater, checkAtStart: true });
    expect(toggle().checked).toBe(true);

    toggle().checked = false;
    toggle().dispatchEvent(new Event('change'));
    await flush();
    expect(stored()).toEqual({ folder: '/Dropbox/Gruppo', userId: 'u-1', checkUpdates: false });
    expect(buttonNamed('Installa e riavvia')).toBeUndefined();
    expect(close).toHaveBeenCalledTimes(1);
    expect(buttonNamed('Controlla ora')?.disabled).toBe(true);

    toggle().checked = true;
    toggle().dispatchEvent(new Event('change'));
    await flush();
    expect(stored().checkUpdates).toBe(true);
    expect(buttonNamed('Controlla ora')?.disabled).toBe(false);
    expect(updater.check).toHaveBeenCalledTimes(1);
  });
});
