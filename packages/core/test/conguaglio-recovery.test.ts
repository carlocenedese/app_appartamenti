// Recoveries from tenants in the settlement (plan 8, group B, task 8). Invented amounts: an
// extraordinary expense of 200,00 €, 150,01 € to recover from two tenants of a 4-bed apartment.
import { describe, expect, it } from 'vitest';
import { ExcelRecoveriesError, buildConguaglioWorkbook, calcConguaglio, cents } from '../src/index';
import type { ConguaglioInput, TenantRecovery } from '../src/index';
import { apartment, bill, instalment, match, period, tenancy } from './helpers/conguaglio-builders';
import { fixtureInput } from './helpers/excel-fixture';

const expense = instalment('str-1', {
  straordinaria: true,
  rateCount: 1,
  rata: cents(20000),
  coversFrom: '2026-11' as never,
  coversTo: '2026-11' as never,
});
const recovery = (extra: Partial<TenantRecovery> = {}): TenantRecovery => ({
  id: 'rec-1',
  v: 1,
  rev: 1,
  apartmentId: 'apt',
  instalmentId: 'str-1',
  amount: cents(15001),
  shares: [
    { tenantId: 'b', amount: cents(7501) },
    { tenantId: 'a', amount: cents(7500) },
  ],
  status: 'da-recuperare',
  periodLabel: '2026-27',
  ...extra,
});
const light = bill('luce', '2026-10-01', '2026-10-31', 4000);
const input = (extra: Partial<ConguaglioInput> = {}): ConguaglioInput => ({
  apartment: apartment(),
  period: period('2026-10', '2027-09', '2026-27'),
  bills: [light],
  instalments: [expense],
  matches: [match(light, 4000), match(expense, 20000)],
  tenancies: [tenancy('a', '2026-10', undefined), tenancy('b', '2026-10', undefined)],
  payments: [],
  ...extra,
});

describe('recoveries in calcConguaglio (plan 8, task 8, R197)', () => {
  it('without recoveries the result is identical, and with none of this period too', () => {
    const plain = calcConguaglio(input());
    expect(calcConguaglio(input({ recoveries: [] }))).toEqual(plain);
    expect(calcConguaglio(input({ recoveries: [recovery({ periodLabel: '2027-28' })] }))).toEqual(
      plain,
    );
    expect(calcConguaglio(input({ recoveries: [recovery({ periodLabel: undefined })] }))).toEqual(
      plain,
    );
    expect(
      calcConguaglio(input({ recoveries: [recovery({ status: 'non-recuperabile' })] })),
    ).toEqual(plain);
    expect(calcConguaglio(input({ recoveries: [recovery({ deleted: true })] }))).toEqual(plain);
    expect(calcConguaglio(input({ recoveries: [recovery({ apartmentId: 'altro' })] }))).toEqual(
      plain,
    );
    expect(plain.tenants.every((t) => !('recupero' in t))).toBe(true);
  });

  it('adds each share to the tenant chosen, as a line of its own and in the amount due', () => {
    const plain = calcConguaglio(input());
    for (const status of ['da-recuperare', 'recuperata'] as const) {
      const result = calcConguaglio(input({ recoveries: [recovery({ status })] }));
      const row = (id: string) => result.tenants.find((t) => t.tenantId === id);
      const before = (id: string) => plain.tenants.find((t) => t.tenantId === id);
      expect(row('a')?.recupero).toBe(7500);
      expect(row('b')?.recupero).toBe(7501);
      expect(row('a')?.due).toBe((before('a')?.due ?? 0) + 7500);
      expect(row('a')?.spese).toBe(before('a')?.spese);
      expect(result.unassigned).toBe(plain.unassigned);
    }
  });

  it('waits for the debit of the expense (R2): pending, nothing charged', () => {
    const result = calcConguaglio(
      input({ matches: [match(light, 4000)], recoveries: [recovery()] }),
    );
    expect(result.tenants.every((t) => t.recupero === undefined)).toBe(true);
    expect(result.pending).toContainEqual({
      itemType: 'instalment',
      itemId: 'str-1',
      reason: 'recupero in attesa del pagamento',
    });
  });

  it('refuses a tenant who is not in the period', () => {
    const away = recovery({
      amount: cents(100),
      shares: [{ tenantId: 'z', amount: cents(100) }],
    });
    expect(() => calcConguaglio(input({ recoveries: [away] }))).toThrow(
      expect.objectContaining({
        name: 'SettlementInputError',
        code: 'recovery-tenant-absent',
        tenantId: 'z',
      }),
    );
  });

  it("the tenants' Excel refuses a period with a recovery (question 10), not without", () => {
    const fixture = fixtureInput();
    expect(() => buildConguaglioWorkbook(fixture)).not.toThrow();
    const tenantId = calcConguaglio(fixture).tenants[0]?.tenantId ?? '';
    const str = instalment('str-x', {
      apartmentId: fixture.apartment.id,
      straordinaria: true,
      rateCount: 1,
      rata: cents(1000),
      coversFrom: fixture.period.from,
      coversTo: fixture.period.from,
    });
    const withRecovery = {
      ...fixture,
      instalments: [...fixture.instalments, str],
      matches: [...fixture.matches, match(str, 1000)],
      recoveries: [
        recovery({
          apartmentId: fixture.apartment.id,
          instalmentId: 'str-x',
          amount: cents(500),
          shares: [{ tenantId, amount: cents(500) }],
          periodLabel: fixture.period.label,
        }),
      ],
    };
    expect(() => buildConguaglioWorkbook(withRecovery)).toThrow(ExcelRecoveriesError);
  });
});
