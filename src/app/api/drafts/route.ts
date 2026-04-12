export const runtime = 'nodejs';
import type { NextRequest } from 'next/server';

import { DraftType, DraftStatus, DraftDirection, type Prisma } from '@prisma/client';
import { addMinutes } from 'date-fns';
import { z } from 'zod';

import { successResponse, errorResponse } from '@/lib/apiResponse';
import {
  DRAFT_PICK_SECONDS_OPTIONS,
  MAX_DRAFT_PICK_SECONDS,
  MIN_DRAFT_PICK_SECONDS,
} from '@/lib/draftClock';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { prismaUserPublicSelect } from '@/lib/prismaUserPublicSelect';
import {
  nestedUserCredentialCreate,
  USER_CREDENTIAL_ADMIN_DEMO,
  USER_CREDENTIAL_DRAFT_DEMO,
  USER_CREDENTIAL_DUMMY_BOT,
} from '@/lib/userCredentialConstants';
import { createDraftReminders } from '@/lib/reminders';
import { localToUtc, isValidTimeZone } from '@/lib/timezone';
import { scheduleDraftStart } from '@/server/queue/draftQueue';

const CreateDraftSchema = z.object({
  name: z.string().min(1, 'Draft name is required'),
  leagueId: z.string().optional(),
  leagueSize: z.number().int().min(4).max(20, 'League size must be between 4 and 20'),
  draftType: z.enum(['snake', 'linear']),
  timePerPick: z
    .number()
    .int()
    .refine(
      (value) =>
        DRAFT_PICK_SECONDS_OPTIONS.includes(value as (typeof DRAFT_PICK_SECONDS_OPTIONS)[number]),
      `Time per pick must be one of: ${DRAFT_PICK_SECONDS_OPTIONS.join(', ')} seconds`
    )
    .refine(
      (value) => value >= MIN_DRAFT_PICK_SECONDS && value <= MAX_DRAFT_PICK_SECONDS,
      `Time per pick must be between ${MIN_DRAFT_PICK_SECONDS} and ${MAX_DRAFT_PICK_SECONDS} seconds`
    ),
  scheduledTime: z.string().optional(),
  timeZone: z.string().optional(),
  enableReminders: z.boolean().optional(),
  leagueData: z
    .object({
      name: z.string(),
      maxTeams: z.number().int(),
      categories: z.array(z.string()),
      ownerId: z.string(),
    })
    .optional(),
  participants: z
    .array(
      z.object({
        userId: z.string(),
        memberId: z.string(),
        displayName: z.string(),
        draftOrder: z.number().int(),
        isOwner: z.boolean().optional(),
      })
    )
    .optional(),
});

async function ensureUserIdForDraftParticipant(
  tx: Prisma.TransactionClient,
  participant: { userId: string; displayName: string }
): Promise<string> {
  try {
    let user = await tx.user.findFirst({
      where: {
        OR: [{ id: participant.userId }, { email: `${participant.userId}@draft.local` }],
      },
      select: { id: true },
    });
    if (!user) {
      user = await tx.user.create({
        data: {
          id: participant.userId,
          email: `${participant.userId}_${Date.now()}@draft.local`,
          displayName: participant.displayName,
          timeZone: 'Australia/Melbourne',
          credential: nestedUserCredentialCreate(USER_CREDENTIAL_DRAFT_DEMO),
        },
        select: { id: true },
      });
    }
    return user.id;
  } catch {
    const user = await tx.user.create({
      data: {
        id: participant.userId,
        email: `${participant.userId}_${Date.now()}_${Math.random().toString(36).substring(7)}@draft.local`,
        displayName: participant.displayName,
        timeZone: 'Australia/Melbourne',
        credential: nestedUserCredentialCreate(USER_CREDENTIAL_DRAFT_DEMO),
      },
      select: { id: true },
    });
    return user.id;
  }
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.json();

    // Validate with Zod
    const parsed = CreateDraftSchema.safeParse(rawBody);
    if (!parsed.success) {
      logger.warn('Draft creation validation failed', {
        issues: parsed.error.flatten().fieldErrors,
      });
      return errorResponse('Validation failed', 400, 'VALIDATION_ERROR', {
        issues: parsed.error.flatten().fieldErrors,
      });
    }

    const body = parsed.data;

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
            members: { include: { user: { select: prismaUserPublicSelect } } },
          },
        });

        if (!league) {
          throw new Error('League not found');
        }

        settings = league.settings;
        const orderedMembers = [...league.members].sort((left, right) => {
          const leftSlot =
            typeof left.draftSlot === 'number' ? left.draftSlot : Number.MAX_SAFE_INTEGER;
          const rightSlot =
            typeof right.draftSlot === 'number' ? right.draftSlot : Number.MAX_SAFE_INTEGER;

          if (leftSlot !== rightSlot) {
            return leftSlot - rightSlot;
          }

          return left.joinedAt.getTime() - right.joinedAt.getTime();
        });
        const assignedSlots = orderedMembers.map((member) => member.draftSlot);
        const missingSlotMember = orderedMembers.find(
          (member) => typeof member.draftSlot !== 'number'
        );
        if (missingSlotMember) {
          throw new Error(`Draft order incomplete for ${missingSlotMember.teamName}`);
        }

        const slotSet = new Set<number>();
        for (const slot of assignedSlots) {
          if (typeof slot !== 'number' || slot < 1 || slot > orderedMembers.length) {
            throw new Error('Draft order contains an invalid slot assignment');
          }

          if (slotSet.has(slot)) {
            throw new Error(`Draft order contains duplicate slot ${slot}`);
          }

          slotSet.add(slot);
        }

        // Verify participants match league members if provided
        if (body.participants && body.participants.length !== orderedMembers.length) {
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
        for (let i = 0; i < orderedMembers.length; i++) {
          await tx.draftOrder.create({
            data: {
              draftId: draft.id,
              memberId: orderedMembers[i].id,
              slot: i + 1,
            },
          });
        }

        return { draft, league, members: orderedMembers, settings };
      } else {
        // Create new temporary league for standalone draft (existing logic)
        settings = await tx.leagueSettings.create({
          data: {
            rosterSize,
            benchSize,
            maxTeams: body.leagueSize,
            pickSeconds: body.timePerPick,
            allowAutoPick: true,
            draftType:
              body.draftType === 'linear' ? ('LINEAR' as typeof DraftType.SNAKE) : DraftType.SNAKE,
            startAt: scheduledStartTime || new Date(),
            timeZone,
            locked: false,
          },
        });

        let resolvedOwnerId: string | null = null;
        if (body.leagueData?.ownerId) {
          const existingOwner = await tx.user.findUnique({
            where: { id: body.leagueData.ownerId },
            select: { id: true },
          });
          if (existingOwner) {
            resolvedOwnerId = existingOwner.id;
          }
        }

        if (!resolvedOwnerId && body.participants && body.participants.length > 0) {
          const ownerParticipant = body.participants.find((p) => p.isOwner) ?? body.participants[0];
          resolvedOwnerId = await ensureUserIdForDraftParticipant(tx, ownerParticipant);
        }

        if (!resolvedOwnerId) {
          const seedOwner = await tx.user.create({
            data: {
              email: `admin_${Date.now()}@statly.local`,
              displayName: 'You (Admin)',
              timeZone: 'Australia/Melbourne',
              credential: nestedUserCredentialCreate(USER_CREDENTIAL_ADMIN_DEMO),
            },
            select: { id: true },
          });
          resolvedOwnerId = seedOwner.id;
        }

        league = await tx.league.create({
          data: {
            name: body.leagueData?.name || body.name,
            inviteCode: `DRAFT_${Date.now()}`,
            ownerId: resolvedOwnerId,
            settingsId: settings.id,
          },
        });

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

        const members = [];

        if (body.participants && body.participants.length > 0) {
          for (let i = 0; i < body.participants.length; i++) {
            const participant = body.participants[i];
            const userId = await ensureUserIdForDraftParticipant(tx, participant);

            const member = await tx.leagueMember.create({
              data: {
                leagueId: league.id,
                userId,
                role: participant.isOwner ? 'OWNER' : 'MANAGER',
                teamName: participant.displayName,
                draftSlot: participant.draftOrder,
              },
            });

            members.push(member);
          }
        } else {
          const yourMember = await tx.leagueMember.create({
            data: {
              leagueId: league.id,
              userId: resolvedOwnerId,
              role: 'OWNER',
              teamName: 'Your Team',
            },
          });

          members.push(yourMember);

          for (let i = 1; i < body.leagueSize; i++) {
            const dummyUser = await tx.user.create({
              data: {
                email: `dummy_${i}_${Date.now()}_${Math.random().toString(36).substring(7)}@bot.local`,
                displayName: `CPU Team ${i}`,
                timeZone: 'UTC',
                credential: nestedUserCredentialCreate(USER_CREDENTIAL_DUMMY_BOT),
              },
              select: { id: true },
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
                user: { select: prismaUserPublicSelect },
              },
            },
          },
        },
        picks: {
          include: {
            player: true,
            member: {
              include: {
                user: { select: prismaUserPublicSelect },
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
