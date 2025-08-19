import type { NextRequest } from 'next/server';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { DraftType, DraftStatus, DraftDirection } from '@prisma/client';
import { scheduleDraftStart } from '@/api/queues/draftQueue';

interface CreateDraftRequest {
  name: string;
  leagueSize: number;
  draftType: 'snake' | 'linear';
  timePerPick: number;
  scheduledTime?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body: CreateDraftRequest = await request.json();

    // Validation
    if (!body.name?.trim()) {
      return errorResponse('Draft name is required', 400);
    }

    if (!body.leagueSize || body.leagueSize < 4 || body.leagueSize > 20) {
      return errorResponse('League size must be between 4 and 20', 400);
    }

    if (!['snake', 'linear'].includes(body.draftType)) {
      return errorResponse('Draft type must be "snake" or "linear"', 400);
    }

    if (!body.timePerPick || body.timePerPick < 30 || body.timePerPick > 600) {
      return errorResponse('Time per pick must be between 30 and 600 seconds', 400);
    }

    // Calculate roster settings (for demo - in production, get from league settings)
    const rosterSize = 18; // Standard AFL roster size
    const benchSize = 4; // Standard bench size
    const totalPicks = body.leagueSize * (rosterSize + benchSize);

    // Create draft in database transaction
    const result = await prisma.$transaction(async (tx) => {
      // First create the league settings
      const settings = await tx.leagueSettings.create({
        data: {
          rosterSize,
          benchSize,
          maxTeams: body.leagueSize,
          pickSeconds: body.timePerPick,
          allowAutoPick: true,
          draftType: body.draftType === 'snake' ? DraftType.SNAKE : DraftType.SNAKE, // Only snake for now
          startAt: body.scheduledTime ? new Date(body.scheduledTime) : new Date(),
          locked: false,
        },
      });

      // Create a temporary league for this draft
      const league = await tx.league.create({
        data: {
          name: body.name,
          inviteCode: `DRAFT_${Date.now()}`,
          ownerId: 'temp_owner', // Will be updated after creating the first user
          settingsId: settings.id,
        },
      });

      // Create draft
      const draft = await tx.draft.create({
        data: {
          leagueId: league.id,
          status: body.scheduledTime ? DraftStatus.SCHEDULED : DraftStatus.LIVE,
          currentPick: body.scheduledTime ? 1 : 1,
          totalPicks,
          round: 1,
          direction: DraftDirection.FORWARD,
          startedAt: body.scheduledTime ? undefined : new Date(),
        },
      });

      // Create league members - you get special privileges, rest are dummy users
      const members = [];
      let firstUserId: string | null = null;

      // Create you as the first member with special privileges
      const yourUser = await tx.user.create({
        data: {
          email: `admin_${Date.now()}@statly.local`,
          passwordHash: 'admin_hash',
          displayName: 'You (Admin)',
          timeZone: 'Australia/Melbourne',
        },
      });

      firstUserId = yourUser.id;

      const yourMember = await tx.leagueMember.create({
        data: {
          leagueId: league.id,
          userId: yourUser.id,
          role: 'OWNER',
          teamName: 'Your Team',
        },
      });

      members.push(yourMember);

      // Create dummy users for the rest of the spots
      for (let i = 1; i < body.leagueSize; i++) {
        const dummyUser = await tx.user.create({
          data: {
            email: `dummy_${i}_${Date.now()}_${Math.random().toString(36).substring(7)}@bot.local`,
            passwordHash: 'dummy_hash',
            displayName: `CPU Team ${i}`,
            timeZone: 'UTC',
          },
        });

        const dummyMember = await tx.leagueMember.create({
          data: {
            leagueId: league.id,
            userId: dummyUser.id,
            role: 'MANAGER',
            teamName: `CPU Team ${i}`,
          },
        });

        members.push(dummyMember);
      }

      // Update league owner
      if (firstUserId) {
        await tx.league.update({
          where: { id: league.id },
          data: { ownerId: firstUserId },
        });
      }

      // Create draft order
      for (let i = 0; i < body.leagueSize; i++) {
        await tx.draftOrder.create({
          data: {
            draftId: draft.id,
            slot: i + 1,
            memberId: members[i].id,
          },
        });
      }

      return { draft, league, members, settings };
    });

    // Schedule draft start if scheduledTime is provided
    if (body.scheduledTime) {
      try {
        await scheduleDraftStart(
          result.league.id,
          new Date(body.scheduledTime),
          body.timePerPick * 1000 // Convert seconds to milliseconds
        );
        logger.info('Draft scheduled successfully', {
          draftId: result.draft.id,
          leagueId: result.league.id,
          scheduledTime: body.scheduledTime,
          timePerPick: body.timePerPick,
        });
      } catch (error) {
        logger.error('Failed to schedule draft start', {
          draftId: result.draft.id,
          leagueId: result.league.id,
          scheduledTime: body.scheduledTime,
          error: error instanceof Error ? error.message : String(error),
        });
        // Don't fail the entire request if scheduling fails
      }
    }

    const responseData = {
      id: result.draft.id,
      name: body.name.trim(),
      leagueSize: body.leagueSize,
      draftType: body.draftType,
      timePerPick: body.timePerPick,
      status: body.scheduledTime ? 'pending' : 'active',
      scheduledTime: body.scheduledTime,
      createdAt: result.draft.createdAt.toISOString(),
      currentPick: result.draft.currentPick,
      currentRound: result.draft.round,
      participants: result.members.map((member, index) =>
        index === 0 ? 'You (Admin)' : `CPU Team ${index}`
      ),
      picks: [],
      yourSlot: 1, // You always get slot 1
      adminPrivileges: true,
    };

    logger.info('Draft created successfully', {
      draftId: result.draft.id,
      name: body.name,
      leagueSize: body.leagueSize,
      draftType: body.draftType,
      status: result.draft.status,
    });

    return successResponse(responseData, 201);
  } catch (error) {
    logger.error('Failed to create draft', {
      error: {
        name: error instanceof Error ? error.name : 'Unknown',
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
    });

    return errorResponse('Failed to create draft', 500);
  }
}

export async function GET() {
  try {
    // Get all drafts from database
    const drafts = await prisma.draft.findMany({
      include: {
        league: {
          include: {
            settings: true,
            members: {
              include: {
                user: true,
              },
            },
          },
        },
        picks: {
          include: {
            player: true,
            member: {
              include: {
                user: true,
              },
            },
          },
          orderBy: { overall: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const formattedDrafts = drafts.map((draft) => ({
      id: draft.id,
      name: `${draft.league?.name || 'Draft'} - ${draft.status}`,
      leagueSize: draft.league?.members.length || 0,
      draftType: draft.league?.settings?.draftType || 'SNAKE',
      timePerPick: draft.league?.settings?.pickSeconds || 120,
      status: draft.status.toLowerCase(),
      createdAt: draft.createdAt.toISOString(),
      currentPick: draft.currentPick,
      currentRound: draft.round,
      participants: draft.league?.members.map((member, index) => `participant_${index}`) || [],
      picks: draft.picks.map((pick) => ({
        round: pick.round,
        pick: pick.overall,
        playerId: pick.playerId,
        participantId: `participant_${pick.slot - 1}`,
        timestamp: pick.madeAt.toISOString(),
      })),
    }));

    logger.info('Drafts retrieved successfully', {
      count: formattedDrafts.length,
    });

    return successResponse(formattedDrafts);
  } catch (error) {
    logger.error('Failed to retrieve drafts', {
      error: {
        name: error instanceof Error ? error.name : 'Unknown',
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
    });

    return errorResponse('Failed to retrieve drafts', 500);
  }
}
