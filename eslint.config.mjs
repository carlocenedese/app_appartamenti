import { builtinModules } from 'node:module';
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// packages/core/src must stay pure: it runs unchanged in the Tauri webview and on the phone,
// where node:fs does not exist, and it never touches the network (spec section 28). The clock
// and the id generator are passed in as arguments. packages/core/test/purity.test.ts holds the
// same rules as a text scan; packages/core/test/eslint-purity.test.ts checks this configuration.
// Restrictions apply to the core sources only: tests and scripts may use node:*.

const NODE_MODULES_MESSAGE =
  'packages/core must not import Node built-ins: it also runs in the Tauri webview and on the phone. Put file access in packages/store-fs and pass dependencies in as arguments.';

const nodeBuiltins = builtinModules
  .filter((name) => !name.startsWith('_'))
  .map((name) => ({ name, message: NODE_MODULES_MESSAGE }));

// Alternation of every built-in module name, escaped for use inside an esquery regex literal.
const builtinPattern = nodeBuiltins.map(({ name }) => name.replaceAll('/', '\\/')).join('|');

const coreRestrictions = {
  files: ['packages/core/src/**/*.{ts,tsx,mts,cts}'],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        paths: nodeBuiltins,
        patterns: [{ group: ['node:*'], message: NODE_MODULES_MESSAGE }],
      },
    ],
    'no-restricted-globals': [
      'error',
      ...['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource'].map((name) => ({
        name,
        message: 'packages/core makes no network calls (spec section 28).',
      })),
      ...['process', 'Buffer', 'require', '__dirname', '__filename'].map((name) => ({
        name,
        message: 'Node globals do not exist in the Tauri webview or on the phone.',
      })),
    ],
    'no-restricted-properties': [
      'error',
      ...['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource'].map((property) => ({
        object: 'globalThis',
        property,
        message: 'packages/core makes no network calls (spec section 28).',
      })),
      {
        object: 'Date',
        property: 'now',
        message: 'Pass the clock in as an argument instead of reading the current time.',
      },
      {
        object: 'Math',
        property: 'random',
        message: 'Pass the random source in as an argument; the core must be deterministic.',
      },
      {
        property: 'randomUUID',
        message: 'Pass the id generator in as an argument; the core must be deterministic.',
      },
      {
        property: 'getRandomValues',
        message: 'Pass the random source in as an argument; the core must be deterministic.',
      },
    ],
    'no-restricted-syntax': [
      'error',
      {
        // no-restricted-imports does not look at dynamic import(), so cover it here.
        selector: `ImportExpression > Literal.source[value=/^(?:node:.*|${builtinPattern})$/]`,
        message: NODE_MODULES_MESSAGE,
      },
      {
        selector: "NewExpression[callee.name='Date'][arguments.length=0]",
        message: 'new Date() reads the current time: pass the clock in as an argument.',
      },
      {
        selector: "CallExpression[callee.name='Date']",
        message: 'Date() reads the current time: pass the clock in as an argument.',
      },
    ],
  },
};

export default defineConfig(
  globalIgnores([
    '**/node_modules/',
    '**/coverage/',
    '**/dist/',
    'apps/desktop/src-tauri/target/',
    'apps/desktop/src-tauri/gen/',
    'apps/desktop/src-tauri/resources/python/',
    '.superpowers/',
  ]),
  js.configs.recommended,
  tseslint.configs.strict,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },
  coreRestrictions,
);
