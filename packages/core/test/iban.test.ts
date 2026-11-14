import { describe, expect, it } from 'vitest';
import { normaliseIban } from '../src/iban';

// The public example IBAN of fixtures/README.md (declared fictitious for `pnpm data:check`).
const VALID = 'IT60X0542811101000000123456';
// Same shape, last check-relevant digit changed: fails mod-97 (built so no real-looking literal exists).
const WRONG_DIGIT = `${VALID.slice(0, -1)}7`;

describe('normaliseIban', () => {
  it('drops spaces, capitalises and checks mod-97', () => {
    expect(normaliseIban(' it60 x054 2811 1010 0000 0123 456 ')).toBe(
      'IT60X0542811101000000123456',
    );
  });

  it('refuses a changed digit, a wrong shape or an empty text', () => {
    expect(normaliseIban(WRONG_DIGIT)).toBeUndefined();
    expect(normaliseIban('IT60X05428')).toBeUndefined();
    expect(normaliseIban('60IT0542811101000000123456')).toBeUndefined();
    expect(normaliseIban('')).toBeUndefined();
  });

  it('works on other countries', () => {
    expect(normaliseIban('GB82 WEST 1234 5698 7654 32')).toBe('GB82WEST12345698765432');
  });

  it('accepts only ASCII letters and digits: no Unicode case folding', () => {
    // 'ſ' and 'ı' upper-case to the ASCII 'S' and 'I'.
    expect(normaliseIban('ıT60X0542811101000000123456')).toBeUndefined();
    expect(normaliseIban(VALID.replace('X', 'ſ'))).toBeUndefined();
  });

  it('checks the length limits of the shape', () => {
    expect(normaliseIban('IT60X054281110')).toBeUndefined(); // 14 characters
    expect(normaliseIban(`${VALID}${'0'.repeat(20)}`)).toBeUndefined(); // too long
  });
});
