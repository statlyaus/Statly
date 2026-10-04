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
    // Each file gets its own database (tests/testUtils/outcomesDatabasePerFile.setup.ts). The
    // outcomes SQL takes transaction advisory locks keyed by hashtextextended(<text key>, 0) with no
    // schema component, and advisory locks are per database. The fixtures are content-addressed, so
    // two files sharing one database take identical keys: PR #763 ran four workers on one database
    // and saw cross-file lock waits, a try-lock failing with "changed concurrently", and timeouts.
    // Roles are server-wide, so the global setup creates them once before any file starts.
    // Two workers, not four: at four, the 4-core runner was CPU-bound and the heaviest files ran
    // two to three times slower than alone, past their timeouts.
    globalSetup: ['tests/testUtils/outcomesParallelDatabases.globalSetup.ts'],
    setupFiles: ['tests/testUtils/outcomesDatabasePerFile.setup.ts'],
    fileParallelism: true,
    maxWorkers: 2,
    // The per-file database is dropped by the setup file's afterAll, which must run after the
    // file's own afterAll hooks have closed their pools.
    sequence: { hooks: 'stack' },
    reporters: ['default'],
  },
});
