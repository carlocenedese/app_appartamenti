import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { goldenFiles, readGolden } from '../packages/core/test/helpers/golden.ts';
import { goldenReport, reportName, writeGoldenReports } from './golden-report.mjs';

const COMMITTED = fileURLToPath(new URL('../reports/golden/', import.meta.url));

let root;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'golden-report-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('golden report', () => {
  it('writes one report per fixture, named after it', () => {
    const outDir = join(root, 'nested');
    const written = writeGoldenReports(outDir);
    expect(written).toEqual(goldenFiles().map(reportName));
    expect(readdirSync(outDir).sort()).toEqual([...written].sort());
  });

  it('keeps the committed reports up to date (run pnpm golden:report)', () => {
    for (const name of goldenFiles()) {
      const committed = readFileSync(join(COMMITTED, reportName(name)), 'utf8');
      expect(committed).toBe(goldenReport(name, readGolden(name).fixture));
    }
  });

  it('gives Excel, app and difference per tenant and category, then the known deviations', () => {
    const { fixture } = readGolden('berchet-2024-25.json');
    const report = goldenReport('berchet-2024-25.json', fixture);
    expect(report).toContain('| ten-a | Luce | € 74,20 | € 73,75 | - € 0,45 |');
    expect(report).toContain('| ten-a | **Totale** | € 159,83 | € 150,09 | - € 9,74 |');
    expect(report).toContain('- App: € 1.228,33; posti vuoti: € 0,00.');
    expect(report).toContain('- Excel: € 1.265,81.');
    expect(report).toContain('1. **Commissione bancaria di 0,80 € per bolletta.**');
  });

  it('shows a dash where the fixture has no Excel amounts', () => {
    const { fixture } = readGolden('berchet-2024-25.json');
    const report = goldenReport('prova-2024-25.json', { ...fixture, excel: undefined });
    expect(report).toContain('La fixture non riporta gli importi dell’Excel.');
    expect(report).toContain('| ten-a | Luce | — | € 73,75 | — |');
    expect(report).not.toContain('- Excel:');
  });
});
