/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    name: 'unit',
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    exclude: ['node_modules'],
    globals: true,
    clearMocks: true,
    setupFiles: ['tests/setup/unit.setup.ts'],
    coverage: {
      enabled: true,
      reportsDirectory: 'coverage/unit',
      provider: 'v8',
      reporter: ['text', 'lcov'],
      lines: 90,
      functions: 90,
      branches: 85,
      statements: 90,
    },
    passWithNoTests: false,
    logHeapUsage: true,
  },
});
