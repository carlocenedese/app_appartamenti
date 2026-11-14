import { describe, expect, it } from 'vitest';
import { isoDate, lastDayOfMonth, yearMonth } from '../src/period';
import { chooseRentMonth } from '../src/rent-month';

const d = isoDate;
const m = yearMonth;

describe('lastDayOfMonth', () => {
  it('handles leap years and December', () => {
    expect(lastDayOfMonth(m('2028-02'))).toBe('2028-02-29');
    expect(lastDayOfMonth(m('2026-02'))).toBe('2026-02-28');
    expect(lastDayOfMonth(m('2026-12'))).toBe('2026-12-31');
  });
});

describe('chooseRentMonth', () => {
  it('takes the previous month within the late threshold', () => {
    const unpaid = [m('2026-10'), m('2026-11')];
    expect(chooseRentMonth({ date: d('2026-11-10'), unpaid, lateDays: 10 })).toEqual({
      status: 'auto',
      month: '2026-10',
    });
    expect(chooseRentMonth({ date: d('2026-11-11'), unpaid, lateDays: 10 })).toEqual({
      status: 'review',
      reason: 'late',
    });
  });
  it('takes the month of the date when it is the oldest unpaid', () => {
    expect(
      chooseRentMonth({ date: d('2026-10-03'), unpaid: [m('2026-10')], lateDays: 10 }),
    ).toEqual({
      status: 'auto',
      month: '2026-10',
    });
  });
  it('asks for review when nothing is unpaid', () => {
    expect(chooseRentMonth({ date: d('2026-10-03'), unpaid: [], lateDays: 10 })).toEqual({
      status: 'review',
      reason: 'month-paid',
    });
  });
  it('asks for review with two months in arrears', () => {
    const unpaid = [m('2026-09'), m('2026-10'), m('2026-11')];
    expect(chooseRentMonth({ date: d('2026-11-01'), unpaid, lateDays: 31 })).toEqual({
      status: 'review',
      reason: 'late',
    });
  });
  it('works across leap day and year end', () => {
    expect(
      chooseRentMonth({ date: d('2028-03-10'), unpaid: [m('2028-02')], lateDays: 10 }),
    ).toEqual({
      status: 'auto',
      month: '2028-02',
    });
    expect(
      chooseRentMonth({ date: d('2027-01-10'), unpaid: [m('2026-12')], lateDays: 10 }),
    ).toEqual({
      status: 'auto',
      month: '2026-12',
    });
  });
  it('with zero late days the previous month is late', () => {
    expect(chooseRentMonth({ date: d('2026-11-01'), unpaid: [m('2026-10')], lateDays: 0 })).toEqual(
      {
        status: 'review',
        reason: 'late',
      },
    );
  });
});
