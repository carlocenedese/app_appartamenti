// Model test of the closing of a settlement period (plan 20, fifth round): settled marks,
// supplementary marks, reopenings, closings again, late bills and flat-charge payments in random
// order, against a ledger kept beside the app.
//
// One apartment with two beds and one period (October 2025 – September 2026): t-a stays all year,
// t-b leaves at the end of August with a deposit of 500,00. Every month each tenant pays the rent
// (450,00) and the flat charge (30,00) as two payments, so a flat charge can be cut without the
// rent. A base bill makes both tenants owe something. The period starts closed.
//
// The ledger (the owner's view, rules of 18 Nov 2026): for a tenant, T = what the settlement says
// he owes now (`calcConguaglio` due: costs less the flat charge collected, capped at each month's
// due by the app's imputation, which is not under test). A closing fixes S = T at that moment. A
// main mark declares settled what the snapshot asked (S) on top of what main marks and earlier
// supplementaries already declared; a supplementary mark declares T − S at that moment; a new
// closing folds the supplementary declared so far into the main. remaining = T − declared. A flat
// charge collected after the last mark that would turn that into a credit is «da verificare»
// (`toCheck`), never a credit (answer F); a credit from costs (a credit note) is a credit. A mark
// while there is extra flat charge is allowed and leaves it to check (final review).
// 7. a mark never changes toCheck; 8. toCheck never decreases unless a flat-charge payment was
//    cancelled, or the mark that made it extra undone, since the last state checked.
//
// Invariants after every action (numbers as in the task of the fifth round):
// 1. reopen then close with no data change between: t-b's withheld amount and toCheck unchanged;
// 2. `loadPeriodClosing` agrees with the deposit statement of t-b (toCheck; «da verificare»
//    action exactly when toCheck), and the statement's lines add up to its total;
// 3. no flat-charge line of the statement is a credit;
// 4. the same data actions with a payment and an adjacent mark swapped give the same final result
//    (checked on the sequences that have such a pair);
// 5. what the statement withholds for the period equals the ledger's remaining, its toCheck the
//    ledger's toCheck;
// 6. no line of the period appears twice (main and supplementary counted once each).
//
// Fixed seeds here; CLOSING_MODEL_SEEDS=<n> runs n seeds, CLOSING_MODEL_FIRST=<seed> the first one.
// A failing seed is shrunk (actions removed one at a time while it still fails on the same
// invariant) and the shortest sequence is printed with the wrong and expected numbers.
import { describe, expect, it } from 'vitest';
import {
  closePeriod,
  commitChange,
  loadDepositReturn,
  loadExcelInput,
  loadPeriodClosing,
  markTenantSettled,
  readJournal,
  recordPath,
  reopenPeriod,
  saveLegalRate,
  undoOperation,
  calcConguaglio,
} from '../src/index';
import type { RecordKind } from '../src/index';
import { isoDate } from '../src/period';
import { apartment, bill, match } from './helpers/conguaglio-builders';
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
  const pick = <T>(items: readonly T[]): T => items[int(items.length)] as T;
  return { int, pick };
}

const QUERY = { apartmentId: 'apt', periodLabel: '2025-26' };
const TENANTS = ['t-a', 't-b'] as const;
type Tenant = (typeof TENANTS)[number];
const MONTHS = Array.from({ length: 12 }, (_, i) => {
  const n = 2025 * 12 + 9 + i;
  return `${String(Math.floor(n / 12))}-${String((n % 12) + 1).padStart(2, '0')}`;
});
const presentMonths = (t: Tenant) => (t === 't-a' ? MONTHS : MONTHS.slice(0, 11));

type Action =
  | { kind: 'bill'; amount: number; month: string }
  | { kind: 'pay'; tenant: Tenant; month: string; amount: number }
  | { kind: 'cancel'; tenant: Tenant; month: string }
  | { kind: 'main'; tenant: Tenant }
  | { kind: 'sup'; tenant: Tenant }
  | { kind: 'undo-mark' }
  | { kind: 'reopen' }
  | { kind: 'close' };

const DATA = new Set(['bill', 'pay', 'cancel']);

/**
 * A random sequence of up to 12 actions, built from short episodes so that the states worth
 * checking (a reopening with a cut flat charge and a new closing, marks around payments, a
 * reopening closed again with no change) come up often; an action the app refuses in the state
 * it meets is skipped (its refusal must be one of the expected ones).
 */
function actions(seed: number): Action[] {
  const r = generator(seed);
  // Mostly t-b (the one whose deposit is checked) and two months, so that a payment meets the flat
  // charge a cancellation left missing.
  const tenant = (): Tenant => (r.int(4) === 0 ? 't-a' : 't-b');
  const month = () => r.pick(['2026-05', '2026-06']);
  const data = (): Action => {
    const roll = r.int(3);
    if (roll === 0)
      return { kind: 'bill', amount: r.pick([-500, 500, 1200, 3000]), month: month() };
    if (roll === 1) {
      return { kind: 'pay', tenant: tenant(), month: month(), amount: r.pick([1500, 3000, 4000]) };
    }
    return { kind: 'cancel', tenant: tenant(), month: month() };
  };
  const out: Action[] = [];
  while (out.length < 12) {
    const roll = r.int(10);
    if (roll === 9) {
      // A mark, then the flat charge it settled paid again (extra), then more marks (final review).
      const m = month();
      out.push(
        { kind: 'main', tenant: 't-b' },
        { kind: 'pay', tenant: 't-b', month: m, amount: r.pick([1500, 3000]) },
        { kind: r.pick(['main', 'sup'] as const), tenant: 't-b' },
      );
    } else if (roll === 0) {
      out.push({ kind: 'reopen' }, ...Array.from({ length: 1 + r.int(3) }, data), {
        kind: 'close',
      });
    } else if (roll === 1) out.push({ kind: 'reopen' }, { kind: 'close' });
    else if (roll === 2) out.push(data());
    else if (roll === 3)
      out.push({
        kind: 'pay',
        tenant: tenant(),
        month: month(),
        amount: r.pick([1500, 3000, 4000]),
      });
    else if (roll === 4)
      out.push({ kind: 'bill', amount: r.pick([-500, 500, 1200, 3000]), month: month() });
    else if (roll === 5 || roll === 6)
      out.push({ kind: r.pick(['main', 'sup'] as const), tenant: tenant() });
    else if (roll === 7) out.push({ kind: 'undo-mark' });
    else break;
  }
  return out.slice(0, 12);
}

const show = (a: Action): string =>
  a.kind === 'bill'
    ? `bill ${String(a.amount / 100)} ${a.month}`
    : a.kind === 'pay'
      ? `pay ${a.tenant} ${String(a.amount / 100)} ${a.month}`
      : a.kind === 'cancel'
        ? `cancel-flat ${a.tenant} ${a.month}`
        : a.kind === 'main' || a.kind === 'sup'
          ? `${a.kind}-settled ${a.tenant}`
          : a.kind;

/** The owner's ledger of one tenant. */
type Ledger = {
  /** S: T when the current snapshot was taken. */
  snapshot: number;
  /** The flat charge collected then, and what was missing of it (M). */
  flatAtClose: number;
  missingAtClose: number;
  /** Levels the owner declared settled: main (cumulative) and the current supplementary. */
  mainDeclared: number;
  supDeclared: number;
  /** P frozen by a main mark on the current closing (what of M was paid then). */
  paidAtMain?: number;
  /** The flat charge collected at the last main mark: what comes after it is extra. */
  flatAtMain?: number;
};
const FLAT_DUE: Record<Tenant, number> = { 't-a': 12 * 3000, 't-b': 11 * 3000 };

type Failure = { invariant: number; detail: string };

class Run {
  store = new MemoryStore();
  private tick = 0;
  private n = 0;
  closed = true;
  ledgers = new Map<Tenant, Ledger>();
  /** Undo stack of marks: the operation and the ledgers before it. */
  marks: { opId: string; before: Map<Tenant, Ledger> }[] = [];
  late = 0;
  pays = 0;

  clock = () => {
    this.tick += 1;
    const m = this.tick;
    return `2026-11-${String(15 + Math.floor(m / 1440)).padStart(2, '0')}T${String(Math.floor((m % 1440) / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00.000Z`;
  };
  newId = () => `op-${String(++this.n)}`;

  async put(kind: RecordKind, record: { id: string } & Record<string, unknown>, before?: unknown) {
    await commitChange(
      this.store,
      {
        profileId: 'p1',
        kind: 'test.seed',
        summary: 'x',
        changes: [{ path: recordPath(kind, record.id), before, after: record }],
      },
      this.clock,
      this.newId,
    );
  }

  async setUp() {
    await this.put('apartment', apartment({ posti: 2 }));
    await this.put('contract', {
      id: 'ctr',
      v: 1,
      rev: 1,
      apartmentId: 'apt',
      type: '1+1',
      start: '2025-10',
      end: '2026-09',
      settlement: 'annuale',
    });
    for (const t of TENANTS) {
      await this.put('tenant', { id: t, v: 1, rev: 1, name: `Nome ${t}` });
      await this.put('tenancy', {
        id: `tcy-${t}`,
        v: 1,
        rev: 1,
        apartmentId: 'apt',
        tenantId: t,
        room: t === 't-a' ? 'A' : 'B',
        from: '2025-10',
        ...(t === 't-b' ? { to: '2026-08' } : {}),
        monthlyRent: 45000,
        monthlyForfait: 3000,
      });
      for (const m of presentMonths(t)) {
        for (const [part, amount] of [
          ['rent', 45000],
          ['flat', 3000],
        ] as const) {
          await this.put('payment', {
            id: `pay-${t}-${m}-${part}`,
            v: 1,
            rev: 1,
            apartmentId: 'apt',
            tenantId: t,
            date: `${m}-05`,
            amount,
            confirmed: true,
            kind: 'canone',
            forMonth: m,
            source: 'manual',
          });
        }
      }
    }
    await this.put('payment', {
      id: 'dep-b',
      v: 1,
      rev: 1,
      apartmentId: 'apt',
      tenantId: 't-b',
      date: '2025-09-25',
      amount: 50000,
      confirmed: true,
      kind: 'caparra',
      source: 'manual',
    });
    const base = bill('b-base', '2025-10-01', '2026-08-31', 160000);
    await this.put('bill', base);
    await this.put('match', match(base, 160000));
    for (const y of ['2025', '2026']) {
      await saveLegalRate(this.store, { year: y, rateBp: 200 }, 'p1', this.clock, this.newId);
    }
    const closed = await closePeriod(this.store, QUERY, 'p1', this.clock, this.newId);
    if (closed.status !== 'closed') throw new Error(`setup: ${JSON.stringify(closed)}`);
    for (const t of TENANTS) {
      const now = await this.ledgerNow(t);
      this.ledgers.set(t, {
        snapshot: now.due,
        flatAtClose: now.flat,
        missingAtClose: FLAT_DUE[t] - now.flat,
        mainDeclared: 0,
        supDeclared: 0,
      });
    }
  }

  /** T and the flat charge collected, from the settlement of today (the ledger's input). */
  async ledgerNow(t: Tenant): Promise<{ due: number; flat: number }> {
    const loaded = await loadExcelInput(this.store, QUERY);
    if (loaded.status !== 'ok') throw new Error(loaded.reason);
    const row = calcConguaglio(loaded.input).tenants.find((x) => x.tenantId === t);
    return { due: row?.due ?? 0, flat: row?.forfaitIncassato ?? 0 };
  }

  /** The ledger's answer for a tenant: remaining and toCheck. */
  async expected(t: Tenant): Promise<{ remaining: number; toCheck: number }> {
    const l = this.ledgers.get(t) as Ledger;
    const now = await this.ledgerNow(t);
    const extra = this.extra(l, now.flat);
    return { remaining: now.due + extra - l.mainDeclared - l.supDeclared, toCheck: extra };
  }

  /** Flat charge collected after the last main mark: already settled, so extra (answer F). */
  extra(l: Ledger, flat: number): number {
    return l.flatAtMain === undefined ? 0 : Math.max(0, flat - l.flatAtMain);
  }

  /** P: of the flat charge missing at the closing, what is paid since (frozen by a main mark). */
  paid(l: Ledger, flat: number): number {
    return l.paidAtMain ?? Math.min(Math.max(0, flat - l.flatAtClose), l.missingAtClose);
  }

  /** What the app says for t-b: withheld for the period and toCheck, or undefined (reopened). */
  async app(): Promise<
    | {
        withheld: number;
        toCheck: number;
        lines: { label: string; amount: number }[];
        total: number;
        sum: number;
        closing:
          { action: string; toCheck: number; remaining: number; mainRemaining: number } | undefined;
        /** t-a's closing row (no deposit: compared with the ledger directly). */
        other: { remaining: number; toCheck: number } | undefined;
      }
    | undefined
  > {
    const r = await loadDepositReturn(this.store, {
      apartmentId: 'apt',
      tenantId: 't-b',
      extraCharges: [],
    });
    if (r.status === 'refused') {
      if (r.reason === 'period-reopened') return undefined;
      throw new Error(`deposit refused: ${r.reason}`);
    }
    const lines = r.statement.lines.filter(
      (l) => l.label !== 'Caparra' && l.label !== 'Interessi legali',
    );
    const closing = await loadPeriodClosing(this.store, QUERY, isoDate('2026-12-31'));
    const rowOf = (id: Tenant) =>
      closing.status === 'closed' ? closing.tenants.find((x) => x.tenantId === id) : undefined;
    const row = rowOf('t-b');
    const other = rowOf('t-a');
    return {
      withheld: -lines.reduce((s, l) => s + l.amount, 0),
      toCheck: r.toCheck.reduce((s, l) => s + l.amount, 0),
      lines,
      total: r.statement.total,
      sum: r.statement.lines.reduce((s, l) => s + l.amount, 0),
      closing:
        row === undefined
          ? undefined
          : {
              action: row.action,
              toCheck: row.toCheck,
              remaining: row.remaining,
              mainRemaining: row.mainRemaining,
            },
      other:
        other === undefined ? undefined : { remaining: other.remaining, toCheck: other.toCheck },
    };
  }

  private cloneLedgers() {
    return new Map([...this.ledgers].map(([k, v]) => [k, { ...v }]));
  }

  /** Applies one action; returns false when it was skipped or correctly refused. */
  async apply(a: Action): Promise<boolean> {
    const refused = (reason: string, allowed: string[]) => {
      if (!allowed.includes(reason)) throw new Error(`unexpected refusal ${reason} of ${show(a)}`);
      return false;
    };
    switch (a.kind) {
      case 'bill': {
        this.late += 1;
        const b = bill(`b-late-${String(this.late)}`, `${a.month}-01`, `${a.month}-28`, a.amount);
        await this.put('bill', b);
        await this.put(
          'match',
          match(b, a.amount, { transactionId: `tx-late-${String(this.late)}` }),
        );
        return true;
      }
      case 'pay': {
        this.pays += 1;
        await this.put('payment', {
          id: `pay-late-${String(this.pays)}`,
          v: 1,
          rev: 1,
          apartmentId: 'apt',
          tenantId: a.tenant,
          date: '2026-12-01',
          amount: a.amount,
          confirmed: true,
          kind: 'canone',
          forMonth: a.month,
          source: 'manual',
        });
        return true;
      }
      case 'cancel': {
        // F5: only while reopened.
        if (this.closed) return false;
        const path = recordPath('payment', `pay-${a.tenant}-${a.month}-flat`);
        const before = (await this.store.readJson(path)) as Record<string, unknown> | undefined;
        if (before === undefined || before.deleted === true) return false;
        await commitChange(
          this.store,
          {
            profileId: 'p1',
            kind: 'test.seed',
            summary: 'x',
            changes: [{ path, before, after: undefined }],
          },
          this.clock,
          this.newId,
        );
        return true;
      }
      case 'main':
      case 'sup': {
        // A mark while some flat charge is to check is allowed and leaves it to check (final
        // review): counted, to show the generator reaches it.
        const own = this.ledgers.get(a.tenant) as Ledger;
        if (this.extra(own, (await this.ledgerNow(a.tenant)).flat) > 0) stats.withExtra += 1;
        const before = this.cloneLedgers();
        const result = await markTenantSettled(
          this.store,
          {
            ...QUERY,
            tenantId: a.tenant,
            on: '2026-12-02',
            ...(a.kind === 'sup' ? { supplementary: true } : {}),
          },
          'p1',
          this.clock,
          this.newId,
        );
        if (result.status === 'refused') {
          return refused(result.reason, ['not-closed', 'no-supplementary', 'use-supplementary']);
        }
        if (result.status === 'unchanged') return false;
        const l = this.ledgers.get(a.tenant) as Ledger;
        const now = await this.ledgerNow(a.tenant);
        const paid = this.paid(l, now.flat);
        const extra = this.extra(l, now.flat);
        // The extra the snapshot already counts as collected (paid after an earlier main mark).
        const inSnapshot =
          l.flatAtMain === undefined ? 0 : Math.max(0, l.flatAtClose - l.flatAtMain);
        const mainLevel =
          l.paidAtMain !== undefined ? l.mainDeclared : l.snapshot + inSnapshot - paid;
        // What was then due: the main is the snapshot less the missing flat charge paid since;
        // the supplementary is everything beyond it. A main mark again on the same closing
        // declares nothing new; the extra stays to check after any mark.
        if (a.kind === 'main') {
          if (l.paidAtMain === undefined) {
            l.mainDeclared = mainLevel;
            l.paidAtMain = paid;
            l.flatAtMain = now.flat - extra;
          }
        } else {
          l.supDeclared = now.due + extra - mainLevel;
        }
        this.marks.push({ opId: result.operationId, before });
        return true;
      }
      case 'undo-mark': {
        const last = this.marks.at(-1);
        if (last === undefined) return false;
        // Only the latest change of the closing record: nothing depends on it.
        const ops = (await readJournal(this.store)).operations.filter((o) =>
          o.changes.some((c) => c.path.startsWith('_app/dati/periodClose/')),
        );
        if (ops.at(-1)?.id !== last.opId) return false;
        await undoOperation(this.store, last.opId, 'p1', this.clock, this.newId);
        this.ledgers = last.before;
        this.marks.pop();
        return true;
      }
      case 'reopen': {
        const result = await reopenPeriod(
          this.store,
          { ...QUERY, on: '2026-12-03', reason: 'Prova del modello' },
          'p1',
          this.clock,
          this.newId,
        );
        if (result.status === 'refused') return refused(result.reason, ['not-closed']);
        this.closed = false;
        this.marks = [];
        return true;
      }
      case 'close': {
        const result = await closePeriod(this.store, QUERY, 'p1', this.clock, this.newId);
        if (result.status === 'refused') {
          return refused(result.reason, ['already-closed', 'cannot-close']);
        }
        this.closed = true;
        this.marks = [];
        for (const t of TENANTS) {
          const l = this.ledgers.get(t) as Ledger;
          const now = await this.ledgerNow(t);
          l.snapshot = now.due;
          l.flatAtClose = now.flat;
          l.missingAtClose = FLAT_DUE[t] - now.flat;
          l.mainDeclared += l.supDeclared;
          l.supDeclared = 0;
          delete l.paidAtMain;
        }
        return true;
      }
    }
  }
}

/** What the runs exercised, printed at the end (a model test that checks nothing is no test). */
const stats = { applied: {} as Record<string, number>, checked: 0, withExtra: 0 };

/** Runs a sequence; returns the first failure, with its invariant. */
async function check(sequence: readonly Action[]): Promise<Failure | undefined> {
  const run = new Run();
  await run.setUp();
  let beforeReopen: { withheld: number; toCheck: number } | undefined;
  /** toCheck at the last state checked, and whether a flat charge was cancelled since. */
  let lastToCheck: number | undefined;
  let cancelledSince = false;
  let dataSinceReopen = false;
  const done: string[] = [];
  for (const a of sequence) {
    let applied: boolean;
    try {
      applied = await run.apply(a);
    } catch (error) {
      return { invariant: 0, detail: `${show(a)}: ${(error as Error).message}` };
    }
    done.push(show(a));
    if (!applied) continue;
    stats.applied[a.kind] = (stats.applied[a.kind] ?? 0) + 1;
    if (DATA.has(a.kind)) dataSinceReopen = true;
    // Undoing a mark takes back the mark that made the payment extra: it may lower toCheck too.
    if (a.kind === 'cancel' || a.kind === 'undo-mark') cancelledSince = true;
    const app = await run.app();
    if (a.kind === 'reopen') {
      dataSinceReopen = false;
      continue;
    }
    if (app === undefined) continue;
    const want = await run.expected('t-b');
    // 1
    if (a.kind === 'close' && beforeReopen !== undefined && !dataSinceReopen) {
      if (app.withheld !== beforeReopen.withheld || app.toCheck !== beforeReopen.toCheck) {
        return {
          invariant: 1,
          detail: `withheld/toCheck ${String(beforeReopen.withheld)}/${String(beforeReopen.toCheck)} → ${String(app.withheld)}/${String(app.toCheck)}`,
        };
      }
    }
    // 2
    if (app.sum !== app.total) return { invariant: 2, detail: 'lines do not add up' };
    if (app.closing !== undefined) {
      if (app.closing.toCheck !== app.toCheck) {
        return {
          invariant: 2,
          detail: `closing toCheck ${String(app.closing.toCheck)}, deposit ${String(app.toCheck)}`,
        };
      }
      if (app.closing.remaining !== app.withheld) {
        return {
          invariant: 2,
          detail: `closing remaining ${String(app.closing.remaining)}, deposit ${String(app.withheld)}`,
        };
      }
      // C2: the action follows the sign of what is withheld beyond the main; «da verificare» only
      // when nothing is and some flat charge is to check.
      const left = app.withheld - app.closing.mainRemaining;
      const want =
        left === 0
          ? [app.toCheck > 0 ? 'da-verificare' : 'nessuna']
          : left < 0
            ? ['da-rimborsare']
            : ['da-pagare', 'da-trattenere-o-richiedere'];
      if (!want.includes(app.closing.action)) {
        return {
          invariant: 2,
          detail: `action ${app.closing.action} with ${String(left)} left of the supplementary and toCheck ${String(app.toCheck)}`,
        };
      }
    }
    // 5, t-a's side: its closing row against the ledger.
    if (app.other !== undefined) {
      const mine = await run.expected('t-a');
      if (app.other.remaining !== mine.remaining || app.other.toCheck !== mine.toCheck) {
        return {
          invariant: 5,
          detail: `t-a closing ${String(app.other.remaining)} / ${String(app.other.toCheck)}; ledger ${String(mine.remaining)} / ${String(mine.toCheck)}`,
        };
      }
    }
    // 3
    const credit = app.lines.find((l) => l.label.startsWith('Forfait') && l.amount > 0);
    if (credit !== undefined) {
      return { invariant: 3, detail: `${credit.label} ${String(credit.amount)}` };
    }
    // 6
    const labels = app.lines.map((l) => l.label);
    if (new Set(labels).size !== labels.length) return { invariant: 6, detail: labels.join(' | ') };
    // 5
    if (app.withheld !== want.remaining || app.toCheck !== want.toCheck) {
      return {
        invariant: 5,
        detail: `withheld ${String(app.withheld)} toCheck ${String(app.toCheck)}; ledger ${String(want.remaining)} / ${String(want.toCheck)}; lines ${JSON.stringify(app.lines)}`,
      };
    }
    // 7, 8
    if (lastToCheck !== undefined) {
      if ((a.kind === 'main' || a.kind === 'sup') && app.toCheck !== lastToCheck) {
        return {
          invariant: 7,
          detail: `${show(a)} changed toCheck ${String(lastToCheck)} → ${String(app.toCheck)}`,
        };
      }
      if (app.toCheck < lastToCheck && !cancelledSince) {
        return {
          invariant: 8,
          detail: `${show(a)} lowered toCheck ${String(lastToCheck)} → ${String(app.toCheck)}`,
        };
      }
    }
    lastToCheck = app.toCheck;
    cancelledSince = false;
    stats.checked += 1;
    beforeReopen = { withheld: app.withheld, toCheck: app.toCheck };
  }
  return undefined;
}

/**
 * Invariant 4: a payment swapped with the mark next to it changes the result only as the ledger
 * says (paid before a main mark it reduces the main; after it, it is extra): the swapped sequence
 * must satisfy every invariant too.
 */
async function checkOrder(sequence: readonly Action[]): Promise<Failure | undefined> {
  const i = sequence.findIndex(
    (a, k) =>
      a.kind === 'pay' && (sequence[k + 1]?.kind === 'main' || sequence[k + 1]?.kind === 'sup'),
  );
  if (i < 0) return undefined;
  const swapped = [...sequence];
  [swapped[i], swapped[i + 1]] = [swapped[i + 1] as Action, swapped[i] as Action];
  const failure = await check(swapped);
  return failure === undefined
    ? undefined
    : { invariant: 4, detail: `swapped (${swapped.map(show).join(' → ')}): ${failure.detail}` };
}

async function failureOf(sequence: readonly Action[]): Promise<Failure | undefined> {
  return (await check(sequence)) ?? (await checkOrder(sequence));
}

/** Removes actions one at a time while the same invariant still fails. */
async function shrink(sequence: Action[], invariant: number): Promise<Action[]> {
  let current = sequence;
  for (let k = current.length - 1; k >= 0; k--) {
    const shorter = current.filter((_, j) => j !== k);
    if ((await failureOf(shorter))?.invariant === invariant) current = shorter;
  }
  return current;
}

const SEEDS = Number(process.env.CLOSING_MODEL_SEEDS ?? '60');
const FIRST = Number(process.env.CLOSING_MODEL_FIRST ?? '1');

describe('the closing against a ledger of the owner (fifth round, the gate of R359)', () => {
  it("the fourth review's C1 sequence, replayed against the ledger", async () => {
    const c1: Action[] = [
      { kind: 'reopen' },
      { kind: 'cancel', tenant: 't-b', month: '2026-05' },
      { kind: 'close' },
      { kind: 'bill', amount: 2400, month: '2026-06' },
      { kind: 'pay', tenant: 't-b', month: '2026-05', amount: 3000 },
      { kind: 'main', tenant: 't-b' },
      { kind: 'sup', tenant: 't-b' },
      { kind: 'bill', amount: 1000, month: '2026-07' },
      { kind: 'reopen' },
      { kind: 'close' },
    ];
    const failure = await failureOf(c1);
    if (failure !== undefined)
      console.log(`C1: invariant ${String(failure.invariant)}: ${failure.detail}`);
    expect(failure).toBeUndefined();
  });

  it(`settled marks, reopenings and flat charges agree with the ledger, over ${String(SEEDS)} seeds`, async () => {
    const families = new Map<
      string,
      { count: number; shortest: string[]; detail: string; seed: number }
    >();
    for (let seed = FIRST; seed < FIRST + SEEDS; seed++) {
      const sequence = actions(seed);
      const failure = await failureOf(sequence);
      if (failure === undefined) continue;
      const short = await shrink(sequence, failure.invariant);
      const last = (await failureOf(short)) ?? failure;
      // A family: the invariant and the kinds of the shortest sequence, in order.
      const key = `${String(failure.invariant)}: ${short.map((a) => a.kind).join(' ')}`;
      const known = families.get(key);
      if (known === undefined) {
        families.set(key, { count: 1, shortest: short.map(show), detail: last.detail, seed });
      } else {
        known.count += 1;
        if (short.length < known.shortest.length) {
          Object.assign(known, { shortest: short.map(show), detail: last.detail, seed });
        }
      }
    }
    const report = [...families].map(
      ([key, f]) =>
        `invariant ${key} — ${String(f.count)} seed(s), e.g. seed ${String(f.seed)}:\n  ${f.shortest.join(' → ')}\n  ${f.detail}`,
    );
    console.log(
      `applied ${JSON.stringify(stats.applied)}, states checked ${String(stats.checked)}, marks with flat charge to check ${String(stats.withExtra)}`,
    );
    if (report.length > 0) console.log(report.join('\n\n'));
    expect(stats.checked).toBeGreaterThan(SEEDS);
    expect(report).toEqual([]);
  }, 3_600_000);
});
