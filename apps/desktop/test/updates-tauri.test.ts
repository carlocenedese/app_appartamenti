import { describe, expect, it, vi } from 'vitest';

const plugin = vi.hoisted(() => ({
  check: vi.fn(),
  relaunch: vi.fn(),
  downloadAndInstall: vi.fn(),
  close: vi.fn(),
}));
vi.mock('@tauri-apps/plugin-updater', () => ({ check: plugin.check }));
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: plugin.relaunch }));

const { CHECK_TIMEOUT_MS, tauriUpdateBackend } = await import('../src/updates-tauri');

describe('tauriUpdateBackend', () => {
  it('checks with a timeout and passes install and close through', async () => {
    plugin.check.mockResolvedValue({
      version: '0.2.0',
      currentVersion: '0.1.0',
      downloadAndInstall: plugin.downloadAndInstall,
      close: plugin.close,
    });
    const update = await tauriUpdateBackend.check();
    expect(plugin.check).toHaveBeenCalledWith({ timeout: CHECK_TIMEOUT_MS });
    expect(CHECK_TIMEOUT_MS).toBe(30_000);
    await update?.install();
    await update?.close();
    expect(plugin.downloadAndInstall).toHaveBeenCalledTimes(1);
    expect(plugin.close).toHaveBeenCalledTimes(1);
  });

  it('gives null when there is nothing newer', async () => {
    plugin.check.mockResolvedValue(null);
    expect(await tauriUpdateBackend.check()).toBeNull();
  });
});
