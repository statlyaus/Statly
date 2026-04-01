export const revalidate = 60;
import { AppLayout } from '@/components/navigation';
import { leagueApplicationService } from '@/server/league/services/LeagueApplicationService';

import WaiversClient from './WaiversClient';

interface SSRClaim {
  id: string;
  userId: string;
  teamId: string;
  playerId: string;
  dropPlayerId?: string;
  priority: number;
  status: 'PENDING' | 'SUCCESSFUL' | 'FAILED' | 'CANCELLED';
  createdAt: string; // ISO
  processedAt?: string; // ISO
}

interface SSRPlayerLite {
  id: string;
  name: string;
  team?: string;
  position?: string;
  ownership?: number; // percentage or 0/100 marker
  avg?: number;
  statsSummary?: {
    disposals?: number;
    tackles?: number;
    marks?: number;
    goals?: number;
  };
}

interface SSRMemberLite {
  userId: string;
  teamId?: string;
  teamName?: string;
}

interface SSRWaiverOrderEntry {
  userId: string;
  teamId?: string;
  teamName?: string;
  currentPriority?: number;
  remainingFAAB?: number;
}

export default async function LeagueWaiversPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: leagueId } = await params;
  const [settings, waivers, members, players] = await Promise.all([
    leagueApplicationService.getWaiverSettings(leagueId),
    leagueApplicationService.listWaivers(leagueId),
    leagueApplicationService.getLeagueMembers(leagueId),
    leagueApplicationService.listLeaguePlayers({
      leagueId,
      limit: 100,
      owned: false,
    }),
  ]);

  const membersIndex = Object.fromEntries(
    (members ?? []).map((member): [string, SSRMemberLite] => [
      member.userId,
      {
        userId: member.userId,
        teamId: member.id,
        teamName: member.teamName,
      },
    ])
  );

  const availablePlayers: SSRPlayerLite[] = players.items.map((player) => ({
    id: player.id,
    name: player.name,
    team: player.team,
    position: player.position,
    ownership: player.ownership,
    avg: player.avg,
    statsSummary: player.statsSummary,
  }));
  const playersIndex = Object.fromEntries(
    availablePlayers.map((player): [string, SSRPlayerLite] => [player.id, player])
  );
  const initialWaiverOrder: SSRWaiverOrderEntry[] = waivers.priorities.map((priority) => ({
    userId: priority.userId,
    teamId: priority.teamId,
    teamName: priority.teamName,
    currentPriority: priority.currentPriority,
    remainingFAAB: priority.remainingFAAB,
  }));
  const initialClaims: SSRClaim[] = waivers.claims.map((claim) => ({
    id: claim.id,
    userId: claim.userId,
    teamId: claim.teamId,
    playerId: claim.playerId,
    dropPlayerId: claim.dropPlayerId,
    priority: claim.priority,
    status: claim.status,
    createdAt: claim.createdAt,
    processedAt: claim.processedAt,
  }));
  const waiverSettings = settings ?? null;
  const initialPlayersCursor = players.nextCursor ?? null;

  return (
    <AppLayout>
      <WaiversClient
        leagueId={leagueId}
        initialClaims={initialClaims}
        initialSettings={waiverSettings}
        availablePlayers={availablePlayers}
        playersIndex={playersIndex}
        membersIndex={membersIndex}
        initialWaiverOrder={initialWaiverOrder}
        initialPlayersCursor={initialPlayersCursor}
      />
    </AppLayout>
  );
}
