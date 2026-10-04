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
    // Files must run one at a time while they share one database. The outcomes SQL takes
    // transaction advisory locks keyed by hashtextextended(<text key>, 0) with no schema component,
    // and advisory locks are per database, not per schema. The fixtures are content-addressed, so
    // two files in different schemas produce identical keys: PR #763 ran four workers and saw
    // cross-file lock waits, a try-lock failing with "changed concurrently", and timeouts. Files
    // can run in parallel once each has its own database.
    fileParallelism: false,
    maxWorkers: 1,
    reporters: ['default'],
  },
});
