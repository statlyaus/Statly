import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/server/aflTradeIntelligence/runtime/publicTradeRateLimit', () => ({
  limitPublicTradeRequest: async () => null,
}));

import { GET } from './route';

describe('GET /api/draft-trades/methodology', () => {
  it('returns truthful prepublication methodology metadata without numerical or model claims', async () => {
    const response = await GET(new NextRequest('http://localhost/api/draft-trades/methodology'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({
      availability: 'unavailable',
      reasonCode: 'no-active-publication',
      methodologyHref: '/draft/trades/methodology',
      methodology: null,
      consistency: {
        contractVersion: 'afl-trade-value/v2',
        selection: 'none',
        publication: null,
        registryRevision: 0,
        projectionBuildId: null,
        calculationAsOf: null,
        knowledgeCutoffAt: null,
        freshness: 'unavailable',
      },
      nextAction: {
        kind: 'await_calculation',
        href: '/draft/trades/methodology',
        expectedAfter: null,
      },
    });
    expect(JSON.stringify(body.data)).not.toMatch(
      /"(modelVersion|valuationBundleId|trainingPeriod|primaryOutcome|estimate|probabilities|userId|leagueId|rosterId|ownerId)"/
    );
  });
});
