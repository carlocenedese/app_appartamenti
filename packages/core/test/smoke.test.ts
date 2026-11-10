import { describe, expect, it } from 'vitest';
import { CORE_VERSION } from '../src/index';

describe('core smoke test', () => {
  it('exposes the core version', () => {
    expect(CORE_VERSION).toBe('0.1.0');
  });
});
