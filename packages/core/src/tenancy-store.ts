/**
 * Writing tenancies (plan 11): the arrival of a tenant (`saveTenancy`), the last month of a stay
 * (`endTenancy`) and a takeover inside a contract (`recordTakeover`). Each write is one operation
 * of the journal, nothing is written while `checkConsistency` reports a problem (R113), the same
 * request on the same state writes nothing, and a write that would make the conguaglio throw
 * (`checkBeds`) is refused. No amount or name in a summary; no movement is ever touched.
 */
import { SettlementInputError, checkBeds, isPresent } from './conguaglio';
import type { SettlementInputErrorCode } from './conguaglio';
import { checkConsistency, commitChange } from './journal';
import type { Operation } from './journal';
import {
  ApartmentSchema,
  ContractSchema,
  PaymentSchema,
  TenancySchema,
  TenantRecoverySchema,
  TenantSchema,
} from './model';
import type { Apartment, Contract, Tenancy } from './model';
import type { Cents } from './money';
import { parseOrThrow } from './parse';
import { addMonths, monthsInPeriod, isoDate, settlementPeriods } from './period';
import type { YearMonth } from './period';
import { loadAll } from './store/load';
import { recordPath } from './store/records';
import type { Store } from './store/store';
import { compareText } from './text';

export type TenancyRefusal =
  | 'inconsistent-store'
  | 'invalid-tenancy'
  | 'unknown-apartment'
  | 'unknown-tenant'
  | 'unknown-contract'
  | 'unknown-tenancy'
  | 'same-tenant'
  | 'no-contract'
  | 'tenancy-exists'
  | 'beds-conflict'
  | 'has-recoveries';

export type TenancyWriteResult =
  | { status: 'saved'; operationId: string; tenancyId: string }
  | { status: 'unchanged'; tenancyId: string }
  | {
      status: 'refused';
      reason: TenancyRefusal;
      /** `beds-conflict`: what `calcConguaglio` would throw, and the first month it would. */
      code?: SettlementInputErrorCode;
      month?: YearMonth;
    };

export interface SaveTenancyInput {
  id: string;
  apartmentId: string;
  tenantId: string;
  room?: string;
  from: YearMonth;
  to?: YearMonth;
  monthlyRent: Cents;
  monthlyForfait: Cents;
  expectedDeposit?: Cents;
  /** A live contract of the same apartment the tenancy is added to (`tenancyIds`). */
  contractId?: string;
}

export interface TakeoverInput {
  /** The live tenancy that leaves, linked to exactly one live contract. */
  outTenancyId: string;
  /** Its last month; the incoming tenancy starts the month after. */
  lastMonth: YearMonth;
  incoming: {
    id: string;
    tenantId: string;
    monthlyRent: Cents;
    monthlyForfait: Cents;
    expectedDeposit?: Cents;
  };
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const refuse = (reason: TenancyRefusal): TenancyWriteResult => ({ status: 'refused', reason });

async function loadState(store: Store) {
  const all = { includeDeleted: true };
  return {
    recoveries: (await loadAll(store, 'tenantRecovery', TenantRecoverySchema)).records,
    apartments: (await loadAll(store, 'apartment', ApartmentSchema)).records,
    tenants: (await loadAll(store, 'tenant', TenantSchema)).records,
    tenancies: (await loadAll(store, 'tenancy', TenancySchema, all)).records,
    contracts: (await loadAll(store, 'contract', ContractSchema, all)).records,
  };
}

const isLive = <T extends { deleted?: boolean }>(r: T | undefined): r is T =>
  r !== undefined && r.deleted !== true;

/** A tenancy record, or undefined when the schema refuses it (or an amount is negative). */
function tenancyRecord(fields: Record<string, unknown>): Tenancy | undefined {
  const parsed = TenancySchema.safeParse({ v: 1, ...fields });
  if (!parsed.success || parsed.data.monthlyRent < 0 || parsed.data.monthlyForfait < 0) {
    return undefined;
  }
  return parsed.data;
}

/**
 * The first bed conflict the written tenancies would make: only the months in which one of them is
 * present (a start month of some tenancy, where every overlap begins), so an old conflict
 * elsewhere does not block a correction.
 */
function bedsConflict(
  apartment: Apartment,
  stored: readonly Tenancy[],
  written: readonly Tenancy[],
): { code: SettlementInputErrorCode; month?: YearMonth; tenancyIds: string[] } | undefined {
  const ids = new Set(written.map((t) => t.id));
  const after = [...stored.filter((t) => !ids.has(t.id)), ...written];
  const months = [
    ...new Set(after.filter((t) => t.apartmentId === apartment.id).map((t) => t.from)),
  ]
    .filter((m) => written.some((t) => isPresent(t, m)))
    .sort(compareText);
  try {
    checkBeds(apartment, after, months);
    return undefined;
  } catch (error) {
    if (!(error instanceof SettlementInputError)) throw error;
    return {
      code: error.code,
      ...(error.month === undefined ? {} : { month: error.month }),
      tenancyIds: error.tenancyIds ?? [],
    };
  }
}

const refuseBeds = (conflict: { code: SettlementInputErrorCode; month?: YearMonth }) =>
  ({
    status: 'refused',
    reason: 'beds-conflict',
    code: conflict.code,
    ...(conflict.month === undefined ? {} : { month: conflict.month }),
  }) as const;

/**
 * Whether a shorter stay leaves a tenant out of a period where a live recovery (not
 * `non-recuperabile`, with `periodLabel`) gives them a share: `calcConguaglio` would throw
 * `recovery-tenant-absent` (R197). Periods from the live contracts of the apartment.
 */
function leavesRecovery(
  state: Awaited<ReturnType<typeof loadState>>,
  apartment: Apartment,
  written: readonly Tenancy[],
): boolean {
  const ids = new Set(written.map((t) => t.id));
  const after = [...state.tenancies.filter((t) => isLive(t) && !ids.has(t.id)), ...written];
  const periods = state.contracts
    .filter((c) => isLive(c) && c.apartmentId === apartment.id)
    .flatMap((c) => {
      try {
        return settlementPeriods(c, apartment.annualitaStart);
      } catch {
        return []; // not a period calcConguaglio can compute either
      }
    });
  return state.recoveries.some(
    (r) =>
      r.apartmentId === apartment.id &&
      r.status !== 'non-recuperabile' &&
      r.periodLabel !== undefined &&
      r.shares.some(
        (share) =>
          written.some((w) => w.tenantId === share.tenantId) &&
          periods
            .filter((p) => p.label === r.periodLabel)
            .some((p) => {
              const months = monthsInPeriod(isoDate(`${p.from}-01`), isoDate(`${p.to}-01`));
              return !after.some(
                (t) =>
                  t.tenantId === share.tenantId &&
                  t.apartmentId === apartment.id &&
                  months.some((m) => isPresent(t, m)),
              );
            }),
      ),
  );
}

/** `after` with the `rev` that follows `before` (1 for a new record). */
const nextRev = <T extends { rev: number }>(before: { rev: number } | undefined, after: T): T => ({
  ...after,
  rev: (before?.rev ?? 0) + 1,
});

/** Same content as the live `before`, whatever the `rev`. */
const same = (before: { rev: number; deleted?: boolean } | undefined, after: object): boolean =>
  isLive(before) && JSON.stringify({ ...after, rev: before.rev }) === JSON.stringify(before);

/** Writes the changed records in one operation, or says nothing changed. */
async function write(
  store: Store,
  tenancyId: string,
  changes: { path: string; before: { rev: number } | undefined; after: { rev: number } }[],
  meta: { kind: string; summary: string; apartmentId: string; profileId: string },
  clock: () => string,
  newId: () => string,
): Promise<TenancyWriteResult> {
  const real = changes
    .filter((c) => !same(c.before, c.after))
    .map((c) => ({ ...c, after: nextRev(c.before, c.after) }));
  if (real.length === 0) return { status: 'unchanged', tenancyId };
  const operation: Operation = await commitChange(
    store,
    {
      profileId: meta.profileId,
      kind: meta.kind,
      apartmentId: meta.apartmentId,
      summary: meta.summary,
      changes: real,
    },
    clock,
    newId,
  );
  return { status: 'saved', operationId: operation.id, tenancyId };
}

/** The contract `c` with `tenancyId` in `tenancyIds` (unchanged when it is there already). */
const linked = (c: Contract, tenancyId: string): Contract =>
  (c.tenancyIds ?? []).includes(tenancyId)
    ? c
    : parseOrThrow(
        ContractSchema,
        { ...c, tenancyIds: [...(c.tenancyIds ?? []), tenancyId] },
        'contract',
      );

/**
 * Creates or replaces the tenancy `input.id` (a deleted one comes back) in one `tenancy.save`
 * operation. Like `saveContract`, it replaces every field: one left out (`room`, `to`,
 * `expectedDeposit`) is removed, so a finished stay saved again without `to` is open again
 * (question 12 of the design, not decided); with `contractId` the tenancy joins that contract's `tenancyIds` in the same
 * operation. Refused without writing, in this order: `inconsistent-store`; `invalid-tenancy` (an
 * id that is not `[A-Za-z0-9_-]{1,64}`, `to` before `from`, a negative rent or flat charge, an
 * expected deposit that is not positive); `unknown-apartment`; `unknown-tenant`; `unknown-contract`
 * (absent, deleted or of another apartment); `beds-conflict` (what `calcConguaglio` would throw).
 */
export async function saveTenancy(
  store: Store,
  input: SaveTenancyInput,
  profileId: string,
  clock: () => string,
  newId: () => string,
): Promise<TenancyWriteResult> {
  if ((await checkConsistency(store)).length > 0) return refuse('inconsistent-store');
  const { contractId, ...fields } = input;
  const record = ID.test(input.id) ? tenancyRecord({ ...fields, rev: 1 }) : undefined;
  if (record === undefined) return refuse('invalid-tenancy');
  const state = await loadState(store);
  const apartment = state.apartments.find((a) => a.id === input.apartmentId);
  if (apartment === undefined) return refuse('unknown-apartment');
  if (!state.tenants.some((t) => t.id === input.tenantId)) return refuse('unknown-tenant');
  const contract = state.contracts.find((c) => c.id === contractId);
  if (
    contractId !== undefined &&
    (!isLive(contract) || contract.apartmentId !== input.apartmentId)
  ) {
    return refuse('unknown-contract');
  }
  const conflict = bedsConflict(apartment, state.tenancies, [record]);
  if (conflict !== undefined) return refuseBeds(conflict);
  const before = state.tenancies.find((t) => t.id === record.id);
  return write(
    store,
    record.id,
    [
      { path: recordPath('tenancy', record.id), before, after: record },
      ...(isLive(contract)
        ? [
            {
              path: recordPath('contract', contract.id),
              before: contract,
              after: linked(contract, record.id),
            },
          ]
        : []),
    ],
    { kind: 'tenancy.save', summary: 'Presenza salvata.', apartmentId: apartment.id, profileId },
    clock,
    newId,
  );
}

/**
 * Writes `lastMonth` as the last month of the live tenancy `tenancyId` in one `tenancy.end`
 * operation. Refused without writing: `inconsistent-store`; `unknown-tenancy` (absent or
 * deleted); `invalid-tenancy` (`lastMonth` before `from`); `beds-conflict` (a longer stay that no
 * longer fits the beds); `has-recoveries` (the tenant would be absent from a period where a live
 * recovery gives them a share). Confirmed rents paid for months after `lastMonth` are not
 * refused: `contractChecks` shows them (`payment-after-end`).
 */
export async function endTenancy(
  store: Store,
  input: { tenancyId: string; lastMonth: YearMonth },
  profileId: string,
  clock: () => string,
  newId: () => string,
): Promise<TenancyWriteResult> {
  if ((await checkConsistency(store)).length > 0) return refuse('inconsistent-store');
  const state = await loadState(store);
  const before = state.tenancies.find((t) => t.id === input.tenancyId);
  if (!isLive(before)) return refuse('unknown-tenancy');
  if (input.lastMonth < before.from) return refuse('invalid-tenancy');
  const after = parseOrThrow(TenancySchema, { ...before, to: input.lastMonth }, 'tenancy');
  const apartment = state.apartments.find((a) => a.id === before.apartmentId);
  const conflict =
    apartment === undefined ? undefined : bedsConflict(apartment, state.tenancies, [after]);
  if (conflict !== undefined) return refuseBeds(conflict);
  if (apartment !== undefined && leavesRecovery(state, apartment, [after])) {
    return refuse('has-recoveries');
  }
  return write(
    store,
    before.id,
    [{ path: recordPath('tenancy', before.id), before, after }],
    {
      kind: 'tenancy.end',
      summary: 'Uscita registrata.',
      apartmentId: before.apartmentId,
      profileId,
    },
    clock,
    newId,
  );
}

/**
 * A takeover in one `tenancy.takeover` operation: the outgoing tenancy ends at `lastMonth`; the
 * incoming one starts the month after in the same apartment and room, until the old end of the
 * outgoing one (none if it had none); the live contract linking the outgoing tenancy adds the
 * incoming one to `tenancyIds` and `{ month, outTenancyId, inTenancyId }` to `takeovers`. The
 * contract's rent history is not touched. The same takeover already written is `unchanged` (one
 * with other figures for the incoming tenancy is `tenancy-exists`). Refused without writing, in
 * this order: `inconsistent-store`; `unknown-tenancy`; `invalid-tenancy` (`lastMonth` before the
 * start or not before the end of the outgoing tenancy, an incoming id or amount not valid);
 * `unknown-tenant`; `same-tenant`; `no-contract` (the outgoing tenancy is not in exactly one live
 * contract; or the incoming tenancy would start after the contract's end: `invalid-tenancy`);
 * `tenancy-exists` (the incoming id is a live tenancy); `beds-conflict`; `has-recoveries` (as
 * `endTenancy`). The incoming tenancy gets the room and the old end of the outgoing one (questions
 * 10 and 11 of the design).
 */
export async function recordTakeover(
  store: Store,
  input: TakeoverInput,
  profileId: string,
  clock: () => string,
  newId: () => string,
): Promise<TenancyWriteResult> {
  if ((await checkConsistency(store)).length > 0) return refuse('inconsistent-store');
  const state = await loadState(store);
  const out = state.tenancies.find((t) => t.id === input.outTenancyId);
  if (!isLive(out)) return refuse('unknown-tenancy');
  const { incoming } = input;
  const month = addMonths(input.lastMonth, 1);
  const contracts = state.contracts.filter(
    (c) => isLive(c) && (c.tenancyIds ?? []).includes(out.id),
  );
  const [contract] = contracts;
  const stored = state.tenancies.find((t) => t.id === incoming.id);
  const done = contract?.takeovers?.some(
    (t) => t.outTenancyId === out.id && t.inTenancyId === incoming.id && t.month === month,
  );
  if (done === true && isLive(stored)) {
    const sameFigures =
      stored.tenantId === incoming.tenantId &&
      stored.monthlyRent === incoming.monthlyRent &&
      stored.monthlyForfait === incoming.monthlyForfait &&
      stored.expectedDeposit === incoming.expectedDeposit;
    return sameFigures ? { status: 'unchanged', tenancyId: incoming.id } : refuse('tenancy-exists');
  }
  const record = ID.test(incoming.id)
    ? tenancyRecord({
        id: incoming.id,
        rev: 1,
        apartmentId: out.apartmentId,
        tenantId: incoming.tenantId,
        ...(out.room === undefined ? {} : { room: out.room }),
        from: month,
        ...(out.to === undefined ? {} : { to: out.to }),
        monthlyRent: incoming.monthlyRent,
        monthlyForfait: incoming.monthlyForfait,
        ...(incoming.expectedDeposit === undefined
          ? {}
          : { expectedDeposit: incoming.expectedDeposit }),
      })
    : undefined;
  if (
    input.lastMonth < out.from ||
    (out.to !== undefined && input.lastMonth >= out.to) ||
    record === undefined
  ) {
    return refuse('invalid-tenancy');
  }
  if (!state.tenants.some((t) => t.id === incoming.tenantId)) return refuse('unknown-tenant');
  if (incoming.tenantId === out.tenantId) return refuse('same-tenant');
  if (contract === undefined || contracts.length > 1) return refuse('no-contract');
  // The incoming tenancy must start inside the contract it joins.
  if (month > contract.end) return refuse('invalid-tenancy');
  if (isLive(stored)) return refuse('tenancy-exists');
  const ended = parseOrThrow(TenancySchema, { ...out, to: input.lastMonth }, 'tenancy');
  const apartment = state.apartments.find((a) => a.id === out.apartmentId);
  const conflict =
    apartment === undefined ? undefined : bedsConflict(apartment, state.tenancies, [ended, record]);
  if (conflict !== undefined) return refuseBeds(conflict);
  if (apartment !== undefined && leavesRecovery(state, apartment, [ended, record])) {
    return refuse('has-recoveries');
  }
  const takeovers = [
    ...(contract.takeovers ?? []),
    { month, outTenancyId: out.id, inTenancyId: record.id },
  ].sort((a, b) => compareText(a.month, b.month));
  const after = parseOrThrow(
    ContractSchema,
    { ...linked(contract, record.id), takeovers },
    'contract',
  );
  return write(
    store,
    record.id,
    [
      { path: recordPath('tenancy', out.id), before: out, after: ended },
      { path: recordPath('tenancy', record.id), before: stored, after: record },
      { path: recordPath('contract', contract.id), before: contract, after },
    ],
    {
      kind: 'tenancy.takeover',
      summary: 'Registrato un subentro.',
      apartmentId: out.apartmentId,
      profileId,
    },
    clock,
    newId,
  );
}

export interface RoomSwapInput {
  apartmentId: string;
  tenancyIdA: string;
  tenancyIdB: string;
  /** The first month in the new rooms; both stays end the month before. */
  month: YearMonth;
  /** The rent from `month`, when it changes (plan 18: data of user1, never derived). */
  monthlyRentA?: Cents;
  monthlyRentB?: Cents;
}

export type RoomSwapResult =
  | {
      status: 'saved';
      operationId: string;
      tenancyIds: [string, string];
      warnings?: ['swap-rent-unchanged'];
    }
  | { status: 'unchanged'; tenancyIds: [string, string]; warnings?: ['swap-rent-unchanged'] }
  | {
      status: 'refused';
      reason: TenancyRefusal | 'no-room' | 'same-room' | 'different-contract';
      code?: SettlementInputErrorCode;
      month?: YearMonth;
    };

/**
 * Two tenants of one contract swap rooms from `month` in one `tenancy.swap` operation (plan 18):
 * both stays end the month before; each tenant starts a stay `<old id>-<month>` in the other's room
 * with their own end, flat charge and expected deposit (no new deposit) and the rent given, else
 * their own; both join the contract's `tenancyIds`; the rent history and the takeovers are not
 * touched. `swap-rent-unchanged` when a rent is not given and the two rents differ. The same
 * request is `unchanged`. Refused without writing, in this order: `inconsistent-store`;
 * `unknown-tenancy` (absent, deleted or of another apartment); `same-tenant`; `tenancy-exists` (a
 * new id is a live tenancy: the same swap with other figures, or another stay); `no-room`;
 * `same-room`; `invalid-tenancy` (`month` not after both starts, a stay not present in `month`,
 * `month` after the contract's end, a negative rent, a new id over 64 characters); `no-contract`
 * (a stay not in exactly one live contract); `different-contract` (question 2 of the design);
 * `beds-conflict`.
 */
export async function recordRoomSwap(
  store: Store,
  input: RoomSwapInput,
  profileId: string,
  clock: () => string,
  newId: () => string,
): Promise<RoomSwapResult> {
  const no = (reason: Extract<RoomSwapResult, { status: 'refused' }>['reason']) =>
    ({ status: 'refused', reason }) as const;
  if ((await checkConsistency(store)).length > 0) return no('inconsistent-store');
  const state = await loadState(store);
  const find = (id: string) =>
    state.tenancies.find((t) => t.id === id && isLive(t) && t.apartmentId === input.apartmentId);
  const a = find(input.tenancyIdA);
  const b = find(input.tenancyIdB);
  if (a === undefined || b === undefined) return no('unknown-tenancy');
  if (a.id === b.id || a.tenantId === b.tenantId) return no('same-tenant');
  const { month } = input;
  const ids: [string, string] = [`${a.id}-${month}`, `${b.id}-${month}`];
  const rentA = input.monthlyRentA ?? a.monthlyRent;
  const rentB = input.monthlyRentB ?? b.monthlyRent;
  const unchangedRent =
    (input.monthlyRentA === undefined || input.monthlyRentB === undefined) &&
    a.monthlyRent !== b.monthlyRent;
  const warned = unchangedRent
    ? { warnings: ['swap-rent-unchanged'] as ['swap-rent-unchanged'] }
    : {};
  // Each new stay: the tenant's own end, flat charge and expected deposit, the other's room.
  const moved = ({ to, ...from }: Tenancy, id: string, room: string | undefined, rent: Cents) =>
    ID.test(id)
      ? tenancyRecord({
          ...from,
          // On a repeated request the old stay already ends before `month` (compared without `to`).
          ...(to === undefined || to < month ? {} : { to }),
          id,
          rev: 1,
          ...(room === undefined ? {} : { room }),
          from: month,
          monthlyRent: rent,
        })
      : undefined;
  const newA = moved(a, ids[0], b.room, rentA);
  const newB = moved(b, ids[1], a.room, rentB);
  const storedA = state.tenancies.find((t) => t.id === ids[0]);
  const storedB = state.tenancies.find((t) => t.id === ids[1]);
  // Already written: the old stays end the month before and the new ones hold the same figures.
  const sameAs = (stored: Tenancy | undefined, record: Tenancy | undefined, old: Tenancy) =>
    isLive(stored) &&
    record !== undefined &&
    old.to === addMonths(month, -1) &&
    JSON.stringify({ ...stored, rev: 1, to: undefined }) ===
      JSON.stringify({ ...record, to: undefined });
  if (sameAs(storedA, newA, a) && sameAs(storedB, newB, b)) {
    return { status: 'unchanged', tenancyIds: ids, ...warned };
  }
  // A new id already live: this swap with other figures, or another stay.
  if (isLive(storedA) || isLive(storedB)) return no('tenancy-exists');
  if (a.room === undefined || b.room === undefined) return no('no-room');
  if (a.room === b.room) return no('same-room');
  const contractsOf = (t: Tenancy) =>
    state.contracts.filter((c) => isLive(c) && (c.tenancyIds ?? []).includes(t.id));
  const [contractA, ...moreA] = contractsOf(a);
  const [contractB, ...moreB] = contractsOf(b);
  if (
    month <= a.from ||
    month <= b.from ||
    !isPresent(a, month) ||
    !isPresent(b, month) ||
    (contractA !== undefined && month > contractA.end) ||
    newA === undefined ||
    newB === undefined
  ) {
    return no('invalid-tenancy');
  }
  if (contractA === undefined || contractB === undefined || moreA.length + moreB.length > 0) {
    return no('no-contract');
  }
  if (contractA.id !== contractB.id) return no('different-contract');
  const last = addMonths(month, -1);
  const endedA = parseOrThrow(TenancySchema, { ...a, to: last }, 'tenancy');
  const endedB = parseOrThrow(TenancySchema, { ...b, to: last }, 'tenancy');
  const apartment = state.apartments.find((x) => x.id === a.apartmentId);
  const conflict =
    apartment === undefined
      ? undefined
      : bedsConflict(apartment, state.tenancies, [endedA, endedB, newA, newB]);
  if (conflict !== undefined) return refuseBeds(conflict);
  const result = await write(
    store,
    ids[0],
    [
      { path: recordPath('tenancy', a.id), before: a, after: endedA },
      { path: recordPath('tenancy', b.id), before: b, after: endedB },
      { path: recordPath('tenancy', newA.id), before: storedA, after: newA },
      { path: recordPath('tenancy', newB.id), before: storedB, after: newB },
      {
        path: recordPath('contract', contractA.id),
        before: contractA,
        after: linked(linked(contractA, newA.id), newB.id),
      },
    ],
    {
      kind: 'tenancy.swap',
      summary: 'Registrato uno scambio di posto.',
      apartmentId: a.apartmentId,
      profileId,
    },
    clock,
    newId,
  );
  return result.status === 'saved'
    ? { status: 'saved', operationId: result.operationId, tenancyIds: ids, ...warned }
    : { status: 'unchanged', tenancyIds: ids, ...warned };
}

/**
 * What stops the undo of an operation on tenancies (plan 11), sorted ids, empty when nothing
 * blocks: the live tenancies the restored ones would conflict with (`checkBeds`: for example an
 * undone exit whose room is taken since; undo or correct those first); then, for a tenancy the
 * operation created, the live payments and recoveries of its tenant in its apartment when no other
 * live tenancy of that tenant is there (the income and the conguaglio would have no stay).
 */
export async function tenancyUndoBlockers(
  store: Store,
  changes: readonly { path: string; before?: unknown; after?: unknown }[],
): Promise<string[]> {
  const created = changes.flatMap(({ path, before, after }) => {
    if (!path.includes('/tenancy/')) return [];
    const was = TenancySchema.safeParse(before);
    const is = TenancySchema.safeParse(after);
    return is.success && is.data.deleted !== true && !(was.success && was.data.deleted !== true)
      ? [is.data]
      : [];
  });
  const restored = changes.flatMap(({ path, before }) => {
    const was = path.includes('/tenancy/') ? TenancySchema.safeParse(before) : undefined;
    return was?.success === true && was.data.deleted !== true ? [was.data] : [];
  });
  if (created.length === 0 && restored.length === 0) return [];
  const tenancies = (await loadAll(store, 'tenancy', TenancySchema)).records;
  const apartments = (await loadAll(store, 'apartment', ApartmentSchema)).records;
  const gone = new Set(created.map((t) => t.id));
  const remaining = tenancies.filter((t) => !gone.has(t.id));
  const own = new Set(restored.map((t) => t.id));
  const clashes = apartments.flatMap((apartment) => {
    const back = restored.filter((t) => t.apartmentId === apartment.id);
    const conflict = back.length === 0 ? undefined : bedsConflict(apartment, remaining, back);
    const others = (conflict?.tenancyIds ?? []).filter((id) => !own.has(id));
    // A conflict of the restored tenancy alone (`unknown-room`): it is the one that blocks.
    return others.length > 0 ? others : (conflict?.tenancyIds ?? []);
  });
  if (clashes.length > 0) return [...new Set(clashes)].sort(compareText);
  const payments = (await loadAll(store, 'payment', PaymentSchema)).records;
  const recoveries = (await loadAll(store, 'tenantRecovery', TenantRecoverySchema)).records;
  const out = created.flatMap((t) => {
    const covered = tenancies.some(
      (o) => o.id !== t.id && o.tenantId === t.tenantId && o.apartmentId === t.apartmentId,
    );
    if (covered) return [];
    return [
      ...payments.filter((p) => p.tenantId === t.tenantId && p.apartmentId === t.apartmentId),
      ...recoveries.filter(
        (r) => r.apartmentId === t.apartmentId && r.shares.some((s) => s.tenantId === t.tenantId),
      ),
    ].map((r) => r.id);
  });
  return [...new Set(out)].sort(compareText);
}
