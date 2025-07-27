import React from 'react';
import type { Player } from '../types';

interface WatchListProps {
  initialPlayers: Player[];
  watchedIds?: string[];
  onWatchToggle?: (playerId: string) => void;
}

const WatchList = ({
  initialPlayers,
  watchedIds = [],
  onWatchToggle = () => {},
}: WatchListProps) => {
  const watchedPlayers = initialPlayers
    .filter((p) => watchedIds.includes(p.id))
    .sort((a, b) => b.average - a.average);

  return (
    <div className="bg-white p-4 rounded shadow h-full">
      <h2 className="text-md font-bold mb-2">Watchlist ({watchedPlayers.length})</h2>

      {watchedPlayers.length === 0 ? (
        <p className="text-sm text-gray-500">
          No players watched. Click <span className="text-yellow-600">★</span> to add players.
        </p>
      ) : (
        <ul className="text-sm space-y-2 max-h-[600px] overflow-y-auto divide-y">
          {watchedPlayers.map((player) => (
            <li key={player.id} className="flex justify-between items-center py-1">
              <div>
                <p className="font-medium">{player.name}</p>
                <p className="text-xs text-gray-500">
                  {player.team} – {player.position} – <span className="font-semibold">{player.average} avg</span>
                </p>
              </div>
              <button
                onClick={() => onWatchToggle(player.id)}
                className="text-xs text-red-500 hover:underline"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default WatchList;