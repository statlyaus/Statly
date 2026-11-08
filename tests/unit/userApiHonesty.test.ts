import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  findMany: vi.fn(),
  findFirst: vi.fn(),
}));

vi.mock('@/lib/serverAuth', () => ({ getUserIdFromRequest: mocks.authenticate }));
vi.mock('@/lib/prisma', () => ({
  prisma: { leagueMember: { findMany: mocks.findMany, findFirst: mocks.findFirst } },
}));

import { GET as GET_TEAMS, POST as POST_TEAMS } from '@/app/api/user/teams/route';

const repoRoot = process.cwd();

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return routeFiles(path);
    return entry === 'route.ts' ? [relative(repoRoot, path)] : [];
  });
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry) ? [path] : [];
  });
}

describe('user API honesty', () => {
  it('keeps only the Prisma-backed /api/user route; the stubbed profile, league and watchlist routes are gone', () => {
    expect(routeFiles(join(repoRoot, 'src/app/api/user'))).toEqual([
      'src/app/api/user/teams/route.ts',
    ]);

    const teamsRoute = readFileSync(join(repoRoot, 'src/app/api/user/teams/route.ts'), 'utf8');
    expect(teamsRoute).toContain("import { prisma } from '@/lib/prisma'");
  });

  it('has no stub user profile service left for any code to fake success through', () => {
    expect(existsSync(join(repoRoot, 'src/services/userProfileService.ts'))).toBe(false);

    const offenders = sourceFiles(join(repoRoot, 'src'))
      .filter((path) => /userProfileService|useUserProfile/.test(readFileSync(path, 'utf8')))
      .map((path) => relative(repoRoot, path));
    expect(offenders).toEqual([]);
  });

  it('shows no league selector or watchlist on /matches, since nothing persisted backs either', () => {
    const matchesPage = readFileSync(join(repoRoot, 'src/app/(app)/matches/page.tsx'), 'utf8');
    const matchCenter = readFileSync(
      join(repoRoot, 'src/components/advanced/RealTimeMatchCenter.tsx'),
      'utf8'
    );

    expect(matchesPage).not.toContain('<select');
    expect(matchesPage).not.toMatch(/watchlist/i);
    expect(matchCenter).not.toContain('My Players');
    expect(matchCenter).not.toMatch(/watchlist/i);
  });
});

describe('/api/user/teams', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects an unauthenticated caller without reading Prisma', async () => {
    mocks.authenticate.mockResolvedValue(null);

    const response = await GET_TEAMS(new NextRequest('http://localhost/api/user/teams'));

    expect(response.status).toBe(401);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("lists the caller's Prisma memberships, ignoring a client-supplied userId", async () => {
    mocks.authenticate.mockResolvedValue('actor');
    mocks.findMany.mockResolvedValue([{ id: 'member-1', leagueId: 'league-1', teamName: 'Hawks' }]);

    const response = await GET_TEAMS(
      new NextRequest('http://localhost/api/user/teams?userId=victim')
    );

    expect(response.status).toBe(200);
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'actor' } })
    );
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: [{ memberId: 'member-1', leagueId: 'league-1', teamName: 'Hawks' }],
    });
  });

  it('refuses to select a team the caller does not own and sets no cookie', async () => {
    mocks.authenticate.mockResolvedValue('actor');
    mocks.findFirst.mockResolvedValue(null);

    const response = await POST_TEAMS(
      new NextRequest('http://localhost/api/user/teams', {
        method: 'POST',
        headers: { origin: 'http://localhost', host: 'localhost' },
        body: JSON.stringify({ leagueId: 'league-1', memberId: 'member-of-victim' }),
      })
    );

    expect(response.status).toBe(403);
    expect(mocks.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'member-of-victim', leagueId: 'league-1', userId: 'actor' },
      })
    );
    expect(response.cookies.get('active_league')).toBeUndefined();
  });
});
