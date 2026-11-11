// Golden settlement test (Task 9, step 4): `calcConguaglio` on every fixture of fixtures/golden
// must give, to the cent, the values Carlo approved (`expected`, `expectedUnassigned`,
// `expectedPending`), condominium excluded. Where the app and the Excel disagree, the fixture must
// document why in `knownDeviations`; `pnpm golden:report` lists the differences one by one.
import { describe, expect, it } from 'vitest';
import { condominioYearChecks, costsWithoutCondominio, settleGolden } from '../src/golden';
import { cents, rateCoverage, yearMonth } from '../src/index';
import { apartment, instalment, match, tenancy } from './helpers/conguaglio-builders';
import { goldenFiles, readGolden } from './helpers/golden';

describe.each(goldenFiles())('golden settlement %s', (name) => {
  const { fixture } = readGolden(name);
  const result = settleGolden(fixture);

  it('lists the same tenants as the approved values', () => {
    expect(result.tenants.map((t) => t.tenantId)).toEqual(
      fixture.expected.map((row) => row.tenantId).sort(),
    );
  });

  it.each(fixture.expected.map((row) => [row.tenantId, row] as const))(
    'reproduces %s to the cent',
    (tenantId, expected) => {
      const actual = result.tenants.find((t) => t.tenantId === tenantId);
      expect(actual).toBeDefined();
      expect({
        tenantId: actual?.tenantId,
        due: actual?.due,
        forfaitIncassato: actual?.forfaitIncassato,
        byCategory: costsWithoutCondominio(actual?.byCategory ?? {}),
      }).toEqual(expected);
    },
  );

  it('leaves the approved amount to the empty beds and the approved items pending', () => {
    expect(result.unassigned).toBe(fixture.expectedUnassigned);
    expect(result.pending.map((item) => item.itemId).sort()).toEqual(
      [...fixture.expectedPending].sort(),
    );
  });

  it.skipIf(fixture.excel === undefined)('documents every difference from the Excel', () => {
    const differences = (fixture.excel ?? []).flatMap((excelRow) => {
      const app = costsWithoutCondominio(
        result.tenants.find((t) => t.tenantId === excelRow.tenantId)?.byCategory ?? {},
      );
      const categories = new Set([...Object.keys(app), ...Object.keys(excelRow.byCategory)]);
      return [...categories].filter(
        (category) => (app[category] ?? 0) !== (excelRow.byCategory[category] ?? 0),
      );
    });
    if (differences.length > 0) expect(fixture.knownDeviations.length).toBeGreaterThan(0);
  });

  // Step 4b: with every condominium instalment matched, each fiscal year settled over its own
  // months gives the tenants and the empty beds exactly the tenants' quota of the budget plus last
  // year's settlement. No fixture has condominium instalments yet (conguaglio-rules.md, (f)).
  const hasCondominio = fixture.instalments.some((i) => i.kind === 'condominio');
  it.skipIf(!hasCondominio)('closes every condominium year without a cent lost', () => {
    for (const check of condominioYearChecks(fixture)) {
      expect(check.pending, check.esercizio).toEqual([]);
      expect(check.shared, check.esercizio).toBe(check.budget);
    }
  });
});

describe('condominium year-end check (Step 4b) on a synthetic year', () => {
  // A lease year from October and a condominium year from May, with an empty bed for 9 months
  // and a record that carries only last year's settlement (and the owner's yearly 24,00 €).
  const apt = apartment({ posti: 4, condominioStart: { month: 5, day: 1 } });
  const tenancies = [
    tenancy('a', '2026-01', undefined),
    tenancy('b', '2026-01', undefined),
    tenancy('c', '2026-01', undefined),
    tenancy('d', '2026-01', '2026-07'),
  ];
  const ordinary = [1, 2, 3, 4].map((index) => {
    const coverage = rateCoverage(yearMonth('2026-05'), 4, index);
    return instalment(`cond-${index}`, {
      rateIndex: index,
      rateCount: 4,
      rata: cents(15001),
      quotaProprieta: cents(2400),
      coversFrom: coverage.from,
      coversTo: coverage.to,
    });
  });
  const previous = instalment('cond-prec', {
    rata: cents(0),
    quotaProprieta: cents(2400),
    conguaglioPrec: cents(4801),
  });
  const items = [...ordinary, previous];

  it('settles the fiscal year over its own months, not the lease year', () => {
    const checks = condominioYearChecks({
      apartment: apt,
      instalments: items,
      matches: items.map((item) => match(item, item.rata + item.conguaglioPrec)),
      tenancies,
    });
    expect(checks).toEqual([
      { esercizio: '2026-27', pending: [], shared: 4 * 15001 - 2400 + 4801, budget: 62405 },
    ]);
  });

  it('shows an unmatched instalment as pending', () => {
    const [check] = condominioYearChecks({
      apartment: apt,
      instalments: items,
      matches: [match(previous, 4801)],
      tenancies,
    });
    expect(check?.pending).toEqual(['cond-1', 'cond-2', 'cond-3', 'cond-4']);
    expect(check?.shared).not.toBe(check?.budget);
  });
});
