import path from 'path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@shared': path.resolve(__dirname, 'shared'),
    },
  },
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['src/testUtils/setupTests.ts'],
    include: [
      'src/**/*.{test,spec}.{ts,tsx,js,jsx,mjs,cjs,mts,cts}',
      'src/**/__tests__/**/*.{test,spec}.{ts,tsx,js,jsx,mjs,cjs,mts,cts}',
      'tests/**/*.{test,spec}.{ts,tsx,js,jsx,mjs,cjs,mts,cts}',
    ],
  },
});
