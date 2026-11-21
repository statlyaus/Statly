import { describe, expect, it } from 'vitest';

import { DAWSON_SEASONS } from '@/components/aflTradeMethod/dawsonExample';
import { round } from '@/components/aflTradeMethod/explainerFormat';

const pools = ['off', 'mid', 'def'] as const;

describe('How Statly values trades: printed sums give their printed answers', () => {
  // The method page shows its working; every season's sums must reproduce, at the decimals shown
  // (operands 4, ratings 3 in the rating line and 4 in the share line, all ratings 3, club value 2).
  it.each(DAWSON_SEASONS.map((d) => [d.season, d] as const))('in %i', (_season, d) => {
    const a = d.adelaide;
    const league = round(d.leaguePointsPerInside50, 4);
    expect(round(round(a.pointsFor / a.inside50sFor, 4) / league, 3)).toBe(round(a.rating.off, 3));
    expect(round(a.inside50sFor / a.inside50sAgainst, 3)).toBe(round(a.rating.mid, 3));
    expect(round(2 - round(a.pointsAgainst / a.inside50sAgainst, 4) / league, 3)).toBe(
      round(a.rating.def, 3)
    );
    for (const k of pools) {
      expect(round((d.clubs * 100 * round(a.rating[k], 4)) / round(a.allRatings[k], 3), 1)).toBe(
        round(a.pav[k], 1)
      );
      expect(
        round((round(a.pav[k], 2) * d.dawson.score[k]) / round(d.dawson.clubScore[k], 1), 2)
      ).toBe(round(d.dawson.pav[k], 2));
    }
  });
});
