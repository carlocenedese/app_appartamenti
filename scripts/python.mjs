// Runs the Python interpreter with the given arguments, the same way on every system:
// `python3` on Linux and macOS, `python` on Windows (where setup-python installs no `python3`
// alias). Set PYTHON to use another interpreter, for example the one of a virtualenv.
// The exit code of Python becomes the exit code of this script.

import { spawnSync } from 'node:child_process';

const interpreter = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
const result = spawnSync(interpreter, process.argv.slice(2), { stdio: 'inherit' });

if (result.error !== undefined) {
  console.error(`Impossibile avviare «${interpreter}»: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
