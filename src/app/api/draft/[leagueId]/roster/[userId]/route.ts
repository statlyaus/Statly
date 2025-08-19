import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function GET(
  request: NextRequest,
  { params }: { params: { leagueId: string; userId: string } }
) {
  try {
    const { leagueId, userId } = params;
    
    if (!leagueId || !userId) {
      return NextResponse.json(
        { error: 'League ID and User ID are required' },
        { status: 400 }
      );
    }

    // First find the league member for this user and league
    const leagueMember = await prisma.leagueMember.findFirst({
      where: {
        league: {
          inviteCode: leagueId // Using invite code as league ID for simplicity
        },
        // You would need to match userId from your auth system to the member
      }
    });

    if (!leagueMember) {
      return NextResponse.json(
        { error: 'User not found in this league' },
        { status: 404 }
      );
    }

    // Get the draft for this league
    const draft = await prisma.draft.findFirst({
      where: {
        league: {
          inviteCode: leagueId
        },
        status: 'COMPLETED'
      },
      include: {
        picks: {
          where: {
            memberId: leagueMember.id
          },
          include: {
            player: true
          },
          orderBy: {
            overall: 'asc'
          }
        }
      }
    });

    if (!draft) {
      return NextResponse.json(
        { error: 'No completed draft found for this league' },
        { status: 404 }
      );
    }

    // Transform the picks data to match the expected format
    const formattedPicks = draft.picks.map(pick => ({
      playerId: pick.playerId,
      playerName: pick.player.name,
      position: pick.player.position,
      team: pick.player.club,
      pickNumber: pick.overall,
      round: pick.round,
      // Add default values for frontend display
      averageScore: 75,
      lastGameScore: 0,
      projectedScore: 80,
      form: [70, 75, 80, 85, 90],
      injuryStatus: 'healthy',
      priceChange: 0,
      ownership: 15
    }));

    return NextResponse.json({
      draftId: draft.id,
      leagueId: leagueId,
      status: draft.status,
      picks: formattedPicks,
      totalPicks: formattedPicks.length
    });
    
  } catch (error) {
    console.error('Error fetching draft roster:', error);
    return NextResponse.json(
      { error: 'Failed to fetch draft roster' },
      { status: 500 }
    );
  } finally {
    await prisma.$disconnect();
  }
}
