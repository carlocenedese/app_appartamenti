/**
 * Writing the IMU (plan 3d): the expected amounts of an apartment and year (`setImuYear`), each
 * write one operation of the journal, nothing written while `checkConsistency` reports a problem
 * (R113), and nothing for the same request on the same state. No amount or name in a summary.
 */
import { checkConsistency, commitChange } from './journal';
import { ApartmentSchema, ImuYearSchema } from './model';
import type { Cents } from './money';
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
    };

/**
 * Creates or updates `imu-<apartmentId>-<year>` (a new `rev`; a deleted one comes back) in one
 * `imu.expected` operation. Refused without writing: the apartment is not live
 * (`unknown-apartment`); the indices are not 1 to n or an amount is not positive (`bad-rates`);
 * another live year of the same `f24Group` and `year` has another number of rates
 * (`rates-mismatch`: one F24 pays the same rate of all of them). The same content already
 * stored is `unchanged`.
 */
export async function setImuYear(
  store: Store,
  input: SetImuYearInput,
  profileId: string,
  clock: () => string,
  newId: () => string,
): Promise<SetImuYearResult> {
  const refuse = (reason: Extract<SetImuYearResult, { status: 'refused' }>['reason']) =>
    ({ status: 'refused', reason }) as const;
  if ((await checkConsistency(store)).length > 0) return refuse('inconsistent-store');
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
