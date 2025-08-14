import { prisma } from '@/lib/prisma';
import { notFound } from 'next/navigation';
import DraftRoomClient from './DraftRoomClient';
import DraftErrorBoundary from '@/components/DraftErrorBoundary';
import type { PlayerStats } from '@/types/fantasyCategories';

interface DraftPageProps {
  params: Promise<{ id: string }>;
}

export default async function DraftPage({ params }: DraftPageProps) {
  const { id } = await params;
  
  // Development mode: Skip auth checks
  const isDevelopment = process.env.NODE_ENV === 'development';
  
  if (isDevelopment) {
    console.log('🧪 Development mode: Skipping authentication for draft', id);
  }
  
  try {
    // Fetch draft with all related data
    const draft = await prisma.draft.findUnique({
      where: { id },
      include: {
        league: {
          include: {
            members: {
              include: {
                user: true
              }
            },
            settings: true
          }
        },
        orders: {
          include: {
            member: {
              include: {
                user: true
              }
            }
          },
          orderBy: { slot: 'asc' }
        },
        picks: {
          include: {
            player: true,
            member: {
              include: {
                user: true
              }
            }
          },
          orderBy: { overall: 'asc' }
        }
      }
    });

    // In development mode, create a mock draft if none exists
    let draftToUse;
    if (!draft && isDevelopment) {
      console.log('🧪 Development mode: Draft not found, creating mock data for draft ID:', id);
      
      // Create mock draft data for development
      draftToUse = {
        id,
        name: 'Development Test Draft',
        status: 'ACTIVE' as const,
        currentRound: 1,
        currentPick: 1,
        timePerPick: 120,
        league: {
          id: 'mock-league-id',
          name: 'Development League',
          maxTeams: 8,
          draftType: 'SNAKE' as const,
          members: [
            {
              id: 'mock-member-1',
              teamName: 'Team 1',
              user: { id: 'user-1', name: 'Player 1', email: 'player1@test.com' }
            },
            {
              id: 'mock-member-2', 
              teamName: 'Team 2',
              user: { id: 'user-2', name: 'Player 2', email: 'player2@test.com' }
            }
          ],
          settings: {
            id: 'mock-settings',
            rosterSize: 22,
            benchSize: 4,
            maxTeams: 8,
            pickSeconds: 120,
            allowAutoPick: true,
            draftType: 'SNAKE' as const,
            startAt: new Date(),
            locked: false
          }
        },
        orders: [
          {
            id: 'order-1',
            slot: 1,
            member: {
              id: 'mock-member-1',
              teamName: 'Team 1',
              user: { id: 'user-1', name: 'Player 1', email: 'player1@test.com' }
            }
          },
          {
            id: 'order-2',
            slot: 2,
            member: {
              id: 'mock-member-2',
              teamName: 'Team 2', 
              user: { id: 'user-2', name: 'Player 2', email: 'player2@test.com' }
            }
          }
        ],
        picks: []
      };
    } else if (!draft || !draft.league) {
      notFound();
    } else {
      draftToUse = draft;
    }

    // Fetch all available players, excluding duplicates with arrows
    const players = await prisma.player.findMany({
      where: {
        NOT: {
          name: {
            contains: '↗'
          }
        }
      },
      orderBy: { name: 'asc' }
    });

    // Calculate current draft state
    const teamCount = draftToUse.orders.length;
    const totalPicks = teamCount * draftToUse.league.settings.rosterSize;
    const currentPick = draftToUse.picks.length + 1;
    const round = Math.ceil(currentPick / teamCount);
    const direction = (round % 2 === 1) ? 'FORWARD' : 'REVERSE';

    // Transform data for client component
    const draftData = {
      id: draftToUse.id,
      currentPick,
      totalPicks,
      round,
      direction,
      status: draftToUse.status,
      participants: draftToUse.orders.map(order => ({
        slot: order.slot,
        member: {
          id: order.member.id,
          userId: order.member.user.id,
          displayName: ('name' in order.member.user) ? order.member.user.name : order.member.user.displayName,
          email: order.member.user.email
        }
      })),
      picks: draftToUse.picks.map(pick => ({
        id: pick.id,
        overall: pick.overall,
        round: pick.round,
        slot: pick.slot,
        player: {
          id: pick.player.id,
          name: pick.player.name,
          position: pick.player.position,
          club: pick.player.club
        },
        member: {
          id: pick.member.id,
          displayName: pick.member.user.displayName
        },
        auto: pick.auto,
        madeAt: pick.madeAt.toISOString()
      }))
    };

    // Generate mock fantasy stats for each player
    const generateStats = (): PlayerStats => {
      const games = 15 + Math.floor(Math.random() * 10); // 15-24 games played
      
      return {
        games,
        kicks: Math.floor((10 + Math.random() * 15) * games),
        handballs: Math.floor((5 + Math.random() * 10) * games),
        marks: Math.floor((3 + Math.random() * 8) * games),
        tackles: Math.floor((2 + Math.random() * 8) * games),
        goals: Math.floor(Math.random() * 45), // 0-44 goals per season
        hitouts: Math.floor(Math.random() * 40) * games,
        clearances: Math.floor((1 + Math.random() * 5) * games),
        inside50s: Math.floor((1 + Math.random() * 8) * games),
        rebound50s: Math.floor((0.5 + Math.random() * 4) * games),
        clangers: Math.floor(Math.random() * 6) * games,
        contestedPossessions: Math.floor((4 + Math.random() * 12) * games),
        uncontestedPossessions: Math.floor((8 + Math.random() * 15) * games),
        freesFor: Math.floor((0.5 + Math.random() * 3) * games),
        freesAgainst: Math.floor((0.5 + Math.random() * 3) * games),
        onePercenters: Math.floor(Math.random() * 5) * games,
        goalAssists: Math.floor(Math.random() * 15), // 0-14 goal assists per season
        timeOnGroundPct: 70 + Math.random() * 25, // 70-95%
        disposalEffPct: 65 + Math.random() * 25, // 65-90%
        turnovers: Math.floor(Math.random() * 4) * games,
        intercepts: Math.floor(Math.random() * 6) * games,
        metresGained: Math.floor((200 + Math.random() * 300) * games),
        contestedMarks: Math.floor((0.5 + Math.random() * 3) * games),
        effectiveDisposals: Math.floor((10 + Math.random() * 15) * games),
        scoreInvolvements: Math.floor(Math.random() * 6) * games
      };
    };

    const playersData = players.map(player => ({
      id: player.id,
      name: player.name,
      position: player.position,
      club: player.club,
      stats: generateStats()
    }));

    return (
      <div className="min-h-screen bg-gray-50">
        <DraftErrorBoundary>
          <DraftRoomClient 
            players={playersData}
            draftData={draftData}
          />
        </DraftErrorBoundary>
      </div>
    );
  } catch (error) {
    console.error('Error loading draft:', error);
    notFound();
  }
}
