// src/app/tradecentre/page.tsx
export const runtime = 'nodejs';

import { getPlayers } from '@/lib/data';
import TradeCentreShell from '@/components/TradeCentreShell';

/** helper: derive teams + playersByTeam from your Player[] */
function deriveLeague(players: Awaited<ReturnType<typeof getPlayers>>) {
  const teamsMap = new Map<string, { id: string; name: string }>();
  const byTeam: Record<string, typeof players> = {};

  for (const p of players) {
    const teamId = String(p.team ?? 'Unknown');
    if (!teamsMap.has(teamId)) teamsMap.set(teamId, { id: teamId, name: teamId });
    if (!byTeam[teamId]) byTeam[teamId] = [];
    byTeam[teamId].push(p);
  }

  const teams = Array.from(teamsMap.values())
    .sort((a, b) => a.name.localeCompare(b.name))
    // shape for TeamSelectorPanel (you can enrich with logos/managers later)
    .map(t => ({ id: t.id, name: t.name }));

  return { teams, playersByTeam: byTeam };
}

export default async function Tradecentre() {
  const allPlayers = await getPlayers();
  const { teams, playersByTeam } = deriveLeague(allPlayers);

  return (
    <main className="mx-auto max-w-7xl p-6">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-3xl font-bold text-white">Trade Centre</h1>
        {/* Optional: tabs if you still want a “Market” view */}
        {/* <Tabs ...>Compare | Market</Tabs> */}
      </header>

      <TradeCentreShell teams={teams} playersByTeam={playersByTeam} />
    </main>
  );
}