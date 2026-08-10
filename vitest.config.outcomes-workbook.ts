/// <reference types="vitest" />
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: { alias: { '@': path.resolve(root, 'src') } },
  test: {
    name: 'outcomes-development-workbook',
    environment: 'node',
    include: ['tests/workbook-integration/**/*.test.ts'],
    globals: true,
    testTimeout: 120_000,
    hookTimeout: 120_000,
    reporters: ['default'],
  },
});
