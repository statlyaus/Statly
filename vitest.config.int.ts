/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
import path from 'path';

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
    setupFiles: ['tests/setup/int.setup.ts'],
    testTimeout: 30000,
    hookTimeout: 60000,
    reporters: ['default'],
    passWithNoTests: false,
  },
});
