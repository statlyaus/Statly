import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prisma, getAuthenticatedUserId, getDraftMembershipAccess } = vi.hoisted(() => ({
  prisma: {
    draft: { findUnique: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(),
  },
  getAuthenticatedUserId: vi.fn(),
  getDraftMembershipAccess: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/serverAuth', () => ({ getAuthenticatedUserId }));
vi.mock('@/server/leagues/membership', () => ({ getDraftMembershipAccess }));
vi.mock('@/server/queue/draftQueue', () => ({ scheduleDraftStart: vi.fn() }));
vi.mock('@/lib/reminders', () => ({ updateDraftReminders: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { DELETE, PUT } from '@/app/api/drafts/[id]/schedule/route';

const params = Promise.resolve({ id: 'draft-1' });

function request(method: 'PUT' | 'DELETE'): NextRequest {
  return new NextRequest('http://localhost:3000/api/drafts/draft-1/schedule', {
    method,
    body: method === 'PUT' ? JSON.stringify({ scheduledTime: '2030-01-01T10:00' }) : undefined,
  });
}

describe('draft schedule route authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(['PUT', 'DELETE'] as const)(
    'rejects an anonymous %s without reading the draft',
    async (method) => {
      getAuthenticatedUserId.mockResolvedValue(null);

      const handler = method === 'PUT' ? PUT : DELETE;
      const response = await handler(request(method), { params });

      expect(response.status).toBe(401);
      expect(prisma.draft.findUnique).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    }
  );

  it.each(['PUT', 'DELETE'] as const)(
    'rejects a %s from a member who cannot manage the league',
    async (method) => {
      getAuthenticatedUserId.mockResolvedValue('member-1');
      getDraftMembershipAccess.mockResolvedValue({ canManage: false });

      const handler = method === 'PUT' ? PUT : DELETE;
      const response = await handler(request(method), { params });

      expect(response.status).toBe(403);
      expect(getDraftMembershipAccess).toHaveBeenCalledWith('draft-1', 'member-1');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    }
  );

  it('lets a commissioner cancel the schedule', async () => {
    getAuthenticatedUserId.mockResolvedValue('owner-1');
    getDraftMembershipAccess.mockResolvedValue({ canManage: true });
    prisma.draft.findUnique.mockResolvedValue({
      id: 'draft-1',
      leagueId: 'league-1',
      status: 'SCHEDULED',
      league: { settings: null },
    });
    prisma.$transaction.mockImplementation(async (run: (tx: typeof prisma) => Promise<void>) =>
      run(prisma)
    );

    const response = await DELETE(request('DELETE'), { params });

    expect(response.status).toBe(200);
    expect(prisma.draft.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'draft-1' } })
    );
  });
});
