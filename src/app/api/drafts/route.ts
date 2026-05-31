import type { NextRequest } from 'next/server';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { DraftType, DraftStatus, DraftDirection } from '@prisma/client';
import { scheduleDraftStart } from '@/server/queue/draftQueue';
import { localToUtc, isValidTimeZone } from '@/lib/timezone';
import { createDraftReminders } from '@/lib/reminders';
import { ensurePrismaLeagueMirror } from '@/lib/prismaLeagueBridge';
import { addMinutes } from 'date-fns';

interface CreateDraftRequest {
  name: string;
  leagueId?: string;
  leagueSize: number;
  draftType: 'snake' | 'linear';
  timePerPick: number;
  scheduledTime?: string;
  timeZone?: string;
  enableReminders?: boolean;
  // League synchronization data
  leagueData?: {
    name: string;
    maxTeams: number;
    categories: string[];
    ownerId: string;
  };
  participants?: Array<{
    userId: string;
    memberId: string;
    displayName: string;
    draftOrder: number;
    isOwner?: boolean;
  }>;
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

    // Timezone validation
    const timeZone = body.timeZone || 'UTC';
    if (!isValidTimeZone(timeZone)) {
      return errorResponse('Invalid timezone', 400);
    }

    // Scheduled time validation and conversion
    let scheduledStartTime: Date;
    if (body.scheduledTime) {
      try {
        // Convert from user's timezone to UTC for storage
        scheduledStartTime = localToUtc(body.scheduledTime, timeZone);

        if (scheduledStartTime <= new Date()) {
          return errorResponse('Scheduled time must be in the future', 400);
        }
      } catch (_error) {
        return errorResponse('Invalid scheduled time format', 400);
      }
    } else {
      // If no scheduled time provided, start draft in 5 minutes from now
      scheduledStartTime = addMinutes(new Date(), 5);
    }

    // Calculate roster settings (for demo - in production, get from league settings)
    const rosterSize = 18; // Standard AFL roster size
    const benchSize = 4; // Standard bench size
    const totalPicks = body.leagueSize * (rosterSize + benchSize);

    if (body.leagueId && body.leagueId !== 'test-league-id') {
      const existingLeague = await prisma.league.findUnique({
        where: { id: body.leagueId },
        select: { id: true },
      });

      if (!existingLeague) {
        await ensurePrismaLeagueMirror({
          leagueId: body.leagueId,
          draftType: body.draftType,
          timePerPick: body.timePerPick,
          scheduledStartTime,
          timeZone,
          rosterSize,
          benchSize,
        });
      }
    }

    // Create draft in database transaction
    const result = await prisma.$transaction(async (tx) => {
      let league;
      let settings;
      const leagueId = body.leagueId;

      // If leagueId is provided, use existing league
      if (leagueId) {
        league = await tx.league.findUnique({
          where: { id: leagueId },
          include: {
            settings: true,
            members: { include: { user: true } },
          },
        });

        if (!league) {
          throw new Error('League not found');
        }

        settings = league.settings;

        // Verify participants match league members if provided
        if (body.participants && body.participants.length !== league.members.length) {
          throw new Error('Participant count does not match league member count');
        }

        // Create draft with existing league
        const draft = await tx.draft.create({
          data: {
            leagueId: league.id,
            status: DraftStatus.SCHEDULED,
            lobbyStatus: body.scheduledTime ? 'CLOSED' : 'COUNTDOWN',
            lobbyOpenAt: body.scheduledTime ? undefined : new Date(),
            currentPick: 1,
            totalPicks,
            round: 1,
            direction: DraftDirection.FORWARD,
            startedAt: body.scheduledTime ? undefined : new Date(),
          },
        });

        // Create draft orders from existing league members
        for (let i = 0; i < league.members.length; i++) {
          await tx.draftOrder.create({
            data: {
              draftId: draft.id,
              memberId: league.members[i].id,
              slot: i + 1,
            },
          });
        }

        return { draft, league, members: league.members, settings };
      } else {
        // Create new temporary league for standalone draft (existing logic)
        settings = await tx.leagueSettings.create({
          data: {
            rosterSize,
            benchSize,
            maxTeams: body.leagueSize,
            pickSeconds: body.timePerPick,
            allowAutoPick: true,
            draftType: body.draftType === 'linear' ? DraftType.LINEAR : DraftType.SNAKE,
            startAt: scheduledStartTime || new Date(),
            timeZone,
            locked: false,
          },
        });

        // Create a temporary league for this draft
        league = await tx.league.create({
          data: {
            name: body.leagueData?.name || body.name,
            inviteCode: `DRAFT_${Date.now()}`,
            ownerId: body.leagueData?.ownerId || 'temp_owner', // Will be updated after creating the first user
            settingsId: settings.id,
          },
        });

        // Create draft
        const draft = await tx.draft.create({
          data: {
            leagueId: league.id,
            status: DraftStatus.SCHEDULED,
            lobbyStatus: body.scheduledTime ? 'CLOSED' : 'COUNTDOWN', // Open lobby immediately if no time specified
            lobbyOpenAt: body.scheduledTime ? undefined : new Date(), // Open lobby now if no time specified
            currentPick: 1,
            totalPicks,
            round: 1,
            direction: DraftDirection.FORWARD,
            startedAt: body.scheduledTime ? undefined : new Date(),
          },
        });

        // Create league members - you get special privileges, rest are dummy users
        const members = [];
        let firstUserId: string | null = null;

        // If participants are provided, use them; otherwise create dummy users
        if (body.participants && body.participants.length > 0) {
          for (let i = 0; i < body.participants.length; i++) {
            const participant = body.participants[i];

            // Create or find user
            let user;
            try {
              user = await tx.user.findFirst({
                where: {
                  OR: [{ id: participant.userId }, { email: `${participant.userId}@draft.local` }],
                },
              });
              if (!user) {
                // Preserve external identity so downstream auth (Firebase UID) matches league members
                user = await tx.user.create({
                  data: {
                    id: participant.userId,
                    email: `${participant.userId}_${Date.now()}@draft.local`,
                    passwordHash: 'draft_hash',
                    displayName: participant.displayName,
                    timeZone: 'Australia/Melbourne',
                  },
                });
              }
            } catch {
              user = await tx.user.create({
                data: {
                  id: participant.userId,
                  email: `${participant.userId}_${Date.now()}_${Math.random().toString(36).substring(7)}@draft.local`,
                  passwordHash: 'draft_hash',
                  displayName: participant.displayName,
                  timeZone: 'Australia/Melbourne',
                },
              });
            }

            if (!firstUserId && participant.isOwner) firstUserId = user.id;

            const member = await tx.leagueMember.create({
              data: {
                leagueId: league.id,
                userId: user.id,
                role: participant.isOwner ? 'OWNER' : 'MANAGER',
                teamName: participant.displayName,
                draftSlot: participant.draftOrder,
              },
            });

            members.push(member);
          }
        } else {
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
        }

        // Update league owner
        if (firstUserId) {
          await tx.league.update({
            where: { id: league.id },
            data: { ownerId: firstUserId },
          });
        }

        // Create draft order
        for (let i = 0; i < members.length; i++) {
          await tx.draftOrder.create({
            data: {
              draftId: draft.id,
              slot: i + 1,
              memberId: members[i].id,
            },
          });
        }

        return { draft, league, members, settings };
      }
    });

    // Schedule draft start
    try {
      if (body.scheduledTime) {
        // User specified a time - schedule lobby to open 5 minutes before
        await scheduleDraftStart(
          result.league.id,
          scheduledStartTime,
          body.timePerPick * 1000 // Convert seconds to milliseconds
        );
      } else {
        // No time specified - lobby is already open, schedule draft to start in 5 minutes
        await scheduleDraftStart(
          result.league.id,
          scheduledStartTime, // This is already set to 5 minutes from now
          body.timePerPick * 1000,
          true // Flag to indicate this should start the draft immediately (no lobby delay)
        );
      }

      // Create reminders if enabled
      if (body.enableReminders !== false) {
        // Default to true
        const participantIds = result.members.map((member) => member.userId);
        await createDraftReminders(result.draft.id, scheduledStartTime, participantIds);
      }

      logger.info('Draft scheduled successfully', {
        draftId: result.draft.id,
        leagueId: result.league.id,
        scheduledTime: scheduledStartTime.toISOString(),
        timeZone,
        timePerPick: body.timePerPick,
        remindersEnabled: body.enableReminders !== false,
        immediateStart: !body.scheduledTime,
      });
    } catch (error) {
      logger.error('Failed to schedule draft start', {
        draftId: result.draft.id,
        leagueId: result.league.id,
        scheduledTime: scheduledStartTime?.toISOString(),
        error: error instanceof Error ? error.message : String(error),
      });
      // Don't fail the entire request if scheduling fails
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
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Failed to create draft', {
      error: {
        name: error instanceof Error ? error.name : 'Unknown',
        message,
        stack: error instanceof Error ? error.stack : undefined,
      },
    });

    // In development, surface the underlying error message to the client
    if (process.env.NODE_ENV !== 'production') {
      return errorResponse(message || 'Failed to create draft', 500);
    }
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
