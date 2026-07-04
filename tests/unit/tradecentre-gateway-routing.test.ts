import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

function readRepoFile(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('tradecentre gateway route ownership', () => {
  it('uses /tradecentre as a fantasy league gateway instead of the public archive', () => {
    const page = readRepoFile('src/app/tradecentre/page.tsx');
    const nextConfig = readRepoFile('next.config.mjs');
    const serverAuth = readRepoFile('src/lib/serverAuth.ts');

    expect(page).toContain("import 'server-only'");
    expect(page).toContain("import { redirect } from 'next/navigation'");
    expect(page).toContain("import { getAuthenticatedUserIdFromServerContext } from '@/lib/serverAuth'");
    expect(page).toContain("import { prisma } from '@/lib/prisma'");
    expect(page).toContain("redirect('/login?next=/tradecentre')");
    expect(page).toContain('prisma.leagueMember.findFirst');
    expect(page).toContain("redirect(`/leagues/${membership.leagueId}/trades`)");
    expect(page).toContain('Join or create a league to trade');
    expect(page).not.toContain("redirect('/draft/trades')");

    expect(nextConfig).not.toContain("source: '/tradecentre'");
    expect(nextConfig).not.toContain("destination: '/draft/trades'");

    expect(serverAuth).toContain('export async function getAuthenticatedUserIdFromServerContext()');
    expect(serverAuth).toContain("headerStore.get('x-auth-user')");
    expect(serverAuth).toContain('cookieStore.get(DEVELOPMENT_AUTH_COOKIE)?.value');
    expect(serverAuth).toContain("cookieStore.get('statly_session')?.value");
    expect(serverAuth).toContain('adminAuth.verifySessionCookie(sessionCookie, true)');
  });
});
