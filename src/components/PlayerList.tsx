'use client';

import { TeamLogo } from '@/components/TeamLogo';

import type { Player } from '../types/players';

interface PlayerListProps {
  title: string; // Add this
  players: Player[];
}

function capitalizeWords(str: string) {
  return str.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

const PlayerList = ({ title, players }: PlayerListProps) => {
  return (
    <>
      <h2 className="text-lg font-semibold mb-2">{title}</h2>
      <ul className="divide-y divide-gray-200">
        {players.map((player) => (
          <li key={player.id} className="flex justify-between py-2 px-4 hover:bg-gray-50">
            <span className="inline-flex flex-wrap items-center gap-2">
              {capitalizeWords(player.name)}
              {player.team ? (
                <>
                  <span className="inline-flex items-center gap-1.5 text-gray-600">
                    <span aria-hidden="true">–</span>
                    <TeamLogo team={player.team} size={16} withCircle decorative />
                    <span>{capitalizeWords(player.team)}</span>
                  </span>
                </>
              ) : null}
              {player.position && <> ({capitalizeWords(player.position)})</>}
            </span>
            <span className="text-blue-600 text-sm">
              Avg: {typeof player.avg === 'number' ? player.avg.toFixed(2) : '-'}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
};

export default PlayerList;
