/**
 * First start (design of plan 6): «Crea gruppo», «Unisciti a un gruppo», «Chi sei?», the read-only
 * messages and the presence notice. A thin view over the core: what may be written comes from
 * `assessWorkspace`, who exists from `liveUsers`, who is active from `othersActive`.
 * User names are shown on screen only, never logged.
 */
import {
  CORE_VERSION,
  DATA_FORMAT,
  assessWorkspace,
  createUser,
  FileAccessError,
  UnreadableRecordsError,
  createWorkspace,
  liveUsers,
  othersActive,
  raiseDataFormat,
  readOnlyMessage,
  readPresence,
  repairDiverged,
  writePresence,
} from '@bollette/core';
import type { Store, User, WorkspaceAssessment } from '@bollette/core';
import { loadMachineSettings, saveMachineSettings } from './machine-settings';
import { isTooBroadFolder } from './tauri-store';
import type { SettingsBackend } from './machine-settings';
import { button, el } from './view-util';

export interface FirstRunInput {
  settings: SettingsBackend;
  /** The folder dialog; `null` when the user cancels. */
  pickFolder: () => Promise<string | null>;
  openStore: (folder: string) => Store;
  /** The bundled supplier profiles, written once when a group is created. */
  seeds: () => Promise<unknown[]>;
  clock: () => string;
  newId: () => string;
  /** Calls `tick` every `ms` milliseconds until the returned function is called. */
  schedule: (ms: number, tick: () => void) => () => void;
  /** «Continua» on a writable folder with a known user. */
  onReady: (ready: { folder: string; userId: string; store: Store }) => void;
  presenceEveryMinutes?: number;
  presenceWindowMinutes?: number;
}

const APP = { version: CORE_VERSION, schemaVersion: DATA_FORMAT };
const TOO_BROAD =
  'La cartella scelta è troppo ampia (la cartella principale del disco o la cartella home): ' +
  "l'app avrebbe accesso a tutti i file che contiene. Scegli una cartella dentro, per esempio in Dropbox.";

/** Draws the first-start screens into `root`; `stop` ends the presence signal. */
export function renderFirstRun(root: HTMLElement, input: FirstRunInput): { stop: () => void } {
  const everyMinutes = input.presenceEveryMinutes ?? 1;
  const windowMinutes = input.presenceWindowMinutes ?? 3;
  let stopPresence = (): void => undefined;
  const load = () => loadMachineSettings(input.settings);

  root.classList.add('first-run');

  function show(title: string, ...children: HTMLElement[]): void {
    root.replaceChildren(el('h2', '', title), ...children);
  }
  function errorLine(text = ''): HTMLParagraphElement {
    const p = el('p', 'error', text);
    p.setAttribute('role', 'alert');
    return p;
  }
  function link(label: string, onClick: () => void): HTMLButtonElement {
    const b = button(label, onClick);
    b.className = 'link';
    return b;
  }
  function field(name: string, label: string): [HTMLLabelElement, HTMLInputElement] {
    const box = el('label', 'field');
    const input = el('input');
    input.name = name;
    input.type = 'text';
    input.maxLength = 200;
    box.append(el('span', '', label), input);
    return [box, input];
  }
  function message(title: string, text: string): void {
    show(title, el('p', '', text), button("Scegli un'altra cartella", showJoin, true));
  }
  const open = (folder: string, note = ''): void => {
    openFolder(folder, note).catch((error: unknown) =>
      // These errors carry a relative path and say what to do; any other stays generic.
      error instanceof FileAccessError || error instanceof UnreadableRecordsError
        ? message('Sola lettura', error.message)
        : message('Cartella non raggiungibile', 'Non è stato possibile leggere la cartella.'),
    );
  };

  function showCreate(): void {
    const [groupLabel, group] = field('group', 'Nome del gruppo');
    const [meLabel, me] = field('me', 'Il tuo nome');
    const error = errorLine();
    const create = button('Crea gruppo', () => void run(), true);
    async function run(): Promise<void> {
      error.textContent = '';
      const name = group.value.trim();
      const userName = me.value.trim();
      if (name === '' || userName === '') {
        error.textContent = 'Scrivi il nome del gruppo e il tuo nome.';
        return;
      }
      create.disabled = true;
      try {
        const folder = await input.pickFolder();
        if (folder === null) return;
        if (isTooBroadFolder(folder)) {
          error.textContent = TOO_BROAD;
          return;
        }
        const settings = await load();
        // The ids are fixed once and saved before any write, so a retry on the same folder resumes.
        const pending =
          settings.pendingWorkspace?.folder === folder
            ? settings.pendingWorkspace
            : { folder, workspaceId: input.newId(), userId: input.newId() };
        await saveMachineSettings(input.settings, { ...settings, pendingWorkspace: pending });
        await createWorkspace(
          input.openStore(folder),
          { workspaceId: pending.workspaceId, name, user: { id: pending.userId, name: userName } },
          await input.seeds(),
          input.clock,
          input.newId,
        );
        // Read again: the updates switch may have been saved while the group was being created.
        const done = { ...(await load()), folder, userId: pending.userId };
        delete done.pendingWorkspace;
        await saveMachineSettings(input.settings, done);
        open(folder);
      } catch (e) {
        if (e instanceof RangeError) {
          // Ruling: a refusal is not an interrupted creation, so its ids are dropped (the same
          // folder would only be refused again; a later empty folder gets fresh ones).
          const current = await load();
          delete current.pendingWorkspace;
          await saveMachineSettings(input.settings, current).catch(() => undefined);
          error.textContent =
            'Questa cartella contiene già dei dati di un gruppo. Per entrarci usa «Unisciti a un ' +
            'gruppo»; per crearne uno nuovo scegli una cartella vuota.';
          return;
        }
        error.textContent =
          'Non è stato possibile creare il gruppo. Se la cartella contiene già un gruppo, usa ' +
          '«Unisciti a un gruppo»; altrimenti riprova con la stessa cartella: il lavoro fatto non si perde.';
      } finally {
        create.disabled = false;
      }
    }
    show(
      'Crea gruppo',
      el('p', '', 'Scegli una cartella vuota nella cartella condivisa (per esempio in Dropbox).'),
      groupLabel,
      meLabel,
      error,
      create,
      link('Unisciti a un gruppo', showJoin),
    );
  }

  function showJoin(): void {
    const error = errorLine();
    const choose = button(
      'Scegli la cartella del gruppo',
      () => {
        input.pickFolder().then(
          (folder) => {
            if (folder !== null) open(folder);
          },
          () => {
            error.textContent = 'Non è stato possibile aprire la scelta della cartella.';
          },
        );
      },
      true,
    );
    show(
      'Unisciti a un gruppo',
      el('p', '', 'Scegli la cartella condivisa che contiene già il gruppo.'),
      error,
      choose,
      link('Crea gruppo', showCreate),
    );
  }

  async function openFolder(folder: string, note: string): Promise<void> {
    stopPresence();
    if (isTooBroadFolder(folder)) {
      message('Cartella troppo ampia', TOO_BROAD);
      return;
    }
    const store = input.openStore(folder);
    const assessment = await assessWorkspace(store, APP);
    if (assessment.compat === 'invalid') {
      message('Cartella non valida', 'Questa cartella non contiene un gruppo valido.');
      return;
    }
    const settings = await load();
    if (settings.folder !== folder)
      await saveMachineSettings(input.settings, { ...settings, folder });
    if (!assessment.writable) {
      showReadOnly(folder, store, assessment, note);
      return;
    }
    const users = await liveUsers(store);
    const me = users.find((u) => u.id === settings.userId);
    if (me === undefined) showWho(folder, store, users);
    else showReady(folder, store, me.id, users);
  }

  function showReadOnly(
    folder: string,
    store: Store,
    assessment: WorkspaceAssessment,
    note: string,
  ): void {
    // Every reason with what to do and its files (paths relative to the folder: on screen only).
    const reasons = assessment.reasons.map(({ code, paths }) => {
      const box = el('div', 'reason');
      box.append(el('p', '', readOnlyMessage(code)));
      if (!paths.every((path) => path === '_app/workspace.json')) {
        const list = el('ul');
        for (const path of paths) list.append(el('li', '', path));
        box.append(list);
      }
      return box;
    });
    const has = (code: string) => assessment.reasons.some((reason) => reason.code === code);
    const actions: HTMLElement[] = [];
    if (has('older-format') && assessment.reasons.length === 1) {
      const raise = button(
        'Aggiorna i dati della cartella',
        () => {
          raise.disabled = true;
          raiseDataFormat(store).then(
            () => open(folder),
            () => open(folder, 'Non è stato possibile aggiornare i dati della cartella.'),
          );
        },
        true,
      );
      actions.push(raise);
    }
    if (has('diverged')) {
      // Only a diverged record is repaired, and only when the user asks; the rest is reported.
      const repair = button(
        'Ripara',
        () => {
          repair.disabled = true;
          void (async () => {
            let failed = '';
            for (const p of assessment.problems.filter((x) => x.reason === 'diverged')) {
              try {
                await repairDiverged(store, p.path);
              } catch {
                failed =
                  'Alcuni dati non si possono riparare: sono più nuovi di quanto dice il registro.';
              }
            }
            open(folder, failed);
          })();
        },
        true,
      );
      actions.push(repair);
    }
    show(
      'Sola lettura',
      ...reasons,
      errorLine(note),
      ...actions,
      link('Ricontrolla', () => open(folder)),
      link("Scegli un'altra cartella", showJoin),
    );
  }

  function showWho(folder: string, store: Store, users: User[]): void {
    const select = el('select');
    select.setAttribute('aria-label', 'Utente');
    for (const u of users) {
      const o = el('option', '', u.name);
      o.value = u.id;
      select.append(o);
    }
    const fresh = el('option', '', 'Nuovo utente');
    fresh.value = '';
    select.append(fresh);
    const [meLabel, me] = field('me', 'Il tuo nome');
    const sync = () => {
      meLabel.hidden = select.value !== '';
    };
    select.addEventListener('change', sync);
    sync();
    const error = errorLine();
    const go = button(
      'Continua',
      () => {
        go.disabled = true;
        void (async () => {
          error.textContent = '';
          let userId = select.value;
          try {
            if (userId === '') {
              if (me.value.trim() === '') {
                error.textContent = 'Scrivi il tuo nome.';
                return;
              }
              userId = input.newId();
              await createUser(
                store,
                { id: userId, name: me.value.trim() },
                userId,
                input.clock,
                input.newId,
              );
            }
            await saveMachineSettings(input.settings, { ...(await load()), userId });
            open(folder);
          } catch {
            error.textContent = 'Non è stato possibile salvare.';
          } finally {
            go.disabled = false;
          }
        })();
      },
      true,
    );
    show(
      'Chi sei?',
      el('p', '', 'Scegli il tuo nome tra gli utenti del gruppo, o aggiungilo.'),
      select,
      meLabel,
      error,
      go,
    );
  }

  function showReady(folder: string, store: Store, userId: string, users: User[]): void {
    const notice = el('p', 'presence');
    notice.setAttribute('role', 'status');
    show(
      'Gruppo pronto',
      el('p', '', 'La cartella del gruppo è aperta.'),
      notice,
      button('Continua', () => input.onReady({ folder, userId, store }), true),
    );
    const names = new Map(users.map((u) => [u.id, u.name]));
    const beat = async (): Promise<void> => {
      try {
        await writePresence(store, userId, input.clock());
        const others = othersActive(
          input.clock(),
          await readPresence(store),
          userId,
          windowMinutes,
        );
        const who = others.map((id) => names.get(id) ?? 'Un altro utente').join(', ');
        notice.textContent =
          others.length === 0 ? '' : `${who} ${others.length === 1 ? 'sta' : 'stanno'} lavorando`;
      } catch {
        // Presence is only a hint: a failed signal is tried again at the next tick.
      }
    };
    void beat();
    const cancel = input.schedule(everyMinutes * 60_000, () => void beat());
    stopPresence = () => {
      cancel();
      stopPresence = () => undefined;
    };
  }

  void load().then((s) => (s.folder === undefined ? showCreate() : open(s.folder)));
  return { stop: () => stopPresence() };
}
