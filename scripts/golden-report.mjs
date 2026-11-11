// Writes, for every golden fixture, the report of the differences between the Excel and the app
// (`pnpm golden:report`): reports/golden/<fixture>-differenze.md, in Italian, for Carlo to check
// and approve. For each tenant and category it gives the Excel amount (the `excel` field of the
// fixture), the app amount (`calcConguaglio`, condominium excluded as in the golden values) and the
// difference, then the known deviations with their reasons.
//
// The settlement runs on the TypeScript sources of packages/core, so the script runs through tsx.
// The output is deterministic; reports/golden is in .prettierignore and
// scripts/golden-report.test.mjs checks that the committed reports are up to date.

import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatEuro } from '../packages/core/src/index.ts';
import {
  costsWithoutCondominio,
  goldenFiles,
  readGolden,
  settleGolden,
} from '../packages/core/test/helpers/golden.ts';

const DEFAULT_OUT_DIR = fileURLToPath(new URL('../reports/golden/', import.meta.url));

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
  for (const tenant of result.tenants) {
    const app = costsWithoutCondominio(tenant.byCategory);
    const excel = excelOf.get(tenant.tenantId);
    const categories = Object.keys(CATEGORY_LABELS).filter(
      (category) => app[category] !== undefined || excel?.[category] !== undefined,
    );
    for (const category of categories) {
      const appAmount = app[category] ?? 0;
      const excelAmount = excel === undefined ? undefined : (excel[category] ?? 0);
      const difference = excelAmount === undefined ? undefined : appAmount - excelAmount;
      lines.push(
        `| ${tenant.tenantId} | ${CATEGORY_LABELS[category]} | ${euro(excelAmount)} | ` +
          `${euro(appAmount)} | ${euro(difference)} |`,
      );
    }
    const appSum = sum(Object.values(app));
    const excelSum = excel === undefined ? undefined : sum(Object.values(excel));
    appTotal += appSum;
    excelTotal += excelSum ?? 0;
    lines.push(
      `| ${tenant.tenantId} | **Totale** | ${euro(excelSum)} | ${euro(appSum)} | ` +
        `${euro(excelSum === undefined ? undefined : appSum - excelSum)} |`,
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
      `- Differenza: ${formatEuro(appTotal - excelTotal)}.`,
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
    writeFileSync(join(outDir, file), goldenReport(name, readGolden(name).fixture), 'utf8');
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
