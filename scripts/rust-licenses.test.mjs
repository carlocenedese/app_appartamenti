import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { disallowedCrates, newDisallowedCrates, toSpdx } from './rust-licenses.mjs';

const REGISTRY = 'registry+https://github.com/rust-lang/crates.io-index';
const crate = (name, license, source = REGISTRY) => ({ name, version: '1.0.0', license, source });
const meta = (...packages) => ({ packages });

const base = meta(
  crate('app-bollette', null, null),
  crate('serde', 'MIT OR Apache-2.0'),
  crate('cssparser', 'MPL-2.0'),
);

describe('rust licences', { timeout: 30_000 }, () => {
  it('lists registry crates outside the allowed list, not the app itself', () => {
    expect([...disallowedCrates(base)]).toEqual([['cssparser', 'MPL-2.0']]);
  });

  it('reads the old cargo format with «/» as OR', () => {
    const old = meta(
      crate('filetime', 'MIT/Apache-2.0'),
      crate('a', 'Apache-2.0/MIT'),
      crate('b', 'MIT / Apache-2.0'),
      crate('c', 'MIT/GPL-3.0'),
      crate('d', 'GPL-3.0/LGPL-2.1'),
    );
    expect(toSpdx('MIT/Apache-2.0')).toBe('MIT OR Apache-2.0');
    expect([...disallowedCrates(old)]).toEqual([['d', 'GPL-3.0/LGPL-2.1']]);
  });

  it('ignores crates outside the resolve of the filtered platforms', () => {
    const wasmOnly = { ...crate('webpki-root-certs', 'CDLA-Permissive-2.0'), id: 'w' };
    const kept = { ...crate('cssparser', 'MPL-2.0'), id: 'c' };
    const filtered = { packages: [wasmOnly, kept], resolve: { nodes: [{ id: 'c' }] } };
    expect([...disallowedCrates(filtered)]).toEqual([['cssparser', 'MPL-2.0']]);
  });

  it('reports only crates that are new and not allowed', () => {
    const after = meta(
      ...base.packages,
      crate('cssparser', 'MPL-2.0'),
      crate('ring', 'Apache-2.0 AND ISC'),
      crate('webpki-roots', 'CDLA-Permissive-2.0'),
      crate('option-ext', 'MPL-2.0'),
      crate('mystery', null),
    );
    expect(newDisallowedCrates(base, after)).toEqual([
      'mystery ((nessuna))',
      'option-ext (MPL-2.0)',
      'webpki-roots (CDLA-Permissive-2.0)',
    ]);
    expect(newDisallowedCrates(after, after)).toEqual([]);
  });

  it('exits with 1 on a new crate, 0 otherwise, 2 on a wrong use', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rust-licenses-'));
    try {
      const before = join(dir, 'before.json');
      const after = join(dir, 'after.json');
      writeFileSync(before, JSON.stringify(base));
      writeFileSync(after, JSON.stringify(meta(...base.packages, crate('x', 'GPL-3.0-only'))));
      const script = fileURLToPath(new URL('rust-licenses.mjs', import.meta.url));
      const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
      expect(run(before, before).status).toBe(0);
      const result = run(before, after);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/x \(GPL-3\.0-only\)/);
      expect(run(before).status).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
