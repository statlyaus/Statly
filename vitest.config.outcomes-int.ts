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
  test: {
    name: 'outcomes-postgres-integration',
    environment: 'node',
    include: ['tests/outcomes-integration/**/*.test.ts'],
    globals: true,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    reporters: ['default'],
  },
});
