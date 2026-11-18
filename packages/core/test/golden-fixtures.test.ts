// Golden fixtures (Task 7 of plan 1): anonymised apartments and lease years whose `expected`
// values user1 checked against the real Excel files. The settlement engine of Task 9 must
// reproduce them; this file only checks that every fixture is well formed, free of personal data
// and consistent with itself. The rules behind the values are in docs/rules/conguaglio-rules.md.
import { describe, expect, it } from 'vitest';
import {
  allocateBillToMonths,
  cents,
  isoDate,
  matchToTransactions,
  monthsInPeriod,
  splitCents,
} from '../src/index';
import { goldenFiles, readGolden } from './helpers/golden';

/** Matching window decided by user1 (R30): 5 days before to 10 days after the due date. */
const WINDOW = { daysBefore: 5, daysAfter: 10 };

// The patterns of Task 7, step 5. pnpm data:check runs stricter checks on every tracked file.
const PERSONAL_DATA = [
  { name: 'IBAN', pattern: /IT\d{2}[A-Z]\d{10}/ },
  { name: 'codice fiscale', pattern: /[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]/ },
  { name: 'POD', pattern: /IT\d{3}E\d{8}/ },
];

const files = goldenFiles();

const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);

describe('golden fixtures', () => {
  it('there is at least one, named <apartment>-<lease year>.json', () => {
    expect(files.length).toBeGreaterThan(0);
    for (const name of files) expect(name).toMatch(/^[a-z]+-\d{4}-\d{2}\.json$/);
  });

  describe.each(files)('%s', (name) => {
    const { text, fixture } = readGolden(name);
    const apartmentId = fixture.apartment.id;
    const tenantIds = fixture.tenancies.map((tenancy) => tenancy.tenantId);

    it('contains no string shaped like an IBAN, a codice fiscale or a POD', () => {
      for (const { name: kind, pattern } of PERSONAL_DATA) {
        expect(pattern.test(text), kind).toBe(false);
      }
    });

    it('has a period inside the contract, named after the file', () => {
      const { period, contract } = fixture;
      expect(contract.apartmentId).toBe(apartmentId);
      expect(period.from <= period.to).toBe(true);
      expect(contract.start <= period.from && period.to <= contract.end).toBe(true);
      expect(name.endsWith(`-${period.label}.json`)).toBe(true);
    });

    it('keeps every record on this apartment, with unique ids', () => {
      const records = [
        ...fixture.bills,
        ...fixture.instalments,
        ...fixture.payments,
        ...fixture.transactions,
        ...fixture.tenancies,
      ];
      for (const record of records) expect(record.apartmentId).toBe(apartmentId);
      const ids = [...records, ...fixture.matches].map((record) => record.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('refers only to tenants, items and movements it contains', () => {
      for (const payment of fixture.payments) expect(tenantIds).toContain(payment.tenantId);
      const expectedIds = fixture.expected.map((row) => row.tenantId);
      expect([...expectedIds].sort()).toEqual([...new Set(tenantIds)].sort());
      if (fixture.excel !== undefined) {
        const excelIds = fixture.excel.map((row) => row.tenantId);
        expect([...excelIds].sort()).toEqual([...expectedIds].sort());
      }
      const items = new Set([
        ...fixture.bills.map((bill) => `bill:${bill.id}`),
        ...fixture.instalments.map((instalment) => `instalment:${instalment.id}`),
      ]);
      const transactions = new Set(fixture.transactions.map((transaction) => transaction.id));
      for (const match of fixture.matches) {
        expect(items.has(`${match.itemType}:${match.itemId}`)).toBe(true);
        if (match.by !== 'assumed') expect(transactions.has(match.transactionId)).toBe(true);
      }
    });

    // Without statements the matching step no longer takes any item as paid (B1, 18 Nov 2026):
    // every item is to verify. The fixture keeps the `assumed` matches the step produced before
    // B1, as stored records: they are still read, and the golden values rest on them.
    it.skipIf(fixture.transactions.length > 0)(
      'records, as matches stored before B1, the items the matching step now leaves to verify',
      () => {
        const result = matchToTransactions({
          bills: fixture.bills,
          instalments: fixture.instalments,
          transactions: [],
          window: WINDOW,
          statementPeriods: [],
          existing: [],
        });
        expect(result.matches).toEqual([]);
        expect(fixture.matches.every((m) => m.by === 'assumed')).toBe(true);
        expect(result.unverified.map((ref) => ref.itemId).sort()).toEqual(
          [...new Set(fixture.matches.map((m) => m.itemId))].sort(),
        );
        expect(result.pending.map((ref) => ref.itemId).sort()).toEqual(
          [...fixture.expectedPending].sort(),
        );
      },
    );

    it('names its beds in order, and every tenancy uses one of them (R30)', () => {
      const rooms = fixture.apartment.rooms ?? [];
      expect(rooms).toHaveLength(fixture.apartment.posti);
      for (const tenancy of fixture.tenancies) expect(rooms).toContain(tenancy.room);
    });

    it('shares out exactly the part of each bill and TARI notice inside the period', () => {
      // A bill is split over its months by days (B2), a TARI notice equally over its months,
      // remainders to the first months; only the months of the period count. byCategory leaves
      // out categories with nothing in them.
      const inPeriod = (amount: number, from: string, to: string): number => {
        const months = monthsInPeriod(isoDate(`${from}-01`), isoDate(`${to}-01`));
        const parts = splitCents(
          cents(amount),
          months.map(() => 1),
        );
        const inside = months.map((m) => fixture.period.from <= m && m <= fixture.period.to);
        return sum(parts.filter((_, i) => inside[i] === true));
      };
      const costs =
        sum(
          fixture.bills.flatMap((b) =>
            allocateBillToMonths(b)
              .filter((s) => fixture.period.from <= s.month && s.month <= fixture.period.to)
              .map((s) => s.amount),
          ),
        ) +
        sum(
          fixture.instalments
            .filter((i) => i.kind === 'tari')
            .map((i) => inPeriod(i.rata, i.coversFrom, i.coversTo)),
        );
      const shared = sum(
        fixture.expected.flatMap((row) =>
          Object.entries(row.byCategory)
            .filter(([category]) => category !== 'condominio')
            .map(([, amount]) => amount),
        ),
      );
      expect(shared + fixture.expectedUnassigned).toBe(costs);
      for (const row of fixture.expected) {
        for (const amount of Object.values(row.byCategory)) expect(amount).not.toBe(0);
      }
    });

    it('collects the flat charge from the payments: rent first, then the flat charge (R4)', () => {
      const months = monthsInPeriod(
        isoDate(`${fixture.period.from}-01`),
        isoDate(`${fixture.period.to}-01`),
      );
      for (const row of fixture.expected) {
        let collected = 0;
        for (const tenancy of fixture.tenancies.filter((t) => t.tenantId === row.tenantId)) {
          for (const month of months) {
            if (month < tenancy.from || (tenancy.to !== undefined && month > tenancy.to)) continue;
            const paid = sum(
              fixture.payments
                .filter((p) => p.tenantId === row.tenantId && p.confirmed && p.kind === 'canone')
                .filter((p) => (p.forMonth ?? p.date.slice(0, 7)) === month)
                .map((p) => p.amount),
            );
            collected += Math.min(Math.max(paid - tenancy.monthlyRent, 0), tenancy.monthlyForfait);
          }
        }
        expect(row.forfaitIncassato, row.tenantId).toBe(collected);
      }
    });

    // Only fixtures whose bills are all assumed paid: no commission can apply (R7), and the
    // condominium is excluded from expected (Task 7), so the costs are exactly byCategory.
    it.skipIf(fixture.matches.some((match) => match.by !== 'assumed'))(
      'has a due amount equal to the costs minus the flat charge collected',
      () => {
        for (const row of fixture.expected) {
          expect(row.byCategory.condominio, row.tenantId).toBeUndefined();
          expect(row.due, row.tenantId).toBe(
            sum(Object.values(row.byCategory)) - row.forfaitIncassato,
          );
        }
      },
    );

    it('documents every deviation from the Excel and who approved the values', () => {
      expect(fixture.knownDeviations.length).toBeGreaterThan(0);
      // A fixture waits as «da approvare» until user1 checks its values (Task 7, step 6).
      expect(fixture.approvedBy.trim()).not.toBe('');
      expect(fixture.approvedBy).not.toBe('da approvare');
    });
  });
});
