// PlayerTable.tsx
import React from 'react';
import type { Player } from '../types';

interface PlayerTableProps {
  players: Player[];
  isMyPick: boolean;
  watchedIds: string[];
  onWatchToggle: (playerId: string) => void;
  onDraftClick: (player: Player) => void;
  sortKey: keyof Player;
  sortAsc: boolean;
  onSortChange: (key: keyof Player) => void;
}

const PlayerTable = ({
  players,
  isMyPick,
  watchedIds,
  onWatchToggle,
  onDraftClick,
  sortKey,
  sortAsc,
  onSortChange,
}: PlayerTableProps) => {
  return (
    <table className="min-w-full table-auto text-sm text-left">
      <thead className="bg-gray-100 dark:bg-gray-800">
        <tr>
          <th
            scope="col"
            className="cursor-pointer px-2 py-1 font-semibold uppercase text-gray-700 dark:text-gray-200"
            onClick={() => onSortChange('name')}
          >
            Name {sortKey === 'name' && (sortAsc ? '▲' : '▼')}
          </th>
          <th
            scope="col"
            className="cursor-pointer px-2 py-1 font-semibold uppercase text-gray-700 dark:text-gray-200"
            onClick={() => onSortChange('team')}
          >
            Team {sortKey === 'team' && (sortAsc ? '▲' : '▼')}
          </th>
          <th
            scope="col"
            className="cursor-pointer px-2 py-1 font-semibold uppercase text-gray-700 dark:text-gray-200"
            onClick={() => onSortChange('position')}
          >
            Position {sortKey === 'position' && (sortAsc ? '▲' : '▼')}
          </th>
          <th
            scope="col"
            className="cursor-pointer px-2 py-1 font-semibold uppercase text-gray-700 dark:text-gray-200"
            onClick={() => onSortChange('average')}
          >
            Score {sortKey === 'average' && (sortAsc ? '▲' : '▼')}
          </th>
          <th className="px-2 py-1" aria-hidden="true"></th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
        {players.length === 0 ? (
          <tr>
            <td colSpan={5} className="px-2 py-2 text-center text-gray-500">
              No players available
            </td>
          </tr>
        ) : (
          players.map((p) => {
            const isWatched = watchedIds.includes(p.id);
            return (
              <tr
                key={p.id}
                className="even:bg-gray-50 dark:even:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                <td className="px-2 py-1 font-medium text-gray-800 dark:text-gray-100">{p.name}</td>
                <td className="px-2 py-1 text-gray-600 dark:text-gray-300">{p.team}</td>
                <td className="px-2 py-1 text-gray-600 dark:text-gray-300">{p.position}</td>
                <td className="px-2 py-1 text-gray-600 dark:text-gray-300">{p.average}</td>
                <td className="px-2 py-1 text-right space-x-2">
                  <button
                    onClick={() => onWatchToggle(p.id)}
                    className="text-xs text-blue-600 hover:underline"
                  >
                    {isWatched ? 'Unwatch' : 'Watch'}
                  </button>
                  {isMyPick && (
                    <button
                      onClick={() => onDraftClick(p)}
                      className="text-xs text-green-600 hover:underline"
                    >
                      Draft
                    </button>
                  )}
                </td>
              </tr>
            );
          })
        )}
      </tbody>
    </table>
  );
};

export default PlayerTable;