import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { outcomeReadService } = vi.hoisted(() => ({
  outcomeReadService: { list: vi.fn() },
}));

vi.mock('@/server/aflTradeIntelligence/runtime/publicReadRuntime', () => ({
  getPublicAflTradeReadRuntime: async () => ({ outcomeReadService }),
}));

import { GET } from './route';
import { aflDraftTradePrePublicationOutcomeReadService } from '@/server/aflTradeIntelligence/outcomes/prePublicationOutcomeReadService';

describe('GET /api/draft-trades/outcomes', () => {
  beforeEach(() => {
    outcomeReadService.list.mockImplementation((request) =>
      aflDraftTradePrePublicationOutcomeReadService.list(request)
    );
  });

  it.each([
    'http://localhost/api/draft-trades/outcomes?year=20',
    'http://localhost/api/draft-trades/outcomes?metric=fantasy_points',
    'http://localhost/api/draft-trades/outcomes?status=verified',
    'http://localhost/api/draft-trades/outcomes?limit=101',
    'http://localhost/api/draft-trades/outcomes?metric=games&metric=goals',
  ])('rejects an invalid or ambiguous bounded query: %s', async (url) => {
    const response = await GET(new NextRequest(url));
    expect(response.status).toBe(400);
  });

  it('returns an honest factual-release blocker with public metric definitions', async () => {
    const response = await GET(
      new NextRequest('http://localhost/api/draft-trades/outcomes?year=2025&metric=games&limit=25')
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.consistency).toMatchObject({
      contractVersion: 'afl-draft-trade-outcomes/v1',
      publicAssetBoundary: 'source_native_afl_assets_no_user_or_fantasy_ownership',
      selection: 'none',
      release: null,
      registryRevision: 0,
      freshness: 'unavailable',
    });
    expect(body.data.metricDefinitions.map(({ metric }: { metric: string }) => metric)).toEqual([
      'games',
      'goals',
      'coaches_votes',
      'brownlow_votes',
    ]);
    expect(body.data.items).toEqual([]);
    expect(JSON.stringify(body.data)).not.toMatch(
      /"(userId|leagueId|memberId|rosterId|ownerId|fantasyTeamId)"/
    );
  });
});
