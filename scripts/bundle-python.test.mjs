import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RUNTIME_DIR,
  copyPackage,
  directorySize,
  interpreterPath,
  main,
  pickRuntime,
  verifySha256,
} from './bundle-python.mjs';

// No test touches the network: main() gets a fake download, a fake extraction and a fake pip.

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

const ARCHIVE = new TextEncoder().encode('archivio finto, non un vero tar.gz');
const ARCHIVE_SHA = sha256(ARCHIVE);

const manifest = {
  'windows-x86_64': {
    url: 'https://example.invalid/windows.tar.gz',
    sha256: 'a'.repeat(64),
    pythonVersion: '3.13.0',
  },
  'macos-aarch64': {
    url: 'https://example.invalid/macos.tar.gz',
    sha256: ARCHIVE_SHA,
    pythonVersion: '3.13.0',
  },
};

let root;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bundle-python-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('pickRuntime', () => {
  it('picks the distribution of the system', () => {
    expect(pickRuntime(manifest, 'win32', 'x64')).toEqual({
      url: 'https://example.invalid/windows.tar.gz',
      sha256: 'a'.repeat(64),
    });
    expect(pickRuntime(manifest, 'darwin', 'arm64')).toEqual({
      url: 'https://example.invalid/macos.tar.gz',
      sha256: ARCHIVE_SHA,
    });
  });

  it.each([
    ['linux', 'x64'],
    ['darwin', 'x64'],
    ['win32', 'arm64'],
    ['sunos', 'sparc'],
  ])('throws for a system without a distribution (%s %s)', (platform, arch) => {
    expect(() => pickRuntime(manifest, platform, arch)).toThrow(/Nessun interprete/);
  });

  it('throws for an entry without an https address or a valid fingerprint', () => {
    const broken = {
      'macos-aarch64': { url: 'http://example.invalid/a.tar.gz', sha256: ARCHIVE_SHA },
      'windows-x86_64': { url: 'https://example.invalid/b.tar.gz', sha256: 'abc' },
    };
    expect(() => pickRuntime(broken, 'darwin', 'arm64')).toThrow(/https/);
    expect(() => pickRuntime(broken, 'win32', 'x64')).toThrow(/impronta/);
  });

  it('accepts the real python/runtime.json for both systems that build the installer', () => {
    const real = JSON.parse(
      readFileSync(new URL('../python/runtime.json', import.meta.url), 'utf8'),
    );
    for (const [platform, arch] of [
      ['win32', 'x64'],
      ['darwin', 'arm64'],
    ]) {
      const { url, sha256: expected } = pickRuntime(real, platform, arch);
      expect(url).toMatch(
        /^https:\/\/github\.com\/astral-sh\/python-build-standalone\/releases\/download\/.+install_only\.tar\.gz$/,
      );
      expect(expected).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(real['windows-x86_64'].pythonVersion).toMatch(/^3\.13\.\d+$/);
    expect(real['macos-aarch64'].pythonVersion).toMatch(/^3\.13\.\d+$/);
  });
});

describe('verifySha256', () => {
  it('accepts the right fingerprint, in either case', () => {
    expect(() => verifySha256(ARCHIVE, ARCHIVE_SHA)).not.toThrow();
    expect(() => verifySha256(ARCHIVE, ARCHIVE_SHA.toUpperCase())).not.toThrow();
  });

  it('throws on a wrong fingerprint', () => {
    expect(() => verifySha256(ARCHIVE, 'b'.repeat(64))).toThrow(/non corrisponde/);
  });

  it('throws on an empty file, even with the fingerprint of the empty file', () => {
    const empty = new Uint8Array(0);
    expect(() => verifySha256(empty, sha256(empty))).toThrow(/vuoto/);
  });

  it('throws on a malformed expected fingerprint', () => {
    expect(() => verifySha256(ARCHIVE, '')).toThrow(/impronta/);
    expect(() => verifySha256(ARCHIVE, ARCHIVE_SHA.slice(1))).toThrow(/impronta/);
  });
});

describe('interpreterPath', () => {
  it('is python.exe at the top on Windows and bin/python3 elsewhere', () => {
    expect(interpreterPath('X', 'win32')).toBe(join('X', 'python.exe'));
    expect(interpreterPath('X', 'darwin')).toBe(join('X', 'bin', 'python3'));
  });
});

/** A fake repository with the package and the schemas that copyPackage and main read. */
function makeRepository(repository) {
  const pkg = join(repository, 'python', 'bollette_pdf');
  mkdirSync(join(pkg, '__pycache__'), { recursive: true });
  writeFileSync(join(pkg, '__init__.py'), '__version__ = "0.0.0"\n');
  writeFileSync(join(pkg, '__main__.py'), 'print("ok")\n');
  writeFileSync(join(pkg, 'stale.pyc'), 'x');
  writeFileSync(join(pkg, '__pycache__', 'x.cpython-313.pyc'), 'x');
  writeFileSync(join(repository, 'python', 'requirements.txt'), '# empty\n');
  const schemas = join(repository, 'docs', 'schemas');
  mkdirSync(schemas, { recursive: true });
  for (const kind of ['supplierProfile', 'extractionResult', 'bill']) {
    writeFileSync(join(schemas, `${kind}.json`), `{"title":"${kind}"}\n`);
  }
}

describe('copyPackage', () => {
  it('copies the package without bytecode and puts the two schemas inside it', () => {
    makeRepository(root);
    const sitePackages = join(root, 'site-packages');
    mkdirSync(sitePackages);
    copyPackage(root, sitePackages);
    const target = join(sitePackages, 'bollette_pdf');
    expect(readdirSync(target).sort()).toEqual(['__init__.py', '__main__.py', 'schemas']);
    expect(readdirSync(join(target, 'schemas')).sort()).toEqual([
      'extractionResult.json',
      'supplierProfile.json',
    ]);
    expect(readFileSync(join(target, 'schemas', 'supplierProfile.json'), 'utf8')).toBe(
      '{"title":"supplierProfile"}\n',
    );
  });

  it('replaces an older copy', () => {
    makeRepository(root);
    const sitePackages = join(root, 'site-packages');
    mkdirSync(join(sitePackages, 'bollette_pdf'), { recursive: true });
    writeFileSync(join(sitePackages, 'bollette_pdf', 'removed.py'), '');
    copyPackage(root, sitePackages);
    expect(existsSync(join(sitePackages, 'bollette_pdf', 'removed.py'))).toBe(false);
  });
});

describe('directorySize', () => {
  it('adds up the sizes of the files, in every subfolder', () => {
    mkdirSync(join(root, 'a', 'b'), { recursive: true });
    writeFileSync(join(root, 'a', 'one'), '123');
    writeFileSync(join(root, 'a', 'b', 'two'), '45');
    expect(directorySize(root)).toBe(5);
  });
});

describe('main', () => {
  function fakes(downloaded) {
    return {
      download: vi.fn(async () => downloaded),
      extract: vi.fn(),
      install: vi.fn(() => join(root, 'site-packages')),
      check: vi.fn(),
      log: vi.fn(),
    };
  }

  it('extracts nothing and leaves the folder alone when the fingerprint does not match', async () => {
    makeRepository(root);
    const destination = join(root, RUNTIME_DIR);
    mkdirSync(destination, { recursive: true });
    writeFileSync(join(destination, 'previous'), 'kept');
    const steps = fakes(new TextEncoder().encode('un altro file'));
    await expect(
      main({ root, manifest, platform: 'darwin', arch: 'arm64', ...steps }),
    ).rejects.toThrow(/non corrisponde/);
    expect(steps.download).toHaveBeenCalledWith('https://example.invalid/macos.tar.gz');
    expect(steps.extract).not.toHaveBeenCalled();
    expect(steps.install).not.toHaveBeenCalled();
    expect(readdirSync(destination)).toEqual(['previous']);
  });

  it('extracts nothing when the download is empty', async () => {
    makeRepository(root);
    const steps = fakes(new Uint8Array(0));
    await expect(
      main({ root, manifest, platform: 'darwin', arch: 'arm64', ...steps }),
    ).rejects.toThrow(/vuoto/);
    expect(steps.extract).not.toHaveBeenCalled();
    expect(existsSync(join(root, RUNTIME_DIR))).toBe(false);
  });

  it('extracts the verified archive into an emptied folder, installs, copies and checks', async () => {
    makeRepository(root);
    const destination = join(root, RUNTIME_DIR);
    mkdirSync(destination, { recursive: true });
    writeFileSync(join(destination, 'previous'), 'removed');
    const steps = fakes(ARCHIVE);
    steps.extract.mockImplementation((bytes, into) => {
      expect(readdirSync(into)).toEqual([]);
      expect(sha256(bytes)).toBe(ARCHIVE_SHA);
      writeFileSync(join(into, 'extracted'), 'x');
    });
    mkdirSync(join(root, 'site-packages'));

    await main({ root, manifest, platform: 'darwin', arch: 'arm64', ...steps });

    expect(steps.extract).toHaveBeenCalledTimes(1);
    expect(readdirSync(destination)).toEqual(['extracted']);
    const python = interpreterPath(destination, 'darwin');
    expect(steps.install).toHaveBeenCalledWith(python, join(root, 'python', 'requirements.txt'));
    expect(existsSync(join(root, 'site-packages', 'bollette_pdf', 'schemas'))).toBe(true);
    expect(steps.check).toHaveBeenCalledWith(python);
    expect(steps.log.mock.calls.at(-1)[0]).toMatch(/MB/);
  });

  it('throws before downloading on a system without a distribution', async () => {
    const steps = fakes(ARCHIVE);
    await expect(
      main({ root, manifest, platform: 'linux', arch: 'x64', ...steps }),
    ).rejects.toThrow(/Nessun interprete/);
    expect(steps.download).not.toHaveBeenCalled();
  });
});
