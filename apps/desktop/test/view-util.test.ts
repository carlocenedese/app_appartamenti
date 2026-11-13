import { describe, expect, it } from 'vitest';
import { formatPercent, parsePercent, saveErrorMessage } from '../src/view-util';

describe('parsePercent', () => {
  it.each([
    ['33,33', 3333],
    ['33.33', 3333],
    ['100', 10000],
    ['0,5', 50],
    ['12,05', 1205],
    [' 7 ', 700],
    ['', 0],
  ])('reads %j as %j basis points', (text, expected) => {
    expect(parsePercent(text)).toBe(expected);
  });

  it.each(['33,333', 'abc', '-5', '1,2,3', '1000', '33,', ',5', '1e2'])('rejects %j', (text) => {
    expect(parsePercent(text)).toBeUndefined();
  });
});

describe('formatPercent', () => {
  it('writes two decimals with a comma', () => {
    expect(formatPercent(3333)).toBe('33,33%');
    expect(formatPercent(10000)).toBe('100,00%');
    expect(formatPercent(5)).toBe('0,05%');
  });
});

describe('saveErrorMessage', () => {
  it('names the stale write and hides every other error', () => {
    const stale = Object.assign(new Error('rev 3 vs 4'), { name: 'StaleWriteError' });
    expect(saveErrorMessage(stale)).toBe(
      "Un'altra persona ha cambiato questa utenza. Ricarica e riprova.",
    );
    expect(saveErrorMessage(new Error('secret path /x'))).toBe('Non è stato possibile salvare.');
    expect(saveErrorMessage('boh')).toBe('Non è stato possibile salvare.');
  });
});
