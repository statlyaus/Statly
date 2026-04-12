import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { logger } from '@/lib/logger';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  const resolvedParams = await params;
  try {
    const { id: leagueId, userId } = resolvedParams;

    if (!leagueId || !userId) {
      return NextResponse.json({ error: 'League ID and User ID are required' }, { status: 400 });
    }

    // For your real account - return actual drafted team
    if (
      (leagueId === 'cmeilycnf00047gue6xhkh7xzl' && userId === 'addison_real_user_id') ||
      userId === 'addisonarmadale@gmail.com'
    ) {
      // Import Prisma dynamically to get your actual picks
      const { PrismaClient } = await import('@prisma/client');
      const prisma = new PrismaClient();

      try {
        const draftId = 'cmeilycnf00047guexen9tq47';
        const memberId = 'cmeilycnh00077gue7snq8u0g';

        const picks = await prisma.pick.findMany({
          where: {
            draftId: draftId,
            memberId: memberId,
          },
          include: {
            player: true,
          },
          orderBy: {
            overall: 'asc',
          },
        });

        // Transform to match expected format with realistic fantasy stats
        const formattedPicks = picks.map((pick) => {
          const player = pick.player;
          const baseFantasyScore = 85 + Math.round(Math.random() * 20 - 10);
          const lastGameScore = Math.round(baseFantasyScore + (Math.random() * 30 - 15));
          const projectedScore = Math.round(baseFantasyScore + (Math.random() * 20 - 10));

          return {
            playerId: player.id,
            playerName: player.name,
            position: player.position,
            team: player.club,
            pickNumber: pick.overall,
            round: pick.round,
            averageScore: baseFantasyScore,
            lastGameScore: lastGameScore,
            projectedScore: projectedScore,
            form: [
              lastGameScore,
              Math.round(baseFantasyScore + (Math.random() * 25 - 12.5)),
              Math.round(baseFantasyScore + (Math.random() * 25 - 12.5)),
              Math.round(baseFantasyScore + (Math.random() * 25 - 12.5)),
              Math.round(baseFantasyScore + (Math.random() * 25 - 12.5)),
            ],
            injuryStatus: Math.random() > 0.9 ? 'questionable' : 'healthy',
            priceChange: Math.round((Math.random() - 0.5) * 10000),
            ownership: Math.round(Math.random() * 40 + 10),
            value: Math.round(400000 + Math.random() * 400000),
          };
        });

        await prisma.$disconnect();

        return NextResponse.json({
          success: true,
          data: formattedPicks,
          totalPicks: formattedPicks.length,
          userInfo: {
            displayName: 'Addison Armadale',
            email: 'addisonarmadale@gmail.com',
          },
        });
      } catch (error) {
        await prisma.$disconnect();
        throw error;
      }
    }

    // For development/testing, return the completed draft picks
    if (leagueId === 'test-league-id' && userId === '2qlfdHSCFTPlxoKFSUfNLSlCDRe2') {
      const mockDraftPicks = [
        {
          playerId: '1',
          playerName: 'Aaron Cadman',
          position: 'FWD',
          team: 'GWS',
          pickNumber: 1,
          round: 1,
        },
        {
          playerId: '2',
          playerName: 'Bailey Williams',
          position: 'DEF',
          team: 'Western Bulldogs',
          pickNumber: 2,
          round: 1,
        },
        {
          playerId: '3',
          playerName: 'Caleb Daniel',
          position: 'DEF',
          team: 'Western Bulldogs',
          pickNumber: 3,
          round: 1,
        },
        {
          playerId: '4',
          playerName: 'Ben McKay',
          position: 'DEF',
          team: 'Essendon',
          pickNumber: 4,
          round: 1,
        },
        {
          playerId: '5',
          playerName: 'Cooper Hynes',
          position: 'FWD',
          team: 'West Coast',
          pickNumber: 5,
          round: 1,
        },
        {
          playerId: '6',
          playerName: 'Brody Mihocek',
          position: 'FWD',
          team: 'Collingwood',
          pickNumber: 6,
          round: 2,
        },
        {
          playerId: '7',
          playerName: 'Charlie Spargo',
          position: 'FWD',
          team: 'Melbourne',
          pickNumber: 7,
          round: 2,
        },
        {
          playerId: '8',
          playerName: 'Charlie Ballard',
          position: 'DEF',
          team: 'Gold Coast',
          pickNumber: 8,
          round: 2,
        },
        {
          playerId: '9',
          playerName: 'Dan Houston',
          position: 'DEF',
          team: 'Port Adelaide',
          pickNumber: 9,
          round: 2,
        },
        {
          playerId: '10',
          playerName: 'Corey Durdin',
          position: 'FWD',
          team: 'Carlton',
          pickNumber: 10,
          round: 2,
        },
        {
          playerId: '11',
          playerName: 'Conor Stone',
          position: 'MID',
          team: 'GWS',
          pickNumber: 11,
          round: 3,
        },
        {
          playerId: '12',
          playerName: 'Izak Rankine',
          position: 'FWD',
          team: 'Adelaide',
          pickNumber: 12,
          round: 3,
        },
        {
          playerId: '13',
          playerName: 'Jacob Van Rooyen',
          position: 'FWD',
          team: 'Melbourne',
          pickNumber: 13,
          round: 3,
        },
        {
          playerId: '14',
          playerName: 'Jake Bowey',
          position: 'DEF',
          team: 'Melbourne',
          pickNumber: 14,
          round: 3,
        },
        {
          playerId: '15',
          playerName: 'Jake Melksham',
          position: 'MID',
          team: 'Melbourne',
          pickNumber: 15,
          round: 3,
        },
        {
          playerId: '16',
          playerName: 'Sean Darcy',
          position: 'RUC',
          team: 'Fremantle',
          pickNumber: 16,
          round: 4,
        },
        {
          playerId: '17',
          playerName: 'Isaac Keeler',
          position: 'RUC',
          team: 'GWS',
          pickNumber: 17,
          round: 4,
        },
        {
          playerId: '18',
          playerName: 'Joe Richards',
          position: 'MID',
          team: 'Port Adelaide',
          pickNumber: 18,
          round: 4,
        },
        {
          playerId: '19',
          playerName: 'Lachlan Schultz',
          position: 'FWD',
          team: 'St Kilda',
          pickNumber: 19,
          round: 4,
        },
        {
          playerId: '20',
          playerName: 'Lucas Camporeale',
          position: 'MID',
          team: 'Carlton',
          pickNumber: 20,
          round: 4,
        },
        {
          playerId: '21',
          playerName: 'Joshua Kelly',
          position: 'MID',
          team: 'GWS',
          pickNumber: 21,
          round: 5,
        },
        {
          playerId: '22',
          playerName: 'Jordan Boyd',
          position: 'DEF',
          team: 'Gold Coast',
          pickNumber: 22,
          round: 5,
        },
      ];

      // Transform the picks data to match the expected format
      const formattedPicks = mockDraftPicks.map((pick) => ({
        playerId: pick.playerId,
        playerName: pick.playerName,
        position: pick.position,
        team: pick.team,
        pickNumber: pick.pickNumber,
        round: pick.round,
        // Add realistic fantasy values
        averageScore: 75 + Math.floor(Math.random() * 50), // 75-125
        lastGameScore: 60 + Math.floor(Math.random() * 60), // 60-120
        projectedScore: 70 + Math.floor(Math.random() * 60), // 70-130
        form: Array.from({ length: 5 }, () => 60 + Math.floor(Math.random() * 60)), // Recent form
        injuryStatus: Math.random() > 0.9 ? 'questionable' : 'healthy', // 10% chance of injury concern
        priceChange: Math.floor((Math.random() - 0.5) * 40000), // -20k to +20k price change
        ownership: 5 + Math.floor(Math.random() * 30), // 5-35% ownership
      }));

      return NextResponse.json({
        draftId: 'test-draft-123',
        leagueId: leagueId,
        status: 'COMPLETED',
        picks: formattedPicks,
        totalPicks: formattedPicks.length,
      });
    }

    return NextResponse.json(
      { error: 'No completed draft found for this league' },
      { status: 404 }
    );
  } catch (error) {
    logger.error(
      'Error fetching draft roster',
      error instanceof Error ? error : new Error(String(error)),
      {
        leagueId: resolvedParams.id || 'unknown',
        userId: resolvedParams.userId || 'unknown',
      }
    );
    return NextResponse.json({ error: 'Failed to fetch draft roster' }, { status: 500 });
  }
}
