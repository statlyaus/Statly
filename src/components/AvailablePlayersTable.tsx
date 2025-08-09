'use client';

import * as React from 'react';
import { useRankings } from '@/app/tradecentre/RankingsContext';

type PlayerLite = { id: string; name: string; team?: string; position?: string; [k: string]: unknown };
type Props = { players: PlayerLite[] };

export default function AvailablePlayersTable({ players }: Props) {
  const rankings = useRankings();

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border-collapse">
        <caption className="sr-only">Available players</caption>
        <thead>
          <tr>
            <th className="border px-4 py-2 text-left text-sm font-semibold">Name</th>
            <th className="border px-4 py-2 text-left text-sm font-semibold">Team</th>
            <th className="border px-4 py-2 text-left text-sm font-semibold">Position</th>
            <th className="border px-4 py-2 text-right text-sm font-semibold">Value</th> {/* new */}
          </tr>
        </thead>
        <tbody>
          {players.map((p) => {
            const v = rankings.get(String(p.id))?.totalValue;
            return (
              <tr key={String(p.id)}>
                <td className="border px-4 py-2">{String(p.name)}</td>
                <td className="border px-4 py-2">{String(p.team ?? '')}</td>
                <td className="border px-4 py-2">{String(p.position ?? '')}</td>
                <td className="border px-4 py-2 text-right tabular-nums">
                  {typeof v === 'number' ? v.toFixed(2) : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}