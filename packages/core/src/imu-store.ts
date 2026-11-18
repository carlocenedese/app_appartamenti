/**
 * Writing the IMU (plan 3d): the expected amounts of an apartment and year (`setImuYear`) and the
 * assignment of an F24 to a rate by hand (`assignImuF24`), each write one operation of the journal, nothing written while `checkConsistency` reports a problem
 * (R113), and nothing for the same request on the same state. No amount or name in a summary.
 */
import { imuDependents } from './imu';
import { commitChange, writesBlocked } from './journal';
import {
  AccountSchema,
  ApartmentSchema,
  BankTransactionSchema,
  ImuRuleSchema,
  ImuYearSchema,
  MovementClassSchema,
} from './model';
import type { Cents } from './money';
import { payablesUsing } from './payable-store';
import { taxPaymentsUsing } from './tax-store';
import { payerKeyOf } from './payers';
import { planOutgoing } from './outgoing-store';
import { addDays } from './period';
import { parseOrThrow } from './parse';
import type { ISODate } from './period';
import { loadAll } from './store/load';
import { recordPath } from './store/records';
import type { Store } from './store/store';

export interface SetImuYearInput {
  apartmentId: string;
  /** `AAAA`. */
  year: string;
  f24Group: string;
  annualTotal?: Cents;
  rates: { index: number; expected?: Cents; dueDate?: ISODate }[];
}

export type SetImuYearResult =
  | { status: 'saved'; operationId: string; imuYearId: string }
  | { status: 'unchanged'; imuYearId: string }
  | {
      status: 'refused';
      reason: 'inconsistent-store' | 'unknown-apartment' | 'bad-rates' | 'rates-mismatch';
    }
  | { status: 'refused'; reason: 'has-dependents'; recordIds: string[] };

/**
 * Creates or updates `imu-<apartmentId>-<year>` (a new `rev`; a deleted one comes back) in one
 * `imu.expected` operation. Refused without writing: the apartment is not live
 * (`unknown-apartment`); the indices are not 1 to n or an amount is not positive (`bad-rates`);
 * another live year of the same `f24Group` and `year` has another number of rates
 * (`rates-mismatch`: one F24 pays the same rate of all of them). The same content already
 * stored is `unchanged`. A live record whose group and year have an assigned F24 changes group or
 * number of rates only after that assignment is undone (`has-dependents`, `imuDependents`).
 */
export async function setImuYear(
  store: Store,
  input: SetImuYearInput,
  profileId: string,
  clock: () => string,
  newId: () => string,
): Promise<SetImuYearResult> {
  const refuse = (
    reason: Exclude<Extract<SetImuYearResult, { status: 'refused' }>['reason'], 'has-dependents'>,
  ) => ({ status: 'refused', reason }) as const;
  if (await writesBlocked(store)) return refuse('inconsistent-store');
  const apartments = (await loadAll(store, 'apartment', ApartmentSchema)).records;
  if (!apartments.some((a) => a.id === input.apartmentId)) return refuse('unknown-apartment');
  const { rates, annualTotal } = input;
  if (
    rates.length === 0 ||
    rates.some((r, i) => r.index !== i + 1 || (r.expected !== undefined && r.expected <= 0)) ||
    (annualTotal !== undefined && annualTotal <= 0)
  ) {
    return refuse('bad-rates');
  }
  const id = `imu-${input.apartmentId}-${input.year}`;
  const years = (await loadAll(store, 'imuYear', ImuYearSchema, { includeDeleted: true })).records;
  const others = years.filter(
    (y) =>
      y.id !== id && y.deleted !== true && y.f24Group === input.f24Group && y.year === input.year,
  );
  if (others.some((y) => y.rates.length !== rates.length)) return refuse('rates-mismatch');

  const before = years.find((y) => y.id === id);
  const classes = (
    await loadAll(store, 'movementClass', MovementClassSchema, { includeDeleted: true })
  ).records;
  const recordIds = imuDependents(classes, before, input);
  if (recordIds.length > 0) return { status: 'refused', reason: 'has-dependents', recordIds };
  const record = (rev: number) =>
    parseOrThrow(
      ImuYearSchema,
      {
        id,
        v: 1,
        rev,
        apartmentId: input.apartmentId,
        year: input.year,
        f24Group: input.f24Group,
        ...(annualTotal === undefined ? {} : { annualTotal }),
        rates: rates.map((r) => ({
          index: r.index,
          ...(r.expected === undefined ? {} : { expected: r.expected }),
          ...(r.dueDate === undefined ? {} : { dueDate: r.dueDate }),
        })),
      },
      'imuYear',
    );
  // Both parsed by the same schema: same keys in the same order when the content is the same.
  if (
    before !== undefined &&
    before.deleted !== true &&
    JSON.stringify(record(before.rev)) === JSON.stringify(before)
  ) {
    return { status: 'unchanged', imuYearId: id };
  }
  const operation = await commitChange(
    store,
    {
      profileId,
      kind: 'imu.expected',
      apartmentId: input.apartmentId,
      summary: 'Aggiornati gli importi IMU attesi.',
      changes: [
        {
          path: recordPath('imuYear', id),
          before,
          after: record((before?.rev ?? 0) + 1),
        },
      ],
    },
    clock,
    newId,
  );
  return { status: 'saved', operationId: operation.id, imuYearId: id };
}

export interface AssignImuF24Input {
  transactionId: string;
  f24Group: string;
  /** `AAAA`. */
  year: string;
  rateIndex: number;
  /** Learn the group for the next F24s of the account (task 5); false: «solo questa volta». */
  rememberRule?: boolean;
}

export type AssignImuF24Result =
  | { status: 'assigned'; operationId: string; classId: string; ruleId?: string }
  | { status: 'unchanged'; classId: string }
  | {
      status: 'refused';
      reason:
        | 'inconsistent-store'
        | 'not-imu-candidate'
        | 'unknown-rate'
        | 'payer-not-in-group'
        | 'rate-already-paid'
        | 'rule-conflict-dates'
        | 'payable-linked'
        | 'tax-assigned';
    };

/**
 * Assigns the F24 `transactionId` to the rate `(f24Group, year, rateIndex)`, always by hand
 * (decision 6: no run writes it), in one `imu.assign` operation. The movement is either a
 * `p-f24-` proposal recomputed on the current state (writes `mc-<id>` `tasse`, `f24`, the
 * apartment of its account, with `imu`) or an F24 confirmed «da ripartire» (a live class `f24`
 * of the apartment of its account, without `imu` or `ruleId`: rewritten with `imu`); anything
 * else is `not-imu-candidate` (an F24 confirmed for another apartment, an excluded, deleted or
 * already assigned movement). `unknown-rate`: no live year of the group and year has that rate;
 * `payer-not-in-group`: the apartment of the account has no live year in it;
 * `rate-already-paid`: another live class has the same rate (question 9: one F24 per rate).
 * `payable-linked` (plan 9, first): a live payable is paid by the movement; `tax-assigned`
 * (plan 10, next): a live `taxPayment` is on it.
 * The same assignment already stored is `unchanged`, nothing written. With `rememberRule`, unless
 * a valid rule of the account and counterparty key already suggests that group, the rule
 * `imur-<transactionId>` (question 8) is written last in the same operation; the valid rules
 * with another group end the day before the movement and the new one starts on it, as the
 * rules of plan 3c (R128). `rule-conflict-dates`: such a rule starts on or after the movement.
 */
export async function assignImuF24(
  store: Store,
  input: AssignImuF24Input,
  profileId: string,
  clock: () => string,
  newId: () => string,
): Promise<AssignImuF24Result> {
  const refuse = (reason: Extract<AssignImuF24Result, { status: 'refused' }>['reason']) =>
    ({ status: 'refused', reason }) as const;
  if (await writesBlocked(store)) return refuse('inconsistent-store');
  const all = { includeDeleted: true };
  const tx = (await loadAll(store, 'transaction', BankTransactionSchema)).records.find(
    (t) => t.id === input.transactionId,
  );
  // Deleted accounts too, as in the balance: the money did move.
  const payer = (await loadAll(store, 'account', AccountSchema, all)).records.find(
    (a) => a.id === tx?.accountId,
  )?.apartmentId;
  const classes = (await loadAll(store, 'movementClass', MovementClassSchema, all)).records;
  const id = `mc-${input.transactionId}`;
  const before = classes.find((c) => c.id === id);
  // Plan 9: the movement already pays a payable typed by hand (one use per movement).
  if ((await payablesUsing(store, [input.transactionId])).length > 0) {
    return refuse('payable-linked');
  }
  // Plan 10: the movement is already assigned to cedolare or registro.
  if ((await taxPaymentsUsing(store, [input.transactionId])).length > 0) {
    return refuse('tax-assigned');
  }
  if (tx === undefined || payer === undefined) return refuse('not-imu-candidate');
  const ownF24 =
    before !== undefined &&
    before.deleted !== true &&
    before.f24 === true &&
    before.ruleId === undefined &&
    before.apartmentId === payer;
  if (
    ownF24 &&
    before.imu?.f24Group === input.f24Group &&
    before.imu.year === input.year &&
    before.imu.rateIndex === input.rateIndex
  ) {
    return { status: 'unchanged', classId: id };
  }
  const toSplit = ownF24 && before.imu === undefined;
  const proposed =
    !toSplit &&
    (await planOutgoing(store)).proposals.some(
      (p) => p.id === `p-f24-${input.transactionId}` && p.step === 'f24',
    );
  if (!(proposed || toSplit)) {
    return refuse('not-imu-candidate');
  }
  const group = (await loadAll(store, 'imuYear', ImuYearSchema)).records.filter(
    (y) => y.f24Group === input.f24Group && y.year === input.year,
  );
  if (!group.some((y) => y.rates.some((r) => r.index === input.rateIndex))) {
    return refuse('unknown-rate');
  }
  if (!group.some((y) => y.apartmentId === payer)) return refuse('payer-not-in-group');
  const imu = { f24Group: input.f24Group, year: input.year, rateIndex: input.rateIndex };
  const paid = classes.some(
    (c) =>
      c.id !== id &&
      c.deleted !== true &&
      c.imu?.f24Group === imu.f24Group &&
      c.imu.year === imu.year &&
      c.imu.rateIndex === imu.rateIndex,
  );
  if (paid) return refuse('rate-already-paid');

  const after = parseOrThrow(
    MovementClassSchema,
    toSplit
      ? { ...before, imu }
      : {
          id,
          v: 1,
          rev: 1,
          transactionId: tx.id,
          kind: 'tasse',
          apartmentId: payer,
          f24: true,
          imu,
        },
    'movementClass',
  );
  const changes: { path: string; before: unknown; after: unknown }[] = [
    { path: recordPath('movementClass', id), before, after },
  ];
  let ruleId: string | undefined;
  if (input.rememberRule === true) {
    const key = payerKeyOf(tx.counterparty);
    const rules = (await loadAll(store, 'imuRule', ImuRuleSchema, all)).records;
    const valid = rules.filter(
      (r) =>
        r.deleted !== true &&
        r.accountId === tx.accountId &&
        r.key === key &&
        (r.validFrom === undefined || r.validFrom <= tx.date) &&
        (r.validTo === undefined || r.validTo >= tx.date),
    );
    const closed = valid.filter((r) => r.f24Group !== input.f24Group);
    const dayBefore = addDays(tx.date as ISODate, -1);
    if (closed.some((r) => r.validFrom !== undefined && r.validFrom > dayBefore)) {
      return refuse('rule-conflict-dates');
    }
    if (closed.length > 0 || valid.length === 0) {
      for (const r of closed) {
        changes.push({
          path: recordPath('imuRule', r.id),
          before: r,
          after: parseOrThrow(ImuRuleSchema, { ...r, validTo: dayBefore }, 'imuRule'),
        });
      }
      ruleId = `imur-${tx.id}`;
      // The rule last: an interrupted assignment never leaves a rule without its class.
      changes.push({
        path: recordPath('imuRule', ruleId),
        before: rules.find((r) => r.id === ruleId),
        after: parseOrThrow(
          ImuRuleSchema,
          {
            id: ruleId,
            v: 1,
            rev: 1,
            accountId: tx.accountId,
            ...(key === undefined ? {} : { key }),
            f24Group: input.f24Group,
            ...(closed.length > 0 ? { validFrom: tx.date } : {}),
          },
          'imuRule',
        ),
      });
    }
  }
  const operation = await commitChange(
    store,
    {
      profileId,
      kind: 'imu.assign',
      apartmentId: payer,
      summary: 'Assegnato un F24 a una rata IMU.',
      changes,
    },
    clock,
    newId,
  );
  return {
    status: 'assigned',
    operationId: operation.id,
    classId: id,
    ...(ruleId === undefined ? {} : { ruleId }),
  };
}
