import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { adminDb } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';
export const runtime = 'nodejs';


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
