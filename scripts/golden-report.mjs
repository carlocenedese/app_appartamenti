// Writes, for every golden fixture, the report of the differences between the Excel and the app
// (`pnpm golden:report`): reports/golden/<fixture>-differenze.md, in Italian, for Carlo to check
// and approve. For each tenant and category it gives the Excel amount (the `excel` field of the
// fixture), the app amount (`calcConguaglio`, condominium excluded as in the golden values) and the
// difference, then the known deviations with their reasons.
//
// The settlement runs on the TypeScript sources of packages/core, so the script runs through tsx.
// The output is deterministic; reports/golden is in .prettierignore and
// scripts/golden-report.test.mjs checks that the committed reports are up to date.

import { mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GoldenFixtureSchema,
  costsWithoutCondominio,
  settleGolden,
} from '../packages/core/src/golden.ts';
import { formatEuro } from '../packages/core/src/index.ts';

const DEFAULT_OUT_DIR = fileURLToPath(new URL('../reports/golden/', import.meta.url));
const GOLDEN_DIR = fileURLToPath(new URL('../fixtures/golden/', import.meta.url));

/** The file names of the golden fixtures, sorted. */
export function goldenFiles(dir = GOLDEN_DIR) {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort();
}

/** The fixture in `fixtures/golden/<name>`, checked against its schema. */
export function readGolden(name, dir = GOLDEN_DIR) {
  return GoldenFixtureSchema.parse(JSON.parse(readFileSync(join(dir, name), 'utf8')));
}

const CATEGORY_LABELS = {
  elettricita: 'Luce',
  gas: 'Gas',
  acqua: 'Acqua',
  internet: 'Internet',
  altro: 'Altro',
  tari: 'TARI',
};

const sum = (values) => values.reduce((total, value) => total + value, 0);
const euro = (amount) => (amount === undefined ? '—' : formatEuro(amount));
/** A difference: `+ € 4,23`, `- € 9,74`, `€ 0,00`. */
const signed = (amount) =>
  amount === undefined ? '—' : amount > 0 ? `+ ${formatEuro(amount)}` : formatEuro(amount);

/** The report file name of a fixture: `berchet-2024-25.json` gives `berchet-2024-25-differenze.md`. */
export function reportName(fixtureName) {
  return `${fixtureName.replace(/\.json$/, '')}-differenze.md`;
}

/** The Markdown report of one fixture. */
export function goldenReport(fixtureName, fixture) {
  const result = settleGolden(fixture);
  const excelOf = new Map((fixture.excel ?? []).map((row) => [row.tenantId, row.byCategory]));
  const lines = [
    `# Differenze tra Excel e app: ${fixtureName.replace(/\.json$/, '')}`,
    '',
    `Generato da \`pnpm golden:report\` da \`fixtures/golden/${fixtureName}\`: non modificarlo a mano.`,
    '',
    `Periodo ${fixture.period.label} (${fixture.period.from} – ${fixture.period.to}), ` +
      `${fixture.apartment.posti} posti. Valori dell'app approvati da: ${fixture.approvedBy}.`,
    'Condominio escluso (sezione 42, R3). Differenza = app − Excel.',
    '',
  ];
  if (fixture.excel === undefined) {
    lines.push('La fixture non riporta gli importi dell’Excel.', '');
  }
  lines.push(
    '## Spese per inquilino e voce',
    '',
    '| Inquilino | Voce | Excel | App | Differenza |',
    '| --- | --- | ---: | ---: | ---: |',
  );
  let excelTotal = 0;
  let appTotal = 0;
  const appOf = new Map(result.tenants.map((tenant) => [tenant.tenantId, tenant]));
  // Every tenant of either side: one the app does not know must not vanish from the report.
  const tenantIds = [...new Set([...appOf.keys(), ...excelOf.keys()])].sort();
  for (const tenantId of tenantIds) {
    const app = costsWithoutCondominio(appOf.get(tenantId)?.byCategory ?? {});
    const excel = excelOf.get(tenantId);
    const categories = Object.keys(CATEGORY_LABELS).filter(
      (category) => app[category] !== undefined || excel?.[category] !== undefined,
    );
    for (const category of categories) {
      const appAmount = app[category] ?? 0;
      const excelAmount = excel === undefined ? undefined : (excel[category] ?? 0);
      const difference = excelAmount === undefined ? undefined : appAmount - excelAmount;
      lines.push(
        `| ${tenantId} | ${CATEGORY_LABELS[category]} | ${euro(excelAmount)} | ` +
          `${euro(appAmount)} | ${signed(difference)} |`,
      );
    }
    const appSum = sum(Object.values(app));
    const excelSum = excel === undefined ? undefined : sum(Object.values(excel));
    appTotal += appSum;
    excelTotal += excelSum ?? 0;
    lines.push(
      `| ${tenantId} | **Totale** | ${euro(excelSum)} | ${euro(appSum)} | ` +
        `${signed(excelSum === undefined ? undefined : appSum - excelSum)} |`,
    );
  }
  lines.push(
    '',
    '## Dovuto per inquilino (app)',
    '',
    'Dovuto = spese − forfait incassato (negativo: da restituire).',
    '',
    '| Inquilino | Spese | Forfait incassato | Dovuto |',
    '| --- | ---: | ---: | ---: |',
  );
  for (const tenantId of tenantIds) {
    const tenant = appOf.get(tenantId);
    lines.push(
      tenant === undefined
        ? `| ${tenantId} | — | — | — |`
        : `| ${tenantId} | ${euro(sum(Object.values(costsWithoutCondominio(tenant.byCategory))))} | ` +
            `${euro(tenant.forfaitIncassato)} | ${euro(tenant.due)} |`,
    );
  }
  lines.push(
    '',
    '## Totali',
    '',
    `- App: ${formatEuro(appTotal)}; posti vuoti: ${formatEuro(result.unassigned)}.`,
  );
  if (fixture.excel !== undefined) {
    lines.push(
      `- Excel: ${formatEuro(excelTotal)}.`,
      `- Differenza: ${signed(appTotal - excelTotal)}.`,
    );
  }
  lines.push('', '## Scostamenti noti', '');
  fixture.knownDeviations.forEach(({ what, why }, index) => {
    lines.push(`${index + 1}. **${what}.** ${why}`);
  });
  return `${lines.join('\n')}\n`;
}

/** Writes the report of every golden fixture into `outDir`; returns the names of the files. */
export function writeGoldenReports(outDir = DEFAULT_OUT_DIR) {
  mkdirSync(outDir, { recursive: true });
  return goldenFiles().map((name) => {
    const file = reportName(name);
    writeFileSync(join(outDir, file), goldenReport(name, readGolden(name)), 'utf8');
    return file;
  });
}

function main() {
  const written = writeGoldenReports();
  console.log(`Wrote ${written.length} golden report(s) to reports/golden.`);
}

const isEntryPoint =
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isEntryPoint) main();
