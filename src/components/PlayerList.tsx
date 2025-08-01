import React from 'react';
import type { Player } from '../types';

interface PlayerListProps {
  title: string; // Add this
  players: Player[];
}

function capitalizeWords(str: string) {
  return str
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const PlayerList = ({ title, players }: PlayerListProps) => {
  return (
    <>
      <h2 className="text-lg font-semibold mb-2">{title}</h2>
      <ul className="divide-y divide-gray-200">
        {players.map((player) => (
          <li
            key={player.id}
            className="flex justify-between py-2 px-4 hover:bg-gray-50"
          >
            <span>
              {capitalizeWords(player.name)}
              {player.team && (
                <> – {capitalizeWords(player.team)}</>
              )}
              {player.position && (
                <> ({capitalizeWords(player.position)})</>
              )}
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