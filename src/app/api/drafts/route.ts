import { NextResponse, type NextRequest } from 'next/server';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import {
  DraftType,
  DraftStatus,
  DraftDirection,
  PickOrder,
  type LeagueMember,
} from '@prisma/client';
import { scheduleDraftStart } from '@/server/queue/draftQueue';
import { localToUtc, isValidTimeZone } from '@/lib/timezone';
import { createDraftReminders } from '@/lib/reminders';
import { ensurePrismaLeagueMirror } from '@/lib/prismaLeagueBridge';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { canManageLeague } from '@/server/leagues/membership';
import { calculateDraftCapacity } from '@/server/draft/domain/draftCapacity';
import {
  FANTASY_CATEGORIES,
  REAL_DATA_NINE_CATEGORY_PRESET,
  type FantasyCategoryKey,
} from '@/types/fantasyCategories';
import {
  MAX_PICK_SECONDS,
  MIN_PICK_SECONDS,
  getBenchSizeFromPositionLimits,
  getRosterSizeFromPositionLimits,
  isValidPickSeconds,
  normalizeDraftAutoPickRules,
  normalizeDraftPickOrderMode,
  normalizeDraftPositionLimits,
  type DraftAutoPickRules,
  type DraftPickOrderMode,
  type DraftPositionLimits,
} from '@/lib/draftSettings';
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
  pickOrder?: DraftPickOrderMode;
  positionLimits?: DraftPositionLimits;
  autoPickRules?: DraftAutoPickRules;
  rosterSize?: number;
  benchSize?: number;
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

type LeagueMemberWithUser = LeagueMember & {
  user: { id: string; email: string; displayName: string | null; timeZone: string | null };
};

const VALID_FANTASY_CATEGORY_KEYS = new Set(Object.keys(FANTASY_CATEGORIES));

function parseValidLeagueCategories(
  categories: readonly string[] | null | undefined
): FantasyCategoryKey[] {
  return (categories ?? [])
    .map(String)
    .filter((category): category is FantasyCategoryKey =>
      VALID_FANTASY_CATEGORY_KEYS.has(category)
    );
}

function normalizeLeagueCategories(
  categories: readonly string[] | null | undefined
): FantasyCategoryKey[] {
  const selected = parseValidLeagueCategories(categories);
  return selected.length ? selected : [...REAL_DATA_NINE_CATEGORY_PRESET];
}

function parseStoredLeagueCategories(raw: string | null | undefined): FantasyCategoryKey[] {
  if (!raw) return [];

  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parseValidLeagueCategories(parsed.map(String)) : [];
  } catch {
    return parseValidLeagueCategories(raw.split(','));
  }
}

function hasStoredLeagueCategories(raw: string | null | undefined): boolean {
  return parseStoredLeagueCategories(raw).length > 0;
}

function orderMembersForDraft(
  members: LeagueMemberWithUser[],
  participants: CreateDraftRequest['participants'],
  pickOrder: DraftPickOrderMode
): LeagueMemberWithUser[] {
  if (!participants?.length) {
    const ordered = [...members].sort((a, b) => {
      const slotA = a.draftSlot ?? Number.MAX_SAFE_INTEGER;
      const slotB = b.draftSlot ?? Number.MAX_SAFE_INTEGER;
      if (slotA !== slotB) return slotA - slotB;
      return a.joinedAt.getTime() - b.joinedAt.getTime();
    });

    if (pickOrder === 'manual') {
      return ordered;
    }

    for (let i = ordered.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
    }

    return ordered;
  }

  const rankByMemberId = new Map(
    participants.map((participant) => [participant.memberId, participant.draftOrder])
  );
  const rankByUserId = new Map(
    participants.map((participant) => [participant.userId, participant.draftOrder])
  );

  return [...members].sort((a, b) => {
    const rankA = rankByMemberId.get(a.id) ?? rankByUserId.get(a.userId) ?? Number.MAX_SAFE_INTEGER;
    const rankB = rankByMemberId.get(b.id) ?? rankByUserId.get(b.userId) ?? Number.MAX_SAFE_INTEGER;
    if (rankA !== rankB) return rankA - rankB;
    return a.joinedAt.getTime() - b.joinedAt.getTime();
  });
}

export async function POST(request: NextRequest) {
  try {
    const userId = await getAuthenticatedUserId(request);
    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    const body: CreateDraftRequest = await request.json();

    if (process.env.NODE_ENV === 'production' && !body.leagueId) {
      return NextResponse.json(
        { success: false, error: 'League draft creation requires a leagueId' },
        { status: 400 }
      );
    }

    if (body.leagueId && !(await canManageLeague(body.leagueId, userId))) {
      return NextResponse.json(
        { success: false, error: 'Commissioner access required' },
        { status: 403 }
      );
    }

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

    if (!body.timePerPick || !isValidPickSeconds(body.timePerPick)) {
      return errorResponse(
        `Time per pick must be between ${MIN_PICK_SECONDS} and ${MAX_PICK_SECONDS} seconds`,
        400
      );
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

    const positionLimits = normalizeDraftPositionLimits(body.positionLimits);
    const autoPickRules = normalizeDraftAutoPickRules(body.autoPickRules);
    const pickOrder = normalizeDraftPickOrderMode(body.pickOrder);
    const rosterSize = getRosterSizeFromPositionLimits(positionLimits);
    const benchSize = getBenchSizeFromPositionLimits(positionLimits);
    const activePlayerCount = await prisma.player.count({ where: { active: true } });

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
          pickOrder,
          positionLimits,
          autoPickRules,
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

        const leagueCategories = normalizeLeagueCategories(body.leagueData?.categories);
        if (!hasStoredLeagueCategories(league.categoriesJson)) {
          await tx.league.update({
            where: { id: league.id },
            data: { categoriesJson: JSON.stringify(leagueCategories) },
          });
        }

        const orderedMembers = orderMembersForDraft(league.members, body.participants, pickOrder);
        const capacity = calculateDraftCapacity({
          teamCount: orderedMembers.length,
          positionLimits,
          activePlayerCount,
        });
        const settingsData = {
          pickSeconds: body.timePerPick,
          allowAutoPick: autoPickRules.enabled,
          positionLimitsJson: JSON.stringify(positionLimits),
          autoPickRulesJson: JSON.stringify(autoPickRules),
          draftType: body.draftType === 'linear' ? DraftType.LINEAR : DraftType.SNAKE,
          pickOrder: pickOrder === 'manual' ? PickOrder.MANUAL : PickOrder.RANDOM,
          rosterSize,
          benchSize,
          startAt: scheduledStartTime,
          timeZone,
        };

        settings = await tx.leagueSettings.update({
          where: { id: league.settings.id },
          data: settingsData,
        });

        // Verify participants match league members if provided
        if (body.participants && body.participants.length !== league.members.length) {
          throw new Error('Participant count does not match league member count');
        }

        for (let i = 0; i < orderedMembers.length; i++) {
          if (orderedMembers[i].draftSlot !== i + 1) {
            await tx.leagueMember.update({
              where: { id: orderedMembers[i].id },
              data: { draftSlot: i + 1 },
            });
          }
        }

        // Create draft with existing league
        const draft = await tx.draft.create({
          data: {
            leagueId: league.id,
            status: DraftStatus.SCHEDULED,
            lobbyStatus: body.scheduledTime ? 'CLOSED' : 'COUNTDOWN',
            lobbyOpenAt: body.scheduledTime ? undefined : new Date(),
            currentPick: 1,
            totalPicks: capacity.totalPicks,
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
        const capacity = calculateDraftCapacity({
          teamCount: body.leagueSize,
          positionLimits,
          activePlayerCount,
        });

        // Create new temporary league for standalone draft (existing logic)
        settings = await tx.leagueSettings.create({
          data: {
            rosterSize,
            benchSize,
            maxTeams: body.leagueSize,
            pickSeconds: body.timePerPick,
            allowAutoPick: autoPickRules.enabled,
            positionLimitsJson: JSON.stringify(positionLimits),
            autoPickRulesJson: JSON.stringify(autoPickRules),
            draftType: body.draftType === 'linear' ? DraftType.LINEAR : DraftType.SNAKE,
            pickOrder: pickOrder === 'manual' ? PickOrder.MANUAL : PickOrder.RANDOM,
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
            categoriesJson: JSON.stringify(normalizeLeagueCategories(body.leagueData?.categories)),
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
            totalPicks: capacity.totalPicks,
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
        const orderedMembers = orderMembersForDraft(
          members as LeagueMemberWithUser[],
          body.participants,
          pickOrder
        );
        for (let i = 0; i < orderedMembers.length; i++) {
          await tx.draftOrder.create({
            data: {
              draftId: draft.id,
              slot: i + 1,
              memberId: orderedMembers[i].id,
            },
          });
        }

        return { draft, league, members: orderedMembers, settings };
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
      leagueId: result.league.id,
      league: {
        id: result.league.id,
        name: result.league.name,
      },
      leagueSize: body.leagueSize,
      draftType: body.draftType,
      timePerPick: body.timePerPick,
      status: result.draft.status,
      startAt: result.settings.startAt.toISOString(),
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
