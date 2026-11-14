import { describe, expect, it } from 'vitest';
import { normaliseIban } from '../src/iban';

describe('normaliseIban', () => {
  it('drops spaces, capitalises and checks mod-97', () => {
    expect(normaliseIban(' it60 x054 2811 1010 0000 0123 456 ')).toBe(
      'IT60X0542811101000000123456',
    );
  });

  it('refuses a changed digit, a wrong shape or an empty text', () => {
    expect(normaliseIban(`${'IT60X054281110100000012345'}7`)).toBeUndefined();
    expect(normaliseIban('IT60X05428')).toBeUndefined();
    expect(normaliseIban('60IT0542811101000000123456')).toBeUndefined();
    expect(normaliseIban('')).toBeUndefined();
  });

  it('works on other countries', () => {
    expect(normaliseIban('GB82 WEST 1234 5698 7654 32')).toBe('GB82WEST12345698765432');
  });
});
