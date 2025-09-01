import { afterEach, beforeAll, vi } from 'vitest';

beforeAll(() => {
  vi.stubGlobal('fetch', (..._args: any[]) => {
    throw new Error('Network calls are disabled in unit tests. Mock them.');
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
