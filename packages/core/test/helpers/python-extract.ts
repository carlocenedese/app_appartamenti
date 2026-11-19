/**
 * Runs the Python reader of PDFs (`python -I -m bollette_pdf`) from the tests of the core.
 *
 * The interpreter is the variable `PYTHON` when set (a path with a separator is resolved against
 * the current folder, so the child can run elsewhere), else `python` on Windows and `python3`
 * on the other systems, as in scripts/python.mjs. Under `-I` the package must be installed in
 * that interpreter: `pnpm python:dev-install` (python/tools/dev_install.py).
 *
 * Python's `re` has no timeout (ruling R54), so every run has one: on expiry the child is killed
 * and the promise rejects. Stdout is read to the end, with a size cap; a non-zero exit rejects
 * with the first line of stderr only, which the package keeps generic (never document text).
 */
import { spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { parseExtractionResult } from '../../src/index';
import type { ExtractionResult } from '../../src/index';

export const EXTRACT_TIMEOUT_MS = 30_000;
export const MAX_STDOUT_BYTES = 8 * 1024 * 1024;
const MAX_STDERR_BYTES = 64 * 1024;

export type RunOptions = {
  timeoutMs?: number;
  maxStdoutBytes?: number;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
};

/** The interpreter to start: `PYTHON`, or `python` on Windows and `python3` elsewhere. */
export function pythonInterpreter(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  const configured = env.PYTHON;
  if (configured !== undefined && configured !== '') {
    return /[\\/]/.test(configured) ? resolve(configured) : configured;
  }
  return platform === 'win32' ? 'python' : 'python3';
}

/** Whether `python -I -m bollette_pdf` runs; when it does not, why, in one Italian sentence. */
export function pythonAvailability(): { available: true } | { available: false; reason: string } {
  const interpreter = pythonInterpreter();
  const probe = spawnSync(interpreter, ['-I', '-m', 'bollette_pdf', '--version'], {
    encoding: 'utf8',
    timeout: EXTRACT_TIMEOUT_MS,
  });
  if (probe.error !== undefined) {
    return { available: false, reason: `impossibile avviare «${interpreter}».` };
  }
  if (probe.status !== 0) {
    return {
      available: false,
      reason: `«${interpreter} -I -m bollette_pdf» non trova il pacchetto (pnpm python:dev-install).`,
    };
  }
  return { available: true };
}

function firstLine(bytes: Buffer): string {
  return bytes.toString('utf8').split(/\r?\n/, 1)[0]?.trim() ?? '';
}

/**
 * Runs the interpreter with `args` and resolves with all of stdout as UTF-8 text. Rejects when
 * it cannot start, runs longer than `timeoutMs` (killed), prints more than `maxStdoutBytes`
 * (killed) or exits with a code other than 0 (message: the first line of stderr).
 */
export function runPython(args: string[], options: RunOptions = {}): Promise<string> {
  const timeoutMs = options.timeoutMs ?? EXTRACT_TIMEOUT_MS;
  const maxStdout = options.maxStdoutBytes ?? MAX_STDOUT_BYTES;
  const interpreter = pythonInterpreter();
  return new Promise((done, fail) => {
    const child = spawn(interpreter, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stopped: string | undefined;
    const stop = (reason: string) => {
      if (stopped !== undefined) return;
      stopped = reason;
      child.kill('SIGKILL');
    };
    const timer = setTimeout(() => {
      stop(`Lettura interrotta: nessuna risposta entro ${String(timeoutMs / 1000)} s.`);
    }, timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > maxStdout) stop('Lettura interrotta: risposta troppo grande.');
      else stdout.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderrBytes < MAX_STDERR_BYTES) stderr.push(chunk);
      stderrBytes += chunk.length;
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      fail(new Error(`Impossibile avviare «${interpreter}»: ${error.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (stopped !== undefined) fail(new Error(stopped));
      else if (code !== 0) {
        const line = firstLine(Buffer.concat(stderr));
        fail(new Error(line === '' ? `Python è uscito con il codice ${String(code)}.` : line));
      } else done(Buffer.concat(stdout).toString('utf8'));
    });
  });
}

/** Reads `pdf` with the profiles of the folder `profiles`, at the ISO date(-time) `at`. */
export async function runExtract(
  input: { pdf: string; profiles: string; at: string },
  options: RunOptions = {},
): Promise<ExtractionResult> {
  const text = await runPython(
    [
      '-I',
      '-m',
      'bollette_pdf',
      'extract',
      '--pdf',
      input.pdf,
      '--profiles',
      input.profiles,
      '--at',
      input.at,
    ],
    options,
  );
  return parseExtractionResult(text);
}
