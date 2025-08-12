import { prisma } from '@/lib/prisma';
import { notFound } from 'next/navigation';
import DraftRoomClient from './DraftRoomClient';
import { calculateTotalValue } from '@/types/fantasyCategories';

interface DraftPageProps {
  params: Promise<{ id: string }>;
}

export default async function DraftPage({ params }: DraftPageProps) {
  const { id } = await params;
  
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

    if (!draft || !draft.league) {
      notFound();
    }

    // Fetch all available players
    const players = await prisma.player.findMany({
      orderBy: { name: 'asc' }
    });

    // Calculate current draft state
    const teamCount = draft.orders.length;
    const totalPicks = teamCount * draft.league.settings.rosterSize;
    const currentPick = draft.picks.length + 1;
    const round = Math.ceil(currentPick / teamCount);
    const direction = (round % 2 === 1) ? 'FORWARD' : 'REVERSE';

    // Transform data for client component
    const draftData = {
      id: draft.id,
      currentPick,
      totalPicks,
      round,
      direction,
      status: draft.status,
      participants: draft.orders.map(order => ({
        slot: order.slot,
        member: {
          id: order.member.id,
          userId: order.member.userId,
          displayName: order.member.user.displayName,
          email: order.member.user.email
        }
      })),
      picks: draft.picks.map(pick => ({
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

    const playersData = players.map(player => {
  // Generate mock fantasy stats for each player
  const generateStats = () => {
    const games = 15 + Math.floor(Math.random() * 10); // 15-24 games played
    
    // Generate season totals for statistical categories
    const seasonStats = {
      goals: Math.floor(Math.random() * 45), // 0-44 goals per season
      behinds: Math.floor(Math.random() * 30), // 0-29 behinds per season
      disposals: (15 + Math.floor(Math.random() * 20)) * games, // Per game * games
      kicks: (8 + Math.floor(Math.random() * 15)) * games,
      handballs: (5 + Math.floor(Math.random() * 12)) * games,
      marks: (3 + Math.floor(Math.random() * 8)) * games,
      tackles: (2 + Math.floor(Math.random() * 8)) * games,
      hitouts: Math.floor(Math.random() * 40) * games,
      goalAccuracy: 40 + Math.random() * 40, // Percentage stat
      kickingEfficiency: 60 + Math.random() * 30, // Percentage stat
      disposalEfficiency: 65 + Math.random() * 25, // Percentage stat
      contestedPossessions: (4 + Math.floor(Math.random() * 12)) * games,
      uncontestedPossessions: (8 + Math.floor(Math.random() * 15)) * games,
      effectiveDisposals: (10 + Math.floor(Math.random() * 15)) * games,
      clangers: Math.floor(Math.random() * 6) * games,
      turnovers: Math.floor(Math.random() * 4) * games,
      intercepts: Math.floor(Math.random() * 6) * games,
      onePercenters: Math.floor(Math.random() * 5) * games,
      bounces: Math.floor(Math.random() * 3) * games,
      metersGained: (200 + Math.floor(Math.random() * 300)) * games,
      timeOnGroundPct: 70 + Math.random() * 25, // Percentage stat
      scoreInvolvements: Math.floor(Math.random() * 6) * games,
      inside50s: Math.floor(Math.random() * 8) * games
    };

    // Calculate total value using the weighted system
    const totalValue = calculateTotalValue(seasonStats, games);

    return {
      ...seasonStats,
      games,
      totalValue
    };
  };      return {
        id: player.id,
        name: player.name,
        position: player.position,
        club: player.club,
        stats: generateStats()
      };
    });

    return (
      <div className="min-h-screen bg-gray-50">
        <DraftRoomClient 
          players={playersData}
          draftData={draftData}
        />
      </div>
    );
  } catch (error) {
    console.error('Error loading draft:', error);
    notFound();
  }
}
