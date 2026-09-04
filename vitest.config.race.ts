/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    name: 'race',
    environment: 'node',
    include: ['tests/race/**/*.test.ts'],
    globals: true,
    setupFiles: ['tests/setup/race.setup.ts'],
    maxWorkers: 1,
    minWorkers: 1,
    testTimeout: 60000,
    hookTimeout: 60000,
    retry: 0,
    reporters: ['default'],
    passWithNoTests: false,
  },
});
