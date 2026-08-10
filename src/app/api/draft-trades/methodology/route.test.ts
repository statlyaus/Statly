import { describe, expect, it } from 'vitest';

import { GET } from './route';

describe('GET /api/draft-trades/methodology', () => {
  it('returns truthful prepublication methodology metadata without numerical or model claims', async () => {
    const response = await GET();
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
