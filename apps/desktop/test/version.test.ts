import { CORE_VERSION } from '@bollette/core';
import { describe, expect, it } from 'vitest';
import { renderVersion, showVersion } from '../src/main';

describe('renderVersion', () => {
  it('names the app and the engine version', () => {
    expect(renderVersion()).toBe(`App Bollette, motore ${CORE_VERSION}`);
  });

  it('contains the version exported by the core', () => {
    expect(renderVersion()).toContain(CORE_VERSION);
  });
});

describe('showVersion', () => {
  it('writes the version text into the element', () => {
    const element = { textContent: '' };
    showVersion(element);
    expect(element.textContent).toBe(renderVersion());
  });

  it('replaces whatever the element showed before', () => {
    const element = { textContent: 'Caricamento…' };
    showVersion(element);
    expect(element.textContent).toBe(renderVersion());
  });
});
