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
    // Ordinary tests stay bounded; the heavy retained native-PAV graph tests declare an explicit
    // 120_000 budget at the call site. See docs/development/testing.md, "Timeout budgets".
    testTimeout: 30_000,
    pool: 'threads',
    // The CI runner has four cores. The heaviest files peak under 400 MB of heap each.
    maxWorkers: 4,
    setupFiles: ['tests/setup/unit.setup.ts'],
    // Coverage is off by default: V8 instrumentation measured a 66% slowdown on the heavy
    // native-PAV files and no gate reads the report. Opt in with --coverage.enabled=true.
    coverage: {
      enabled: false,
      exclude: ['**/.next/**', '**/tmp/**'],
      reportsDirectory: 'coverage/unit',
      provider: 'v8',
      reporter: ['text', 'lcov'],
    },
    passWithNoTests: false,
    logHeapUsage: true,
  },
});
