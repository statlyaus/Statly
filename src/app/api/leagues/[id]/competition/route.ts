import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { getLeagueMembership } from '@/lib/leagueMembership';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import {
  normalizeCompetitionRules,
  parseCompetitionRulesJson,
  type CompetitionRules,
} from '@/server/leagues/competitionRules';
import {
  publishCompetition,
  setCompetitionRoundFallbackDeadline,
} from '@/server/leagues/competitionService';
import type { FantasyCategoryKey } from '@/types/fantasyCategories';

function parseCategories(value: string | null): FantasyCategoryKey[] {
  if (!value) return ['goals'];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((category): category is FantasyCategoryKey => typeof category === 'string')
      : ['goals'];
  } catch {
    return ['goals'];
  }
}

async function authorizeCompetitionRequest(request: NextRequest, leagueId: string) {
  const userId = await getAuthenticatedUserId(request);
  if (!userId) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };

  const membership = await getLeagueMembership(leagueId, userId);
  if (!membership.isMember) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    include: {
      settings: true,
      members: { where: { userId }, take: 1 },
    },
  });
  if (!league?.settings) return { error: NextResponse.json({ error: 'League not found' }, { status: 404 }) };

  const member = league.members[0];
  const canManage = league.ownerId === userId || member?.isCoCommissioner === true;

  return { userId, league, member, canManage };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const authorization = await authorizeCompetitionRequest(request, id);
  if ('error' in authorization) return authorization.error;

  const categories = parseCategories(authorization.league.categoriesJson);
  const rules = parseCompetitionRulesJson(
    authorization.league.settings.competitionRulesJson,
    categories[0] ?? 'goals'
  );
  const [rounds, audits, commissioners] = await Promise.all([
    prisma.leagueCompetitionRound.findMany({
      where: { leagueId: id, fixtureVersion: authorization.league.settings.competitionRulesVersion },
      orderBy: { round: 'asc' },
      include: {
        matchups: {
          include: { homeMember: true, awayMember: true, byeMember: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    }),
    prisma.leagueCompetitionAudit.findMany({
      where: { leagueId: id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { actorMember: { select: { teamName: true } } },
    }),
    prisma.leagueMember.findMany({
      where: { leagueId: id, OR: [{ userId: authorization.league.ownerId }, { isCoCommissioner: true }] },
      select: { id: true, teamName: true, isCoCommissioner: true, userId: true },
      orderBy: { joinedAt: 'asc' },
    }),
  ]);

  return NextResponse.json({
    success: true,
    data: {
      canManage: authorization.canManage,
      teamCount: await prisma.leagueMember.count({ where: { leagueId: id } }),
      rosterSize: authorization.league.settings.rosterSize,
      categories,
      lineupSlots: authorization.league.settings.lineupSlotsJson,
      status: authorization.league.settings.competitionStatus,
      fixtureVersion: authorization.league.settings.competitionRulesVersion,
      publishedAt: authorization.league.settings.competitionPublishedAt?.toISOString() ?? null,
      rules,
      commissioners,
      rounds: rounds.map((round) => ({
        id: round.id,
        round: round.round,
        aflRound: round.aflRound,
        phase: round.phase,
        status: round.status,
        startsAt: round.startsAt?.toISOString() ?? null,
        endsAt: round.endsAt?.toISOString() ?? null,
        fallbackLockAt: round.fallbackLockAt?.toISOString() ?? null,
        matchups: round.matchups.map((matchup) => ({
          id: matchup.id,
          bracketKey: matchup.bracketKey,
          homeTeam: matchup.homeMember?.teamName ?? null,
          awayTeam: matchup.awayMember?.teamName ?? null,
          byeTeam: matchup.byeMember?.teamName ?? null,
        })),
      })),
      audit: audits.map((audit) => ({
        id: audit.id,
        eventType: audit.eventType,
        actorTeamName: audit.actorMember?.teamName ?? null,
        payload: audit.payloadJson,
        createdAt: audit.createdAt.toISOString(),
      })),
    },
  });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const authorization = await authorizeCompetitionRequest(request, id);
  if ('error' in authorization) return authorization.error;
  if (!authorization.canManage) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (authorization.league.settings.competitionStatus !== 'SETUP') {
    return NextResponse.json(
      { error: 'Published competition rules cannot be changed. Use a commissioner override instead.' },
      { status: 409 }
    );
  }

  const body = (await request.json()) as { rules?: unknown };
  const categories = parseCategories(authorization.league.categoriesJson);
  const rules = normalizeCompetitionRules(body.rules, categories[0] ?? 'goals');

  await prisma.leagueSettings.update({
    where: { id: authorization.league.settings.id },
    data: { competitionRulesJson: JSON.stringify(rules) },
  });

  return NextResponse.json({ success: true, data: { rules } });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const authorization = await authorizeCompetitionRequest(request, id);
  if ('error' in authorization) return authorization.error;
  if (!authorization.canManage || !authorization.member) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as { rules?: unknown };
  const categories = parseCategories(authorization.league.categoriesJson);
  const rules: CompetitionRules =
    body.rules === undefined
      ? parseCompetitionRulesJson(
          authorization.league.settings.competitionRulesJson,
          categories[0] ?? 'goals'
        )
      : normalizeCompetitionRules(body.rules, categories[0] ?? 'goals');
  const result = await publishCompetition({ leagueId: id, actorMemberId: authorization.member.id, rules });
  if (!result.ok) return NextResponse.json({ error: 'Competition cannot be published', details: result.errors }, { status: 400 });

  return NextResponse.json({ success: true, data: result });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const authorization = await authorizeCompetitionRequest(request, id);
  if ('error' in authorization) return authorization.error;
  if (!authorization.canManage || !authorization.member) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = (await request.json()) as { round?: unknown; fallbackLockAt?: unknown };
  const round = Number.parseInt(String(body.round), 10);
  const fallbackLockAt = new Date(String(body.fallbackLockAt));
  if (!Number.isInteger(round) || round < 1 || Number.isNaN(fallbackLockAt.getTime())) {
    return NextResponse.json({ error: 'A valid round and fallback deadline are required.' }, { status: 400 });
  }

  const result = await setCompetitionRoundFallbackDeadline({
    leagueId: id,
    round,
    actorMemberId: authorization.member.id,
    fallbackLockAt,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  return NextResponse.json({ success: true });
}
