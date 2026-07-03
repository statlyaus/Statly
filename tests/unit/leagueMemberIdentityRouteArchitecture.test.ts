import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('league member identity route architecture', () => {
  const source = () =>
    readFileSync(join(process.cwd(), 'src/app/api/leagues/[id]/members/me/route.ts'), 'utf8');

  it('authenticates and authorizes membership before parsing or writes', () => {
    const route = source();

    expect(route).toContain("import { getAuthenticatedUserId } from '@/lib/serverAuth'");
    expect(route).toContain(
      "import { getLeagueMembership, queueLeagueMembershipPatch } from '@/lib/leagueMembership'"
    );
    expect(route).toContain('const userId = await getAuthenticatedUserId(request);');
    expect(route).toContain('const membership = await getLeagueMembership(id, userId);');
    expect(route).toContain('if (!membership.isMember)');
    expect(route.indexOf('const membership = await getLeagueMembership(id, userId);')).toBeLessThan(
      route.indexOf('body = (await request.json()) as Record<string, unknown>;')
    );
    expect(route).toContain("return NextResponse.json({ error: 'Invalid request body' }");
  });

  it('normalizes team symbol input through the shared validation helper', () => {
    const route = source();

    expect(route).toContain("import { normalizeTeamSymbolUrl } from '@/lib/teamSymbol'");
    expect(route).toContain('const teamLogoUrl = normalizeTeamSymbolUrl(body.teamLogoUrl);');
    expect(route).toContain("return NextResponse.json({ error: error.message }, { status: 400 });");
  });

  it('updates Prisma first and Firestore fallback with the same field', () => {
    const route = source();

    expect(route).toContain('await prisma.leagueMember.update({');
    expect(route).toContain('where: { id: membership.memberDocId }');
    expect(route).toContain('data: { teamLogoUrl }');
    expect(route).toContain('queueLeagueMembershipPatch(batch, id, userId, { teamLogoUrl });');
    expect(route).toContain('await batch.commit();');
  });

  it('returns the member identity response envelope', () => {
    const route = source();

    expect(route).toContain('success: true');
    expect(route).toContain('data: {');
    expect(route).toContain('member:');
  });
});
