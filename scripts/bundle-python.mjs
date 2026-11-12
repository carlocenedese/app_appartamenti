// Puts a Python interpreter, with bollette_pdf and its dependencies, into
// apps/desktop/src-tauri/resources/python/, which tauri.conf.json bundles into the installer.
//
//   node scripts/bundle-python.mjs
//
// The interpreter is a python-build-standalone distribution, the "install_only" .tar.gz variant
// (not .tar.zst: Node and `tar` read gzip without extra tools). python/runtime.json gives, for
// each system that builds the installer, its address, its SHA-256 (copied from the SHA256SUMS
// file of the release) and the Python version. Steps:
//   1. download the archive into a temporary folder;
//   2. check its SHA-256: an archive that does not match is never extracted, and the
//      destination folder is left as it was;
//   3. empty the destination folder and extract the archive into it;
//   4. with the bundled pip, install python/requirements.txt (--require-hashes --no-deps
//      --only-binary :all:) into the site-packages of the bundled interpreter, then remove pip
//      itself (and the copy kept by ensurepip): the app does not need it;
//   5. copy python/bollette_pdf/ there too, with schemas/supplierProfile.json and
//      schemas/extractionResult.json from docs/schemas/ inside it (bollette_pdf/schemas.py looks
//      there), so that `python -I -m bollette_pdf` works without PYTHONPATH;
//   6. run `python -I -m bollette_pdf --version` and print the final size.
// Right after the extraction, Tcl/Tk, tkinter, IDLE and turtle are removed (TKINTER_PATHS): the
// app does not use them and the TCL licence is not in the allowed list. On macOS `bin/python3` is
// then made the only copy of the interpreter (keepOneLauncher).
// Only Node built-ins: no npm dependencies.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { devNull, tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

/** Destination, relative to the root of the repository. */
export const RUNTIME_DIR = join('apps', 'desktop', 'src-tauri', 'resources', 'python');

const SYSTEMS = { win32: 'windows', darwin: 'macos', linux: 'linux' };
const ARCHITECTURES = { x64: 'x86_64', arm64: 'aarch64' };
const SHA256 = /^[0-9a-f]{64}$/i;

/** The {url, sha256} of the distribution for a Node platform and arch; throws when there is none. */
export function pickRuntime(manifest, platform, arch) {
  const key = `${SYSTEMS[platform] ?? platform}-${ARCHITECTURES[arch] ?? arch}`;
  const entry = Object.hasOwn(manifest, key) ? manifest[key] : undefined;
  if (entry === undefined || entry === null) {
    throw new Error(`Nessun interprete Python per ${key} in python/runtime.json.`);
  }
  if (typeof entry.url !== 'string' || !entry.url.startsWith('https://')) {
    throw new Error(`L'indirizzo per ${key} deve cominciare con https://.`);
  }
  if (typeof entry.sha256 !== 'string' || !SHA256.test(entry.sha256)) {
    throw new Error(`L'impronta SHA-256 per ${key} non è valida.`);
  }
  return { url: entry.url, sha256: entry.sha256 };
}

/** Throws unless `bytes` is not empty and its SHA-256 is `expected` (hexadecimal). */
export function verifySha256(bytes, expected) {
  if (typeof expected !== 'string' || !SHA256.test(expected)) {
    throw new Error("L'impronta SHA-256 attesa non è valida.");
  }
  if (bytes.length === 0) {
    throw new Error('Il file scaricato è vuoto.');
  }
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== expected.toLowerCase()) {
    throw new Error(`L'impronta SHA-256 non corrisponde: attesa ${expected}, trovata ${actual}.`);
  }
}

/** The interpreter inside an extracted install_only distribution. */
export function interpreterPath(directory, platform) {
  return platform === 'win32' ? join(directory, 'python.exe') : join(directory, 'bin', 'python3');
}

/**
 * Tcl/Tk and everything that needs it (ruling R69): the app does not use tkinter, and the TCL
 * licence is not in the allowed list. Paths relative to the interpreter folder; `*` matches any
 * run of characters inside one path segment.
 */
export const TKINTER_PATHS = {
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
};

function segmentMatcher(segment) {
  const escaped = segment.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*');
  return new RegExp(`^${escaped}$`);
}

/** The paths of TKINTER_PATHS that exist under `directory`, sorted. */
export function tkinterPaths(directory, platform) {
  const patterns = TKINTER_PATHS[platform === 'win32' ? 'win32' : 'other'];
  const found = new Set();
  for (const pattern of patterns) {
    let current = [directory];
    for (const segment of pattern.split('/')) {
      const matcher = segmentMatcher(segment);
      current = current.flatMap((folder) => {
        if (!existsSync(folder) || !lstatSync(folder).isDirectory()) return [];
        return readdirSync(folder)
          .filter((name) => matcher.test(name))
          .map((name) => join(folder, name));
      });
    }
    for (const path of current) found.add(path);
  }
  return [...found].sort();
}

/** Removes Tcl/Tk, tkinter, IDLE and turtle from an extracted interpreter; returns what it removed. */
export function removeTkinter(directory, platform) {
  const paths = tkinterPaths(directory, platform);
  for (const path of paths) rmSync(path, { recursive: true, force: true });
  return paths;
}

/**
 * Leaves `bin/python3` (the name the app runs) as the only copy of the interpreter. In the
 * distribution `python3` and `python` are links to `python3.13`, but Tauri copies a link as a whole
 * file when it bundles the resources: 18 MB each. The `-config` and pydoc scripts name
 * `python3.13` too and are removed with the other names; the app uses none of them.
 */
export function keepOneLauncher(directory, platform) {
  const bin = join(directory, 'bin');
  const launcher = join(bin, 'python3');
  if (platform === 'win32' || !existsSync(launcher)) return;
  if (lstatSync(launcher).isSymbolicLink()) {
    const real = realpathSync(launcher);
    if (dirname(real) !== realpathSync(bin)) {
      throw new Error('Il link bin/python3 punta fuori da bin/: la distribuzione è cambiata.');
    }
    renameSync(real, launcher); // replaces the link in one step
  }
  for (const name of readdirSync(bin)) {
    if (/^(python|python3\.\d+|python3(\.\d+)?-config|pydoc3(\.\d+)?)$/.test(name)) {
      rmSync(join(bin, name), { force: true });
    }
  }
}

/** Copies python/bollette_pdf/ (without bytecode) and the two schemas it needs into sitePackages. */
export function copyPackage(root, sitePackages) {
  const target = join(sitePackages, 'bollette_pdf');
  rmSync(target, { recursive: true, force: true });
  cpSync(join(root, 'python', 'bollette_pdf'), target, {
    recursive: true,
    filter: (source) => basename(source) !== '__pycache__' && !source.endsWith('.pyc'),
  });
  mkdirSync(join(target, 'schemas'));
  for (const kind of ['supplierProfile', 'extractionResult']) {
    cpSync(join(root, 'docs', 'schemas', `${kind}.json`), join(target, 'schemas', `${kind}.json`));
  }
}

/** Total size in bytes of the files under `directory` (symbolic links are not followed). */
export function directorySize(directory) {
  let total = 0;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) total += directorySize(path);
    else total += lstatSync(path).size;
  }
  return total;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: ['pipe', 'pipe', 'inherit'], ...options });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `«${basename(command)} ${args.join(' ')}» è uscito con il codice ${result.status}.`,
    );
  }
  return result.stdout?.toString('utf8') ?? '';
}

async function download(url) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`Download non riuscito: HTTP ${response.status}.`);
  return new Uint8Array(await response.arrayBuffer());
}

/** Extracts a verified .tar.gz into `destination`, dropping the top folder (`python/`). */
function extract(bytes, destination) {
  // The tar stream goes in on stdin: GNU tar would read a "C:\..." archive path as a remote host.
  // On Windows the tar of the system (bsdtar) is used, not whichever tar comes first on PATH.
  const systemTar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
  const tar = process.platform === 'win32' && existsSync(systemTar) ? systemTar : 'tar';
  run(tar, ['-x', '-f', '-', '--strip-components=1'], {
    cwd: destination,
    input: gunzipSync(bytes),
    stdio: ['pipe', 'inherit', 'inherit'],
  });
}

/** Environment for the bundled interpreter: no user configuration of pip or Python. */
function isolatedEnvironment() {
  return { ...process.env, PIP_CONFIG_FILE: devNull, PYTHONNOUSERSITE: '1' };
}

/**
 * Installs the pinned dependencies into the bundled site-packages, then removes pip: the app does
 * not need it, and pip vendors certifi (MPL-2.0, not in the allowed list). Returns site-packages.
 */
export function install(python, requirements) {
  const env = isolatedEnvironment();
  const paths = JSON.parse(
    run(
      python,
      [
        '-I',
        '-c',
        "import json, sysconfig; print(json.dumps([sysconfig.get_path(n) for n in ('purelib', 'stdlib')]))",
      ],
      { env },
    ),
  );
  const [sitePackages, standardLibrary] = paths;
  run(
    python,
    [
      '-I',
      '-m',
      'pip',
      'install',
      '--disable-pip-version-check',
      '--no-input',
      '--require-hashes',
      '--no-deps',
      '--only-binary',
      ':all:',
      '--target',
      sitePackages,
      '-r',
      requirements,
    ],
    { env, stdio: ['ignore', 'inherit', 'inherit'] },
  );
  run(python, ['-I', '-m', 'pip', 'uninstall', '--yes', '--disable-pip-version-check', 'pip'], {
    env,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  // The copy of pip kept by ensurepip, and the console scripts that --target writes with the
  // absolute path of this machine in them.
  const bundled = join(standardLibrary, 'ensurepip', '_bundled');
  if (existsSync(bundled)) {
    for (const name of readdirSync(bundled)) {
      if (name.endsWith('.whl')) rmSync(join(bundled, name));
    }
  }
  rmSync(join(sitePackages, 'bin'), { recursive: true, force: true });
  return sitePackages;
}

export function check(python) {
  const version = run(python, ['-I', '-m', 'bollette_pdf', '--version'], {
    env: isolatedEnvironment(),
  }).trim();
  console.log(`python -I -m bollette_pdf --version: ${version}`);
  run(
    python,
    [
      '-I',
      '-c',
      "import importlib.util, sys; sys.exit(any(importlib.util.find_spec(m) for m in ('tkinter', '_tkinter')))",
    ],
    { env: isolatedEnvironment() },
  );
}

/**
 * Builds resources/python/. Every step can be replaced (the tests do, to stay off the network):
 * {root, manifest, platform, arch, download, extract, install, check, log}.
 */
export async function main(options = {}) {
  const root = options.root ?? fileURLToPath(new URL('..', import.meta.url));
  const manifest =
    options.manifest ?? JSON.parse(readFileSync(join(root, 'python', 'runtime.json'), 'utf8'));
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const steps = {
    download: options.download ?? download,
    extract: options.extract ?? extract,
    install: options.install ?? install,
    check: options.check ?? check,
    log: options.log ?? console.log,
  };

  const { url, sha256 } = pickRuntime(manifest, platform, arch);
  const temporary = mkdtempSync(join(tmpdir(), 'bundle-python-'));
  try {
    steps.log(`Download di ${url}`);
    const archive = join(temporary, 'python.tar.gz');
    writeFileSync(archive, await steps.download(url));
    const bytes = readFileSync(archive);
    verifySha256(bytes, sha256); // before anything is extracted or removed
    steps.log(`Impronta SHA-256 verificata: ${sha256.toLowerCase()}`);

    const destination = join(root, RUNTIME_DIR);
    rmSync(destination, { recursive: true, force: true });
    mkdirSync(destination, { recursive: true });
    steps.extract(bytes, destination);
    steps.log(`Tolti Tcl/Tk e tkinter: ${removeTkinter(destination, platform).length} percorsi.`);
    keepOneLauncher(destination, platform);

    const python = interpreterPath(destination, platform);
    const sitePackages = steps.install(python, join(root, 'python', 'requirements.txt'));
    copyPackage(root, sitePackages);
    steps.check(python);
    const megabytes = (directorySize(destination) / 1024 / 1024).toFixed(1);
    steps.log(`Interprete pronto in ${RUNTIME_DIR}: ${megabytes} MB.`);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

const isEntryPoint =
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isEntryPoint) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
