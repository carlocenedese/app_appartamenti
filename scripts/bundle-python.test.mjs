import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  lstatSync,
  readdirSync,
  rmSync,
  symlinkSync,
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
  keepOneLauncher,
  main,
  pickRuntime,
  removeTkinter,
  TKINTER_PATHS,
  tkinterPaths,
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
  mkdirSync(join(repository, 'python', 'licenses'));
  writeFileSync(join(repository, 'python', 'licenses', 'ocr-native-libraries.txt'), 'testi\n');
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
    expect(readdirSync(target).sort()).toEqual([
      '__init__.py',
      '__main__.py',
      'licenses',
      'schemas',
    ]);
    expect(readFileSync(join(target, 'licenses', 'ocr-native-libraries.txt'), 'utf8')).toBe(
      'testi\n',
    );
    expect(readdirSync(join(target, 'schemas')).sort()).toEqual([
      'extractionResult.json',
      'supplierProfile.json',
    ]);
    expect(readFileSync(join(target, 'schemas', 'supplierProfile.json'), 'utf8')).toBe(
      '{"title":"supplierProfile"}\n',
    );
  });

  it('ships the licence texts of the native OCR libraries, one section per library', () => {
    const text = readFileSync(
      new URL('../python/licenses/ocr-native-libraries.txt', import.meta.url),
      'utf8',
    );
    // the ten libraries of tesserocr/.dylibs on macOS, grouped by project (docs/rules/ocr-licenze.md)
    for (const name of [
      'Tesseract',
      'Leptonica',
      'libpng',
      'libjpeg-turbo',
      'libtiff',
      'libwebp',
      'liblzma',
      'Zstandard',
    ]) {
      expect(text, name).toContain(`## ${name}`);
    }
    expect(text).toContain('Redistributions in binary form must reproduce');
    expect(text).not.toMatch(/GNU (Lesser )?General Public License/i);
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

/** Creates the files (ending without "/") and folders (ending with "/") under `base`. */
function makeTree(base, entries) {
  for (const entry of entries) {
    const path = join(base, ...entry.split('/'));
    if (entry.endsWith('/')) mkdirSync(path, { recursive: true });
    else {
      mkdirSync(join(path, '..'), { recursive: true });
      writeFileSync(path, 'x');
    }
  }
}

describe('removeTkinter', () => {
  it('lists Tcl/Tk, tkinter, IDLE and turtle for both systems', () => {
    expect(TKINTER_PATHS).toEqual({
      win32: [
        'Lib/tkinter',
        'Lib/idlelib',
        'Lib/turtledemo',
        'Lib/turtle.py',
        'Lib/__pycache__/turtle.*',
        'DLLs/_tkinter.*',
        'DLLs/tcl*.dll',
        'DLLs/tk*.dll',
        'tcl',
      ],
      other: [
        'bin/idle3*',
        'lib/libtcl*',
        'lib/libtk*',
        'lib/tcl*',
        'lib/tk*',
        'lib/itcl*',
        'lib/thread*',
        'lib/python3.*/tkinter',
        'lib/python3.*/idlelib',
        'lib/python3.*/turtledemo',
        'lib/python3.*/turtle.py',
        'lib/python3.*/__pycache__/turtle.*',
        'lib/python3.*/lib-dynload/_tkinter.*',
      ],
    });
  });

  it('removes the Windows layout of python-build-standalone and keeps the rest', () => {
    makeTree(root, [
      'python.exe',
      'DLLs/_tkinter.pyd',
      'DLLs/_tkinter.pdb',
      'DLLs/tcl86t.dll',
      'DLLs/tk86t.dll',
      'DLLs/_ssl.pyd',
      'DLLs/sqlite3.dll',
      'Lib/tkinter/__init__.py',
      'Lib/idlelib/idle.py',
      'Lib/turtledemo/__main__.py',
      'Lib/turtle.py',
      'Lib/json/__init__.py',
      'tcl/tcl8.6/init.tcl',
      'tcl/tk8.6/tk.tcl',
      'tcl/tix8.4.3/Tix.tcl',
    ]);
    const removed = removeTkinter(root, 'win32');
    expect(removed).toHaveLength(9);
    expect(tkinterPaths(root, 'win32')).toEqual([]);
    expect(readdirSync(root).sort()).toEqual(['DLLs', 'Lib', 'python.exe']);
    expect(readdirSync(join(root, 'DLLs')).sort()).toEqual(['_ssl.pyd', 'sqlite3.dll']);
    expect(readdirSync(join(root, 'Lib'))).toEqual(['json']);
  });

  it('removes the macOS layout of python-build-standalone and keeps the rest', () => {
    makeTree(root, [
      'bin/python3',
      'bin/idle3',
      'bin/idle3.13',
      'bin/pydoc3',
      'lib/libpython3.13.dylib',
      'lib/libtcl9.0.dylib',
      'lib/libtcl9tk9.0.dylib',
      'lib/tcl9/',
      'lib/tcl9.0/init.tcl',
      'lib/tk9.0/tk.tcl',
      'lib/itcl4.3.8/itcl.tcl',
      'lib/thread3.0.6/pkgIndex.tcl',
      'lib/pkgconfig/python3.pc',
      'lib/python3.13/tkinter/__init__.py',
      'lib/python3.13/idlelib/idle.py',
      'lib/python3.13/turtledemo/__main__.py',
      'lib/python3.13/turtle.py',
      'lib/python3.13/json/__init__.py',
      'lib/python3.13/lib-dynload/_tkinter.cpython-313-darwin.so',
      'lib/python3.13/lib-dynload/_ssl.cpython-313-darwin.so',
    ]);
    removeTkinter(root, 'darwin');
    expect(tkinterPaths(root, 'darwin')).toEqual([]);
    expect(readdirSync(join(root, 'bin')).sort()).toEqual(['pydoc3', 'python3']);
    expect(readdirSync(join(root, 'lib')).sort()).toEqual([
      'libpython3.13.dylib',
      'pkgconfig',
      'python3.13',
    ]);
    expect(readdirSync(join(root, 'lib', 'python3.13')).sort()).toEqual(['json', 'lib-dynload']);
    expect(readdirSync(join(root, 'lib', 'python3.13', 'lib-dynload'))).toEqual([
      '_ssl.cpython-313-darwin.so',
    ]);
  });

  it('does nothing on a folder without Tcl/Tk', () => {
    makeTree(root, ['python.exe', 'Lib/json/__init__.py']);
    expect(removeTkinter(root, 'win32')).toEqual([]);
    expect(removeTkinter(root, 'darwin')).toEqual([]);
  });
});

describe('keepOneLauncher', () => {
  // Symbolic links need a privilege on Windows, where the function does nothing anyway.
  const posix = process.platform === 'win32' ? it.skip : it;

  function distribution() {
    makeTree(root, [
      'bin/python3.13',
      'bin/pydoc3',
      'bin/pydoc3.13',
      'bin/python3-config',
      'bin/python3.13-config',
    ]);
    writeFileSync(join(root, 'bin', 'python3.13'), 'the interpreter');
    symlinkSync('python3.13', join(root, 'bin', 'python3'));
    symlinkSync('python3', join(root, 'bin', 'python')); // a chain: python -> python3 -> python3.13
  }

  posix('leaves bin/python3 as the one real file, without the other names', () => {
    distribution();
    keepOneLauncher(root, 'darwin');
    expect(readdirSync(join(root, 'bin')).sort()).toEqual(['python3']);
    expect(lstatSync(join(root, 'bin', 'python3')).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(root, 'bin', 'python3'), 'utf8')).toBe('the interpreter');
  });

  posix('is idempotent and also takes a real python3 with links around it', () => {
    makeTree(root, ['bin/python3']);
    writeFileSync(join(root, 'bin', 'python3'), 'the interpreter');
    symlinkSync('python3', join(root, 'bin', 'python3.13'));
    keepOneLauncher(root, 'darwin');
    keepOneLauncher(root, 'darwin');
    expect(readdirSync(join(root, 'bin'))).toEqual(['python3']);
    expect(readFileSync(join(root, 'bin', 'python3'), 'utf8')).toBe('the interpreter');
  });

  posix('refuses a link that leaves bin/, and moves nothing', () => {
    makeTree(root, ['lib/python3.13', 'bin/']);
    symlinkSync(join('..', 'lib', 'python3.13'), join(root, 'bin', 'python3'));
    expect(() => keepOneLauncher(root, 'darwin')).toThrow(/fuori da bin/);
    expect(existsSync(join(root, 'lib', 'python3.13'))).toBe(true);
  });

  it('does nothing on Windows or without bin/python3', () => {
    makeTree(root, ['python.exe', 'bin/python3.13']);
    keepOneLauncher(root, 'win32');
    expect(readdirSync(join(root, 'bin'))).toEqual(['python3.13']);
    keepOneLauncher(root, 'darwin');
    expect(readdirSync(join(root, 'bin'))).toEqual(['python3.13']);
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
      mkdirSync(join(into, 'lib', 'tk9.0'), { recursive: true });
    });
    mkdirSync(join(root, 'site-packages'));

    await main({ root, manifest, platform: 'darwin', arch: 'arm64', ...steps });

    expect(steps.extract).toHaveBeenCalledTimes(1);
    expect(readdirSync(destination).sort()).toEqual(['extracted', 'lib']);
    expect(readdirSync(join(destination, 'lib'))).toEqual([]);
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
