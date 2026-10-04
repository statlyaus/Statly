/// <reference types="vitest" />
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
    name: 'integration',
    environment: 'node',
    include: ['tests/integration/**/*.test.ts', 'tests/integration/**/*.test.tsx'],
    globals: true,
    globalSetup: ['tests/setup/int.globalSetup.ts'],
    setupFiles: ['tests/setup/int.setup.ts'],
    // Every integration file writes to the same disposable PostgreSQL database (DATABASE_URL_TEST)
    // and cleans up only its own fixtures, so files run one at a time.
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
    reporters: ['default'],
    passWithNoTests: true,
  },
});
