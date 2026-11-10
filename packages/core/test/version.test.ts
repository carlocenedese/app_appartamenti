import { describe, expect, it } from 'vitest';
import type { Workspace } from '../src/model';
import { checkCompat, compareSemver } from '../src/version';

describe('compareSemver', () => {
  it('compares numerically, not as text', () => {
    expect(compareSemver('1.10.0', '1.9.0')).toBe(1);
    expect(compareSemver('1.9.0', '1.10.0')).toBe(-1);
    expect(compareSemver('1.0.10', '1.0.9')).toBe(1);
    expect(compareSemver('10.0.0', '9.99.99')).toBe(1);
  });

  it('returns 0 for equal versions', () => {
    expect(compareSemver('1.2.3', '1.2.3')).toBe(0);
    expect(compareSemver('0.0.0', '0.0.0')).toBe(0);
  });

  it('orders by major, then minor, then patch', () => {
    expect(compareSemver('2.0.0', '1.99.99')).toBe(1);
    expect(compareSemver('1.0.0', '2.0.0')).toBe(-1);
    expect(compareSemver('1.3.0', '1.2.99')).toBe(1);
    expect(compareSemver('1.2.0', '1.3.0')).toBe(-1);
    expect(compareSemver('1.2.4', '1.2.3')).toBe(1);
    expect(compareSemver('1.2.3', '1.2.4')).toBe(-1);
  });

  it('is antisymmetric', () => {
    const versions = ['0.1.0', '1.0.0', '1.0.1', '1.2.0', '1.10.0', '2.0.0'];
    for (const a of versions) {
      for (const b of versions) {
        expect(compareSemver(a, b)).toBe(-compareSemver(b, a) || 0);
      }
    }
  });

  it.each([
    '',
    '1',
    '1.2',
    '1.2.3.4',
    'v1.2.3',
    '1.2.x',
    '1..3',
    '-1.2.3',
    '1.-2.3',
    '1.2.3-beta.1',
    '1.2.3+build.5',
    '01.2.3',
    '1.02.3',
    '1.2.03',
    ' 1.2.3',
    '1.2.3 ',
    '1.2.3\n',
    '1.2.9007199254740993',
    '１.2.3',
  ])('throws a RangeError on the malformed version %j', (version) => {
    expect(() => compareSemver(version, '1.0.0')).toThrow(RangeError);
    expect(() => compareSemver('1.0.0', version)).toThrow(RangeError);
  });
});

describe('checkCompat', () => {
  const app = { version: '1.0.0', schemaVersion: 1 };

  function workspace(changes: Partial<Workspace> = {}): Workspace {
    return {
      workspaceId: 'ws-1',
      name: 'Appartamenti',
      schemaVersion: 1,
      minAppVersion: '1.0.0',
      createdAt: '2026-11-10T20:15:00.000Z',
      ...changes,
    };
  }

  it('is ok when the schema matches and the app is new enough', () => {
    expect(checkCompat(workspace(), app)).toBe('ok');
  });

  it('is ok when the app is newer than minAppVersion', () => {
    expect(checkCompat(workspace({ minAppVersion: '0.9.5' }), app)).toBe('ok');
    expect(checkCompat(workspace({ minAppVersion: '0.99.0' }), { ...app, version: '1.0.0' })).toBe(
      'ok',
    );
  });

  it('is readonly when the workspace needs a newer app than this one', () => {
    expect(checkCompat(workspace({ minAppVersion: '1.2.0' }), app)).toBe('readonly');
    expect(checkCompat(workspace({ minAppVersion: '1.0.1' }), app)).toBe('readonly');
    expect(checkCompat(workspace({ minAppVersion: '2.0.0' }), app)).toBe('readonly');
  });

  it('compares minAppVersion numerically', () => {
    expect(checkCompat(workspace({ minAppVersion: '1.10.0' }), { ...app, version: '1.9.0' })).toBe(
      'readonly',
    );
    expect(checkCompat(workspace({ minAppVersion: '1.9.0' }), { ...app, version: '1.10.0' })).toBe(
      'ok',
    );
  });

  it('is readonly when the workspace schema is newer than the app schema', () => {
    expect(checkCompat(workspace({ schemaVersion: 2 }), app)).toBe('readonly');
  });

  it('is upgrade-needed when the workspace schema is older than the app schema', () => {
    expect(checkCompat(workspace({ schemaVersion: 1 }), { ...app, schemaVersion: 2 })).toBe(
      'upgrade-needed',
    );
  });

  it('puts readonly before upgrade-needed', () => {
    // An older schema but a workspace that asks for a newer app: do not offer to upgrade.
    expect(
      checkCompat(workspace({ schemaVersion: 1, minAppVersion: '3.0.0' }), {
        version: '2.0.0',
        schemaVersion: 2,
      }),
    ).toBe('readonly');
  });

  it('is ok on a newer app with the same schema', () => {
    expect(checkCompat(workspace(), { version: '2.5.1', schemaVersion: 1 })).toBe('ok');
  });

  it('throws on a malformed version instead of guessing', () => {
    expect(() => checkCompat(workspace({ minAppVersion: '1.2' }), app)).toThrow(RangeError);
    expect(() => checkCompat(workspace(), { ...app, version: 'next' })).toThrow(RangeError);
  });

  it('only needs the two compatibility fields of the workspace', () => {
    expect(checkCompat({ schemaVersion: 1, minAppVersion: '1.0.0' }, app)).toBe('ok');
  });
});
