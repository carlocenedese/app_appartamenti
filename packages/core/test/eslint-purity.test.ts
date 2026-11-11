import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// The ESLint rules that keep packages/core/src pure. They are checked here against probe
// snippets, so that a change to eslint.config.mjs cannot silently let a forbidden call through.

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const SRC_PROBE = 'packages/core/src/probe.ts';

const eslint = new ESLint({ cwd: ROOT, overrideConfigFile: join(ROOT, 'eslint.config.mjs') });

async function restrictedRules(code: string, file: string = SRC_PROBE): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: join(ROOT, file) });
  return (result?.messages ?? [])
    .map((message) => message.ruleId ?? 'parse-error')
    .filter((ruleId) => ruleId.startsWith('no-restricted-') || ruleId === 'parse-error');
}

describe('ESLint purity rules for packages/core/src', () => {
  it.each([
    ["export const r = fetch('https://example.org');", 'no-restricted-globals'],
    ['export const x = new XMLHttpRequest();', 'no-restricted-globals'],
    ["export const s = new WebSocket('wss://example.org');", 'no-restricted-globals'],
    ["export const r = globalThis.fetch('https://example.org');", 'no-restricted-properties'],
    [
      "import { readFileSync } from 'node:fs';\nexport const f = readFileSync;",
      'no-restricted-imports',
    ],
    ["import http from 'http';\nexport const h = http;", 'no-restricted-imports'],
    ["import https from 'https';\nexport const h = https;", 'no-restricted-imports'],
    ["import net from 'net';\nexport const n = net;", 'no-restricted-imports'],
    ["import { join } from 'path';\nexport const j = join;", 'no-restricted-imports'],
    ["export const m = import('node:fs/promises');", 'no-restricted-syntax'],
    ["export const m = import('fs/promises');", 'no-restricted-syntax'],
    ['export const now = Date.now();', 'no-restricted-properties'],
    ['export const now = new Date();', 'no-restricted-syntax'],
    ['export const now = Date();', 'no-restricted-syntax'],
    ['export const r = Math.random();', 'no-restricted-properties'],
    ['export const id = crypto.randomUUID();', 'no-restricted-properties'],
    ['export const id = globalThis.crypto.randomUUID();', 'no-restricted-properties'],
    ['export const bytes = crypto.getRandomValues(new Uint8Array(4));', 'no-restricted-properties'],
    ['export const e = process.env.HOME;', 'no-restricted-globals'],
  ])('rejects %s', async (code, ruleId) => {
    expect(await restrictedRules(code)).toContain(ruleId);
  });

  it.each([
    'export const d = new Date(Date.UTC(2026, 7, 1));',
    'export const d = (ms: number) => new Date(ms);',
    'export const digest = (data: Uint8Array) => crypto.subtle.digest("SHA-256", data);',
    'export const t = Date.UTC(2026, 0, 1);',
    "import { z } from 'zod';\nexport const s = z;",
    "import { a } from './a';\nexport const b = a;",
    "export const lazy = () => import('./a');",
  ])('accepts %s', async (code) => {
    expect(await restrictedRules(code)).toEqual([]);
  });

  it.each([
    [
      'packages/core/test/probe.ts',
      "import { readFileSync } from 'node:fs';\nexport const f = readFileSync;",
    ],
    ['packages/core/test/probe.ts', 'export const now = Date.now();'],
    [
      'scripts/probe.mjs',
      "import { readFileSync } from 'node:fs';\nexport const f = readFileSync;",
    ],
    [
      'packages/store-fs/src/probe.ts',
      "import { readFileSync } from 'node:fs';\nexport const f = readFileSync;",
    ],
  ])('does not restrict %s outside the core sources', async (file, code) => {
    expect(await restrictedRules(code, file)).toEqual([]);
  });
});
