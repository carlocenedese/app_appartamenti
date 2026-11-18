import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createUser, createWorkspace, liveUsers, repairDiverged } from '@bollette/core';
import { renderFirstRun } from '../src/first-run';
import type { FirstRunInput } from '../src/first-run';
import type { MachineSettings, SettingsBackend } from '../src/machine-settings';
import { TauriStore } from '../src/tauri-store';
import { MemoryFs } from './helpers/memory-fs';

vi.mock('@bollette/core', async (importOriginal) => {
  const core = await importOriginal<typeof import('@bollette/core')>();
  return { ...core, repairDiverged: vi.fn(core.repairDiverged) };
});

const ROOT = '/Dropbox/Gruppo';
const NOW = '2026-11-13T10:00:00.000Z';

/** A store that fails once on a chosen path, to interrupt createWorkspace. */
class FlakyStore extends TauriStore {
  failOn: string | undefined;
  override async writeJsonAtomic(path: string, value: unknown): Promise<void> {
    if (path === this.failOn) {
      this.failOn = undefined;
      throw new Error('interrotto');
    }
    return super.writeJsonAtomic(path, value);
  }
}

let fs: MemoryFs;
let store: FlakyStore;
let saved: string | undefined;
let root: HTMLElement;
let ids: number;
const ticks: { ms: number; tick: () => void }[] = [];
const stop = vi.fn();

const settingsBackend: SettingsBackend = {
  readText: () =>
    saved === undefined ? Promise.reject(new Error('missing')) : Promise.resolve(saved),
  writeText: (text) => {
    saved = text;
    return Promise.resolve();
  },
};
const settings = (): MachineSettings => (saved === undefined ? {} : JSON.parse(saved));
const newId = () => `id-${String(ids++)}`;

function input(over: Partial<FirstRunInput> = {}): FirstRunInput {
  return {
    settings: settingsBackend,
    pickFolder: vi.fn(() => Promise.resolve(ROOT)),
    openStore: () => store,
    seeds: () => Promise.resolve([]),
    clock: () => NOW,
    newId,
    schedule: (ms, tick) => {
      ticks.push({ ms, tick });
      return stop;
    },
    onReady: vi.fn(),
    ...over,
  };
}

beforeEach(() => {
  fs = new MemoryFs();
  fs.dirs.add('/Dropbox');
  fs.dirs.add(ROOT);
  store = new FlakyStore(ROOT, fs);
  saved = undefined;
  ids = 0;
  ticks.length = 0;
  stop.mockReset();
  vi.mocked(repairDiverged).mockClear();
  root = document.createElement('div');
});

const heading = () => root.querySelector('h2')?.textContent;
const primaries = () => root.querySelectorAll('button.primary');
const primary = () => primaries()[0] as HTMLButtonElement;
const buttonNamed = (text: string) =>
  [...root.querySelectorAll('button')].find((b) => b.textContent === text) as HTMLButtonElement;
function type(name: string, text: string): void {
  const field = root.querySelector(`input[name="${name}"]`) as HTMLInputElement;
  field.value = text;
  field.dispatchEvent(new Event('input', { bubbles: true }));
}
const screen = (title: string) => vi.waitFor(() => expect(heading()).toBe(title));

/** A workspace in ROOT with the user u-1 «Mario»; the machine is u-1 unless said otherwise. */
async function existingGroup(machine: MachineSettings = { folder: ROOT, userId: 'u-1' }) {
  let n = 0;
  await createWorkspace(
    new TauriStore(ROOT, fs),
    { workspaceId: 'ws-1', name: 'Gruppo', user: { id: 'u-1', name: 'Mario' } },
    [],
    () => NOW,
    () => `seed-op-${String(n++)}`,
  );
  saved = JSON.stringify(machine);
}

describe('renderFirstRun: «Crea gruppo»', () => {
  it('saves pendingWorkspace before writing and reuses its ids on a retry with the same folder', async () => {
    renderFirstRun(root, input());
    await screen('Crea gruppo');
    type('group', 'Casa al mare');
    type('me', 'Mario');

    let pendingAtFirstWrite: unknown;
    const write = store.writeJsonAtomic.bind(store);
    store.writeJsonAtomic = async (path, value) => {
      pendingAtFirstWrite ??= settings().pendingWorkspace ?? null;
      return write(path, value);
    };
    store.failOn = '_app/workspace.json';
    primary().click();
    await vi.waitFor(() => expect(root.querySelector('.error')?.textContent).not.toBe(''));
    const pending = settings().pendingWorkspace;
    expect(pending).toEqual({ folder: ROOT, workspaceId: 'id-0', userId: 'id-1' });
    expect(pendingAtFirstWrite).toEqual(pending);
    expect(settings().folder).toBeUndefined();

    primary().click();
    await screen('Gruppo pronto');
    const workspace = JSON.parse(await fs.readText(`${ROOT}/_app/workspace.json`));
    expect(workspace.workspaceId).toBe('id-0');
    expect((await liveUsers(store)).map((u) => u.id)).toEqual(['id-1']);
    expect(settings()).toEqual({ folder: ROOT, userId: 'id-1' });
  });

  it('refuses a folder that already holds data of a group, with a message and no pending ids', async () => {
    // Another group arrived without its workspace.json.
    let n = 0;
    await createUser(
      store,
      { id: 'u-9', name: 'Zeno' },
      'u-9',
      () => NOW,
      () => `z-${String(n++)}`,
    );
    renderFirstRun(root, input());
    await screen('Crea gruppo');
    type('group', 'Casa al mare');
    type('me', 'Mario');
    primary().click();
    await vi.waitFor(() =>
      expect(root.querySelector('.error')?.textContent).toContain('già dei dati'),
    );
    expect(fs.names(`${ROOT}/_app`)).not.toContain('workspace.json');
    expect((await liveUsers(store)).map((u) => u.id)).toEqual(['u-9']);
    expect(settings().pendingWorkspace).toBeUndefined();
  });

  it('refuses a home folder or a root before writing anything', async () => {
    renderFirstRun(root, input({ pickFolder: () => Promise.resolve('/Users/user2') }));
    await screen('Crea gruppo');
    type('group', 'Casa al mare');
    type('me', 'Mario');
    primary().click();
    await vi.waitFor(() =>
      expect(root.querySelector('.error')?.textContent).toContain('troppo ampia'),
    );
    expect(saved).toBeUndefined();
  });

  it('starts a new group with new ids when the retry picks another folder', async () => {
    saved = JSON.stringify({
      pendingWorkspace: { folder: '/Dropbox/Altro', workspaceId: 'old-ws', userId: 'old-u' },
    });
    renderFirstRun(root, input());
    await screen('Crea gruppo');
    type('group', 'Casa al mare');
    type('me', 'Mario');
    primary().click();
    await screen('Gruppo pronto');
    expect(settings().userId).not.toBe('old-u');
    expect((await liveUsers(store)).map((u) => u.id)).toEqual([settings().userId]);
  });

  it('switches to «Unisciti a un gruppo» and back', async () => {
    renderFirstRun(root, input());
    await screen('Crea gruppo');
    buttonNamed('Unisciti a un gruppo').click();
    await screen('Unisciti a un gruppo');
    expect(primaries()).toHaveLength(1);
    buttonNamed('Crea gruppo').click();
    await screen('Crea gruppo');
    expect(primaries()).toHaveLength(1);
  });

  it('joins a valid group folder and asks who the user is', async () => {
    await existingGroup({});
    renderFirstRun(root, input());
    await screen('Crea gruppo');
    buttonNamed('Unisciti a un gruppo').click();
    await screen('Unisciti a un gruppo');
    primary().click();
    await screen('Chi sei?');
    expect(settings().folder).toBe(ROOT);
  });
});

describe('renderFirstRun: opening a folder', () => {
  it('with sync behind: read-only message, no write, and «Ripara» repairs once, only on click', async () => {
    await existingGroup();
    // The record is not as the journal says (cut short: a half-synchronised folder). A record at
    // the same rev with other content is a fork and is not repaired (revisione 2026-11-18, G1).
    const userFile = `${ROOT}/_app/dati/user/u-1.json`;
    fs.put(userFile, '{"id": "u-1", "v": 1, "re');
    renderFirstRun(root, input());
    await screen('Sola lettura');
    expect(root.textContent).toContain('sincronizzazione in corso o incompleta');
    expect(primaries()).toHaveLength(1);
    expect(primary().textContent).toBe('Ripara');
    expect(root.querySelectorAll('input')).toHaveLength(0);
    expect(repairDiverged).not.toHaveBeenCalled();
    expect(fs.names(`${ROOT}/_app`)).not.toContain('presenza');

    primary().click();
    await screen('Gruppo pronto');
    expect(repairDiverged).toHaveBeenCalledTimes(1);
    expect(vi.mocked(repairDiverged).mock.calls[0]?.[1]).toBe('_app/dati/user/u-1.json');
    expect(JSON.parse(await fs.readText(userFile)).name).toBe('Mario');
  });

  it('a saved or joined folder that is a home or a root: message, nothing read or written', async () => {
    saved = JSON.stringify({ folder: '/', userId: 'u-1' });
    const openStore = vi.fn(() => store);
    renderFirstRun(root, input({ openStore }));
    await screen('Cartella troppo ampia');
    expect(openStore).not.toHaveBeenCalled();
    expect(primary().textContent).toBe("Scegli un'altra cartella");
  });

  it('a folder without a group: message and no write action', async () => {
    saved = JSON.stringify({ folder: ROOT, userId: 'u-1' });
    renderFirstRun(root, input());
    await screen('Cartella non valida');
    expect(primaries()).toHaveLength(1);
    expect(primary().textContent).toBe("Scegli un'altra cartella");
    expect(fs.names(ROOT)).toEqual([]);
  });

  it('a folder written by a newer app opens read-only, without «Ripara»', async () => {
    await existingGroup();
    const ws = JSON.parse(await fs.readText(`${ROOT}/_app/workspace.json`));
    fs.put(`${ROOT}/_app/workspace.json`, JSON.stringify({ ...ws, minAppVersion: '99.0.0' }));
    renderFirstRun(root, input());
    await screen('Sola lettura');
    expect(root.textContent).toContain('versione più nuova');
    expect(buttonNamed('Ripara')).toBeUndefined();
  });

  it('asks to choose another user when the machine user is not in the folder', async () => {
    await existingGroup({ folder: ROOT, userId: 'u-gone' });
    renderFirstRun(root, input());
    await screen('Chi sei?');
    expect(primaries()).toHaveLength(1);
    const select = root.querySelector('select') as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(['Mario', 'Nuovo utente']);
    select.value = 'u-1';
    select.dispatchEvent(new Event('change'));
    primary().click();
    await screen('Gruppo pronto');
    expect(settings().userId).toBe('u-1');
  });

  it('a double click on «Continua» creates one user only', async () => {
    await existingGroup({ folder: ROOT, userId: 'u-gone' });
    renderFirstRun(root, input());
    await screen('Chi sei?');
    const select = root.querySelector('select') as HTMLSelectElement;
    select.value = '';
    select.dispatchEvent(new Event('change'));
    type('me', 'Lucia');
    const go = primary();
    go.click();
    go.click();
    await screen('Gruppo pronto');
    expect((await liveUsers(store)).filter((u) => u.name === 'Lucia')).toHaveLength(1);
  });

  it('with only a cut-short journal file: no «Ripara», the wait message and a way to check again', async () => {
    await existingGroup();
    fs.put(`${ROOT}/_app/journal/2026-11-13T10-00-00.000Z-u-1-zz.json`, '{"id":');
    renderFirstRun(root, input());
    await screen('Sola lettura');
    expect(buttonNamed('Ripara')).toBeUndefined();
    expect(root.textContent).toContain('Aspetta che Dropbox finisca');
    expect(root.textContent).not.toContain('usa «Ripara»');
    fs.put(`${ROOT}/_app/journal/2026-11-13T10-00-00.000Z-u-1-zz.json`, '{}');
    buttonNamed('Ricontrolla').click();
    await vi.waitFor(() => expect(heading()).toBe('Sola lettura'));
    expect(repairDiverged).not.toHaveBeenCalled();
  });

  it('creates a new user with a fresh id when asked', async () => {
    await existingGroup({ folder: ROOT, userId: 'u-gone' });
    renderFirstRun(root, input());
    await screen('Chi sei?');
    const select = root.querySelector('select') as HTMLSelectElement;
    select.value = '';
    select.dispatchEvent(new Event('change'));
    type('me', 'Lucia');
    primary().click();
    await screen('Gruppo pronto');
    const me = settings().userId;
    expect(me).toMatch(/^id-/);
    expect((await liveUsers(store)).find((u) => u.id === me)?.name).toBe('Lucia');
  });

  it('writes presence every minute, names the other active user, and stops', async () => {
    await existingGroup();
    let n = 0;
    await createUser(
      store,
      { id: 'u-2', name: 'Lucia' },
      'u-2',
      () => NOW,
      () => `x-${String(n++)}`,
    );
    fs.put(
      `${ROOT}/_app/presenza/u-2.json`,
      JSON.stringify({ userId: 'u-2', at: '2026-11-13T09:59:00.000Z' }),
    );
    const handle = renderFirstRun(root, input());
    await screen('Gruppo pronto');
    await vi.waitFor(() =>
      expect(root.querySelector('.presence')?.textContent).toBe('Lucia sta lavorando'),
    );
    expect(primaries()).toHaveLength(1);
    expect(fs.names(`${ROOT}/_app/presenza`)).toEqual(['u-1.json', 'u-2.json']);
    expect(ticks.map((t) => t.ms)).toEqual([60_000]);
    handle.stop();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('a tick rewrites the presence and updates the notice', async () => {
    await existingGroup();
    let n = 0;
    await createUser(
      store,
      { id: 'u-2', name: 'Lucia' },
      'u-2',
      () => NOW,
      () => `x-${String(n++)}`,
    );
    let now = NOW;
    renderFirstRun(root, input({ clock: () => now }));
    await screen('Gruppo pronto');
    await vi.waitFor(() => expect(fs.names(`${ROOT}/_app/presenza`)).toEqual(['u-1.json']));
    expect(root.querySelector('.presence')?.textContent).toBe('');
    now = '2026-11-13T10:01:00.000Z';
    fs.put(`${ROOT}/_app/presenza/u-2.json`, JSON.stringify({ userId: 'u-2', at: now }));
    ticks[0]?.tick();
    await vi.waitFor(() =>
      expect(root.querySelector('.presence')?.textContent).toBe('Lucia sta lavorando'),
    );
    expect(JSON.parse(await fs.readText(`${ROOT}/_app/presenza/u-1.json`)).at).toBe(now);
  });

  it('shows no notice when nobody else is active', async () => {
    await existingGroup();
    renderFirstRun(root, input());
    await screen('Gruppo pronto');
    await vi.waitFor(() => expect(fs.names(`${ROOT}/_app/presenza`)).toEqual(['u-1.json']));
    expect(root.querySelector('.presence')?.textContent).toBe('');
  });
});
