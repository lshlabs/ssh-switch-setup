import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/core/src/**/*.test.ts', 'apps/mobile/src/**/*.test.ts'],
    globals: false,
  },
});
