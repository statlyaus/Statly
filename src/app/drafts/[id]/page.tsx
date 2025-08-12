import { prisma } from '@/lib/prisma';
import { notFound } from 'next/navigation';
import DraftRoomClient from './DraftRoomClient';

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
      // Generate mock stats based on position
      const generateStats = (position: string) => {
        const base = {
          kicks: Math.floor(Math.random() * 10) + 15, // 15-24
          handballs: Math.floor(Math.random() * 8) + 8, // 8-15
          marks: Math.floor(Math.random() * 5) + 3, // 3-7
          tackles: Math.floor(Math.random() * 4) + 2, // 2-5
          goals: Math.floor(Math.random() * 3), // 0-2
          hitouts: 0,
          clearances: Math.floor(Math.random() * 3) + 1, // 1-3
          inside50s: Math.floor(Math.random() * 3) + 1, // 1-3
          rebound50s: Math.floor(Math.random() * 2) + 1, // 1-2
          clangers: Math.floor(Math.random() * 3) + 1, // 1-3
          contestedPossessions: Math.floor(Math.random() * 6) + 8, // 8-13
          uncontestedPossessions: Math.floor(Math.random() * 8) + 12, // 12-19
          freesFor: Math.floor(Math.random() * 2), // 0-1
          freesAgainst: Math.floor(Math.random() * 2), // 0-1
          onePercenters: Math.floor(Math.random() * 3) + 1, // 1-3
          goalAssists: Math.floor(Math.random() * 2), // 0-1
          timeOnGround: Math.floor(Math.random() * 20) + 70, // 70-89%
          disposalEfficiency: Math.floor(Math.random() * 20) + 75, // 75-94%
          turnovers: Math.floor(Math.random() * 3) + 1, // 1-3
          intercepts: Math.floor(Math.random() * 3) + 1, // 1-3
          metresGained: Math.floor(Math.random() * 100) + 200, // 200-299
          contestedMarks: Math.floor(Math.random() * 2), // 0-1
          effectiveDisposals: Math.floor(Math.random() * 8) + 18, // 18-25
          scoreInvolvements: Math.floor(Math.random() * 4) + 2, // 2-5
          avgFantasyPoints: 0 // Will be calculated below
        };

        // Position-specific adjustments
        if (position === 'RUC') {
          base.hitouts = Math.floor(Math.random() * 20) + 15; // 15-34
          base.clearances = Math.floor(Math.random() * 4) + 4; // 4-7
          base.contestedPossessions = Math.floor(Math.random() * 8) + 12; // 12-19
        } else if (position === 'FWD') {
          base.goals = Math.floor(Math.random() * 4) + 1; // 1-4
          base.goalAssists = Math.floor(Math.random() * 3) + 1; // 1-3
          base.inside50s = Math.floor(Math.random() * 4) + 3; // 3-6
        } else if (position === 'DEF') {
          base.rebound50s = Math.floor(Math.random() * 4) + 2; // 2-5
          base.intercepts = Math.floor(Math.random() * 4) + 2; // 2-5
          base.onePercenters = Math.floor(Math.random() * 4) + 2; // 2-5
        }

        // Calculate average fantasy points (simple formula)
        base.avgFantasyPoints = Math.floor(
          (base.kicks * 1) + 
          (base.handballs * 1) + 
          (base.marks * 3) + 
          (base.tackles * 4) + 
          (base.goals * 6) + 
          (base.hitouts * 1) +
          (base.clearances * 2)
        );

        return base;
      };

      return {
        id: player.id,
        name: player.name,
        position: player.position,
        club: player.club,
        stats: generateStats(player.position)
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
