import '@testing-library/jest-dom/vitest';
import { afterEach, beforeAll, vi } from 'vitest';

vi.mock('server-only', () => ({}));

// Constructing a PrismaClient loads the native query engine immediately, without a query. Inside a
// Vitest worker that has aborted the whole unit run (#809), so the unit tier never constructs one.
// Modules that import the shared client get one that throws on first use; a test that needs it
// injects a fake or mocks '@/lib/prisma' itself, which overrides this.
vi.mock('@/lib/prisma', () => ({
  prisma: new Proxy(
    {},
    {
      get(_target, property) {
        // Leave symbols and `then` unanswered so matchers, formatters and `await` can inspect it.
        if (typeof property === 'symbol' || property === 'then') return undefined;
        throw new Error(
          `Unit tests must not use the shared Prisma client (prisma.${property}). Inject a fake ` +
            "client, vi.mock('@/lib/prisma'), or move the test to tests/integration."
        );
      },
    }
  ),
}));

vi.mock('@prisma/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@prisma/client')>();
  class UnitTierPrismaClient {
    constructor() {
      throw new Error(
        'Unit tests must not construct a PrismaClient. vi.mock the module that imports ' +
          '@/lib/prisma, or move the test to tests/integration.'
      );
    }
  }
  return { ...actual, PrismaClient: UnitTierPrismaClient };
});

beforeAll(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('Network calls are disabled in unit tests. Mock them.');
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
