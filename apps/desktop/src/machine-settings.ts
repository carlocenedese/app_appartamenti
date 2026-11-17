/**
 * Settings of this machine only: which folder, «who am I», the language, the update switch and an
 * unfinished group creation. They live in the app's config folder, never in the shared folder (design of plan 6,
 * choices 3 and 4).
 */
import { appConfigDir, join } from '@tauri-apps/api/path';
import { mkdir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { z } from 'zod';

const MachineSettingsSchema = z.object({
  folder: z.string().min(1).optional(),
  userId: z.string().min(1).optional(),
  language: z.string().min(1).optional(),
  /** The update check, the app's only network call; missing means on (open question R285). */
  checkUpdates: z.boolean().optional(),
  /** Ids fixed by «Crea gruppo» before writing, reused by a retry on the same folder. */
  pendingWorkspace: z
    .object({
      folder: z.string().min(1),
      workspaceId: z.string().min(1),
      userId: z.string().min(1),
    })
    .optional(),
});

export type MachineSettings = z.infer<typeof MachineSettingsSchema>;

/** The one settings file, read and written whole. */
export interface SettingsBackend {
  readText(): Promise<string>;
  writeText(text: string): Promise<void>;
}

const FILE = 'machine-settings.json';

/**
 * The real backend: `$APPCONFIG/machine-settings.json` through the file plugin (the capability
 * allows that file and its folder only).
 *
 * shortcut: written in place, not atomically; a crash mid-write gives an invalid file, read as {}
 * (the folder is asked again). Write a temp file and rename if that turns out to matter.
 */
export const tauriSettingsBackend: SettingsBackend = {
  readText: async () => readTextFile(await join(await appConfigDir(), FILE)),
  writeText: async (text) => {
    const dir = await appConfigDir();
    await mkdir(dir, { recursive: true });
    await writeTextFile(await join(dir, FILE), text);
  },
};

/** The saved settings; `{}` when the file is missing, unreadable, not JSON or of another shape. */
export async function loadMachineSettings(backend: SettingsBackend): Promise<MachineSettings> {
  try {
    const parsed = MachineSettingsSchema.safeParse(JSON.parse(await backend.readText()));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

/** Replaces the saved settings; settings of the wrong shape throw before anything is written. */
export async function saveMachineSettings(
  backend: SettingsBackend,
  settings: MachineSettings,
): Promise<void> {
  const valid = MachineSettingsSchema.parse(settings);
  await backend.writeText(`${JSON.stringify(valid, null, 2)}\n`);
}
