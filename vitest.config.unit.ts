/// <reference types="vitest" />
import path from 'node:path';

import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    name: 'unit',
    environment: 'jsdom',
    include: [
      'tests/unit/**/*.test.ts',
      'tests/unit/**/*.test.tsx',
      'src/app/dashboard/**/*.test.tsx',
      'src/app/api/draft-trades/**/*.test.ts',
    ],
    exclude: ['node_modules'],
    globals: true,
    clearMocks: true,
    // Replay, canonicalization, and hostile-size contract tests run under full V8 coverage in CI.
    // Keep them bounded, while allowing realistic shared-runner instrumentation overhead.
    testTimeout: 30_000,
    pool: 'threads',
    maxWorkers: 2,
    setupFiles: ['tests/setup/unit.setup.ts'],
    coverage: {
      enabled: true,
      reportsDirectory: 'coverage/unit',
      provider: 'v8',
      reporter: ['text', 'lcov'],
    },
    passWithNoTests: false,
    logHeapUsage: true,
  },
});
