import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('legacy trade review Pages API architecture', () => {
  it('keeps legacy top-level tradeReviews endpoints authenticated and privately cached', () => {
    const listSource = readFileSync(join(process.cwd(), 'src/pages/api/listTrades.ts'), 'utf8');
    const reviewSource = readFileSync(join(process.cwd(), 'src/pages/api/tradeReview.ts'), 'utf8');

    for (const source of [listSource, reviewSource]) {
      expect(source).toContain('getAuthenticatedUserIdFromApiRequest');
      expect(source).toContain("'Cache-Control', 'private, no-store'");
      expect(source).not.toContain("'Cache-Control', 'public, max-age=0, s-maxage=60");
      expect(source.indexOf('getAuthenticatedUserIdFromApiRequest(req)')).toBeLessThan(
        source.indexOf("collection('tradeReviews')")
      );
    }
  });
});
