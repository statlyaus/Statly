import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAuthenticatedUserId: vi.fn(),
  getLeagueMembership: vi.fn(),
  findLeague: vi.fn(),
  updateLeagueSettings: vi.fn(),
  publishCompetition: vi.fn(),
  setCompetitionRoundFallbackDeadline: vi.fn(),
  saveCompetitionFixture: vi.fn(),
  deleteCompetitionFixture: vi.fn(),
}));

vi.mock('@/lib/serverAuth', () => ({
  getAuthenticatedUserId: mocks.getAuthenticatedUserId,
}));

vi.mock('@/lib/leagueMembership', () => ({
  getLeagueMembership: mocks.getLeagueMembership,
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: mocks.findLeague },
    leagueSettings: { update: mocks.updateLeagueSettings },
  },
}));

vi.mock('@/server/leagues/competitionService', () => ({
  publishCompetition: mocks.publishCompetition,
  setCompetitionRoundFallbackDeadline: mocks.setCompetitionRoundFallbackDeadline,
  saveCompetitionFixture: mocks.saveCompetitionFixture,
  deleteCompetitionFixture: mocks.deleteCompetitionFixture,
}));

import { PATCH, POST, PUT } from '@/app/api/leagues/[id]/competition/route';

function readRepoFile(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

function requireResponse(response: Response | undefined): Response {
  if (!response) throw new Error('Expected the route handler to return a response.');
  return response;
}

describe('league matchup API route architecture', () => {
  beforeEach(() => {
    mocks.getAuthenticatedUserId.mockReset().mockResolvedValue('owner-user');
    mocks.getLeagueMembership.mockReset().mockResolvedValue({ isMember: true });
    mocks.findLeague.mockReset().mockResolvedValue({
      ownerId: 'owner-user',
      categoriesJson: '["goals"]',
      settings: {
        id: 'settings-1',
        competitionStatus: 'PUBLISHED',
        competitionRulesJson: '{}',
        competitionRulesVersion: 1,
      },
      members: [{ id: 'member-1', userId: 'owner-user', isCoCommissioner: false }],
    });
    mocks.updateLeagueSettings.mockReset();
    mocks.publishCompetition.mockReset();
    mocks.setCompetitionRoundFallbackDeadline.mockReset();
    mocks.saveCompetitionFixture.mockReset();
    mocks.deleteCompetitionFixture.mockReset();
  });

  it('keeps routes league-scoped, authorization-gated, and service-backed', () => {
    const matchupsRoute = readRepoFile('src/app/api/leagues/[id]/matchups/route.ts');
    const recalcRoute = readRepoFile(
      'src/app/api/leagues/[id]/matchups/[round]/recalculate/route.ts'
    );
    const lineupRoute = readRepoFile('src/app/api/leagues/[id]/lineups/[round]/route.ts');
    const competitionRoute = readRepoFile('src/app/api/leagues/[id]/competition/route.ts');

    expect(matchupsRoute).toContain('getAuthenticatedUserId');
    expect(matchupsRoute).toContain('getLeagueMembership');
    expect(matchupsRoute).toContain('loadLeagueMatchupReadModel');
    expect(matchupsRoute).toContain('userId');
    expect(matchupsRoute).not.toContain('generateLeagueFixtures');
    expect(matchupsRoute).toContain('Fixtures are published from Competition Rules');
    expect(matchupsRoute).toContain('export async function GET');
    expect(matchupsRoute).toContain('export async function POST');

    expect(recalcRoute).toContain('getAuthenticatedUserId');
    expect(recalcRoute).toContain('getLeagueMembership');
    expect(recalcRoute).toContain('recalculateLeagueRoundMatchups');
    expect(recalcRoute).not.toContain('scoreHeadToHeadCategories;');
    expect(recalcRoute).not.toContain('calculateStandingsRows;');

    expect(lineupRoute).toContain('getAuthenticatedUserId');
    expect(lineupRoute).toContain('getLeagueMembership');
    expect(lineupRoute).toContain('loadMemberLineup');
    expect(lineupRoute).toContain('saveMemberLineup');
    expect(lineupRoute).not.toContain('requestedPlayers');
    expect(lineupRoute).toContain('export async function GET');
    expect(lineupRoute).toContain('export async function PATCH');

    expect(competitionRoute).toContain('export async function PATCH');
  });

  it('returns 400 for malformed competition mutation JSON without invoking a service', async () => {
    const request = new NextRequest('http://localhost/api/leagues/league-1/competition', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: '{',
    });

    const response = requireResponse(
      await PATCH(request, { params: Promise.resolve({ id: 'league-1' }) })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'A valid JSON object is required.',
    });
    expect(mocks.setCompetitionRoundFallbackDeadline).not.toHaveBeenCalled();
  });

  it('dispatches the current save-fixture action contract', async () => {
    mocks.saveCompetitionFixture.mockResolvedValue({
      ok: true,
      fixture: {
        id: 'fixture-1',
        round: 2,
        homeMemberId: 'member-1',
        awayMemberId: 'member-2',
        byeMemberId: null,
      },
    });
    const request = new NextRequest('http://localhost/api/leagues/league-1/competition', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'SAVE_FIXTURE',
        round: 2,
        fixture: { homeMemberId: 'member-1', awayMemberId: 'member-2' },
      }),
    });

    const response = requireResponse(
      await PATCH(request, { params: Promise.resolve({ id: 'league-1' }) })
    );

    expect(response.status).toBe(200);
    expect(mocks.saveCompetitionFixture).toHaveBeenCalledWith({
      leagueId: 'league-1',
      round: 2,
      actorMemberId: 'member-1',
      fixture: {
        matchupId: null,
        homeMemberId: 'member-1',
        awayMemberId: 'member-2',
        byeMemberId: null,
      },
    });
  });

  it('returns 400 for a non-object rules payload without saving competition settings', async () => {
    mocks.findLeague.mockResolvedValueOnce({
      ownerId: 'owner-user',
      categoriesJson: '["goals"]',
      settings: {
        id: 'settings-1',
        competitionStatus: 'SETUP',
        competitionRulesJson: '{}',
        competitionRulesVersion: 0,
      },
      members: [{ id: 'member-1', userId: 'owner-user', isCoCommissioner: false }],
    });
    const request = new NextRequest('http://localhost/api/leagues/league-1/competition', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: '[]',
    });

    const response = requireResponse(
      await PUT(request, { params: Promise.resolve({ id: 'league-1' }) })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'A valid JSON object is required.' });
    expect(mocks.updateLeagueSettings).not.toHaveBeenCalled();
  });

  it('returns 400 for malformed publish JSON without publishing competition data', async () => {
    const request = new NextRequest('http://localhost/api/leagues/league-1/competition', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    });

    const response = requireResponse(
      await POST(request, { params: Promise.resolve({ id: 'league-1' }) })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'A valid JSON object is required.' });
    expect(mocks.publishCompetition).not.toHaveBeenCalled();
  });
});
