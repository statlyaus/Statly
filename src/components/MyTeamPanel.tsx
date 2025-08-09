'use client';

import React from 'react';
import type { Player, Team } from '../types';
import { useRankings } from '@/app/tradecentre/RankingsContext';

type MyTeamPanelProps = {
  team: Team | undefined;
  players: Player[];
  /** Optional: sort drafted players by highest totalValue */
  sortByValue?: boolean;
};

function ValueChip({ playerId }: { playerId: string }) {
  const rankings = useRankings();
  const data = rankings.get(String(playerId));
  if (!data) return null; // no ranking yet

  const { rank, totalValue } = data;
  return (
    <span
      role="status"
      title={`Rank ${rank}, total value ${totalValue.toFixed(2)}`}
      className="ml-2 inline-flex items-center gap-1 rounded-md bg-blue-50 px-1.5 py-0.5 text-[11px] font-medium text-blue-700 ring-1 ring-inset ring-blue-200"
    >
      <span className="tabular-nums">#{rank}</span>
      <span className="opacity-50">•</span>
      <span className="tabular-nums">{totalValue.toFixed(2)}</span>
    </span>
  );
}

function capWords(str = '') {
  return str.replace(/\b\w/g, (c) => c.toUpperCase());
}
function capFirst(str = '') {
  return str ? str.charAt(0).toUpperCase() + str.slice(1).toLowerCase() : '';
}

const MyTeamPanel = ({ team, players, sortByValue = true }: MyTeamPanelProps) => {
  const rankings = useRankings();

  if (!team) return null;

  const draftedPlayers = players.filter((p) =>
    (team.players ?? []).map(String).includes(String(p.id))
  );

  // Optional: sort by totalValue desc if we have rankings
  const sorted = sortByValue
    ? [...draftedPlayers].sort((a, b) => {
        const A = rankings.get(String(a.id))?.totalValue ?? -Infinity;
        const B = rankings.get(String(b.id))?.totalValue ?? -Infinity;
        return B - A;
      })
    : draftedPlayers;

  return (
    <section aria-labelledby="team-heading">
      <div className="bg-white p-4 rounded shadow h-full">
        <h2 id="team-heading" className="text-md font-bold mb-2">
          My Team
        </h2>

        {sorted.length === 0 ? (
          <p className="text-sm text-gray-500">No players drafted yet.</p>
        ) : (
          <ul className="text-sm space-y-1 max-h-[600px] overflow-y-auto">
            {sorted.map((player) => (
              <li key={player.id} className="border-b py-1 flex items-baseline">
                <span className="font-medium">{capWords(player.name)}</span>
                <ValueChip playerId={String(player.id)} />
                <span className="ml-2 text-gray-600">
                  – {player.team ? capFirst(player.team) : ''}{' '}
                  {player.position ? `(${capFirst(player.position)})` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
};

export default MyTeamPanel;