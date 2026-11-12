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
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { canManageLeague } from '@/server/leagues/membership';
import { MAX_LEAGUE_TEAMS, MIN_LEAGUE_TEAMS } from '@/server/leagues/leagueCapacity';
import { calculateDraftCapacity } from '@/server/draft/domain/draftCapacity';
import { writeDraftOrder } from '@/server/draft/draftOrderWriter';
import { splitDraftingMembers } from '@/server/leagues/leagueFormat';
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

function parseStoredLeagueCategories(raw: unknown): FantasyCategoryKey[] {
  return Array.isArray(raw) ? parseValidLeagueCategories(raw.map(String)) : [];
}

function hasStoredLeagueCategories(raw: unknown): boolean {
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

type ValidatedDraftRequest =
  { ok: true; timeZone: string; scheduledStartTime: Date } | { ok: false; error: string };

// Checks the request's own fields and resolves its start time (UTC); no database access.
function validateCreateDraftRequest(body: CreateDraftRequest): ValidatedDraftRequest {
  if (!body.name?.trim()) {
    return { ok: false, error: 'Draft name is required' };
  }

  if (
    typeof body.leagueSize !== 'number' ||
    !Number.isInteger(body.leagueSize) ||
    body.leagueSize < MIN_LEAGUE_TEAMS ||
    body.leagueSize > MAX_LEAGUE_TEAMS
  ) {
    return {
      ok: false,
      error: `League size must be between ${MIN_LEAGUE_TEAMS} and ${MAX_LEAGUE_TEAMS}`,
    };
  }

  if (!['snake', 'linear'].includes(body.draftType)) {
    return { ok: false, error: 'Draft type must be "snake" or "linear"' };
  }

  if (!body.timePerPick || !isValidPickSeconds(body.timePerPick)) {
    return {
      ok: false,
      error: `Time per pick must be between ${MIN_PICK_SECONDS} and ${MAX_PICK_SECONDS} seconds`,
    };
  }

  const timeZone = body.timeZone || 'UTC';
  if (!isValidTimeZone(timeZone)) {
    return { ok: false, error: 'Invalid timezone' };
  }

  // Without a scheduled time the draft starts in 5 minutes.
  if (!body.scheduledTime) {
    return { ok: true, timeZone, scheduledStartTime: addMinutes(new Date(), 5) };
  }

  let scheduledStartTime: Date;
  try {
    // Convert from the user's timezone to UTC for storage
    scheduledStartTime = localToUtc(body.scheduledTime, timeZone);
  } catch (_error) {
    return { ok: false, error: 'Invalid scheduled time format' };
  }
  if (scheduledStartTime <= new Date()) {
    return { ok: false, error: 'Scheduled time must be in the future' };
  }
  return { ok: true, timeZone, scheduledStartTime };
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

    // Drafts belong to a league; there is no standalone draft without one.
    if (!body.leagueId) {
      return NextResponse.json(
        { success: false, error: 'League draft creation requires a leagueId' },
        { status: 400 }
      );
    }

    if (!(await canManageLeague(body.leagueId, userId))) {
      return NextResponse.json(
        { success: false, error: 'Commissioner access required' },
        { status: 403 }
      );
    }

    const validated = validateCreateDraftRequest(body);
    if (!validated.ok) {
      return errorResponse(validated.error, 400);
    }
    const { timeZone, scheduledStartTime } = validated;

    const positionLimits = normalizeDraftPositionLimits(body.positionLimits);
    const autoPickRules = normalizeDraftAutoPickRules(body.autoPickRules);
    const pickOrder = normalizeDraftPickOrderMode(body.pickOrder);
    const rosterSize = getRosterSizeFromPositionLimits(positionLimits);
    const benchSize = getBenchSizeFromPositionLimits(positionLimits);
    const activePlayerCount = await prisma.player.count({ where: { active: true } });

    const leagueId = body.leagueId;
    const result = await prisma.$transaction(async (tx) => {
      const league = await tx.league.findUnique({
        where: { id: leagueId },
        include: {
          settings: true,
          members: { where: { isActive: true }, include: { user: true } },
        },
      });

      if (!league) {
        throw new Error('League not found');
      }

      const leagueCategories = normalizeLeagueCategories(body.leagueData?.categories);
      if (!hasStoredLeagueCategories(league.categoriesJson)) {
        await tx.league.update({
          where: { id: league.id },
          data: { categoriesJson: leagueCategories },
        });
      }

      const orderedMembers = orderMembersForDraft(league.members, body.participants, pickOrder);
      // BR-09, BR-10: the Bloodsucker never drafts; its roster is filled from the pool afterwards.
      const { drafters, bloodsucker } = splitDraftingMembers(orderedMembers, league.settings);
      const capacity = calculateDraftCapacity({
        teamCount: drafters.length,
        reservedTeamCount: bloodsucker ? 1 : 0,
        positionLimits,
        activePlayerCount,
      });
      const settingsData = {
        pickSeconds: body.timePerPick,
        allowAutoPick: autoPickRules.enabled,
        positionLimitsJson: positionLimits,
        autoPickRulesJson: autoPickRules,
        draftType: body.draftType === 'linear' ? DraftType.LINEAR : DraftType.SNAKE,
        pickOrder: pickOrder === 'manual' ? PickOrder.MANUAL : PickOrder.RANDOM,
        rosterSize,
        benchSize,
        startAt: scheduledStartTime,
        timeZone,
      };

      const settings = await tx.leagueSettings.update({
        where: { id: league.settings.id },
        data: settingsData,
      });

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
          totalPicks: capacity.totalPicks,
          round: 1,
          direction: DraftDirection.FORWARD,
          startedAt: body.scheduledTime ? undefined : new Date(),
        },
      });

      // Drafters take slots 1..n in this order; a Bloodsucker takes the next slot, outside the order.
      await writeDraftOrder(tx, {
        draftId: draft.id,
        members: orderedMembers,
        settings: league.settings,
      });

      return { draft, league, members: drafters, settings };
    });

    // Schedule draft start
    try {
      if (body.scheduledTime) {
        // User specified a time - schedule lobby to open 5 minutes before
        await scheduleDraftStart(
          { draftId: result.draft.id, leagueId: result.league.id },
          scheduledStartTime,
          body.timePerPick * 1000 // Convert seconds to milliseconds
        );
      } else {
        // No time specified - lobby is already open, schedule draft to start in 5 minutes
        await scheduleDraftStart(
          { draftId: result.draft.id, leagueId: result.league.id },
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
      startAt: result.settings.startAt?.toISOString() ?? null,
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
