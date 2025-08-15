'use client';

import * as React from 'react';
import { useRankings } from '@/hooks/useRankings';

type PlayerLite = {
  id: string;
  name: string;
  team?: string;
  position?: string;
  [k: string]: unknown;
};

type Props = { players: PlayerLite[] };

export default function AvailablePlayersTable({ players }: Props) {
  const { get, isLoading, error } = useRankings();

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border-collapse">
        <caption className="sr-only">Available players</caption>
        <thead>
          <tr>
            <th className="border px-4 py-2 text-left text-sm font-semibold">Name</th>
            <th className="border px-4 py-2 text-left text-sm font-semibold">Team</th>
            <th className="border px-4 py-2 text-left text-sm font-semibold">Position</th>
            <th className="border px-4 py-2 text-right text-sm font-semibold">Value</th>
          </tr>
        </thead>
        <tbody>
          {players.map((p) => {
            const entry = get(String(p.id)); // { totalValue, rank } | undefined
            const valueText = entry ? entry.totalValue.toFixed(2) : isLoading ? '…' : '—';
            const title = entry
              ? `Rank #${entry.rank} • ${entry.totalValue.toFixed(2)}`
              : undefined;

            return (
              <tr key={String(p.id)}>
                <td className="border px-4 py-2">{String(p.name)}</td>
                <td className="border px-4 py-2">{String(p.team ?? '')}</td>
                <td className="border px-4 py-2">{String(p.position ?? '')}</td>
                <td className="border px-4 py-2 text-right tabular-nums" title={title}>
                  {valueText}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Optional tiny hint if rankings failed */}
      {error && <p className="mt-2 text-xs text-red-600">Couldn’t load rankings: {error}</p>}
    </div>
  );
}
