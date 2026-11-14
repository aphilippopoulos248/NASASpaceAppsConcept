import { defineConfig } from 'vitest/config';

// Unit tests: pure TypeScript (science core, terrain maths, assistant tools, server handlers).
// Browser behaviour is covered by the Playwright flow in e2e/.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'server/**/*.test.ts'],
    testTimeout: 30000,
    coverage: {
      provider: 'v8',
      include: ['src/astro/**', 'src/analysis/**', 'src/terrain/**', 'src/assistant/**', 'src/core/**', 'server/**'],
      exclude: ['**/*.test.ts', '**/*.d.ts'],
      reporter: ['text-summary', 'json-summary'],
    },
  },
});
