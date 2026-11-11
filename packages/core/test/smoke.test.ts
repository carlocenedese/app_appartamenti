import { describe, expect, it } from 'vitest';
import * as core from '../src/index';
import { CORE_VERSION } from '../src/index';

describe('core smoke test', () => {
  it('exposes the core version', () => {
    expect(CORE_VERSION).toBe('0.1.0');
  });

  it('exports the money, period, model, version and store API from the package entry point', () => {
    expect(Object.keys(core)).toEqual(
      expect.arrayContaining([
        'cents',
        'parseEuro',
        'formatEuro',
        'splitCents',
        'isoDate',
        'yearMonth',
        'monthsInPeriod',
        'addDays',
        'daysBetween',
        'annualitaOf',
        'annualitaRange',
        'addMonths',
        'settlementPeriods',
        'rateCoverage',
        'recordSchemas',
        'BillSchema',
        'WorkspaceSchema',
        'compareSemver',
        'checkCompat',
        'loadAll',
        'findWorkspace',
        'writeRecord',
        'recordPath',
        'assertSafeRelPath',
        'StaleWriteError',
        'MalformedJsonError',
        'expectedDebit',
      ]),
    );
  });
});
