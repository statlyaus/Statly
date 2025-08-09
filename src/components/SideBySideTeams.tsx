// src/components/SideBySideTeams.tsx
'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { Player } from '@/types';
import { useTradeStore } from '@/state/tradeStore';

type Side = 'incoming' | 'outgoing';

type Props = {
  leftTitle: string;           // e.g., "Your Team"
  rightTitle: string;          // e.g., "Opponent"
  leftPlayers: Player[];       // your roster
  rightPlayers: Player[];      // their roster
};

const POSITIONS = ['DEF', 'MID', 'FWD', 'RUC'] as const;

function readStat(player: Player, key: string): number | string | undefined {
  // read from stats bag first, then top-level
  const stats = (player as unknown as { stats?: Record<string, unknown> }).stats;
  const bag = stats?.[key];
  if (bag !== undefined) return bag as number | string;
  const top = (player as unknown as Record<string, unknown>)[key];
  return top as number | string | undefined;
}

function Row({
  player,
  side,
  onAdd,
}: {
  player: Player;
  side: Side;
  onAdd: (side: Side, p: Player) => void;
}) {
  return (
    <li className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-3 py-2 px-3 rounded hover:bg-gray-800">
      <div className="truncate">
        <Link href={`/players/${player.id}`} className="text-blue-400 hover:underline">
          {player.name}
        </Link>
        <div className="text-xs text-gray-400">
          {player.position ?? '—'} {player.team ? `• ${player.team}` : ''}
        </div>
      </div>
      <div className="text-right tabular-nums text-gray-300">{readStat(player, 'metresGained') ?? '–'}</div>
      <div className="text-right tabular-nums text-gray-300">{readStat(player, 'clearances') ?? '–'}</div>
      <div className="text-right tabular-nums text-gray-300">{readStat(player, 'scoreInvolvements') ?? '–'}</div>
      <div className="text-right">
        <button
          onClick={() => onAdd(side, player)}
          className={`rounded px-2 py-1 text-sm ${
            side === 'incoming'
              ? 'bg-blue-600 hover:bg-blue-700 text-white'
              : 'bg-amber-600 hover:bg-amber-700 text-white'
          }`}
          aria-label={`Add ${player.name} to ${side}`}
        >
          {side === 'incoming' ? 'Add In' : 'Add Out'}
        </button>
      </div>
    </li>
  );
}

export default function SideBySideTeams({
  leftTitle,
  rightTitle,
  leftPlayers,
  rightPlayers,
}: Props) {
  const add = useTradeStore((s) => s.add);

  const [filterPos, setFilterPos] = useState<string>('ALL');

  const filteredLeft = useMemo(() => {
    if (filterPos === 'ALL') return leftPlayers;
    return leftPlayers.filter((pl) => (pl.position ?? '').toString().toUpperCase().includes(filterPos));
  }, [leftPlayers, filterPos]);

  const filteredRight = useMemo(() => {
    if (filterPos === 'ALL') return rightPlayers;
    return rightPlayers.filter((pl) => (pl.position ?? '').toString().toUpperCase().includes(filterPos));
  }, [rightPlayers, filterPos]);

  return (
    <div className="space-y-4">
      {/* quick position filter */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-400">Filter:</span>
        <button
          className={`rounded-full px-3 py-1 text-sm border ${filterPos === 'ALL' ? 'bg-gray-700 text-white border-gray-600' : 'border-gray-700 text-gray-300 hover:bg-gray-800'}`}
          onClick={() => setFilterPos('ALL')}
        >
          All
        </button>
        {POSITIONS.map((pos) => (
          <button
            key={pos}
            className={`rounded-full px-3 py-1 text-sm border ${
              filterPos === pos ? 'bg-gray-700 text-white border-gray-600' : 'border-gray-700 text-gray-300 hover:bg-gray-800'
            }`}
            onClick={() => setFilterPos(pos)}
          >
            {pos}
          </button>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {/* Left side (your team -> outgoing) */}
        <section className="rounded-xl border border-gray-800 bg-gray-900">
          <header className="flex items-center justify-between px-3 py-2 border-b border-gray-800">
            <h3 className="font-semibold text-white">{leftTitle}</h3>
            <div className="text-xs text-gray-400 hidden sm:flex gap-6">
              <span>MG</span>
              <span>CLR</span>
              <span>SI</span>
            </div>
          </header>
          <ul className="divide-y divide-gray-800">
            {filteredLeft.map((player) => (
              <Row key={player.id} player={player} side="outgoing" onAdd={add} />
            ))}
          </ul>
        </section>

        {/* Right side (opponent -> incoming) */}
        <section className="rounded-xl border border-gray-800 bg-gray-900">
          <header className="flex items-center justify-between px-3 py-2 border-b border-gray-800">
            <h3 className="font-semibold text-white">{rightTitle}</h3>
            <div className="text-xs text-gray-400 hidden sm:flex gap-6">
              <span>MG</span>
              <span>CLR</span>
              <span>SI</span>
            </div>
          </header>
          <ul className="divide-y divide-gray-800">
            {filteredRight.map((player) => (
              <Row key={player.id} player={player} side="incoming" onAdd={add} />
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}