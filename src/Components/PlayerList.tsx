import React from 'react';
import type { Player } from '../types';

interface PlayerListProps {
  players: Player[];
}

function capitalizeWords(str: string) {
  return str.replace(/\b\w/g, (c) => c.toUpperCase());
}

const PlayerList = ({ players }: PlayerListProps) => {
  return (
    <ul className="divide-y divide-gray-200">
      {players.map((player, index) => (
        <li
          key={index}
          className="flex justify-between py-2 px-4 hover:bg-gray-50"
        >
          <span>
            {player.name ? capitalizeWords(player.name) : 'Unknown Player'}
            {player.team && (
              <> – {player.team.charAt(0).toUpperCase() + player.team.slice(1).toLowerCase()}</>
            )}
            {player.position && (
              <> ({player.position.charAt(0).toUpperCase() + player.position.slice(1).toLowerCase()})</>
            )}
          </span>
          <span className="text-blue-600 text-sm">Avg: {player.avg ?? '-'}</span>
        </li>
      ))}
    </ul>
  );
};

export default PlayerList;