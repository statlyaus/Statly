import { NextRequest } from 'next/server';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const startDraftIfOverdueMock = vi.fn();
const autoPickIfExpiredMock = vi.fn();
const publishCommandResultMock = vi.fn();
const draftFindUniqueMock = vi.fn();
const pickFindFirstMock = vi.fn();
const pickCountMock = vi.fn();

vi.mock('@/server/draft/services/DraftApplicationService', () => ({
  draftApplicationService: {
    startDraftIfOverdue: startDraftIfOverdueMock,
    autoPickIfExpired: autoPickIfExpiredMock,
  },
}));

vi.mock('@/server/draft/services/DraftRealtimePublisher', () => ({
  draftRealtimePublisher: {
    publishCommandResult: publishCommandResultMock,
  },
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    draft: {
      findUnique: draftFindUniqueMock,
    },
    pick: {
      findFirst: pickFindFirstMock,
      count: pickCountMock,
    },
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

function request() {
  return new NextRequest('http://localhost/api/drafts/cmp7owptn00gquxz8wun1z7a8');
}

function context() {
  return {
    params: Promise.resolve({ id: 'cmp7owptn00gquxz8wun1z7a8' }),
  };
}

function draftTimes() {
  return {
    createdAt: new Date('2026-05-18T00:00:00.000Z'),
    startedAt: new Date('2026-05-18T00:01:00.000Z'),
    completedAt: null,
  };
}

function draftRecord() {
  return {
    id: 'cmp7owptn00gquxz8wun1z7a8',
    status: 'LIVE',
    currentPick: 15,
    totalPicks: 264,
    round: 2,
    direction: 'FORWARD',
    pickDeadlineAt: new Date('2026-05-18T00:03:00.000Z'),
    createdAt: new Date('2026-05-18T00:00:00.000Z'),
    startedAt: new Date('2026-05-18T00:01:00.000Z'),
    completedAt: null,
    league: {
      name: 'Statly Fixture Full League 1',
      categoriesJson: JSON.stringify([]),
      settings: {
        draftType: 'SNAKE',
        pickSeconds: 120,
      },
    },
    orders: [
      {
        slot: 1,
        member: {
          id: 'member-1',
          userId: 'statly-dev-tester',
          user: { displayName: 'Statly Dev Tester' },
        },
      },
    ],
  };
}

describe('GET /api/drafts/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    startDraftIfOverdueMock.mockResolvedValue(null);
    autoPickIfExpiredMock.mockResolvedValue(null);
    publishCommandResultMock.mockResolvedValue(undefined);
    draftFindUniqueMock.mockImplementation((args) =>
      args?.select?.createdAt ? Promise.resolve(draftTimes()) : Promise.resolve(draftRecord())
    );
    pickFindFirstMock.mockResolvedValue({
      madeAt: new Date('2026-05-18T00:02:00.000Z'),
      overall: 14,
    });
    pickCountMock.mockResolvedValue(14);
  });

  it('returns draft metadata when opportunistic auto-pick repair fails', async () => {
    autoPickIfExpiredMock.mockRejectedValue(new Error('Draft order is missing slot 3'));
    const { GET } = await import('./route');

    const response = await GET(request(), context());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(autoPickIfExpiredMock).toHaveBeenCalledWith({
      draftId: 'cmp7owptn00gquxz8wun1z7a8',
    });
    expect(body.data).toEqual(
      expect.objectContaining({
        id: 'cmp7owptn00gquxz8wun1z7a8',
        status: 'LIVE',
        currentPick: 15,
        picksSummary: {
          count: 14,
          latestOverall: 14,
        },
      })
    );
  });
});
