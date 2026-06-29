import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('trade list Firestore architecture', () => {
  it('lists league trades from the canonical league subcollection', () => {
    const source = readFileSync(join(process.cwd(), 'src/app/api/trades/list/route.ts'), 'utf8');

    expect(source).toContain("collection('leagues').doc(leagueId).collection('trades')");
    expect(source).toContain('listLeagueTrades');
    expect(source).toContain('status');
    expect(source).toContain('playersOffered');
    expect(source).toContain('playersRequested');
  });

  it('requires league membership for league-scoped Admin SDK reads', () => {
    const routeSource = readFileSync(
      join(process.cwd(), 'src/app/api/trades/list/route.ts'),
      'utf8'
    );
    const pageSource = readFileSync(
      join(process.cwd(), 'src/app/(app)/leagues/[id]/trades/page.tsx'),
      'utf8'
    );

    expect(routeSource).toContain("import type { NextRequest } from 'next/server'");
    expect(routeSource).toContain("import { getAuthenticatedUserId } from '@/lib/serverAuth'");
    expect(routeSource).toContain(
      "import { verifyLeagueMembership } from '@/lib/leagueMembership'"
    );
    expect(routeSource).toContain('authorizeLeagueTradeList(request, leagueId)');
    expect(routeSource).toContain('authorizeTradeListRead(request)');
    expect(routeSource).toContain('return NextResponse.json({ error:');
    expect(routeSource).toContain('membership.isMember');
    expect(routeSource).toContain("'Cache-Control': 'private, no-store'");
    expect(routeSource).not.toContain('s-maxage=60');

    expect(pageSource).toContain("import { cookies, headers } from 'next/headers'");
    expect(pageSource).toContain('const headerStore = await headers()');
    expect(pageSource).toContain('headers: { cookie: cookieStore.toString() }');
  });
});
