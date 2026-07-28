import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

const routeMocks = vi.hoisted(() => ({
  loadLobbySchemaDiagnostic: vi.fn(),
  revalidatePlayersTags: vi.fn(),
}));

vi.mock('@/lib/cache', () => ({
  revalidatePlayersTags: routeMocks.revalidatePlayersTags,
}));
vi.mock('@/lib/firebaseAdmin', () => ({ adminDb: {} }));
vi.mock('@/lib/logger', () => ({
  logger: {
    apiError: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/server/diagnostics/lobbySchemaDiagnostic', () => ({
  loadLobbySchemaDiagnostic: routeMocks.loadLobbySchemaDiagnostic,
}));

import { GET as getTestData, POST as addTestData } from '@/app/api/add-test-data/route';
import { GET as getTestDraft, POST as createTestDraft } from '@/app/api/create-test-draft/route';
import { POST as createTestUser } from '@/app/api/dev/test-user/route';
import { GET as getDraftDebug } from '@/app/api/drafts/[id]/debug/route';
import { GET as getLobbyDiagnostic } from '@/app/api/test-lobby/route';

const guardedHandlers = [
  { name: 'add-test-data POST', invoke: () => addTestData(request('POST')) },
  { name: 'add-test-data GET', invoke: () => getTestData() },
  { name: 'create-test-draft POST', invoke: () => createTestDraft(request('POST')) },
  { name: 'create-test-draft GET', invoke: () => getTestDraft(request('GET')) },
  { name: 'dev/test-user POST', invoke: () => createTestUser(request('POST')) },
  {
    name: 'draft debug GET',
    invoke: () =>
      getDraftDebug(request('GET'), { params: Promise.resolve({ id: 'draft-not-read' }) }),
  },
  { name: 'test-lobby GET', invoke: () => getLobbyDiagnostic(request('GET')) },
] as const;

describe('disabled development tool routes', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each(guardedHandlers)('returns a hidden 404 from $name', async ({ invoke }) => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('STATLY_ENABLE_DEV_TOOLS', '');

    const response = await invoke();

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: { message: 'Not Found', code: 'NOT_FOUND' },
    });
    expect(routeMocks.loadLobbySchemaDiagnostic).not.toHaveBeenCalled();
    expect(routeMocks.revalidatePlayersTags).not.toHaveBeenCalled();
  });
});

function request(method: string): NextRequest {
  return new NextRequest('http://localhost/api/development-tool', { method });
}
