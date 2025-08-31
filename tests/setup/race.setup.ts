import { beforeAll, afterAll, vi } from 'vitest';

beforeAll(() => {
  // use vi.useFakeTimers() inside individual tests if needed
});

afterAll(() => {
  vi.useRealTimers();
});
