/// <reference types="vitest" />
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  envDir: false,
  plugins: [tsconfigPaths()],
  root,
  resolve: { alias: { '@': path.resolve(root, 'src') } },
  esbuild: { jsx: 'automatic' },
  test: {
    name: 'outcomes-postgres-integration',
    environment: 'node',
    include: ['tests/outcomes-integration/**/*.test.ts'],
    globals: true,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Each file deploys its own schema and drops it with CASCADE, about 1,200 relations. Files ran
    // one at a time until the lock ceiling was raised to 2048 (#671); with that ceiling four files
    // fit the lock table together, which matches the CI runner's four cores.
    maxWorkers: 4,
    reporters: ['default'],
  },
});
