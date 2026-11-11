import { describe, expect, it } from 'vitest';
import { ALLOWED_LICENSES, findDisallowedLicenses, isLicenseAllowed } from './check-licenses.mjs';

describe('allowed list', () => {
  it('matches the list in the global constraints (spec section 40)', () => {
    expect([...ALLOWED_LICENSES].sort()).toEqual(
      [
        '0BSD',
        'Apache-2.0',
        'BSD-2-Clause',
        'BSD-3-Clause',
        'BlueOak-1.0.0',
        'CC0-1.0',
        'ISC',
        'MIT',
        'Unicode-3.0',
        'Unlicense',
        'Zlib',
      ].sort(),
    );
  });
});

describe('isLicenseAllowed', () => {
  it.each([
    'MIT',
    'Apache-2.0',
    'BSD-2-Clause',
    'BSD-3-Clause',
    'ISC',
    '0BSD',
    'CC0-1.0',
    'Unlicense',
    'BlueOak-1.0.0',
    'Unicode-3.0',
    'Zlib',
  ])('accepts the single allowed licence %s', (expression) => {
    expect(isLicenseAllowed(expression)).toBe(true);
  });

  it('accepts (MIT OR CC0-1.0)', () => {
    expect(isLicenseAllowed('(MIT OR CC0-1.0)')).toBe(true);
  });

  it('accepts MIT OR GPL-3.0 because one allowed option is enough', () => {
    expect(isLicenseAllowed('MIT OR GPL-3.0')).toBe(true);
  });

  it('rejects (MIT AND GPL-3.0) because every part must be allowed', () => {
    expect(isLicenseAllowed('(MIT AND GPL-3.0)')).toBe(false);
  });

  it('rejects GPL-3.0-only', () => {
    expect(isLicenseAllowed('GPL-3.0-only')).toBe(false);
  });

  it.each(['GPL-3.0', 'GPL-2.0-or-later', 'AGPL-3.0-only', 'LGPL-2.1', 'LGPL-3.0-or-later'])(
    'rejects the copyleft licence %s',
    (expression) => {
      expect(isLicenseAllowed(expression)).toBe(false);
    },
  );

  it('rejects licences that are not on the list even when permissive in practice', () => {
    expect(isLicenseAllowed('MPL-2.0')).toBe(false);
    expect(isLicenseAllowed('CC-BY-4.0')).toBe(false);
    expect(isLicenseAllowed('Python-2.0')).toBe(false);
  });

  it('accepts (MIT AND Apache-2.0) when all parts are allowed', () => {
    expect(isLicenseAllowed('(MIT AND Apache-2.0)')).toBe(true);
  });

  it('gives AND priority over OR', () => {
    expect(isLicenseAllowed('MIT OR GPL-3.0 AND LGPL-2.1')).toBe(true);
    expect(isLicenseAllowed('GPL-3.0 AND MIT OR GPL-2.0')).toBe(false);
  });

  it('handles nested parentheses', () => {
    expect(isLicenseAllowed('((MIT OR GPL-3.0) AND (ISC OR AGPL-3.0))')).toBe(true);
    expect(isLicenseAllowed('(MIT OR GPL-3.0) AND LGPL-2.1')).toBe(false);
    expect(isLicenseAllowed('(GPL-3.0 OR (AGPL-3.0 AND MIT))')).toBe(false);
  });

  it('judges a WITH exception by its base licence', () => {
    expect(isLicenseAllowed('GPL-2.0-only WITH Classpath-exception-2.0')).toBe(false);
    expect(isLicenseAllowed('Apache-2.0 WITH LLVM-exception')).toBe(true);
    expect(isLicenseAllowed('(MIT OR GPL-2.0 WITH Classpath-exception-2.0)')).toBe(true);
  });

  it('judges the "or later" suffix by its base licence', () => {
    expect(isLicenseAllowed('Apache-2.0+')).toBe(true);
    expect(isLicenseAllowed('GPL-3.0+')).toBe(false);
  });

  it('ignores case and surrounding whitespace', () => {
    expect(isLicenseAllowed('  mit  ')).toBe(true);
    expect(isLicenseAllowed('mit or gpl-3.0')).toBe(true);
    expect(isLicenseAllowed('(mit and gpl-3.0)')).toBe(false);
  });

  it.each([
    '',
    '   ',
    'Unknown',
    'UNLICENSED',
    'SEE LICENSE IN LICENSE.txt',
    'MIT AND',
    'OR MIT',
    '(MIT',
    'MIT)',
    '()',
    'MIT MIT',
    'MIT OR OR ISC',
    'WITH MIT',
    'MIT WITH',
  ])('rejects the unknown or malformed expression "%s"', (expression) => {
    expect(isLicenseAllowed(expression)).toBe(false);
  });

  it('rejects values that are not strings', () => {
    expect(isLicenseAllowed(undefined)).toBe(false);
    expect(isLicenseAllowed(null)).toBe(false);
    expect(isLicenseAllowed(42)).toBe(false);
  });
});

describe('findDisallowedLicenses', () => {
  const report = {
    MIT: [{ name: 'left-pad', versions: ['1.3.0'] }],
    '(MIT OR CC0-1.0)': [{ name: 'dual', versions: ['2.0.0'] }],
    'GPL-3.0-only': [
      { name: 'copyleft', versions: ['1.0.0', '1.1.0'] },
      { name: '@scope/other', versions: ['3.0.0'] },
    ],
    '(MIT AND GPL-3.0)': [{ name: 'mixed', versions: ['0.1.0'] }],
  };

  it('lists every package whose licence is not allowed, with its versions', () => {
    expect(findDisallowedLicenses(report)).toEqual([
      {
        license: 'GPL-3.0-only',
        packages: ['copyleft@1.0.0', 'copyleft@1.1.0', '@scope/other@3.0.0'],
      },
      { license: '(MIT AND GPL-3.0)', packages: ['mixed@0.1.0'] },
    ]);
  });

  it('returns nothing when all licences are allowed', () => {
    expect(
      findDisallowedLicenses({ MIT: report.MIT, '(MIT OR CC0-1.0)': report['(MIT OR CC0-1.0)'] }),
    ).toEqual([]);
  });

  it('treats an empty report as suspicious and says so', () => {
    expect(() => findDisallowedLicenses({})).toThrow(/no packages/i);
  });
});
