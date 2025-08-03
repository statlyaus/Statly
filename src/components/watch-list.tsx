import React from 'react';
import type { Player } from '../types';

interface WatchListProps {
  initialPlayers: Player[];
  watchedIds: string[];
  onWatchToggle: (playerId: string) => void;
}

const WatchList = ({ initialPlayers, watchedIds = [], onWatchToggle }: WatchListProps) => {
  const watchedPlayers = initialPlayers.filter((p) => watchedIds.includes(p.id));

  function capitalizeWords(str: string) {
    return str.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function capitalizeFirst(str?: string) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
  }

  return (
    <div className="bg-white p-4 rounded shadow h-full border border-blue-200">
      <div className="flex items-center justify-between mb-3 border-b border-blue-300 pb-2">
        <div className="flex items-center gap-2">
          <span className="inline-block bg-blue-100 text-blue-700 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide">
            Watchlist
          </span>
          <span className="text-xs text-blue-600 font-medium">
            (Auto-draft will pick your top available player)
          </span>
        </div>
        <span className="text-xs text-gray-400">
          {watchedPlayers.length} player{watchedPlayers.length !== 1 ? 's' : ''}
        </span>
      </div>
      {watchedPlayers.length === 0 ? (
        <div className="text-gray-400 text-sm text-center py-8">No players watched yet.</div>
      ) : (
        <ul className="divide-y divide-blue-100 rounded overflow-hidden">
          {watchedPlayers.map((player, idx) => (
            <li
              key={player.id}
              className={`flex justify-between items-center py-3 px-2 ${idx === 0 ? 'bg-blue-50 border-l-4 border-blue-500' : ''}`}
            >
              <div>
                <p className={`font-semibold ${idx === 0 ? 'text-blue-800' : 'text-gray-800'}`}>
                  {capitalizeWords(player.name)}
                  {idx === 0 && (
                    <span className="ml-2 text-xs bg-blue-200 text-blue-800 rounded px-2 py-0.5 font-bold uppercase align-middle">
                      Top Pick
                    </span>
                  )}
                </p>
                <p className="text-xs text-gray-500">
                  {capitalizeFirst(player.team)} – {capitalizeFirst(player.position)} –{' '}
                  <span className="font-semibold">{player.avg} avg</span>
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
