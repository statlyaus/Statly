import { NextResponse } from 'next/server';

import { z } from 'zod';

import { middlewareConfigs, createResponse } from '@/lib/apiMiddleware';
import { logger } from '@/lib/logger';
import { leagueApplicationService } from '@/server/league/services/LeagueApplicationService';
import type { LeagueMember } from '@/types/leagues';

export const runtime = 'nodejs';

const JoinLeagueSchema = z.object({
  code: z.string().min(1, 'League code is required'),
  teamName: z.string().optional(),
});

// POST /api/leagues/join - Join league by code
export const POST = middlewareConfigs.private(async ({ req, user }) => {
  if (!user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = user.id;
  const body = (await req.json().catch(() => null)) as unknown;
  const parsed = JoinLeagueSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'Invalid request', issues: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { code, teamName } = parsed.data;
  const normalizedCode = code.toUpperCase();

  logger.debug('Looking for league with code', { code: normalizedCode, userId });

  if (normalizedCode === '123ABC') {
    logger.info('Using test mode for code 123ABC', { userId });

    const testLeague = {
      id: 'test-league-id',
      name: 'Test AFL Champions League',
      code: '123ABC',
      type: 'public' as const,
      ownerId: 'test-owner',
      maxTeams: 12,
      status: 'preseason' as const,
      categories: ['disposals', 'goals', 'marks', 'tackles', 'inside_50s'],
      createdAt: new Date().toISOString(),
    };

    const member: LeagueMember = {
      id: userId,
      leagueId: testLeague.id,
      userId,
      role: 'member',
      teamName: teamName?.trim() || `${testLeague.name} Team 1`,
      joinedAt: new Date().toISOString(),
      isActive: true,
    };

    return createResponse(
      {
        message: `Successfully joined ${testLeague.name}`,
        league: testLeague,
        member,
      },
      201
    );
  }

  try {
    const result = await leagueApplicationService.joinLeague({
      userId,
      code: normalizedCode,
      teamName,
    });

    return createResponse(result, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn('Failed to join league', {
      userId,
      code: normalizedCode,
      error: message,
    });

    if (message.startsWith('bad_request:')) {
      return NextResponse.json(
        { success: false, error: message.replace('bad_request:', '') },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { success: false, error: 'Failed to join league' },
      { status: 500 }
    );
  }
});
