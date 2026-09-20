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
      // Colocated source tests were previously excluded, so 67 of them had never executed in CI.
      // Mirror the base config's patterns instead of listing individual app directories.
      'src/**/*.{test,spec}.{ts,tsx,js,jsx,mjs,cjs,mts,cts}',
      'src/**/__tests__/**/*.{test,spec}.{ts,tsx,js,jsx,mjs,cjs,mts,cts}',
    ],
    exclude: [
      '**/node_modules/**',
      '**/tmp/**',
      // Starts a real HTTP server and fetches it, which the unit setup blocks by stubbing fetch.
      // It belongs in the integration suite; tracked as a follow-up on #626.
      'src/server/app.test.ts',
    ],
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
      exclude: ['**/.next/**', '**/tmp/**'],
      reportsDirectory: 'coverage/unit',
      provider: 'v8',
      reporter: ['text', 'lcov'],
    },
    passWithNoTests: false,
    logHeapUsage: true,
  },
});
