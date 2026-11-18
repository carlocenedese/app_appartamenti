// Runs the Python interpreter with the given arguments, the same way on every system:
// `python3` on Linux and macOS, `python` on Windows (where setup-python installs no `python3`
// alias). Set PYTHON to use another interpreter, for example the one of a virtualenv (an empty
// PYTHON counts as unset, like in the test helper of packages/core).
// The exit code of Python becomes the exit code of this script.
// A development tool only: the installed app never runs it. Without PYTHON the interpreter comes
// from the PATH; on Windows the search looks in the working folder first, so it always runs from
// the root of the repository (where pnpm runs it anyway), never from wherever `node` was started.
// For a pinned interpreter set PYTHON to its absolute path.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const interpreter = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const result = spawnSync(interpreter, process.argv.slice(2), { stdio: 'inherit', cwd: root });

if (result.error !== undefined) {
  console.error(`Impossibile avviare «${interpreter}»: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
