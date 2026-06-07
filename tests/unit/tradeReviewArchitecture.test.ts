import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('trade review Firestore architecture', () => {
  it('keeps trade review state authenticated and privately cached', () => {
    const source = readFileSync(join(process.cwd(), 'src/app/api/trades/review/route.ts'), 'utf8');

    expect(source).toContain('adminAuth.verifyIdToken');
    expect(source).toContain('verifyLeagueMembership');
    expect(source).toContain("collection('tradeReviews')");
    expect(source).toContain("'Cache-Control': 'private, no-store'");
    expect(source).not.toContain("'Cache-Control': 'public, max-age=0, s-maxage=60");
  });
});
