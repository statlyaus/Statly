import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { getLeagueMembership, isLeagueManagerRole } from '@/lib/leagueMembership';
import { cancelDraftStart, scheduleDraftStart } from '@/server/queue/draftQueue';
import { ensureLeagueDraftSetupConverged } from '@/server/draft/services/DraftSetupConvergenceService';
import { getLeagueDraftOperationalReadiness } from '@/server/draft/services/DraftReadinessService';
import {
  MAX_PICK_SECONDS,
  MIN_PICK_SECONDS,
  getBenchSizeFromPositionLimits,
  getRosterSizeFromPositionLimits,
  isValidPickSeconds,
  normalizeDraftAutoPickRules,
  normalizeDraftPickOrderMode,
  normalizeDraftPositionLimits,
} from '@/lib/draftSettings';

function parseDraftDate(value: unknown): Date | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function parsePickSeconds(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function authorizeDraftSettingsRead(request: NextRequest, leagueId: string) {
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

async function authorizeDraftSettingsWrite(request: NextRequest, leagueId: string) {
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

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json();

    if (!id) {
      return NextResponse.json({ error: 'League ID is required' }, { status: 400 });
    }

    const authError = await authorizeDraftSettingsWrite(request, id);
    if (authError) {
      return authError;
    }

    const prismaLeague = await prisma.league.findUnique({
      where: { id },
      include: { settings: true },
    });

    if (prismaLeague?.settings) {
      const draftDateField = ['draftDate', 'scheduledTime', 'startAt'].find((field) =>
        Object.prototype.hasOwnProperty.call(body, field)
      );
      const draftDateValue = draftDateField ? body[draftDateField] : undefined;
      const draftDate = parseDraftDate(draftDateValue);
      const isClearingDraftDate =
        draftDateField !== undefined &&
        (draftDateValue === null ||
          (typeof draftDateValue === 'string' && draftDateValue.trim().length === 0));
      const timePerPick = parsePickSeconds(body.timePerPick ?? body.pickSeconds);
      const draftType = String(body.draftType ?? prismaLeague.settings.draftType).toUpperCase();

      if (draftDateField && !draftDate && !isClearingDraftDate) {
        return NextResponse.json({ error: 'Invalid draft date' }, { status: 400 });
      }

      if (timePerPick !== undefined && !isValidPickSeconds(timePerPick)) {
        return NextResponse.json(
          {
            error: `Time per pick must be between ${MIN_PICK_SECONDS} and ${MAX_PICK_SECONDS} seconds`,
          },
          { status: 400 }
        );
      }

      if (!['SNAKE', 'LINEAR'].includes(draftType)) {
        return NextResponse.json({ error: 'Invalid draft type' }, { status: 400 });
      }

      const positionLimits = normalizeDraftPositionLimits(
        body.positionLimits ?? prismaLeague.settings.positionLimitsJson
      );
      const autoPickRules = normalizeDraftAutoPickRules(
        body.autoPickRules ?? prismaLeague.settings.autoPickRulesJson
      );
      const pickOrder = normalizeDraftPickOrderMode(
        body.pickOrder ?? prismaLeague.settings.pickOrder
      );

      await prisma.leagueSettings.update({
        where: { id: prismaLeague.settings.id },
        data: {
          ...(draftDateField ? { startAt: draftDate ?? null } : {}),
          ...(timePerPick !== undefined ? { pickSeconds: timePerPick } : {}),
          draftType: draftType as 'SNAKE' | 'LINEAR',
          pickOrder: pickOrder === 'manual' ? 'MANUAL' : 'RANDOM',
          allowAutoPick: autoPickRules.enabled,
          rosterSize: getRosterSizeFromPositionLimits(positionLimits),
          benchSize: getBenchSizeFromPositionLimits(positionLimits),
          positionLimitsJson: JSON.stringify(positionLimits),
          autoPickRulesJson: JSON.stringify(autoPickRules),
        },
      });

      const draftReadiness = await ensureLeagueDraftSetupConverged({
        prismaClient: prisma,
        leagueId: id,
      });
      const effectivePickSeconds = timePerPick ?? prismaLeague.settings.pickSeconds;
      const effectiveDraftDate = draftDateField ? draftDate : prismaLeague.settings.startAt;

      if (isClearingDraftDate) {
        await cancelDraftStart(id);
      } else if (draftDate && draftDate.getTime() > Date.now()) {
        try {
          await scheduleDraftStart(id, draftDate, effectivePickSeconds * 1000, true);
        } catch (error) {
          logger.error('Failed to schedule updated draft start', {
            leagueId: id,
            draftId: draftReadiness.draftId,
            scheduledTime: draftDate.toISOString(),
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      logger.info('Updated Prisma draft settings', {
        leagueId: id,
        draftId: draftReadiness.draftId,
        readinessStatus: draftReadiness.status,
      });

      return NextResponse.json({
        success: true,
        message: 'Draft settings updated successfully',
        data: {
          draftDate: effectiveDraftDate?.toISOString() ?? null,
          draftType: draftType.toLowerCase(),
          timePerPick: effectivePickSeconds,
          pickOrder,
          positionLimits,
          autoPickRules,
          draftReadiness,
        },
      });
    }

    // For real leagues, update in Firebase
    const leagueRef = adminDb.collection('leagues').doc(id);
    const leagueDoc = await leagueRef.get();

    if (!leagueDoc.exists) {
      return NextResponse.json({ error: 'League not found' }, { status: 404 });
    }

    // Update the league with new draft settings
    await leagueRef.update({
      draftDate: body.draftDate,
      draftType: body.draftType || 'snake',
      timePerPick: body.timePerPick || 120,
      pickOrder: normalizeDraftPickOrderMode(body.pickOrder),
      positionLimits: normalizeDraftPositionLimits(body.positionLimits),
      autoPickRules: normalizeDraftAutoPickRules(body.autoPickRules),
      updatedAt: new Date().toISOString(),
    });

    logger.info(`Updated draft settings for league ${id}`);

    return NextResponse.json({
      success: true,
      message: 'Draft settings updated successfully',
      data: body,
    });
  } catch (error) {
    logger.error('Error updating draft settings:', error);
    return NextResponse.json({ error: 'Failed to update draft settings' }, { status: 500 });
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json({ error: 'League ID is required' }, { status: 400 });
    }

    const authError = await authorizeDraftSettingsRead(request, id);
    if (authError) {
      return authError;
    }

    const prismaLeague = await prisma.league.findUnique({
      where: { id },
      include: { settings: true },
    });

    if (prismaLeague?.settings) {
      const draftReadiness = await getLeagueDraftOperationalReadiness(prisma, { leagueId: id });

      return NextResponse.json({
        success: true,
        data: {
          draftDate: prismaLeague.settings.startAt?.toISOString() ?? null,
          draftType: prismaLeague.settings.draftType.toLowerCase(),
          timePerPick: prismaLeague.settings.pickSeconds,
          pickOrder: prismaLeague.settings.pickOrder.toLowerCase(),
          positionLimits: normalizeDraftPositionLimits(prismaLeague.settings.positionLimitsJson),
          autoPickRules: normalizeDraftAutoPickRules(prismaLeague.settings.autoPickRulesJson),
          draftReadiness,
        },
      });
    }

    // For real leagues
    const leagueRef = adminDb.collection('leagues').doc(id);
    const leagueDoc = await leagueRef.get();

    if (!leagueDoc.exists) {
      return NextResponse.json({ error: 'League not found' }, { status: 404 });
    }

    const leagueData = leagueDoc.data();
    const draftSettings = {
      draftDate: leagueData?.draftDate,
      draftType: leagueData?.draftType || 'snake',
      timePerPick: leagueData?.timePerPick || 120,
      pickOrder: normalizeDraftPickOrderMode(leagueData?.pickOrder),
      positionLimits: normalizeDraftPositionLimits(leagueData?.positionLimits),
      autoPickRules: normalizeDraftAutoPickRules(leagueData?.autoPickRules),
    };

    return NextResponse.json({
      success: true,
      data: draftSettings,
    });
  } catch (error) {
    logger.error('Error fetching draft settings:', error);
    return NextResponse.json({ error: 'Failed to fetch draft settings' }, { status: 500 });
  }
}
