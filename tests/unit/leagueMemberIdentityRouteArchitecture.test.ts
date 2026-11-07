import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('league member identity route architecture', () => {
  const source = () =>
    readFileSync(join(process.cwd(), 'src/app/api/leagues/[id]/members/me/route.ts'), 'utf8');

  it('authenticates and authorizes membership before parsing or writes', () => {
    const route = source();

    expect(route).toContain("import { getAuthenticatedUserId } from '@/lib/serverAuth'");
    expect(route).toContain("import { getLeagueMembership } from '@/lib/leagueMembership'");
    expect(route).toContain('const userId = await getAuthenticatedUserId(request);');
    expect(route).toContain(
      'const league = await prisma.league.findUnique({ where: { id }, select: { id: true } });'
    );
    expect(route).toContain('const membership = await getLeagueMembership(id, userId);');
    expect(route).toContain("membership.source !== 'prisma'");
    expect(route.indexOf('prisma.league.findUnique')).toBeLessThan(
      route.indexOf('const membership = await getLeagueMembership(id, userId);')
    );
    expect(route.indexOf('const membership = await getLeagueMembership(id, userId);')).toBeLessThan(
      route.indexOf('body = (await request.json()) as Record<string, unknown>;')
    );
    expect(route).toContain("return NextResponse.json({ error: 'Invalid request body' }");
  });

  it('normalizes team setting input through shared validation helpers', () => {
    const route = source();

    expect(route).toContain('normalizeTeamSymbolPosition');
    expect(route).toContain('normalizeTeamSymbolUrl');
    expect(route).toContain('normalizeTeamSymbolZoom');
    expect(route).toContain('function parseTeamName(value: unknown): string');
    expect(route).toContain('function parseNotificationSettings');
    expect(route).toContain('teamLogoUrl: normalizeTeamSymbolUrl(body.teamLogoUrl)');
    expect(route).toContain(
      'teamLogoPositionX: normalizeTeamSymbolPosition(body.teamLogoPositionX)'
    );
    expect(route).toContain(
      'teamLogoPositionY: normalizeTeamSymbolPosition(body.teamLogoPositionY)'
    );
    expect(route).toContain('teamLogoZoom: normalizeTeamSymbolZoom(body.teamLogoZoom)');
    expect(route).toContain('return NextResponse.json({ error: error.message }, { status: 400 });');
  });

  it('writes partial member settings to Prisma only, never a Firestore fallback', () => {
    const route = source();

    expect(route).toContain('await prisma.leagueMember.update({');
    expect(route).toContain('where: { id: memberId }');
    expect(route).toContain('const prismaData:');
    expect(route).toContain('data: prismaData');
    expect(route).toContain('notificationSettingsJson');
    expect(route).not.toContain('adminDb');
    expect(route).not.toContain('queueLeagueMembershipPatch');
    expect(route).not.toContain('firestorePatch');
  });

  it('returns the member identity response envelope', () => {
    const route = source();

    expect(route).toContain('success: true');
    expect(route).toContain('data: {');
    expect(route).toContain('member:');
  });
});
