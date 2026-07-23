import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('temporary trade list compatibility architecture', () => {
  it('loads league-scoped trades through the canonical Prisma read model', () => {
    const source = readFileSync(join(process.cwd(), 'src/app/api/trades/list/route.ts'), 'utf8');

    expect(source).toContain('loadAuthorizedLeagueTradeCentre');
    expect(source).toContain('toLegacyLeagueTradeList');
    expect(source).toContain('userId: auth.userId');
    expect(source).toContain('view');
    expect(source).toContain('cursor');
    expect(source).not.toContain("collection('leagues').doc(leagueId).collection('trades')");
    expect(source).not.toContain('verifyLeagueMembership');
  });

  it('preserves the unscoped legacy trade-review query behind authentication', () => {
    const source = readFileSync(join(process.cwd(), 'src/app/api/trades/list/route.ts'), 'utf8');

    expect(source).toContain("import { getAuthenticatedUserId } from '@/lib/serverAuth'");
    expect(source).toContain("adminDb.collection('tradeReviews')");
    expect(source).toContain('listTradeReviews');
    expect(source).toContain("'Cache-Control': 'private, no-store'");
    expect(source).toContain('e instanceof TradeServiceError');
    expect(source).not.toContain('s-maxage=60');
  });
});
