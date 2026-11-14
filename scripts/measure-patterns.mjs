// Measurement (not a test): the slowest pattern that `isSafePattern` accepts, on 300 hostile
// characters (R102). Run with `pnpm exec tsx scripts/measure-patterns.mjs`; the ceiling in
// statement-read.test.ts is only a coarse guard (1500 ms), the fine figure (100 ms) is this one.
import { isSafePattern } from '../packages/core/src/statement-read.ts';

const atoms = ['a', '\\w', '.', '[a-z]', '\\d'];
const quantifiers = ['', '*', '+', '{1}', '{3}', '{6}', '{12}', '{23}', '{40}', '{0,10}', '?'];
const inputs = [
  'a'.repeat(299) + '!',
  'ab'.repeat(149) + '!',
  '1'.repeat(299) + '!',
  ' '.repeat(150) + 'a'.repeat(149) + '!',
];
let worst = { ms: 0, pattern: '' };
let count = 0;
function visit(parts, length) {
  if (parts.length >= 3 && parts.length === length) {
    const pattern = parts.join('') + 'x';
    if (!isSafePattern(pattern)) return;
    count += 1;
    if (count % 5000 === 0)
      console.error(`${String(count)} so far, slowest ${worst.ms.toFixed(1)} ms`);
    const re = new RegExp(pattern);
    for (const input of inputs) {
      const t0 = performance.now();
      re.exec(input);
      const ms = performance.now() - t0;
      if (ms > worst.ms) worst = { ms, pattern };
    }
    return;
  }
  for (const a of atoms) for (const q of quantifiers) visit([...parts, a + q], length);
}
// Argument: the lengths to try (default 3,4; takes many minutes; progress on stderr).
for (const length of (process.argv[2] ?? '3,4').split(',').map(Number)) visit([], length);
console.log(
  `${String(count)} accepted patterns; slowest ${worst.ms.toFixed(1)} ms: ${worst.pattern}`,
);
