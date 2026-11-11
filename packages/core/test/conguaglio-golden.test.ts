// Golden settlement test (Task 9, step 4): `calcConguaglio` on every fixture of fixtures/golden
// must give, to the cent, the values Carlo approved (`expected`, `expectedUnassigned`,
// `expectedPending`), condominium excluded. Where the app and the Excel disagree, the fixture must
// document why in `knownDeviations`; `pnpm golden:report` lists the differences one by one.
import { describe, expect, it } from 'vitest';
import { calcConguaglio, cents } from '../src/index';
import type { Instalment } from '../src/index';
import { costsWithoutCondominio, goldenFiles, readGolden, settleGolden } from './helpers/golden';

const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);

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

  // Step 4b: with every condominium instalment matched, the tenants' shares plus the empty beds
  // equal the tenants' quota of the budget (instalments minus the owner's yearly share) plus last
  // year's settlement. No fixture has condominium instalments yet (conguaglio-rules.md, (f)).
  const condominio = fixture.instalments.filter(
    (instalment) => instalment.kind === 'condominio' && instalment.straordinaria !== true,
  );
  it.skipIf(condominio.length === 0)('closes the condominium year without a cent lost', () => {
    const settled = calcConguaglio({
      apartment: fixture.apartment,
      period: fixture.period,
      bills: [],
      instalments: condominio,
      matches: fixture.matches.filter((m) => m.part === 'amount'),
      tenancies: fixture.tenancies,
      payments: [],
    });
    expect(settled.pending).toEqual([]);
    const byEsercizio = new Map<string, Instalment[]>();
    for (const item of condominio) {
      byEsercizio.set(item.esercizio, [...(byEsercizio.get(item.esercizio) ?? []), item]);
    }
    const budget = sum(
      [...byEsercizio.values()].map(
        (items) =>
          sum(items.map((i) => i.rata + i.conguaglioPrec)) - (items[0]?.quotaProprieta ?? 0),
      ),
    );
    const shares = sum(settled.tenants.map((t) => t.condominio.rata + t.condominio.conguaglioPrec));
    expect(cents(shares + settled.unassigned)).toBe(budget);
  });
});
