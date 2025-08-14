import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { commonErrors } from '@/lib/apiResponse';
import { withRequestTracing } from '@/lib/requestTracing';
import type { League, LeagueMember, JoinLeagueRequest } from '@/types/leagues';

// Generate unique team name
function generateTeamName(leagueName: string, teamNumber: number): string {
  return `${leagueName} Team ${teamNumber}`;
}

// GET /api/leagues/[id] - Get specific league details
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const tracer = withRequestTracing(req, { endpoint: 'league-detail', leagueId: params.id });

  try {
    const leagueId = params.id;

    // Get league data
    const leagueDoc = await adminDb.collection('leagues').doc(leagueId).get();
    
    if (!leagueDoc.exists) {
      return commonErrors.notFound('League not found');
    }

    const league: League = {
      id: leagueDoc.id,
      ...leagueDoc.data()
    } as League;

    // Get league members
    const membersSnapshot = await adminDb.collection('leagueMembers')
      .where('leagueId', '==', leagueId)
      .where('isActive', '==', true)
      .get();

    const members = membersSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as LeagueMember[];

    const response = {
      league,
      members,
      memberCount: members.length,
      spotsRemaining: league.maxTeams - members.length,
    };

    tracer.complete(200, { memberCount: members.length });
    return NextResponse.json({ success: true, data: response });

  } catch (error) {
    tracer.error(error instanceof Error ? error : new Error(String(error)), 500);
    return commonErrors.internalServerError('Failed to fetch league details');
  }
}

// POST /api/leagues/[id] - Join league or update league settings
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const tracer = withRequestTracing(req, { endpoint: 'league-action', leagueId: params.id });

  try {
    const leagueId = params.id;
    const body = await req.json();
    const userId = req.headers.get('x-user-id');

    if (!userId) {
      return commonErrors.unauthorized('Must be logged in');
    }

    const { action } = body;

    if (action === 'join') {
      return handleJoinLeague(req, leagueId, userId, body, tracer);
    } else if (action === 'update') {
      return handleUpdateLeague(req, leagueId, userId, body, tracer);
    } else {
      return NextResponse.json(
        { success: false, error: 'Invalid action' },
        { status: 400 }
      );
    }

  } catch (error) {
    tracer.error(error instanceof Error ? error : new Error(String(error)), 500);
    return commonErrors.internalServerError('Failed to process league action');
  }
}

async function handleJoinLeague(
  req: NextRequest,
  leagueId: string,
  userId: string,
  body: JoinLeagueRequest,
  tracer: any
) {
  const { teamName, code } = body;

  // Get league data
  const leagueDoc = await adminDb.collection('leagues').doc(leagueId).get();
  
  if (!leagueDoc.exists) {
    return commonErrors.notFound('League not found');
  }

  const league = { id: leagueDoc.id, ...leagueDoc.data() } as League;

  // Validate league code for private leagues
  if (league.type === 'private' && league.code !== code) {
    return NextResponse.json(
      { success: false, error: 'Invalid league code' },
      { status: 400 }
    );
  }

  // Check if league is full
  const membersSnapshot = await adminDb.collection('leagueMembers')
    .where('leagueId', '==', leagueId)
    .where('isActive', '==', true)
    .get();

  if (membersSnapshot.size >= league.maxTeams) {
    return NextResponse.json(
      { success: false, error: 'League is full' },
      { status: 400 }
    );
  }

  // Check if user is already a member
  const existingMember = membersSnapshot.docs.find(
    doc => doc.data().userId === userId
  );

  if (existingMember) {
    return NextResponse.json(
      { success: false, error: 'Already a member of this league' },
      { status: 400 }
    );
  }

  // Validate team name
  let finalTeamName = teamName?.trim();
  if (!finalTeamName) {
    finalTeamName = generateTeamName(league.name, membersSnapshot.size + 1);
  }

  // Check for duplicate team names
  const duplicateName = membersSnapshot.docs.find(
    doc => doc.data().teamName.toLowerCase() === finalTeamName!.toLowerCase()
  );

  if (duplicateName) {
    return NextResponse.json(
      { success: false, error: 'Team name already taken' },
      { status: 400 }
    );
  }

  // Create league member
  const newMember: Omit<LeagueMember, 'id'> = {
    leagueId,
    userId,
    role: 'member',
    teamName: finalTeamName,
    joinedAt: new Date().toISOString(),
    isActive: true,
  };

  const memberRef = await adminDb.collection('leagueMembers').add(newMember);

  const createdMember: LeagueMember = {
    id: memberRef.id,
    ...newMember,
  };

  tracer.complete(201, { memberId: createdMember.id });
  return NextResponse.json({ 
    success: true, 
    data: createdMember 
  }, { status: 201 });
}

async function handleUpdateLeague(
  req: NextRequest,
  leagueId: string,
  userId: string,
  body: any,
  tracer: any
) {
  // Get league data
  const leagueDoc = await adminDb.collection('leagues').doc(leagueId).get();
  
  if (!leagueDoc.exists) {
    return commonErrors.notFound('League not found');
  }

  const league = { id: leagueDoc.id, ...leagueDoc.data() } as League;

  // Check if user is the owner
  if (league.ownerId !== userId) {
    return commonErrors.forbidden('Only league owner can update settings');
  }

  // Extract updateable fields
  const { name, description, tradeSettings, waiverWire, draftDate, status } = body;

  const updates: Partial<League> = {};
  
  if (name) updates.name = name.trim();
  if (description !== undefined) updates.description = description?.trim();
  if (tradeSettings) updates.tradeSettings = { ...league.tradeSettings, ...tradeSettings };
  if (waiverWire) updates.waiverWire = { ...league.waiverWire, ...waiverWire };
  if (draftDate) updates.draftDate = draftDate;
  if (status && ['preseason', 'active', 'completed'].includes(status)) {
    updates.status = status;
  }

  // Update league
  await adminDb.collection('leagues').doc(leagueId).update(updates);

  const updatedLeague: League = {
    ...league,
    ...updates,
  };

  tracer.complete(200, { updatedFields: Object.keys(updates) });
  return NextResponse.json({ 
    success: true, 
    data: updatedLeague 
  });
}

// DELETE /api/leagues/[id] - Delete league (owner only)
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const tracer = withRequestTracing(req, { endpoint: 'league-delete', leagueId: params.id });

  try {
    const leagueId = params.id;
    const userId = req.headers.get('x-user-id');

    if (!userId) {
      return commonErrors.unauthorized('Must be logged in');
    }

    // Get league data
    const leagueDoc = await adminDb.collection('leagues').doc(leagueId).get();
    
    if (!leagueDoc.exists) {
      return commonErrors.notFound('League not found');
    }

    const league = { id: leagueDoc.id, ...leagueDoc.data() } as League;

    // Check if user is the owner
    if (league.ownerId !== userId) {
      return commonErrors.forbidden('Only league owner can delete the league');
    }

    // Delete all league members
    const membersSnapshot = await adminDb.collection('leagueMembers')
      .where('leagueId', '==', leagueId)
      .get();

    const batch = adminDb.batch();
    membersSnapshot.docs.forEach(doc => {
      batch.delete(doc.ref);
    });

    // Delete the league
    batch.delete(adminDb.collection('leagues').doc(leagueId));

    await batch.commit();

    tracer.complete(200, { deletedMembersCount: membersSnapshot.size });
    return NextResponse.json({ 
      success: true, 
      message: 'League deleted successfully' 
    });

  } catch (error) {
    tracer.error(error instanceof Error ? error : new Error(String(error)), 500);
    return commonErrors.internalServerError('Failed to delete league');
  }
}
