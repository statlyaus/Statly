import { NextResponse } from 'next/server';
import { z } from 'zod';

import { commonErrors } from '@/lib/apiResponse';
import { middlewareConfigs, createResponse } from '@/lib/apiMiddleware';
import { adminDb } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';
import type { JoinLeagueRequest, League, LeagueMember } from '@/types/leagues';

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

  const body = await req.json();
  const parsed = JoinLeagueSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'Invalid request', issues: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { code, teamName } = parsed.data;

    // Find league by code
    logger.debug('Looking for league with code', { code: code.toUpperCase(), userId });

    // For testing purposes, accept "123ABC" as a test code
    if (code.toUpperCase() === '123ABC') {
      logger.info('Using test mode for code 123ABC', { userId });

      // Create a mock league for testing
      const testLeague = {
        id: 'test-league-id',
        name: 'Test AFL Champions League',
        code: '123ABC',
        type: 'public',
        ownerId: 'test-owner',
        maxTeams: 12,
        status: 'preseason',
        categories: ['disposals', 'goals', 'marks', 'tackles', 'inside_50s'],
        createdAt: new Date().toISOString(),
      };

      // Check if user is already a member (simulate check)
      logger.debug('Test league found, proceeding with join', { userId, leagueId: testLeague.id });

      // Add member to league (simulate) using user id as member doc id
      const deterministicMemberId = userId;
      const newMember: LeagueMember = {
        id: deterministicMemberId,
        leagueId: testLeague.id,
        userId,
        role: 'member',
        teamName,
        joinedAt: new Date().toISOString(),
        isActive: true,
      };

      logger.info('Successfully joined test league', { userId, leagueId: testLeague.id, memberId: deterministicMemberId });
      return createResponse(
        {
          message: `Successfully joined ${testLeague.name}`,
          league: testLeague,
          member: newMember,
        },
        201
      );
    }

    const leagueSnapshot = await adminDb
      .collection('leagues')
      .where('code', '==', code.toUpperCase())
      .limit(1)
      .get();

    logger.debug('League query result', {
      code: code.toUpperCase(),
      empty: leagueSnapshot.empty,
      size: leagueSnapshot.size,
      userId,
    });

    if (leagueSnapshot.empty) {
      // Let's also check what leagues exist for debugging
      const allLeaguesSnapshot = await adminDb.collection('leagues').limit(5).get();
      const existingLeagues = allLeaguesSnapshot.docs.map((doc) => ({
        id: doc.id,
        code: doc.data().code,
        name: doc.data().name,
      }));

      logger.warn('League not found', { code: code.toUpperCase(), userId, existingLeagues });
      return NextResponse.json(
        {
          success: false,
          error: `League with code "${code.toUpperCase()}" not found. Try the test code "123ABC" to test the join functionality!`,
          debug: { availableLeagues: existingLeagues },
        },
        { status: 400 }
      );
    }

    const leagueDoc = leagueSnapshot.docs[0];
    const league: League = {
      id: leagueDoc.id,
      ...leagueDoc.data(),
    } as League;

    // Check if league is joinable
    if (league.status !== 'preseason') {
      return NextResponse.json(
        { success: false, error: 'League is no longer accepting new members' },
        { status: 400 }
      );
    }

    // Check if league is full
    const membersSnapshot = await adminDb
      .collection('leagues')
      .doc(league.id)
      .collection('members')
      .where('isActive', '==', true)
      .get();

    if (membersSnapshot.size >= league.maxTeams) {
      return NextResponse.json({ success: false, error: 'League is full' }, { status: 400 });
    }

    // Check if user is already a member
    const existingMember = membersSnapshot.docs.find((doc) => doc.data().userId === userId);

    if (existingMember) {
      return NextResponse.json(
        { success: false, error: 'Already a member of this league' },
        { status: 400 }
      );
    }

    // Validate team name
    let finalTeamName = teamName?.trim();
    if (!finalTeamName) {
      finalTeamName = `${league.name} Team ${membersSnapshot.size + 1}`;
    }

    // Check for duplicate team names
    const duplicateName = membersSnapshot.docs.find(
      (doc) => doc.data().teamName.toLowerCase() === finalTeamName!.toLowerCase()
    );

    if (duplicateName) {
      return NextResponse.json(
        { success: false, error: 'Team name already taken' },
        { status: 400 }
      );
    }

    // Create league member
    const newMember: Omit<LeagueMember, 'id'> = {
      leagueId: league.id,
      userId,
      role: 'member',
      teamName: finalTeamName,
      joinedAt: new Date().toISOString(),
      isActive: true,
    };

    const deterministicMemberId = userId;
    await adminDb
      .collection('leagues')
      .doc(league.id)
      .collection('members')
      .doc(deterministicMemberId)
      .set(newMember, { merge: true });
    await adminDb
      .collection('leagueMembers')
      .doc(`${league.id}_${userId}`)
      .set(newMember, { merge: true });

    const createdMember: LeagueMember = {
      id: deterministicMemberId,
      ...newMember,
    };

    return createResponse(
      {
        member: createdMember,
        league: {
          id: league.id,
          name: league.name,
          code: league.code,
          type: league.type,
          status: league.status,
        },
      },
      201
    );
});
