import type { NextRequest } from 'next/server';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { DraftType, DraftStatus, LeagueRole } from '@/types/prisma-fallback';
import { addMinutes } from 'date-fns';

/**
 * Create a test draft for development/testing
 */
export async function POST(_request: NextRequest) {
  try {
    logger.info('Creating test draft');

    // Create test draft with lobby opening in 1 minute and draft starting in 6 minutes
    const now = new Date();
    const lobbyOpenTime = addMinutes(now, 1);
    const draftStartTime = addMinutes(now, 6);

    const result = await prisma.$transaction(async (tx) => {
      // Create league settings first
      const settings = await tx.leagueSettings.create({
        data: {
          rosterSize: 22,
          benchSize: 5,
          maxTeams: 12,
          pickSeconds: 120,
          allowAutoPick: true,
          draftType: DraftType.SNAKE,
          startAt: draftStartTime,
          timeZone: 'UTC',
          locked: false,
        },
      });

      // Create league
      const league = await tx.league.create({
        data: {
          name: `Test Draft League - ${now.toISOString().slice(0, 16)}`,
          inviteCode: `TEST${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
          ownerId: 'test-user',
          settingsId: settings.id,
        },
      });



      // Create draft
      const draft = await tx.draft.create({
        data: {
          leagueId: league.id,
          status: DraftStatus.SCHEDULED,
          lobbyStatus: 'CLOSED',
          lobbyOpenAt: lobbyOpenTime,
          currentPick: 1,
          totalPicks: 264, // 12 teams * 22 picks
          round: 1,
        },
      });

      // Create some test members
      const members = [];
      for (let i = 1; i <= 4; i++) {
        const member = await tx.leagueMember.create({
          data: {
            leagueId: league.id,
            userId: `test-user-${i}`,
            role: i === 1 ? LeagueRole.OWNER : LeagueRole.MANAGER,
            teamName: `Test Team ${i}`,
          },
        });
        members.push(member);
      }

      // Create draft order
      for (let i = 0; i < members.length; i++) {
        await tx.draftOrder.create({
          data: {
            draftId: draft.id,
            memberId: members[i].id,
            slot: i + 1,
          },
        });
      }

      return { draft, league, settings, members };
    });

    const response = {
      success: true,
      draft: {
        id: result.draft.id,
        status: result.draft.status,
        lobbyStatus: result.draft.lobbyStatus,
        lobbyOpenAt: result.draft.lobbyOpenAt,
        leagueId: result.league.id,
        leagueName: result.league.name,
        draftStartTime,
        lobbyOpenTime,
        url: `/drafts/${result.draft.id}`,
      },
      message: 'Test draft created successfully',
      instructions: [
        `1. Visit: /drafts/${result.draft.id}`,
        `2. Lobby will open at: ${lobbyOpenTime.toISOString()}`,
        `3. Draft will start at: ${draftStartTime.toISOString()}`,
        '4. You can test the lobby functionality',
      ],
    };

    logger.info('Test draft created', {
      draftId: result.draft.id,
      leagueId: result.league.id,
      lobbyOpenTime,
      draftStartTime,
    });

    return successResponse(response);
  } catch (error) {
    logger.error('Failed to create test draft', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    return errorResponse(
      `Failed to create test draft: ${error instanceof Error ? error.message : 'Unknown error'}`,
      500
    );
  }
}

/**
 * Get instructions for testing
 */
export async function GET(_request: NextRequest) {
  return successResponse({
    message: 'Test Draft Creator',
    instructions: [
      'POST to this endpoint to create a test draft',
      'The draft will be scheduled to start in 6 minutes',
      'The lobby will open in 1 minute',
      'You can then test the lobby functionality',
    ],
    endpoints: {
      createDraft: 'POST /api/create-test-draft',
      listDrafts: 'GET /api/drafts/list',
      testLobby: 'GET /api/test-lobby',
    },
  });
}
