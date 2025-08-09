'use client';

import * as React from 'react';
import { useRankings } from '@/app/tradecentre/RankingsContext';

// If you already have a Player type, import it and replace this.
type PlayerLite = {
  id: string;
  name: string;
  team?: string;
  position?: string;
  [key: string]: unknown;
};

type Props = {
  players: PlayerLite[];
};

function ValueChip({ playerId, compact = false }: { playerId: string; compact?: boolean }) {
  const rankings = useRankings();
  const data = rankings.get(String(playerId));
  if (!data) return null;

  const { rank, totalValue } = data;
  const label = `Rank ${rank}, total value ${totalValue.toFixed(2)}`;

  return (
    <span
      role="status"
      aria-label={label}
      className={
        compact
          ? 'ml-2 inline-flex items-center gap-1 rounded-md bg-blue-50 px-1.5 py-0.5 text-[11px] font-medium text-blue-700 ring-1 ring-inset ring-blue-200'
          : 'ml-2 inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-200'
      }
      title={label}
    >
      <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" className="-mt-px">
        <path d="M12 2l3 7h7l-5.5 4.1L18 21l-6-3.8L6 21l1.5-7.9L2 9h7z" />
      </svg>
      <span className="tabular-nums">#{rank}</span>
      <span className="opacity-60">•</span>
      <span className="tabular-nums">{totalValue.toFixed(2)}</span>
    </span>
  );
}

export default function AvailablePlayersTable({ players }: Props) {
  // Any existing filters/pagination you already had should remain intact.
  // I’m keeping the structure minimal to focus on inserting the chip next to names.

  // Example: derive unique team/pos if you already had it
  // const uniqueTeams = [...new Set(players.map((p) => p.team))];
  // const uniquePositions = [...new Set(players.map((p) => p.position))];

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border-collapse">
        <caption className="sr-only">Available players</caption>
        <thead>
          <tr>
            <th className="border px-4 py-2 text-left text-sm font-semibold">Name</th>
            <th className="border px-4 py-2 text-left text-sm font-semibold">Team</th>
            <th className="border px-4 py-2 text-left text-sm font-semibold">Position</th>
            {/* keep any other headers you already had */}
          </tr>
        </thead>
        <tbody>
          {players.map((player) => (
            <tr key={String(player.id)}>
              <td className="border px-4 py-2">
                <div className="flex items-baseline">
                  <span className="truncate">{String(player.name)}</span>
                  {/* New: show live Rank + Total Value */}
                  <ValueChip playerId={String(player.id)} compact />
                </div>
              </td>
              <td className="border px-4 py-2">{String(player.team ?? '')}</td>
              <td className="border px-4 py-2">{String(player.position ?? '')}</td>
              {/* keep any other cells you already had */}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}