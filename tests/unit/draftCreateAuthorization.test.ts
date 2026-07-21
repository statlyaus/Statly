import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { getLeagueMembership } from '@/lib/leagueMembership';
import { adminDb } from '@/lib/firebaseAdmin';
import { getLeagueMembershipAccess } from '@/server/leagues/membership';

const scheduleDraftStart = vi.fn();
const createDraftReminders = vi.fn();
const ensurePrismaLeagueMirror = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/serverAuth', () => ({
  getAuthenticatedUserId: vi.fn(),
}));

vi.mock('@/lib/firebaseAdmin', () => ({
  adminDb: {
    collection: vi.fn(),
  },
}));

vi.mock('@/lib/leagueMembership', () => ({
  getLeagueMembership: vi.fn(),
  isLeagueManagerRole: (role: unknown) =>
    typeof role === 'string' &&
    ['owner', 'commissioner', 'admin', 'manager'].includes(role.trim().toLowerCase()),
}));

vi.mock('@/server/queue/draftQueue', () => ({
  scheduleDraftStart,
}));

vi.mock('@/lib/reminders', () => ({
  createDraftReminders,
}));

vi.mock('@/lib/prismaLeagueBridge', () => ({
  ensurePrismaLeagueMirror,
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.mocked(adminDb.collection).mockReturnValue({
    doc: vi.fn().mockReturnValue({
      get: vi.fn().mockResolvedValue({
        exists: false,
        data: () => undefined,
      }),
    }),
  } as never);
});

describe('draft create authorization architecture', () => {
  it('authenticates and authorizes league managers before draft creation side effects', () => {
    const source = readFileSync(join(process.cwd(), 'src/app/api/drafts/route.ts'), 'utf8');

    expect(source).toContain("import { getAuthenticatedUserId } from '@/lib/serverAuth'");
    expect(source).toContain("import { canManageLeague } from '@/server/leagues/membership'");
    expect(source).toContain('const userId = await getAuthenticatedUserId(request);');
    expect(source).toContain('await canManageLeague(body.leagueId, userId)');
    expect(source).toMatch(
      /return NextResponse\.json\(\s*\{ success: false, error: 'Authentication required' \},\s*\{ status: 401 \}\s*\)/
    );
    expect(source).toMatch(
      /return NextResponse\.json\(\s*\{ success: false, error: 'Commissioner access required' \},\s*\{ status: 403 \}\s*\)/
    );

    expect(source.indexOf('const userId = await getAuthenticatedUserId(request);')).toBeLessThan(
      source.indexOf('await ensurePrismaLeagueMirror')
    );
    expect(source.indexOf('await canManageLeague(body.leagueId, userId)')).toBeLessThan(
      source.indexOf('await ensurePrismaLeagueMirror')
    );
  });

  it('does not fall back to legacy membership when Prisma has no active member', async () => {
    vi.mocked(prisma.league.findUnique).mockResolvedValue({
      ownerId: 'prisma-owner',
      members: [],
    } as never);
    vi.mocked(getLeagueMembership).mockResolvedValue({
      isMember: true,
      source: 'legacy',
      memberDocId: 'legacy-member',
      data: { role: 'commissioner' },
    });

    const access = await getLeagueMembershipAccess('league-1', 'user-1');

    expect(getLeagueMembership).not.toHaveBeenCalled();
    expect(access).toEqual({
      leagueId: 'league-1',
      userId: 'user-1',
      isMember: false,
      canManage: false,
    });
  });

  it('falls back to Firestore league ownership when Prisma access is missing', async () => {
    vi.mocked(prisma.league.findUnique).mockResolvedValue(null);
    vi.mocked(getLeagueMembership).mockResolvedValue({
      isMember: false,
      source: 'none',
    });
    vi.mocked(adminDb.collection).mockReturnValue({
      doc: vi.fn().mockReturnValue({
        get: vi.fn().mockResolvedValue({
          exists: true,
          data: () => ({ ownerId: 'user-1' }),
        }),
      }),
    } as never);

    const access = await getLeagueMembershipAccess('league-1', 'user-1');

    expect(access).toEqual({
      leagueId: 'league-1',
      userId: 'user-1',
      role: 'owner',
      isMember: true,
      canManage: true,
    });
  });

  it('does not let Firestore ownership override an active Prisma member role', async () => {
    vi.mocked(prisma.league.findUnique).mockResolvedValue({
      ownerId: 'prisma-owner',
      members: [
        {
          id: 'prisma-member',
          role: 'MEMBER',
          isActive: true,
          status: 'ACTIVE',
          isCoCommissioner: false,
        },
      ],
    } as never);
    vi.mocked(getLeagueMembership).mockResolvedValue({
      isMember: false,
      source: 'none',
    });
    vi.mocked(adminDb.collection).mockReturnValue({
      doc: vi.fn().mockReturnValue({
        get: vi.fn().mockResolvedValue({
          exists: true,
          data: () => ({ ownerId: 'user-1' }),
        }),
      }),
    } as never);

    const access = await getLeagueMembershipAccess('league-1', 'user-1');

    expect(access).toEqual({
      leagueId: 'league-1',
      userId: 'user-1',
      memberId: 'prisma-member',
      role: 'MEMBER',
      isMember: true,
      canManage: false,
    });
    expect(adminDb.collection).not.toHaveBeenCalled();
  });

  it('returns 401 before parsing or draft side effects when the request is unauthenticated', async () => {
    vi.mocked(getAuthenticatedUserId).mockResolvedValue(null);
    const json = vi.fn();
    const { POST } = await import('@/app/api/drafts/route');

    const response = await POST({ json } as never);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Authentication required',
    });
    expect(json).not.toHaveBeenCalled();
    expect(ensurePrismaLeagueMirror).not.toHaveBeenCalled();
    expect(scheduleDraftStart).not.toHaveBeenCalled();
    expect(createDraftReminders).not.toHaveBeenCalled();
  });

  it('returns 400 in production before draft side effects when leagueId is missing', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.mocked(getAuthenticatedUserId).mockResolvedValue('user-1');
    const { POST } = await import('@/app/api/drafts/route');

    const response = await POST({
      json: vi.fn().mockResolvedValue({
        name: 'Standalone draft',
        leagueSize: 12,
        draftType: 'snake',
        timePerPick: 60,
      }),
    } as never);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'League draft creation requires a leagueId',
    });
    expect(ensurePrismaLeagueMirror).not.toHaveBeenCalled();
    expect(scheduleDraftStart).not.toHaveBeenCalled();
    expect(createDraftReminders).not.toHaveBeenCalled();
  });

  it('returns 403 before draft side effects when the user cannot manage the league', async () => {
    vi.mocked(getAuthenticatedUserId).mockResolvedValue('user-1');
    vi.mocked(prisma.league.findUnique).mockResolvedValue(null);
    vi.mocked(getLeagueMembership).mockResolvedValue({
      isMember: true,
      source: 'legacy',
      memberDocId: 'member-1',
      data: { role: 'member' },
    });
    const { POST } = await import('@/app/api/drafts/route');

    const response = await POST({
      json: vi.fn().mockResolvedValue({
        name: 'League draft',
        leagueId: 'league-1',
        leagueSize: 12,
        draftType: 'snake',
        timePerPick: 60,
      }),
    } as never);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Commissioner access required',
    });
    expect(ensurePrismaLeagueMirror).not.toHaveBeenCalled();
    expect(scheduleDraftStart).not.toHaveBeenCalled();
    expect(createDraftReminders).not.toHaveBeenCalled();
  });
});
