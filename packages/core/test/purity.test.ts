import { readdirSync, readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The core must run unchanged in the Tauri webview and on the phone: no network, no Node
// built-ins, no hidden clock or randomness (the clock and the id generator are arguments).
// ESLint enforces the same rules while editing; this test is the safety net behind it.

const SRC_DIR = fileURLToPath(new URL('../src', import.meta.url));

const TOKEN_RULES: readonly (readonly [label: string, pattern: RegExp])[] = [
  ['fetch(', /\bfetch\s*\(/],
  ['XMLHttpRequest', /\bXMLHttpRequest\b/],
  ['WebSocket', /\bWebSocket\b/],
  ['Date.now(', /\bDate\s*\.\s*now\b/],
  ['new Date()', /\bnew\s+Date\s*\(\s*\)/],
  ['Math.random(', /\bMath\s*\.\s*random\b/],
  ['randomUUID(', /\brandomUUID\b/],
];

const SPECIFIER_PATTERN = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)(['"`])([^'"`\n]+)\1/g;
const NODE_BUILTINS = new Set(builtinModules);

function isNodeBuiltin(specifier: string): boolean {
  return specifier.startsWith('node:') || NODE_BUILTINS.has(specifier);
}

function findViolations(source: string): string[] {
  const found: string[] = [];
  for (const [label, pattern] of TOKEN_RULES) {
    if (pattern.test(source)) found.push(label);
  }
  for (const match of source.matchAll(SPECIFIER_PATTERN)) {
    const specifier = match[2] ?? '';
    if (isNodeBuiltin(specifier)) found.push(`import of "${specifier}"`);
  }
  return found;
}

describe('purity detector', () => {
  it.each([
    ["fetch('https://example.org')", 'fetch('],
    ['const x = new XMLHttpRequest();', 'XMLHttpRequest'],
    ["const s = new WebSocket('wss://example.org');", 'WebSocket'],
    ['const now = Date.now();', 'Date.now('],
    ['const now = new Date();', 'new Date()'],
    ['const now = new Date( );', 'new Date()'],
    ['const r = Math.random();', 'Math.random('],
    ['const id = crypto.randomUUID();', 'randomUUID('],
    ["import { readFileSync } from 'node:fs';", 'import of "node:fs"'],
    ["import http from 'http';", 'import of "http"'],
    ["import https from 'https';", 'import of "https"'],
    ["import net from 'net';", 'import of "net"'],
    ["import { join } from 'path';", 'import of "path"'],
    ["const fs = await import('node:fs/promises');", 'import of "node:fs/promises"'],
    ["const fs = require('fs');", 'import of "fs"'],
  ])('flags %s', (source, label) => {
    expect(findViolations(source)).toContain(label);
  });

  it.each([
    'const date = new Date(Date.UTC(2026, 7, 1));',
    'const date = new Date(timestamp);',
    'const digest = await crypto.subtle.digest("SHA-256", data);',
    "import { z } from 'zod';",
    "import { toCents } from './cents';",
    "import type { Store } from '../store';",
    'const node: TreeNode = { node: 1 };',
  ])('accepts %s', (source) => {
    expect(findViolations(source)).toEqual([]);
  });
});

describe('packages/core/src is pure', () => {
  const sources = readdirSync(SRC_DIR, { recursive: true, encoding: 'utf8' })
    .filter((path) => /\.[cm]?tsx?$/.test(path))
    .sort();

  it('has at least one source file to inspect', () => {
    expect(sources).toContain('index.ts');
  });

  it.each(sources)('%s has no network, Node, clock or randomness access', (path) => {
    const source = readFileSync(join(SRC_DIR, path), 'utf8');
    expect(findViolations(source)).toEqual([]);
  });
});
