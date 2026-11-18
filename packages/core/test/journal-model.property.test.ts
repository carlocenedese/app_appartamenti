// Model test of the fork detection (docs/revisione-2026-11-18-dati.md, «Ridisegno»): one to three
// computers on a folder synchronised file by file (in any order, partly, last writer wins for a
// record file), with skewed clocks, saves, identical replays, undos, undos of undos, deletions,
// failed writes and their retries, repairs and choices of a version (and their undos).
//
// The oracle never asks journal.ts: it follows what each record file holds from the writes the
// stores actually make. Every version written is tagged with the set of operations whose effect it
// carries (the version it was written over, plus the operation writing it; a choice carries every
// version its computer knew). After a full synchronisation, on every computer, each operation the
// user was told succeeded is carried by the record on disk, or the record is reported (`forked` or
// `diverged`); all computers report the same. Where no record is changed by two computers, nothing
// is ever `forked`. After the choices and repairs and one more synchronisation everything is clean
// and no operation file was lost.
//
// Fixed seeds here; JOURNAL_MODEL_SEEDS=<n> runs n seeds (the long run).
import { describe, expect, it } from 'vitest';
import {
  JOURNAL_DIR,
  checkConsistency,
  commitChange,
  forkVersions,
  recordPath,
  repairDiverged,
  resolveFork,
  undoOperation,
} from '../src/index';
import type { Operation } from '../src/index';
import { MemoryStore } from './helpers/memory-store';

/** mulberry32: a small seeded generator, so a failing seed can be replayed. */
function generator(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n: number) => Math.floor(next() * n);
  const pick = <T>(items: readonly T[]): T | undefined => items[int(items.length)];
  return { next, int, pick, chance: (p: number) => next() < p };
}
type Random = ReturnType<typeof generator>;

/** Canonical JSON (sorted keys): the identity of a version, rev included. */
function keyOf(value: unknown): string {
  const canon = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(canon);
    if (typeof v !== 'object' || v === null) return v;
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, canon((v as Record<string, unknown>)[k])]),
    );
  };
  return JSON.stringify(canon(value)) ?? 'undefined';
}

const PATHS = ['b1', 'b2', 'b3'].map((id) => recordPath('bill', id));
const idOf = (path: string) => path.slice(path.lastIndexOf('/') + 1, -'.json'.length);
const bill = (path: string, amount: number) => ({
  id: idOf(path),
  v: 1,
  rev: 1,
  apartmentId: 'apt-1',
  category: 'elettricita',
  supplier: 'F',
  periodStart: '2025-12-01',
  periodEnd: '2026-01-31',
  amount,
  includedInConguaglio: true,
  sharedWithTenants: true,
  fileHash: 'abc',
  filePath: 'b/x.pdf',
});

/**
 * What the oracle knows: each version (by content) was written by some operations over some other
 * versions; it carries those operations and everything those versions carry. Computed when asked,
 * so a version left later by another computer with the same content counts as well.
 */
class Model {
  private readonly made = new Map<string, { ids: Set<string>; over: Set<string> }>();
  add(key: string, over: Iterable<string>, id: string): void {
    const node = this.made.get(key) ?? { ids: new Set(), over: new Set() };
    node.ids.add(id);
    for (const parent of over) node.over.add(parent);
    this.made.set(key, node);
  }
  carried(key: string): Set<string> {
    const ids = new Set<string>();
    const seen = new Set<string>();
    const pending = [key];
    for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
      if (seen.has(next)) continue;
      seen.add(next);
      const node = this.made.get(next);
      for (const id of node?.ids ?? []) ids.add(id);
      pending.push(...(node?.over ?? []));
    }
    return ids;
  }
}

/** One computer: a store whose files are synchronised one by one through `Cloud`. */
class Replica extends MemoryStore {
  readonly dirty = new Set<string>();
  readonly seen = new Map<string, number>();
  failNext = false;
  resolving = false;

  constructor(
    readonly name: string,
    readonly profileId: string,
    readonly skewMs: number,
    private readonly model: Model,
  ) {
    super();
  }

  override async writeJsonAtomic(path: string, value: unknown): Promise<void> {
    if (path.startsWith(`${JOURNAL_DIR}/`)) {
      // Each version the operation will write goes over what is on disk here now: it carries
      // that and the operation (a choice also carries every version this computer knows). A
      // repair later writes such a version as it is: it carries nothing more.
      const operation = value as Operation;
      for (const change of operation.changes) {
        const over = [keyOf(await this.readJson(change.path))];
        if (this.resolving) over.push(...(await this.afters(change.path)));
        this.model.add(keyOf(change.after), over, operation.id);
      }
    } else if (this.failNext) {
      this.failNext = false;
      throw new Error('EIO');
    }
    await super.writeJsonAtomic(path, value);
    this.dirty.add(path);
  }

  /** The versions of `path` the journal files on this computer know. */
  async afters(path: string): Promise<string[]> {
    const keys: string[] = [];
    for (const name of await this.list(JOURNAL_DIR)) {
      const operation = JSON.parse(this.getRaw(`${JOURNAL_DIR}/${name}`) ?? '{}') as Operation;
      for (const change of operation.changes) {
        if (change.path === path) keys.push(keyOf(change.after));
      }
    }
    return keys;
  }
}

/** Dropbox, file by file: the last upload of a file wins. */
class Cloud {
  private readonly files = new Map<string, { text: string; seq: number }>();
  private seq = 0;

  upload(replica: Replica, path: string): void {
    const text = replica.getRaw(path);
    if (text === undefined || !replica.dirty.delete(path)) return;
    this.files.set(path, { text, seq: ++this.seq });
    replica.seen.set(path, this.seq);
  }

  download(replica: Replica, path: string): void {
    const file = this.files.get(path);
    if (file === undefined || (replica.seen.get(path) ?? 0) >= file.seq) return;
    replica.putRaw(path, file.text);
    replica.seen.set(path, file.seq);
    replica.dirty.delete(path); // a change not uploaded yet is lost: the other computer won
  }

  pending(replica: Replica): string[] {
    return [...this.files]
      .filter(([path, { seq }]) => (replica.seen.get(path) ?? 0) < seq)
      .map(([path]) => path);
  }

  syncAll(replicas: readonly Replica[], random: Random): void {
    for (const replica of shuffle(replicas, random)) {
      for (const path of shuffle([...replica.dirty], random)) this.upload(replica, path);
    }
    for (const replica of replicas) {
      for (const path of this.pending(replica)) this.download(replica, path);
    }
  }
}

function shuffle<T>(items: readonly T[], random: Random): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = random.int(i + 1);
    [copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
  }
  return copy;
}

const flagged = async (store: Replica) =>
  new Set(
    (await checkConsistency(store))
      .filter(({ reason }) => reason === 'forked' || reason === 'diverged')
      .map(({ path }) => path),
  );

type Confirmed = { id: string; paths: string[] };

/** The changes to `path` in the journal of `replica` and its record, to read a failing seed. */
async function dump(replica: Replica, path: string): Promise<string> {
  const show = (r: unknown) =>
    r === undefined
      ? '-'
      : `${String((r as { rev: number }).rev)}/${String((r as { amount: number }).amount)}${(r as { deleted?: boolean }).deleted === true ? 'D' : ''}`;
  const lines = [`disk ${show(await replica.readJson(path))}`];
  for (const name of await replica.list(JOURNAL_DIR)) {
    const operation = JSON.parse(replica.getRaw(`${JOURNAL_DIR}/${name}`) ?? '') as Operation;
    for (const change of operation.changes) {
      if (change.path !== path) continue;
      lines.push(
        `${operation.id} ${operation.kind} ${show(change.before)} -> ${show(change.after)}` +
          `${change.supersedes === undefined ? '' : ` supersedes ${change.supersedes.join(',')}`}`,
      );
    }
  }
  return lines.join('\n');
}

/**
 * One history. `owned`: each record is changed by one computer only (no concurrency on a record),
 * and then `forked` must never appear.
 */
async function history(seed: number, owned: boolean): Promise<void> {
  const random = generator(seed);
  const model = new Model();
  const cloud = new Cloud();
  const sameUser = random.chance(0.5);
  const replicas = Array.from(
    { length: owned ? 2 + random.int(2) : 1 + random.int(3) },
    (_, i) =>
      new Replica(
        `r${String(i)}`,
        sameUser ? 'pa' : `p${String(i)}`,
        (random.int(21) - 10) * 60_000,
        model,
      ),
  );
  const ownerOf = (path: string) => replicas[PATHS.indexOf(path) % replicas.length];
  let now = Date.UTC(2026, 10, 10, 20);
  let count = 0;
  const confirmed: Confirmed[] = [];
  const written = new Set<string>();
  const lastInput = new Map<Replica, Parameters<typeof commitChange>[1]>();
  const log: string[] = [];

  const clockOf = (replica: Replica) => () =>
    new Date((now += 1000) + replica.skewMs).toISOString();
  const newId = (replica: Replica) => () => `${replica.name}-${String(++count)}`;
  const journalIds = async (replica: Replica) => new Set(await replica.list(JOURNAL_DIR));
  /** Runs `action` on `replica`; the operations it wrote are confirmed if it succeeds. */
  const run = async (replica: Replica, what: string, action: () => Promise<unknown>) => {
    const before = await journalIds(replica);
    let ok = true;
    try {
      await action();
    } catch {
      ok = false;
    }
    replica.resolving = false;
    replica.failNext = false;
    const added = [...(await journalIds(replica))].filter((name) => !before.has(name));
    for (const name of added) written.add(name);
    log.push(`${replica.name} ${what} ${ok ? 'ok' : 'refused'} ${added.join(',')}`);
    if (!ok) return;
    for (const name of added) {
      const operation = JSON.parse(replica.getRaw(`${JOURNAL_DIR}/${name}`) ?? '') as Operation;
      confirmed.push({ id: operation.id, paths: operation.changes.map(({ path }) => path) });
    }
  };

  const save = async (replica: Replica, fail: boolean) => {
    const mine = owned ? PATHS.filter((path) => ownerOf(path) === replica) : PATHS;
    const paths = shuffle(mine, random).slice(0, 1 + random.int(Math.min(2, mine.length)));
    const changes = [];
    for (const path of paths) {
      const disk = (await replica.readJson(path)) as Record<string, unknown> | undefined;
      const fresh = bill(path, 1 + random.int(5));
      if (disk === undefined) changes.push({ path, after: fresh });
      else if (disk.deleted === true) changes.push({ path, before: disk, after: fresh });
      else if (random.chance(0.15)) changes.push({ path, before: disk, after: undefined });
      else changes.push({ path, before: disk, after: { ...disk, amount: fresh.amount } });
    }
    const input = { profileId: replica.profileId, kind: 'bill.update', summary: 's', changes };
    lastInput.set(replica, input);
    replica.failNext = fail;
    await run(replica, `save${fail ? '-fail' : ''} ${paths.join(',')}`, () =>
      commitChange(replica, input, clockOf(replica), newId(replica)),
    );
    if (fail && random.chance(0.7)) {
      await run(replica, 'retry', () =>
        commitChange(replica, input, clockOf(replica), newId(replica)),
      );
    }
  };

  const steps = 10 + random.int(30);
  for (let step = 0; step < steps; step++) {
    const replica = random.pick(replicas) as Replica;
    const roll = random.next();
    if (roll < 0.25) {
      await save(replica, false);
    } else if (roll < 0.32) {
      await save(replica, true);
    } else if (roll < 0.37) {
      const input = lastInput.get(replica);
      if (input !== undefined) {
        await run(replica, 'replay', () =>
          commitChange(replica, input, clockOf(replica), newId(replica)),
        );
      }
    } else if (roll < 0.42 && !owned) {
      // The same change made on another computer (identical before and after).
      const other = random.pick(replicas) as Replica;
      const input = lastInput.get(other);
      if (input !== undefined) {
        const mine = { ...input, profileId: replica.profileId };
        await run(replica, `replay of ${other.name}`, () =>
          commitChange(replica, mine, clockOf(replica), newId(replica)),
        );
      }
    } else if (roll < 0.52) {
      const names = await replica.list(JOURNAL_DIR);
      const operations = names.map(
        (name) => JSON.parse(replica.getRaw(`${JOURNAL_DIR}/${name}`) ?? '') as Operation,
      );
      const candidates = owned
        ? operations.filter(({ changes }) => changes.every(({ path }) => ownerOf(path) === replica))
        : operations;
      const target = random.chance(0.5) ? candidates.at(-1) : random.pick(candidates);
      if (target !== undefined) {
        const cascade = random.chance(0.5);
        await run(replica, `undo ${target.id}${cascade ? ' cascade' : ''}`, () =>
          undoOperation(replica, target.id, replica.profileId, clockOf(replica), newId(replica), {
            cascade,
          }),
        );
      }
    } else if (roll < 0.57) {
      for (const path of await flagged(replica)) {
        await run(replica, `repair ${path}`, () => repairDiverged(replica, path));
      }
    } else if (roll < 0.62 && !owned) {
      for (const { path, reason } of await checkConsistency(replica)) {
        if (reason !== 'forked') continue;
        const version = random.pick(await forkVersions(replica, path));
        if (version === undefined) continue;
        replica.resolving = true;
        await run(replica, `resolve ${path} ${version.id}`, () =>
          resolveFork(
            replica,
            path,
            version.id,
            replica.profileId,
            clockOf(replica),
            newId(replica),
          ),
        );
      }
    } else if (roll < 0.66) {
      cloud.syncAll(replicas, random);
      log.push('sync all');
    } else {
      // Part of the synchronisation: a few files, one by one, in any order.
      for (let n = 1 + random.int(4); n > 0; n--) {
        const who = random.pick(replicas) as Replica;
        if (random.chance(0.5)) {
          const path = random.pick([...who.dirty]);
          if (path !== undefined) cloud.upload(who, path);
        } else {
          const path = random.pick(cloud.pending(who));
          if (path !== undefined) cloud.download(who, path);
        }
      }
      log.push('sync some');
    }
    if (owned) {
      for (const each of replicas) {
        const forked = (await checkConsistency(each)).filter(({ reason }) => reason === 'forked');
        expect(forked, `seed ${String(seed)} owned, ${each.name}\n${log.join('\n')}`).toEqual([]);
      }
    }
  }

  const where = (what: string) => `seed ${String(seed)} ${what}\n${log.join('\n')}`;
  const oracle = async (allowFlagged: boolean) => {
    const seen: unknown[] = [];
    for (const replica of replicas) {
      const problems = await checkConsistency(replica);
      seen.push(problems);
      const marked = allowFlagged ? await flagged(replica) : new Set<string>();
      for (const { id, paths } of confirmed) {
        for (const path of paths) {
          if (marked.has(path)) continue;
          const disk = await replica.readJson(path);
          const carried = model.carried(keyOf(disk));
          if (!carried.has(id)) {
            expect.fail(
              where(`${replica.name}: ${id} lost on ${path}\n${await dump(replica, path)}`),
            );
          }
        }
      }
    }
    for (const problems of seen) expect(problems, where('computers disagree')).toEqual(seen[0]);
    return seen[0] as Awaited<ReturnType<typeof checkConsistency>>;
  };

  cloud.syncAll(replicas, random);
  await oracle(true);

  // The person chooses and repairs on one computer, then everything is synchronised.
  const first = replicas[0] as Replica;
  for (let round = 0; round < 3; round++) {
    for (const { path, reason } of await checkConsistency(first)) {
      if (reason === 'forked') {
        const version = random.pick(await forkVersions(first, path));
        first.resolving = true;
        await run(first, `final resolve ${path}`, () =>
          resolveFork(first, path, version?.id ?? '', 'pa', clockOf(first), newId(first)),
        );
      } else if (reason === 'diverged') {
        await run(first, `final repair ${path}`, () => repairDiverged(first, path));
      }
    }
  }
  cloud.syncAll(replicas, random);
  expect(await oracle(false), where('not clean after the choices')).toEqual([]);
  for (const replica of replicas) {
    const names = await journalIds(replica);
    for (const name of written) expect(names.has(name), where(`${name} lost`)).toBe(true);
  }
}

const SEEDS = Number(process.env.JOURNAL_MODEL_SEEDS ?? '150');
const FIRST = Number(process.env.JOURNAL_MODEL_FIRST ?? '1');

describe('the journal against a model of the computers (fork detection)', () => {
  it(`keeps every confirmed change or reports it, over ${String(SEEDS)} seeds`, async () => {
    for (let seed = FIRST; seed < FIRST + SEEDS; seed++) await history(seed, false);
  }, 600_000);

  it(`never reports a fork when no record is changed in two places, over ${String(SEEDS)} seeds`, async () => {
    for (let seed = FIRST; seed < FIRST + SEEDS; seed++) await history(seed + 1_000_000, true);
  }, 600_000);
});
