import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
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
    ],
  },
});
