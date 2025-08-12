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

    const playersData = players.map(player => ({
      id: player.id,
      name: player.name,
      position: player.position,
      club: player.club
    }));

    return (
      <div className="container mx-auto px-4 py-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold">
            {draft.league.name} Draft
          </h1>
          <p className="text-gray-600">
            {draft.league.settings.rosterSize} players per team • {teamCount} teams
          </p>
        </div>

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
