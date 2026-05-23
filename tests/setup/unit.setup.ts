import { afterEach, beforeAll, vi } from 'vitest';

vi.mock('server-only', () => ({}));

beforeAll(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('Network calls are disabled in unit tests. Mock them.');
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
