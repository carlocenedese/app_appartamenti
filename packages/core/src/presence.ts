/**
 * Presence: who else is working in the shared folder. Each user keeps one small file
 * `_app/presenza/<userId>.json` with the time of their last signal. It is not a record (no `id`,
 * `v`, `rev`), leaves no journal operation and is never read by `loadAll`, which only looks in
 * `_app/dati`. No user name is stored. The clock is an argument, never read here.
 */
import { z } from 'zod';
import { TimestampSchema } from './model';
import { MalformedJsonError, assertSafeSegment } from './store/store';
import type { Store } from './store/store';

export const PRESENCE_DIR = '_app/presenza';

const PresenceEntrySchema = z.object({ userId: z.string().min(1), at: TimestampSchema });
export type PresenceEntry = { userId: string; at: string };

/** Records that `userId` is active at `now`. Throws a `RangeError` for an unsafe `userId`, before writing. */
export async function writePresence(store: Store, userId: string, now: string): Promise<void> {
  assertSafeSegment(userId);
  await store.writeJsonAtomic(`${PRESENCE_DIR}/${userId}.json`, { userId, at: now });
}

/** The valid entries; files that are broken, of another shape or not named after their user are ignored. */
export async function readPresence(store: Store): Promise<PresenceEntry[]> {
  const entries: PresenceEntry[] = [];
  for (const name of await store.list(PRESENCE_DIR)) {
    if (!name.endsWith('.json')) continue;
    let raw: unknown;
    try {
      raw = await store.readJson(`${PRESENCE_DIR}/${name}`);
    } catch (error) {
      if (error instanceof MalformedJsonError) continue;
      throw error;
    }
    const parsed = PresenceEntrySchema.safeParse(raw);
    if (parsed.success && `${parsed.data.userId}.json` === name) entries.push(parsed.data);
  }
  return entries;
}

/** Milliseconds since the epoch of a validated timestamp, from integers and UTC only. */
function instant(at: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?Z$/.exec(at);
  if (!m) throw new RangeError(`Not a timestamp: ${JSON.stringify(at)}`);
  const [y, mo, d, h, mi, s] = m.slice(1, 7).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const ms = Number((m[7] ?? '').padEnd(3, '0').slice(0, 3));
  return Date.UTC(y, mo - 1, d, h, mi, s, ms);
}

/**
 * The users other than `me` whose signal is at most `windowMinutes` old. A signal more than
 * `toleranceMinutes` in the future (the other machine's clock is wrong) does not count. Sorted, no repeats.
 */
export function othersActive(
  now: string,
  entries: PresenceEntry[],
  me: string,
  windowMinutes: number,
  toleranceMinutes = 1,
): string[] {
  if (!Number.isFinite(windowMinutes) || windowMinutes <= 0) {
    throw new RangeError(
      `windowMinutes must be a positive finite number, got ${String(windowMinutes)}`,
    );
  }
  const t = instant(now);
  const active = entries
    .filter((e) => e.userId !== me)
    .filter((e) => {
      const age = t - instant(e.at);
      return age <= windowMinutes * 60_000 && age >= -toleranceMinutes * 60_000;
    })
    .map((e) => e.userId);
  return [...new Set(active)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
