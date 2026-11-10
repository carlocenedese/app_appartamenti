import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'store-fs',
    include: ['test/**/*.test.ts'],
  },
});
