import { NextRequest } from 'next/server';

import { DraftStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getAuthenticatedUserIdMock = vi.fn();
const draftFindUniqueMock = vi.fn();
const transactionMock = vi.fn();
const leagueSettingsUpdateMock = vi.fn();
const draftUpdateMock = vi.fn();
const scheduleDraftStartMock = vi.fn();
const updateDraftRemindersMock = vi.fn();

vi.mock('@/lib/serverAuth', () => ({
  getAuthenticatedUserId: getAuthenticatedUserIdMock,
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    draft: {
      findUnique: draftFindUniqueMock,
    },
    $transaction: transactionMock,
  },
}));

vi.mock('@/server/queue/draftQueue', () => ({
  scheduleDraftStart: scheduleDraftStartMock,
}));

vi.mock('@/lib/reminders', () => ({
  updateDraftReminders: updateDraftRemindersMock,
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

function scheduleRequest() {
  return new NextRequest('http://localhost/api/drafts/draft-1/schedule', {
    method: 'PUT',
    body: JSON.stringify({
      scheduledTime: '2030-06-01T10:00:00',
      timePerPick: 120,
      timeZone: 'UTC',
    }),
  });
}

function scheduledDraft(memberRole: string, ownerId = 'owner-1') {
  return {
    id: 'draft-1',
    leagueId: 'league-1',
    status: DraftStatus.SCHEDULED,
    league: {
      ownerId,
      settings: {
        id: 'settings-1',
        pickSeconds: 90,
      },
      members: [
        {
          userId: 'actor-1',
          role: memberRole,
        },
      ],
    },
  };
}

describe('PUT /api/drafts/[id]/schedule', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthenticatedUserIdMock.mockResolvedValue('owner-1');
    draftFindUniqueMock.mockResolvedValue(scheduledDraft('OWNER'));
    transactionMock.mockImplementation(async (callback) =>
      callback({
        leagueSettings: {
          update: leagueSettingsUpdateMock,
        },
        draft: {
          update: draftUpdateMock,
        },
      })
    );
    scheduleDraftStartMock.mockResolvedValue(undefined);
    updateDraftRemindersMock.mockResolvedValue(undefined);
  });

  it('rejects unauthenticated schedule updates before reading draft state', async () => {
    getAuthenticatedUserIdMock.mockResolvedValue(null);
    const { PUT } = await import('./route');

    const response = await PUT(scheduleRequest(), {
      params: Promise.resolve({ id: 'draft-1' }),
    });

    expect(response.status).toBe(401);
    expect(draftFindUniqueMock).not.toHaveBeenCalled();
    expect(scheduleDraftStartMock).not.toHaveBeenCalled();
  });

  it('rejects authenticated league members without manager privileges before mutation', async () => {
    getAuthenticatedUserIdMock.mockResolvedValue('actor-1');
    draftFindUniqueMock.mockResolvedValue(scheduledDraft('MANAGER', 'owner-1'));
    const { PUT } = await import('./route');

    const response = await PUT(scheduleRequest(), {
      params: Promise.resolve({ id: 'draft-1' }),
    });

    expect(response.status).toBe(403);
    expect(transactionMock).not.toHaveBeenCalled();
    expect(scheduleDraftStartMock).not.toHaveBeenCalled();
  });

  it('allows a league owner to update the draft schedule', async () => {
    getAuthenticatedUserIdMock.mockResolvedValue('owner-1');
    draftFindUniqueMock.mockResolvedValue(scheduledDraft('OWNER', 'owner-1'));
    const { PUT } = await import('./route');

    const response = await PUT(scheduleRequest(), {
      params: Promise.resolve({ id: 'draft-1' }),
    });

    expect(response.status).toBe(200);
    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(scheduleDraftStartMock).toHaveBeenCalledWith('league-1', expect.any(Date), 120_000);
  });
});

describe('DELETE /api/drafts/[id]/schedule', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthenticatedUserIdMock.mockResolvedValue('owner-1');
    draftFindUniqueMock.mockResolvedValue(scheduledDraft('OWNER'));
    transactionMock.mockImplementation(async (callback) =>
      callback({
        leagueSettings: {
          update: leagueSettingsUpdateMock,
        },
        draft: {
          update: draftUpdateMock,
        },
      })
    );
  });

  it('rejects unauthenticated schedule cancellation before reading draft state', async () => {
    getAuthenticatedUserIdMock.mockResolvedValue(null);
    const { DELETE } = await import('./route');

    const response = await DELETE(
      new NextRequest('http://localhost/api/drafts/draft-1/schedule', {
        method: 'DELETE',
      }),
      { params: Promise.resolve({ id: 'draft-1' }) }
    );

    expect(response.status).toBe(401);
    expect(draftFindUniqueMock).not.toHaveBeenCalled();
  });

  it('rejects authenticated league members without manager privileges before cancellation', async () => {
    getAuthenticatedUserIdMock.mockResolvedValue('actor-1');
    draftFindUniqueMock.mockResolvedValue(scheduledDraft('MANAGER', 'owner-1'));
    const { DELETE } = await import('./route');

    const response = await DELETE(
      new NextRequest('http://localhost/api/drafts/draft-1/schedule', {
        method: 'DELETE',
      }),
      { params: Promise.resolve({ id: 'draft-1' }) }
    );

    expect(response.status).toBe(403);
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it('allows a league owner to cancel the draft schedule', async () => {
    const { DELETE } = await import('./route');

    const response = await DELETE(
      new NextRequest('http://localhost/api/drafts/draft-1/schedule', {
        method: 'DELETE',
      }),
      { params: Promise.resolve({ id: 'draft-1' }) }
    );

    expect(response.status).toBe(200);
    expect(transactionMock).toHaveBeenCalledTimes(1);
  });
});
