/**
 * The real updater (plan 16b): the only file that imports the two plugins. The plugin reads
 * latest.json, downloads, and checks the signature with the public key of tauri.conf.json
 * (requireSignedVersion: the signature binds the version too).
 */
import { relaunch } from '@tauri-apps/plugin-process';
import { check } from '@tauri-apps/plugin-updater';
import type { UpdateBackend } from './updates';

export const tauriUpdateBackend: UpdateBackend = {
  check: async () => {
    const update = await check();
    return update === null
      ? null
      : {
          version: update.version,
          currentVersion: update.currentVersion,
          install: () => update.downloadAndInstall(),
        };
  },
  restart: relaunch,
};
