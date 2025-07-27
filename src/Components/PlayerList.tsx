import React from 'react';
import type { Player } from '../types';

interface PlayerListProps {
  players: Player[];
}

const PlayerList = ({ players }: PlayerListProps) => {
  return (
    <ul className="divide-y divide-gray-200">
      {players.map((player, index) => (
        <li
          key={index}
          className="flex justify-between py-2 px-4 hover:bg-gray-50"
        >
          <span>{player.name ?? 'Unknown Player'}</span>
          <span className="text-blue-600 text-sm">Avg: {player.average ?? '-'}</span>
        </li>
      ))}
    </ul>
  );
};

export default PlayerList;