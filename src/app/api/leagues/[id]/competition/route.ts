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
  deleteCompetitionFixture,
  publishCompetition,
  saveCompetitionFixture,
  setCompetitionRoundFallbackDeadline,
} from '@/server/leagues/competitionService';
import { normalizeFantasyCategoryKeys, type FantasyCategoryKey } from '@/types/fantasyCategories';

function parseCategories(value: string | null): FantasyCategoryKey[] {
  if (!value) return ['goals'];

  try {
    return normalizeFantasyCategoryKeys(JSON.parse(value));
  } catch {
    return ['goals'];
  }
}

function missingActorMemberResponse() {
  return NextResponse.json(
    {
      error:
        'The commissioner account is not linked to a league team. Restore the owner membership before publishing or overriding competition rounds.',
    },
    { status: 409 }
  );
}

function parsePositiveRound(value: unknown): number | null {
  const normalized = typeof value === 'number' ? String(value) : String(value ?? '').trim();
  if (!/^[1-9]\d*$/.test(normalized)) return null;

  const round = Number(normalized);
  return Number.isSafeInteger(round) ? round : null;
}

async function parseRequestObject(request: NextRequest): Promise<Record<string, unknown> | null> {
  const body: unknown = await request.json().catch(() => null);
  return body !== null && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null;
}

function invalidMutationBodyResponse() {
  return NextResponse.json({ error: 'A valid JSON object is required.' }, { status: 400 });
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
  if (!league?.settings)
    return { error: NextResponse.json({ error: 'League not found' }, { status: 404 }) };

  const member = league.members[0];
  const canManage = league.ownerId === userId || member?.isCoCommissioner === true;

  return { userId, league, member, canManage };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const authorization = await authorizeCompetitionRequest(request, id);
  if ('error' in authorization) return authorization.error;

  const categories = parseCategories(authorization.league.categoriesJson);
  const rules = parseCompetitionRulesJson(
    authorization.league.settings.competitionRulesJson,
    categories[0] ?? 'goals'
  );
  const [rounds, audits, commissioners, teams] = await Promise.all([
    prisma.leagueCompetitionRound.findMany({
      where: {
        leagueId: id,
        fixtureVersion: authorization.league.settings.competitionRulesVersion,
      },
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
      where: {
        leagueId: id,
        OR: [{ userId: authorization.league.ownerId }, { isCoCommissioner: true }],
      },
      select: { id: true, teamName: true, isCoCommissioner: true, userId: true },
      orderBy: { joinedAt: 'asc' },
    }),
    prisma.leagueMember.findMany({
      where: { leagueId: id },
      select: { id: true, teamName: true, draftSlot: true },
      orderBy: [{ draftSlot: 'asc' }, { joinedAt: 'asc' }],
    }),
  ]);

  return NextResponse.json({
    success: true,
    data: {
      canManage: authorization.canManage,
      teamCount: teams.length,
      rosterSize: authorization.league.settings.rosterSize,
      categories,
      lineupSlots: authorization.league.settings.lineupSlotsJson,
      status: authorization.league.settings.competitionStatus,
      fixtureVersion: authorization.league.settings.competitionRulesVersion,
      publishedAt: authorization.league.settings.competitionPublishedAt?.toISOString() ?? null,
      rules,
      commissioners,
      teams,
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
          homeMemberId: matchup.homeMemberId,
          awayMemberId: matchup.awayMemberId,
          byeMemberId: matchup.byeMemberId,
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

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const authorization = await authorizeCompetitionRequest(request, id);
  if ('error' in authorization) return authorization.error;
  if (!authorization.canManage) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (authorization.league.settings.competitionStatus !== 'SETUP') {
    return NextResponse.json(
      {
        error:
          'Published competition rules cannot be changed. Use a commissioner override instead.',
      },
      { status: 409 }
    );
  }

  const body = await parseRequestObject(request);
  if (!body) return invalidMutationBodyResponse();
  const categories = parseCategories(authorization.league.categoriesJson);
  const rules = normalizeCompetitionRules(body.rules, categories[0] ?? 'goals');

  await prisma.leagueSettings.update({
    where: { id: authorization.league.settings.id },
    data: { competitionRulesJson: JSON.stringify(rules) },
  });

  return NextResponse.json({ success: true, data: { rules } });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const authorization = await authorizeCompetitionRequest(request, id);
  if ('error' in authorization) return authorization.error;
  if (!authorization.canManage) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!authorization.member) return missingActorMemberResponse();

  const body = await parseRequestObject(request);
  if (!body) return invalidMutationBodyResponse();
  const categories = parseCategories(authorization.league.categoriesJson);
  const rules: CompetitionRules =
    body.rules === undefined
      ? parseCompetitionRulesJson(
          authorization.league.settings.competitionRulesJson,
          categories[0] ?? 'goals'
        )
      : normalizeCompetitionRules(body.rules, categories[0] ?? 'goals');
  const result = await publishCompetition({
    leagueId: id,
    actorMemberId: authorization.member.id,
    rules,
  });
  if (!result.ok)
    return NextResponse.json(
      { error: 'Competition cannot be published', details: result.errors },
      { status: 400 }
    );

  return NextResponse.json({ success: true, data: result });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const authorization = await authorizeCompetitionRequest(request, id);
  if ('error' in authorization) return authorization.error;
  if (!authorization.canManage) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!authorization.member) return missingActorMemberResponse();

  const body = await parseRequestObject(request);
  if (!body) return invalidMutationBodyResponse();
  const action = body.action;
  const round = parsePositiveRound(body.round);
  if (round === null) {
    return NextResponse.json({ error: 'Choose a valid competition round.' }, { status: 400 });
  }

  if (action === 'SET_DEADLINE') {
    const fallbackLockAt = new Date(String(body.fallbackLockAt));
    if (Number.isNaN(fallbackLockAt.getTime())) {
      return NextResponse.json({ error: 'Choose a valid fallback deadline.' }, { status: 400 });
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

  if (action === 'SAVE_FIXTURE') {
    const fixture =
      body.fixture && typeof body.fixture === 'object' && !Array.isArray(body.fixture)
        ? (body.fixture as Record<string, unknown>)
        : null;
    if (!fixture) {
      return NextResponse.json({ error: 'A valid fixture is required.' }, { status: 400 });
    }
    const result = await saveCompetitionFixture({
      leagueId: id,
      round,
      actorMemberId: authorization.member.id,
      fixture: {
        matchupId: typeof fixture.matchupId === 'string' ? fixture.matchupId : null,
        homeMemberId: typeof fixture.homeMemberId === 'string' ? fixture.homeMemberId : null,
        awayMemberId: typeof fixture.awayMemberId === 'string' ? fixture.awayMemberId : null,
        byeMemberId: typeof fixture.byeMemberId === 'string' ? fixture.byeMemberId : null,
      },
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ success: true, data: result.fixture });
  }

  if (action === 'DELETE_FIXTURE') {
    if (typeof body.matchupId !== 'string' || !body.matchupId) {
      return NextResponse.json({ error: 'Choose a fixture to delete.' }, { status: 400 });
    }
    const result = await deleteCompetitionFixture({
      leagueId: id,
      round,
      actorMemberId: authorization.member.id,
      matchupId: body.matchupId,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: 'Choose a valid competition action.' }, { status: 400 });
}
