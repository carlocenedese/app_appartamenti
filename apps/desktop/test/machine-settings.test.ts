import { describe, expect, it } from 'vitest';
import { loadMachineSettings, saveMachineSettings } from '../src/machine-settings';
import type { SettingsBackend } from '../src/machine-settings';

/** One text file in memory; reading a missing file fails like the file plugin does. */
function memoryBackend(text?: string): SettingsBackend & { text?: string } {
  const b: SettingsBackend & { text?: string } = {
    readText: () =>
      b.text === undefined ? Promise.reject(new Error('not found')) : Promise.resolve(b.text),
    writeText: (t) => {
      b.text = t;
      return Promise.resolve();
    },
  };
  if (text !== undefined) b.text = text;
  return b;
}

describe('machine settings', () => {
  it('reads back what it saved', async () => {
    const backend = memoryBackend();
    const settings = {
      folder: '/Dropbox/Gruppo',
      userId: 'u-1',
      language: 'it',
      pendingWorkspace: { folder: '/Dropbox/Altro', workspaceId: 'ws-1', userId: 'u-2' },
    };
    await saveMachineSettings(backend, settings);
    expect(await loadMachineSettings(backend)).toEqual(settings);
  });

  it('gives {} for a missing file, text that is not JSON, or JSON of another shape', async () => {
    expect(await loadMachineSettings(memoryBackend())).toEqual({});
    expect(await loadMachineSettings(memoryBackend('{"folder": '))).toEqual({});
    expect(await loadMachineSettings(memoryBackend('{"folder": 7}'))).toEqual({});
    expect(await loadMachineSettings(memoryBackend('[]'))).toEqual({});
  });

  it('refuses to save settings of the wrong shape', async () => {
    const backend = memoryBackend();
    await expect(
      saveMachineSettings(backend, { pendingWorkspace: { workspaceId: '' } } as never),
    ).rejects.toThrow();
    expect(backend.text).toBeUndefined();
  });
});
