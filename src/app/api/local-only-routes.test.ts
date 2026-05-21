import { NextRequest } from 'next/server';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const firebaseMocks = vi.hoisted(() => ({
  createCustomToken: vi.fn(),
  createUser: vi.fn(),
  getUser: vi.fn(),
  collection: vi.fn(),
}));

const prismaMocks = vi.hoisted(() => ({
  draftCount: vi.fn(),
  draftFindFirst: vi.fn(),
  draftFindUnique: vi.fn(),
  transaction: vi.fn(),
}));

const lobbyMocks = vi.hoisted(() => ({
  ensureLobbyColumns: vi.fn(),
  ensureRosterTables: vi.fn(),
}));

const cacheMocks = vi.hoisted(() => ({
  revalidatePlayersTags: vi.fn(),
}));

vi.mock('@/lib/firebaseAdmin', () => ({
  adminAuth: {
    getUser: firebaseMocks.getUser,
    createUser: firebaseMocks.createUser,
    createCustomToken: firebaseMocks.createCustomToken,
  },
  adminDb: {
    collection: firebaseMocks.collection,
  },
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    draft: {
      count: prismaMocks.draftCount,
      findFirst: prismaMocks.draftFindFirst,
      findUnique: prismaMocks.draftFindUnique,
    },
    $transaction: prismaMocks.transaction,
  },
}));

vi.mock('@/lib/ensureLobbyColumns', () => ({
  ensureLobbyColumns: lobbyMocks.ensureLobbyColumns,
  ensureRosterTables: lobbyMocks.ensureRosterTables,
}));

vi.mock('@/lib/cache', () => ({
  revalidatePlayersTags: cacheMocks.revalidatePlayersTags,
}));

type RouteContext = { params: Promise<{ id: string }> };

type HandlerModule = {
  GET?: (request: NextRequest, context: RouteContext) => Promise<Response>;
  POST?: (request: NextRequest, context: RouteContext) => Promise<Response>;
};

const routes: Array<{
  label: string;
  method: 'GET' | 'POST';
  importRoute: () => Promise<HandlerModule>;
  url: string;
  context?: RouteContext;
}> = [
  {
    label: 'dev test user',
    method: 'POST',
    importRoute: () => import('./dev/test-user/route'),
    url: 'http://localhost/api/dev/test-user',
  },
  {
    label: 'add test data GET',
    method: 'GET',
    importRoute: () => import('./add-test-data/route'),
    url: 'http://localhost/api/add-test-data',
  },
  {
    label: 'add test data POST',
    method: 'POST',
    importRoute: () => import('./add-test-data/route'),
    url: 'http://localhost/api/add-test-data',
  },
  {
    label: 'create test draft GET',
    method: 'GET',
    importRoute: () => import('./create-test-draft/route'),
    url: 'http://localhost/api/create-test-draft',
  },
  {
    label: 'create test draft POST',
    method: 'POST',
    importRoute: () => import('./create-test-draft/route'),
    url: 'http://localhost/api/create-test-draft',
  },
  {
    label: 'test lobby',
    method: 'GET',
    importRoute: () => import('./test-lobby/route'),
    url: 'http://localhost/api/test-lobby',
  },
  {
    label: 'env check',
    method: 'GET',
    importRoute: () => import('./env-check/route'),
    url: 'http://localhost/api/env-check',
  },
  {
    label: 'admin check',
    method: 'GET',
    importRoute: () => import('./admin-check/route'),
    url: 'http://localhost/api/admin-check',
  },
  {
    label: 'draft debug',
    method: 'GET',
    importRoute: () => import('./drafts/[id]/debug/route'),
    url: 'http://localhost/api/drafts/draft-1/debug',
    context: { params: Promise.resolve({ id: 'draft-1' }) },
  },
];

const defaultRouteContext: RouteContext = {
  params: Promise.resolve({ id: 'unused' }),
};

describe('local-only API routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('STATLY_RUNTIME_ENV', 'preview');
  });

  it.each(routes)('returns 404 for $label outside explicit local runtime', async (route) => {
    const mod = await route.importRoute();
    const handler = mod[route.method];
    expect(handler).toBeTypeOf('function');

    const context = route.context ?? defaultRouteContext;
    const response = await handler!(new NextRequest(route.url, { method: route.method }), context);

    expect(response.status).toBe(404);
    expect(firebaseMocks.collection).not.toHaveBeenCalled();
    expect(firebaseMocks.getUser).not.toHaveBeenCalled();
    expect(firebaseMocks.createUser).not.toHaveBeenCalled();
    expect(firebaseMocks.createCustomToken).not.toHaveBeenCalled();
    expect(prismaMocks.transaction).not.toHaveBeenCalled();
    expect(prismaMocks.draftCount).not.toHaveBeenCalled();
    expect(prismaMocks.draftFindFirst).not.toHaveBeenCalled();
    expect(prismaMocks.draftFindUnique).not.toHaveBeenCalled();
    expect(lobbyMocks.ensureLobbyColumns).not.toHaveBeenCalled();
    expect(lobbyMocks.ensureRosterTables).not.toHaveBeenCalled();
    expect(cacheMocks.revalidatePlayersTags).not.toHaveBeenCalled();
  });
});
