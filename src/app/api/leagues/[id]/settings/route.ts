import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { adminDb } from '@/lib/firebaseAdmin';
import {
  getLeagueMembership,
  isLeagueManagerRole,
  listActiveLeagueMembers,
} from '@/lib/leagueMembership';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { ensureLeagueDraftSetupConverged } from '@/server/draft/services/DraftSetupConvergenceService';
import {
  DEFAULT_DRAFT_AUTO_PICK_RULES,
  DEFAULT_DRAFT_POSITION_LIMITS,
  getBenchSizeFromPositionLimits,
  getRosterSizeFromPositionLimits,
  isValidPickSeconds,
  normalizeDraftAutoPickRules,
  normalizeDraftPickOrderMode,
  normalizeDraftPositionLimits,
} from '@/lib/draftSettings';
import { REAL_DATA_NINE_CATEGORY_PRESET, type FantasyCategoryKey } from '@/types/fantasyCategories';
import {
  normalizeCategoryDirections,
  parseCategoryDirectionsJson,
} from '@/server/leagues/categoryDirections';
import { normalizeLineupSlots, parseLineupSlotsJson } from '@/server/leagues/lineupSettings';
import type { CategoryDirection, LeagueScoringMode } from '@/types/leagues';
import {
  MAX_LEAGUE_TEAMS,
  MIN_LEAGUE_TEAMS,
  getMaxTeamsUpdateError,
} from '@/server/leagues/leagueCapacity';

type DraftTypeValue = 'SNAKE' | 'LINEAR';
type WaiverRuleValue = 'WEEKLY' | 'ROLLING';

const TEST_LEAGUE_ID = 'test-league-id';
const TEST_LEAGUE_OWNER_ID = '2qlfdHSCFTPlxoKFSUfNLSlCDRe2';
const REAL_DATA_CATEGORY_KEYS = new Set<FantasyCategoryKey>(REAL_DATA_NINE_CATEGORY_PRESET);

function isDevelopmentTestLeague(leagueId: string) {
  return process.env.NODE_ENV !== 'production' && leagueId === TEST_LEAGUE_ID;
}

async function authorizeLeagueSettingsRead(request: NextRequest, leagueId: string) {
  const userId = await getAuthenticatedUserId(request);
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const membership = await getLeagueMembership(leagueId, userId);
  if (!membership.isMember) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return null;
}

async function authorizeLeagueSettingsWrite(request: NextRequest, leagueId: string) {
  const userId = await getAuthenticatedUserId(request);
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const membership = await getLeagueMembership(leagueId, userId);
  if (!membership.isMember || !isLeagueManagerRole(membership.data?.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return null;
}

function getNestedValue(source: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (key in source) return source[key];
  }

  return undefined;
}

function normalizeLeagueCategories(value: unknown): FantasyCategoryKey[] {
  if (typeof value === 'string' && value.trim()) {
    try {
      return normalizeLeagueCategories(JSON.parse(value));
    } catch {
      return [...REAL_DATA_NINE_CATEGORY_PRESET];
    }
  }

  if (!Array.isArray(value)) {
    return [...REAL_DATA_NINE_CATEGORY_PRESET];
  }

  const selected = value.filter(
    (category): category is FantasyCategoryKey =>
      typeof category === 'string' && REAL_DATA_CATEGORY_KEYS.has(category as FantasyCategoryKey)
  );

  return selected.length === value.length && selected.length
    ? selected
    : [...REAL_DATA_NINE_CATEGORY_PRESET];
}

function normalizeLeagueScoringMode(
  value: unknown,
  fallback: LeagueScoringMode
): LeagueScoringMode {
  return value === 'H2H_MOST_CATEGORIES' ? 'H2H_MOST_CATEGORIES' : fallback;
}

function normalizeDraftType(value: unknown, fallback: DraftTypeValue): DraftTypeValue {
  return String(value ?? fallback)
    .trim()
    .toUpperCase() === 'LINEAR'
    ? 'LINEAR'
    : 'SNAKE';
}

function normalizeWaiverRule(value: unknown, fallback: WaiverRuleValue): WaiverRuleValue {
  return String(value ?? fallback)
    .trim()
    .toUpperCase() === 'ROLLING'
    ? 'ROLLING'
    : 'WEEKLY';
}

function parseOptionalDate(value: unknown): Date | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim().length === 0) return null;

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseOptionalInteger(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? Math.floor(parsed) : undefined;
}

function toTestLeagueSettingsResponse(body: Record<string, unknown> = {}) {
  const leagueInput = (body.league && typeof body.league === 'object' ? body.league : {}) as Record<
    string,
    unknown
  >;
  const draftInput = (body.draft && typeof body.draft === 'object' ? body.draft : {}) as Record<
    string,
    unknown
  >;
  const rosterInput = (body.roster && typeof body.roster === 'object' ? body.roster : {}) as Record<
    string,
    unknown
  >;
  const scoringInput = (
    body.scoring && typeof body.scoring === 'object' ? body.scoring : {}
  ) as Record<string, unknown>;
  const waiverInput = (body.waiver && typeof body.waiver === 'object' ? body.waiver : {}) as Record<
    string,
    unknown
  >;
  const draftDate =
    typeof draftInput.draftDate === 'string' && draftInput.draftDate.trim()
      ? draftInput.draftDate
      : new Date('2026-06-07T09:00:00.000Z').toISOString();
  const timePerPick = parseOptionalInteger(draftInput.timePerPick) ?? 120;
  const maxTeams = parseOptionalInteger(leagueInput.maxTeams) ?? 12;
  const positionLimits = normalizeDraftPositionLimits(
    rosterInput.positionLimits ?? DEFAULT_DRAFT_POSITION_LIMITS
  );
  const autoPickRules = normalizeDraftAutoPickRules(
    draftInput.autoPickRules ?? DEFAULT_DRAFT_AUTO_PICK_RULES
  );

  return {
    league: {
      id: TEST_LEAGUE_ID,
      name:
        typeof leagueInput.name === 'string' && leagueInput.name.trim()
          ? leagueInput.name.trim()
          : 'Test Fantasy League',
      code: 'TEST2026',
      maxTeams,
      locked: false,
    },
    scoring: {
      scoringFormat: 'nine-category',
      categories: normalizeLeagueCategories(scoringInput.categories),
      scoringMode: normalizeLeagueScoringMode(scoringInput.scoringMode, 'H2H_EACH_CATEGORY'),
      lineupSlots: normalizeLineupSlots(scoringInput.lineupSlots),
      categoryDirections: normalizeCategoryDirections(
        normalizeLeagueCategories(scoringInput.categories),
        scoringInput.categoryDirections as Partial<Record<FantasyCategoryKey, CategoryDirection>>
      ),
      scoringSettingsLockedAt: null,
    },
    roster: {
      rosterSize: getRosterSizeFromPositionLimits(positionLimits),
      benchSize: getBenchSizeFromPositionLimits(positionLimits),
      positionLimits,
    },
    draft: {
      draftDate,
      draftType: String(draftInput.draftType ?? 'snake').toLowerCase(),
      timePerPick,
      pickOrder: normalizeDraftPickOrderMode(draftInput.pickOrder),
      timeZone:
        typeof draftInput.timeZone === 'string' && draftInput.timeZone.trim()
          ? draftInput.timeZone
          : 'Australia/Melbourne',
      autoPickRules,
    },
    waiver: {
      waiverRule: String(waiverInput.waiverRule ?? 'weekly').toLowerCase(),
    },
  };
}

function toSettingsResponse(league: {
  id: string;
  name: string;
  inviteCode: string;
  categoriesJson: string | null;
  settings: {
    maxTeams: number;
    rosterSize: number;
    benchSize: number;
    pickSeconds: number;
    allowAutoPick: boolean;
    positionLimitsJson: string | null;
    autoPickRulesJson: string | null;
    draftType: string;
    pickOrder: string;
    waiverRule: string;
    startAt: Date;
    timeZone: string;
    locked: boolean;
    scoringMode: string;
    lineupSlotsJson: string | null;
    categoryDirectionsJson: string | null;
    scoringSettingsLockedAt: Date | null;
  };
}) {
  const positionLimits = normalizeDraftPositionLimits(league.settings.positionLimitsJson);
  const autoPickRules = normalizeDraftAutoPickRules(league.settings.autoPickRulesJson);
  const categories = normalizeLeagueCategories(league.categoriesJson);

  return {
    league: {
      id: league.id,
      name: league.name,
      code: league.inviteCode,
      maxTeams: league.settings.maxTeams,
      locked: league.settings.locked,
    },
    scoring: {
      scoringFormat: 'nine-category',
      categories,
      scoringMode: normalizeLeagueScoringMode(league.settings.scoringMode, 'H2H_EACH_CATEGORY'),
      lineupSlots: parseLineupSlotsJson(league.settings.lineupSlotsJson),
      categoryDirections: parseCategoryDirectionsJson(
        categories,
        league.settings.categoryDirectionsJson
      ),
      scoringSettingsLockedAt: league.settings.scoringSettingsLockedAt?.toISOString() ?? null,
    },
    roster: {
      rosterSize: league.settings.rosterSize,
      benchSize: league.settings.benchSize,
      positionLimits,
    },
    draft: {
      draftDate: league.settings.startAt.toISOString(),
      draftType: league.settings.draftType.toLowerCase(),
      timePerPick: league.settings.pickSeconds,
      pickOrder: league.settings.pickOrder.toLowerCase(),
      timeZone: league.settings.timeZone,
      autoPickRules,
    },
    waiver: {
      waiverRule: league.settings.waiverRule.toLowerCase(),
    },
  };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'League ID is required' }, { status: 400 });
    }

    if (isDevelopmentTestLeague(id)) {
      return NextResponse.json({
        success: true,
        data: toTestLeagueSettingsResponse(),
      });
    }

    const authError = await authorizeLeagueSettingsRead(request, id);
    if (authError) {
      return authError;
    }

    const prismaLeague = await prisma.league.findUnique({
      where: { id },
      include: { settings: true },
    });

    if (prismaLeague?.settings) {
      return NextResponse.json({
        success: true,
        data: toSettingsResponse(prismaLeague),
      });
    }

    const leagueRef = adminDb.collection('leagues').doc(id);
    const leagueDoc = await leagueRef.get();

    if (!leagueDoc.exists) {
      return NextResponse.json({ error: 'League not found' }, { status: 404 });
    }

    const data = leagueDoc.data() ?? {};
    return NextResponse.json({
      success: true,
      data: {
        league: {
          id,
          name: data.name ?? 'League',
          code: data.code ?? '',
          maxTeams: Number(data.maxTeams ?? 12),
          locked: false,
        },
        scoring: {
          scoringFormat: 'nine-category',
          categories: normalizeLeagueCategories(data.categories),
          scoringMode: normalizeLeagueScoringMode(data.scoringMode, 'H2H_EACH_CATEGORY'),
          lineupSlots: normalizeLineupSlots(data.lineupSlots),
          categoryDirections: normalizeCategoryDirections(
            normalizeLeagueCategories(data.categories),
            data.categoryDirections as Partial<Record<FantasyCategoryKey, CategoryDirection>>
          ),
          scoringSettingsLockedAt:
            typeof data.scoringSettingsLockedAt === 'string' ? data.scoringSettingsLockedAt : null,
        },
        roster: {
          rosterSize: 18,
          benchSize: 4,
          positionLimits: normalizeDraftPositionLimits(data.positionLimits),
        },
        draft: {
          draftDate: data.draftDate ?? new Date().toISOString(),
          draftType: String(data.draftType ?? 'snake').toLowerCase(),
          timePerPick: Number(data.timePerPick ?? 120),
          pickOrder: normalizeDraftPickOrderMode(data.pickOrder),
          timeZone: data.timeZone ?? 'Australia/Melbourne',
          autoPickRules: normalizeDraftAutoPickRules(data.autoPickRules),
        },
        waiver: {
          waiverRule: String(data.waiverRule ?? data.waiverWire?.waiverResetPolicy ?? 'weekly'),
        },
      },
    });
  } catch (error) {
    logger.error('Error fetching league settings:', error);
    return NextResponse.json({ error: 'Failed to fetch league settings' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'League ID is required' }, { status: 400 });
    }

    if (isDevelopmentTestLeague(id)) {
      const userId = await getAuthenticatedUserId(request);
      if (!userId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }

      if (userId !== TEST_LEAGUE_OWNER_ID) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }

      const testBody = (await request.json()) as Record<string, unknown>;
      return NextResponse.json({
        success: true,
        data: toTestLeagueSettingsResponse(testBody),
      });
    }

    const authError = await authorizeLeagueSettingsWrite(request, id);
    if (authError) {
      return authError;
    }

    const body = (await request.json()) as Record<string, unknown>;
    const leagueInput = (
      body.league && typeof body.league === 'object' ? body.league : {}
    ) as Record<string, unknown>;
    const draftInput = (body.draft && typeof body.draft === 'object' ? body.draft : {}) as Record<
      string,
      unknown
    >;
    const rosterInput = (
      body.roster && typeof body.roster === 'object' ? body.roster : {}
    ) as Record<string, unknown>;
    const scoringInput = (
      body.scoring && typeof body.scoring === 'object' ? body.scoring : {}
    ) as Record<string, unknown>;
    const waiverInput = (
      body.waiver && typeof body.waiver === 'object' ? body.waiver : {}
    ) as Record<string, unknown>;

    const prismaLeague = await prisma.league.findUnique({
      where: { id },
      include: {
        settings: true,
        _count: { select: { members: true } },
      },
    });

    if (prismaLeague?.settings) {
      const nameInput =
        getNestedValue(leagueInput, ['name', 'leagueName']) ??
        getNestedValue(body, ['name', 'leagueName']);
      const nextName = typeof nameInput === 'string' ? nameInput.trim() : undefined;
      if (nextName !== undefined && nextName.length < 3) {
        return NextResponse.json(
          { error: 'League name must be at least 3 characters' },
          { status: 400 }
        );
      }

      const categoriesInput = scoringInput.categories ?? body.categories;
      const categories =
        categoriesInput === undefined
          ? normalizeLeagueCategories(prismaLeague.categoriesJson)
          : normalizeLeagueCategories(categoriesInput);
      const scoringMode = normalizeLeagueScoringMode(
        scoringInput.scoringMode ?? body.scoringMode,
        prismaLeague.settings.scoringMode as LeagueScoringMode
      );
      const lineupSlots =
        scoringInput.lineupSlots === undefined && body.lineupSlots === undefined
          ? parseLineupSlotsJson(prismaLeague.settings.lineupSlotsJson)
          : normalizeLineupSlots(scoringInput.lineupSlots ?? body.lineupSlots);
      const categoryDirections = normalizeCategoryDirections(
        categories,
        (scoringInput.categoryDirections ?? body.categoryDirections) as Partial<
          Record<FantasyCategoryKey, CategoryDirection>
        >
      );
      const scoringSettingsChanged =
        scoringInput.scoringMode !== undefined ||
        body.scoringMode !== undefined ||
        scoringInput.lineupSlots !== undefined ||
        body.lineupSlots !== undefined ||
        scoringInput.categoryDirections !== undefined ||
        body.categoryDirections !== undefined ||
        categoriesInput !== undefined;
      if (scoringSettingsChanged && prismaLeague.settings.scoringSettingsLockedAt) {
        return NextResponse.json({ error: 'Scoring settings are locked' }, { status: 409 });
      }

      const draftDate = parseOptionalDate(
        draftInput.draftDate ?? draftInput.scheduledTime ?? body.draftDate ?? body.startAt
      );
      if (draftDate === null) {
        return NextResponse.json({ error: 'Invalid draft date' }, { status: 400 });
      }

      const timePerPickInput =
        draftInput.timePerPick ?? draftInput.pickSeconds ?? body.timePerPick ?? body.pickSeconds;
      const timePerPick = parseOptionalInteger(timePerPickInput);
      if (
        timePerPickInput !== undefined &&
        (timePerPick === undefined || !isValidPickSeconds(timePerPick))
      ) {
        return NextResponse.json(
          { error: 'Time per pick must be between 15 and 600 seconds' },
          { status: 400 }
        );
      }

      const maxTeamsInput = leagueInput.maxTeams ?? body.maxTeams;
      const maxTeams = parseOptionalInteger(maxTeamsInput);
      if (
        maxTeamsInput !== undefined &&
        (maxTeams === undefined || maxTeams < MIN_LEAGUE_TEAMS || maxTeams > MAX_LEAGUE_TEAMS)
      ) {
        return NextResponse.json(
          { error: `Max teams must be between ${MIN_LEAGUE_TEAMS} and ${MAX_LEAGUE_TEAMS}` },
          { status: 400 }
        );
      }

      const maxTeamsUpdateError = getMaxTeamsUpdateError({
        nextMaxTeams: maxTeams,
        activeMemberCount: prismaLeague._count.members,
      });
      if (maxTeamsUpdateError) {
        return NextResponse.json({ error: maxTeamsUpdateError }, { status: 400 });
      }

      const positionLimits = normalizeDraftPositionLimits(
        rosterInput.positionLimits ??
          body.positionLimits ??
          prismaLeague.settings.positionLimitsJson
      );
      const autoPickRules = normalizeDraftAutoPickRules(
        draftInput.autoPickRules ?? body.autoPickRules ?? prismaLeague.settings.autoPickRulesJson
      );
      const draftType = normalizeDraftType(
        draftInput.draftType ?? body.draftType,
        prismaLeague.settings.draftType
      );
      const pickOrder = normalizeDraftPickOrderMode(
        draftInput.pickOrder ?? body.pickOrder ?? prismaLeague.settings.pickOrder
      );
      const waiverRule = normalizeWaiverRule(
        waiverInput.waiverRule ?? body.waiverRule,
        prismaLeague.settings.waiverRule
      );
      const timeZone =
        typeof (draftInput.timeZone ?? body.timeZone) === 'string'
          ? String(draftInput.timeZone ?? body.timeZone)
          : prismaLeague.settings.timeZone;

      await prisma.$transaction([
        prisma.league.update({
          where: { id },
          data: {
            ...(nextName ? { name: nextName } : {}),
            categoriesJson: JSON.stringify(categories),
          },
        }),
        prisma.leagueSettings.update({
          where: { id: prismaLeague.settings.id },
          data: {
            maxTeams: maxTeams ?? prismaLeague.settings.maxTeams,
            ...(draftDate ? { startAt: draftDate } : {}),
            pickSeconds: timePerPick ?? prismaLeague.settings.pickSeconds,
            draftType,
            pickOrder: pickOrder === 'manual' ? 'MANUAL' : 'RANDOM',
            waiverRule,
            timeZone,
            allowAutoPick: autoPickRules.enabled,
            rosterSize: getRosterSizeFromPositionLimits(positionLimits),
            benchSize: getBenchSizeFromPositionLimits(positionLimits),
            positionLimitsJson: JSON.stringify(positionLimits),
            autoPickRulesJson: JSON.stringify(autoPickRules),
            scoringMode,
            lineupSlotsJson: JSON.stringify(lineupSlots),
            categoryDirectionsJson: JSON.stringify(categoryDirections),
          },
        }),
      ]);

      await ensureLeagueDraftSetupConverged({
        prismaClient: prisma,
        leagueId: id,
      });

      const updatedLeague = await prisma.league.findUnique({
        where: { id },
        include: { settings: true },
      });

      if (!updatedLeague?.settings) {
        return NextResponse.json({ error: 'League not found' }, { status: 404 });
      }

      return NextResponse.json({
        success: true,
        data: toSettingsResponse(updatedLeague),
      });
    }

    const leagueRef = adminDb.collection('leagues').doc(id);
    const leagueDoc = await leagueRef.get();

    if (!leagueDoc.exists) {
      return NextResponse.json({ error: 'League not found' }, { status: 404 });
    }

    const maxTeamsInput = leagueInput.maxTeams ?? body.maxTeams;
    const maxTeams = parseOptionalInteger(maxTeamsInput);
    if (maxTeamsInput !== undefined && maxTeams === undefined) {
      return NextResponse.json(
        { error: `Max teams must be between ${MIN_LEAGUE_TEAMS} and ${MAX_LEAGUE_TEAMS}` },
        { status: 400 }
      );
    }

    if (maxTeamsInput !== undefined) {
      const maxTeamsUpdateError = getMaxTeamsUpdateError({
        nextMaxTeams: maxTeams,
        activeMemberCount: (await listActiveLeagueMembers(id)).length,
      });
      if (maxTeamsUpdateError) {
        return NextResponse.json({ error: maxTeamsUpdateError }, { status: 400 });
      }
    }

    const categories = normalizeLeagueCategories(scoringInput.categories ?? body.categories);
    const firestoreScoringMode = normalizeLeagueScoringMode(
      scoringInput.scoringMode ?? body.scoringMode,
      'H2H_EACH_CATEGORY'
    );
    const firestoreLineupSlots = normalizeLineupSlots(scoringInput.lineupSlots ?? body.lineupSlots);
    const firestoreCategoryDirections = normalizeCategoryDirections(
      categories,
      (scoringInput.categoryDirections ?? body.categoryDirections) as Partial<
        Record<FantasyCategoryKey, CategoryDirection>
      >
    );
    await leagueRef.update({
      ...(typeof (leagueInput.name ?? body.name) === 'string' &&
      String(leagueInput.name ?? body.name).trim()
        ? { name: String(leagueInput.name ?? body.name).trim() }
        : {}),
      ...(maxTeamsInput !== undefined ? { maxTeams } : {}),
      categories,
      ...(body.draftDate || draftInput.draftDate
        ? { draftDate: body.draftDate ?? draftInput.draftDate }
        : {}),
      scoringMode: firestoreScoringMode,
      lineupSlots: firestoreLineupSlots,
      categoryDirections: firestoreCategoryDirections,
      draftType: draftInput.draftType ?? body.draftType ?? 'snake',
      timePerPick: draftInput.timePerPick ?? body.timePerPick ?? 120,
      pickOrder: normalizeDraftPickOrderMode(draftInput.pickOrder ?? body.pickOrder),
      waiverRule: String(waiverInput.waiverRule ?? body.waiverRule ?? 'weekly').toLowerCase(),
      positionLimits: normalizeDraftPositionLimits(
        rosterInput.positionLimits ?? body.positionLimits
      ),
      autoPickRules: normalizeDraftAutoPickRules(draftInput.autoPickRules ?? body.autoPickRules),
      updatedAt: new Date().toISOString(),
    });

    const updatedDoc = await leagueRef.get();
    const data = updatedDoc.data() ?? {};

    return NextResponse.json({
      success: true,
      data: {
        league: {
          id,
          name: data.name ?? 'League',
          code: data.code ?? '',
          maxTeams: Number(data.maxTeams ?? 12),
          locked: false,
        },
        scoring: {
          scoringFormat: 'nine-category',
          categories: normalizeLeagueCategories(data.categories),
          scoringMode: normalizeLeagueScoringMode(data.scoringMode, 'H2H_EACH_CATEGORY'),
          lineupSlots: normalizeLineupSlots(data.lineupSlots),
          categoryDirections: normalizeCategoryDirections(
            normalizeLeagueCategories(data.categories),
            data.categoryDirections as Partial<Record<FantasyCategoryKey, CategoryDirection>>
          ),
          scoringSettingsLockedAt:
            typeof data.scoringSettingsLockedAt === 'string' ? data.scoringSettingsLockedAt : null,
        },
        roster: {
          rosterSize: 18,
          benchSize: 4,
          positionLimits: normalizeDraftPositionLimits(data.positionLimits),
        },
        draft: {
          draftDate: data.draftDate ?? new Date().toISOString(),
          draftType: String(data.draftType ?? 'snake').toLowerCase(),
          timePerPick: Number(data.timePerPick ?? 120),
          pickOrder: normalizeDraftPickOrderMode(data.pickOrder),
          timeZone: data.timeZone ?? 'Australia/Melbourne',
          autoPickRules: normalizeDraftAutoPickRules(data.autoPickRules),
        },
        waiver: {
          waiverRule: String(data.waiverRule ?? data.waiverWire?.waiverResetPolicy ?? 'weekly'),
        },
      },
    });
  } catch (error) {
    logger.error('Error updating league settings:', error);
    return NextResponse.json({ error: 'Failed to update league settings' }, { status: 500 });
  }
}
