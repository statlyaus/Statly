import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { scheduleDraftStart } from '@/server/queue/draftQueue';
import { ensureLeagueDraftSetupConverged } from '@/server/draft/services/DraftSetupConvergenceService';
import { getLeagueDraftOperationalReadiness } from '@/server/draft/services/DraftReadinessService';

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

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json();

    if (!id) {
      return NextResponse.json({ error: 'League ID is required' }, { status: 400 });
    }

    // For test league, just return success
    if (id === 'test-league-id') {
      logger.info(`Updated draft settings for test league: ${JSON.stringify(body)}`);

      return NextResponse.json({
        success: true,
        message: 'Draft settings updated successfully',
        data: body,
      });
    }

    const prismaLeague = await prisma.league.findUnique({
      where: { id },
      include: { settings: true },
    });

    if (prismaLeague?.settings) {
      const draftDate = parseDraftDate(body.draftDate ?? body.scheduledTime ?? body.startAt);
      const timePerPick = parsePickSeconds(body.timePerPick ?? body.pickSeconds);
      const draftType = String(body.draftType ?? prismaLeague.settings.draftType).toUpperCase();

      if ((body.draftDate || body.scheduledTime || body.startAt) && !draftDate) {
        return NextResponse.json({ error: 'Invalid draft date' }, { status: 400 });
      }

      if (timePerPick !== undefined && (timePerPick < 30 || timePerPick > 600)) {
        return NextResponse.json(
          { error: 'Time per pick must be between 30 and 600 seconds' },
          { status: 400 }
        );
      }

      if (!['SNAKE', 'LINEAR'].includes(draftType)) {
        return NextResponse.json({ error: 'Invalid draft type' }, { status: 400 });
      }

      await prisma.leagueSettings.update({
        where: { id: prismaLeague.settings.id },
        data: {
          ...(draftDate ? { startAt: draftDate } : {}),
          ...(timePerPick !== undefined ? { pickSeconds: timePerPick } : {}),
          draftType: draftType as 'SNAKE' | 'LINEAR',
        },
      });

      const draftReadiness = await ensureLeagueDraftSetupConverged({
        prismaClient: prisma,
        leagueId: id,
      });
      const effectivePickSeconds = timePerPick ?? prismaLeague.settings.pickSeconds;

      if (draftDate && draftDate.getTime() > Date.now()) {
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
          draftDate: draftDate?.toISOString() ?? prismaLeague.settings.startAt.toISOString(),
          draftType: draftType.toLowerCase(),
          timePerPick: effectivePickSeconds,
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

    // For test league
    if (id === 'test-league-id') {
      const testDraftSettings = {
        draftDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
        draftType: 'snake',
        timePerPick: 120,
      };

      return NextResponse.json({
        success: true,
        data: testDraftSettings,
      });
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
          draftDate: prismaLeague.settings.startAt.toISOString(),
          draftType: prismaLeague.settings.draftType.toLowerCase(),
          timePerPick: prismaLeague.settings.pickSeconds,
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
