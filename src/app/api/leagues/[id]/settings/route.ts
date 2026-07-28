import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { adminDb } from '@/lib/firebaseAdmin';
import { listActiveLeagueMembers } from '@/lib/leagueMembership';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { ensureLeagueDraftSetupConverged } from '@/server/draft/services/DraftSetupConvergenceService';
import {
  getBenchSizeFromPositionLimits,
  getRosterSizeFromPositionLimits,
  isValidPickSeconds,
  normalizeDraftAutoPickRules,
  normalizeDraftPickOrderMode,
  normalizeDraftPositionLimits,
} from '@/lib/draftSettings';
import {
  normalizeFantasyCategoryKeys,
  REAL_DATA_NINE_CATEGORY_PRESET,
  type FantasyCategoryKey,
} from '@/types/fantasyCategories';
import {
  normalizeCategoryDirections,
  parseCategoryDirectionsJson,
} from '@/server/leagues/categoryDirections';
import { normalizeLineupSlots, parseLineupSlotsJson } from '@/server/leagues/lineupSettings';
import type { CategoryDirection, LeagueScoringMode, TradeReview } from '@/types/leagues';
import {
  MAX_LEAGUE_TEAMS,
  MIN_LEAGUE_TEAMS,
  getMaxTeamsUpdateError,
} from '@/server/leagues/leagueCapacity';
import { getLeagueMembershipAccess } from '@/server/leagues/membership';

type DraftTypeValue = 'SNAKE' | 'LINEAR';
type WaiverRuleValue = 'WEEKLY' | 'ROLLING';

async function authorizeLeagueSettingsRead(request: NextRequest, leagueId: string) {
  const userId = await getAuthenticatedUserId(request);
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const access = await getLeagueMembershipAccess(leagueId, userId);
  if (!access.isMember) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return null;
}

async function authorizeLeagueSettingsWrite(request: NextRequest, leagueId: string) {
  const userId = await getAuthenticatedUserId(request);
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const access = await getLeagueMembershipAccess(leagueId, userId);
  if (!access.canManage) {
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
      return normalizeFantasyCategoryKeys(JSON.parse(value), REAL_DATA_NINE_CATEGORY_PRESET);
    } catch {
      return [...REAL_DATA_NINE_CATEGORY_PRESET];
    }
  }

  return normalizeFantasyCategoryKeys(value, REAL_DATA_NINE_CATEGORY_PRESET);
}

function normalizeLeagueScoringMode(
  value: unknown,
  fallback: LeagueScoringMode
): LeagueScoringMode {
  return value === 'H2H_MOST_CATEGORIES' ? 'H2H_MOST_CATEGORIES' : fallback;
}

function normalizeFixtureGenerationMode(value: unknown): 'AUTOMATIC' | 'MANUAL' {
  return value === 'MANUAL' ? 'MANUAL' : 'AUTOMATIC';
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

function normalizeTradeReview(value: unknown, fallback: TradeReview = 'none'): TradeReview {
  const normalized = String(value ?? fallback)
    .trim()
    .toLowerCase();
  if (normalized === 'admin' || normalized === 'veto') return normalized;
  return 'none';
}

function toPrismaTradeReview(value: TradeReview): 'NONE' | 'ADMIN' | 'VETO' {
  return value.toUpperCase() as 'NONE' | 'ADMIN' | 'VETO';
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

interface ParsedTradeSettingsUpdate {
  tradeLimit?: number;
  tradeReview?: TradeReview;
  tradeDeadline?: Date | null;
  offerExpiryHours?: number;
  reviewHours?: number;
  vetoThreshold?: number;
}

type TradeSettingsParseResult =
  | { ok: true; data: ParsedTradeSettingsUpdate }
  | { ok: false; error: string };

function parseTradeSettingsUpdate(tradeInput: Record<string, unknown>): TradeSettingsParseResult {
  const ranges = [
    ['tradeLimit', 0, 100, 'Trade limit must be between 0 and 100'],
    ['offerExpiryHours', 1, 336, 'Trade offer expiry must be between 1 and 336 hours'],
    ['reviewHours', 1, 336, 'Trade review window must be between 1 and 336 hours'],
    ['vetoThreshold', 1, 20, 'Trade veto threshold must be between 1 and 20'],
  ] as const;
  const parsedIntegers: Partial<
    Record<'tradeLimit' | 'offerExpiryHours' | 'reviewHours' | 'vetoThreshold', number>
  > = {};

  for (const [key, minimum, maximum, error] of ranges) {
    const input = tradeInput[key];
    if (input === undefined) continue;

    const isIntegerInput =
      (typeof input === 'number' && Number.isInteger(input)) ||
      (typeof input === 'string' && /^-?\d+$/.test(input.trim()));
    const parsed = parseOptionalInteger(input);
    if (!isIntegerInput || parsed === undefined || parsed < minimum || parsed > maximum) {
      return { ok: false, error };
    }
    parsedIntegers[key] = parsed;
  }

  let tradeReview: TradeReview | undefined;
  if (tradeInput.tradeReview !== undefined) {
    const normalized = String(tradeInput.tradeReview).trim().toLowerCase();
    if (!['none', 'admin', 'veto'].includes(normalized)) {
      return { ok: false, error: 'Trade review must be none, admin, or veto' };
    }
    tradeReview = normalized as TradeReview;
  }

  let tradeDeadline: Date | null | undefined;
  if (
    tradeInput.tradeDeadline === null ||
    (typeof tradeInput.tradeDeadline === 'string' && tradeInput.tradeDeadline.trim().length === 0)
  ) {
    tradeDeadline = null;
  } else if (tradeInput.tradeDeadline !== undefined) {
    tradeDeadline = parseOptionalDate(tradeInput.tradeDeadline);
    if (tradeDeadline === null) {
      return { ok: false, error: 'Invalid trade deadline' };
    }
  }

  return {
    ok: true,
    data: {
      ...parsedIntegers,
      ...(tradeReview !== undefined ? { tradeReview } : {}),
      ...(tradeDeadline !== undefined ? { tradeDeadline } : {}),
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
    fixtureGenerationMode: string;
    lineupSlotsJson: string | null;
    categoryDirectionsJson: string | null;
    scoringSettingsLockedAt: Date | null;
    tradeLimit: number;
    tradeReviewMode: string;
    tradeDeadline: Date | null;
    tradeOfferExpiryHours: number;
    tradeReviewHours: number;
    tradeVetoThreshold: number;
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
      fixtureGenerationMode: normalizeFixtureGenerationMode(league.settings.fixtureGenerationMode),
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
    trade: {
      tradeLimit: league.settings.tradeLimit,
      tradeReview: normalizeTradeReview(league.settings.tradeReviewMode),
      tradeDeadline: league.settings.tradeDeadline?.toISOString() ?? null,
      offerExpiryHours: league.settings.tradeOfferExpiryHours,
      reviewHours: league.settings.tradeReviewHours,
      vetoThreshold: league.settings.tradeVetoThreshold,
    },
  };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'League ID is required' }, { status: 400 });
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
          fixtureGenerationMode: normalizeFixtureGenerationMode(data.fixtureGenerationMode),
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
        trade: {
          tradeLimit: Number(data.tradeSettings?.tradeLimit ?? 10),
          tradeReview: normalizeTradeReview(data.tradeSettings?.tradeReview),
          tradeDeadline: data.tradeSettings?.tradeDeadline ?? null,
          offerExpiryHours: Number(data.tradeSettings?.offerExpiryHours ?? 72),
          reviewHours: Number(data.tradeSettings?.reviewHours ?? 24),
          vetoThreshold: Number(data.tradeSettings?.vetoThreshold ?? 3),
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
    const tradeInput = (body.trade && typeof body.trade === 'object' ? body.trade : {}) as Record<
      string,
      unknown
    >;
    const tradeSettingsResult = parseTradeSettingsUpdate(tradeInput);
    if (!tradeSettingsResult.ok) {
      return NextResponse.json({ error: tradeSettingsResult.error }, { status: 400 });
    }
    const { tradeLimit, tradeReview, tradeDeadline, offerExpiryHours, reviewHours, vetoThreshold } =
      tradeSettingsResult.data;

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
      const fixtureGenerationMode = normalizeFixtureGenerationMode(
        scoringInput.fixtureGenerationMode ??
          body.fixtureGenerationMode ??
          prismaLeague.settings.fixtureGenerationMode
      );
      const lineupSlots =
        scoringInput.lineupSlots === undefined && body.lineupSlots === undefined
          ? parseLineupSlotsJson(prismaLeague.settings.lineupSlotsJson)
          : normalizeLineupSlots(scoringInput.lineupSlots ?? body.lineupSlots);
      const categoryDirectionsInput = scoringInput.categoryDirections ?? body.categoryDirections;
      const categoryDirections =
        categoryDirectionsInput === undefined
          ? parseCategoryDirectionsJson(categories, prismaLeague.settings.categoryDirectionsJson)
          : normalizeCategoryDirections(
              categories,
              categoryDirectionsInput as Partial<Record<FantasyCategoryKey, CategoryDirection>>
            );
      const scoringSettingsChanged =
        scoringInput.scoringMode !== undefined ||
        body.scoringMode !== undefined ||
        scoringInput.fixtureGenerationMode !== undefined ||
        body.fixtureGenerationMode !== undefined ||
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

      const nextTradeReview =
        tradeReview ?? normalizeTradeReview(prismaLeague.settings.tradeReviewMode);

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
            fixtureGenerationMode,
            lineupSlotsJson: JSON.stringify(lineupSlots),
            categoryDirectionsJson: JSON.stringify(categoryDirections),
            tradeLimit: tradeLimit ?? prismaLeague.settings.tradeLimit,
            tradeReviewMode: toPrismaTradeReview(nextTradeReview),
            ...(tradeDeadline !== undefined ? { tradeDeadline } : {}),
            tradeOfferExpiryHours: offerExpiryHours ?? prismaLeague.settings.tradeOfferExpiryHours,
            tradeReviewHours: reviewHours ?? prismaLeague.settings.tradeReviewHours,
            tradeVetoThreshold: vetoThreshold ?? prismaLeague.settings.tradeVetoThreshold,
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

    const existingData = leagueDoc.data() ?? {};
    const existingTradeSettings =
      existingData.tradeSettings && typeof existingData.tradeSettings === 'object'
        ? (existingData.tradeSettings as Record<string, unknown>)
        : {};
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
    const firestoreFixtureGenerationMode = normalizeFixtureGenerationMode(
      scoringInput.fixtureGenerationMode ?? body.fixtureGenerationMode
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
      fixtureGenerationMode: firestoreFixtureGenerationMode,
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
      tradeSettings: {
        ...existingTradeSettings,
        ...(tradeLimit !== undefined ? { tradeLimit } : {}),
        ...(tradeReview !== undefined ? { tradeReview } : {}),
        ...(tradeDeadline !== undefined
          ? { tradeDeadline: tradeDeadline?.toISOString() ?? null }
          : {}),
        ...(offerExpiryHours !== undefined ? { offerExpiryHours } : {}),
        ...(reviewHours !== undefined ? { reviewHours } : {}),
        ...(vetoThreshold !== undefined ? { vetoThreshold } : {}),
      },
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
          fixtureGenerationMode: normalizeFixtureGenerationMode(data.fixtureGenerationMode),
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
        trade: {
          tradeLimit: Number(data.tradeSettings?.tradeLimit ?? 10),
          tradeReview: normalizeTradeReview(data.tradeSettings?.tradeReview),
          tradeDeadline: data.tradeSettings?.tradeDeadline ?? null,
          offerExpiryHours: Number(data.tradeSettings?.offerExpiryHours ?? 72),
          reviewHours: Number(data.tradeSettings?.reviewHours ?? 24),
          vetoThreshold: Number(data.tradeSettings?.vetoThreshold ?? 3),
        },
      },
    });
  } catch (error) {
    logger.error('Error updating league settings:', error);
    return NextResponse.json({ error: 'Failed to update league settings' }, { status: 500 });
  }
}
