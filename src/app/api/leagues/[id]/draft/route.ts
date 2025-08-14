import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';

interface DraftPageProps {
  params: Promise<{ id: string }>;
}

// GET /api/leagues/[id]/draft - Get or create draft for league
export async function GET(req: NextRequest, { params }: DraftPageProps) {
  try {
    const { id: leagueId } = await params;

    // First, check if league exists
    const leagueDoc = await adminDb.collection('leagues').doc(leagueId).get();
    if (!leagueDoc.exists) {
      return NextResponse.json(
        { success: false, error: 'League not found' },
        { status: 404 }
      );
    }

    const league = { id: leagueDoc.id, ...leagueDoc.data() };

    // Check if there's already a draft for this league
    // For now, we'll use a simple mapping: draft ID = league ID
    // In a real system, you'd store this relationship in the database
    
    // Since we don't have a direct draft system integrated with Firebase leagues,
    // we'll redirect to the draft tab for now and let users manually create drafts
    return NextResponse.json({
      success: true,
      data: {
        hasDraft: false,
        draftId: null,
        league,
        message: 'No draft found for this league. Use the Draft tab to set up a draft.'
      }
    });

  } catch (error) {
    console.error('Error fetching league draft:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch league draft' },
      { status: 500 }
    );
  }
}

// POST /api/leagues/[id]/draft - Create draft for league
export async function POST(req: NextRequest, { params }: DraftPageProps) {
  try {
    const { id: leagueId } = await params;

    // Get league data
    const leagueDoc = await adminDb.collection('leagues').doc(leagueId).get();
    if (!leagueDoc.exists) {
      return NextResponse.json(
        { success: false, error: 'League not found' },
        { status: 404 }
      );
    }

    const leagueData = leagueDoc.data();
    const league = { 
      id: leagueDoc.id, 
      name: leagueData?.name || 'League',
      maxTeams: leagueData?.maxTeams || 8,
      ...leagueData 
    };

    // Get league members
    const membersSnapshot = await adminDb.collection('league_members')
      .where('leagueId', '==', leagueId)
      .get();

    const members = membersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // For now, return league info to help with draft creation
    // In a real implementation, you'd create a draft entry linking to this league
    return NextResponse.json({
      success: true,
      data: {
        league,
        members,
        suggestedDraftSettings: {
          name: `${league.name || 'League'} Draft`,
          leagueSize: members.length || league.maxTeams || 8,
          draftType: 'snake',
          timePerPick: 120
        }
      }
    });

  } catch (error) {
    console.error('Error creating league draft:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create league draft' },
      { status: 500 }
    );
  }
}
