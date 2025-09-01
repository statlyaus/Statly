/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    name: 'integration',
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    globals: true,
    setupFiles: ['tests/setup/int.setup.ts'],
    testTimeout: 30000,
    hookTimeout: 60000,
    reporters: ['default'],
    passWithNoTests: false,
  },
});
