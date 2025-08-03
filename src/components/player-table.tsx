import React, { useState, useMemo } from 'react';
import type { Player } from '../types';

type AvailablePlayersTableProps = {
  /**
   * List of available (undrafted) players to display.
   */
  players: Player[];
  isMyPick?: boolean;
  watchedIds?: string[];
  /**
   * List of drafted player IDs (used for disabling draft button and row opacity).
   */
  draftedIds?: string[];
  onDraft?: (player: Player) => void;
  onWatchToggle?: (playerId: string) => void;
  onConfirmDraft?: (player: Player) => void;
};

const AvailablePlayersTable = ({
  players = [],
  isMyPick = false,
  watchedIds = [],
  draftedIds = [],
  onDraft = () => {},
  onWatchToggle = () => {},
  onConfirmDraft = () => {},
}: AvailablePlayersTableProps) => {
  const [selectedTeam, setSelectedTeam] = useState<string>('All');
  const [selectedPosition, setSelectedPosition] = useState<string>('All');

  // Players prop is expected to be already filtered for undrafted players.
  const teams = useMemo(() => ['All', ...new Set(players.map((p) => p.team))], [players]);
  const positions = ['All', 'MID', 'FWD', 'DEF', 'RUC'];

  const filteredPlayers = useMemo(() => {
    return players
      .filter((p) => selectedTeam === 'All' || p.team === selectedTeam)
      .filter((p) => selectedPosition === 'All' || p.position === selectedPosition);
  }, [players, selectedTeam, selectedPosition]);

  function capitalizeWords(str: string) {
    return str.replace(/\b\w/g, (c) => c.toUpperCase());
  }

  if (!players.length) return <p className="text-sm text-gray-500">No players available.</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <label className="text-sm">
          Team:
          <select
            value={selectedTeam}
            onChange={(e) => setSelectedTeam(e.target.value)}
            className="ml-2 p-1 border rounded text-sm"
          >
            {teams.map((team) => (
              <option key={team} value={team}>
                {team}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Position:
          <select
            value={selectedPosition}
            onChange={(e) => setSelectedPosition(e.target.value)}
            className="ml-2 p-1 border rounded text-sm"
          >
            {positions.map((pos) => (
              <option key={pos} value={pos}>
                {pos}
              </option>
            ))}
          </select>
        </label>
      </div>

      {!isMyPick && (
        <p className="text-sm text-gray-500 italic">
          Waiting for your turn – you can still browse the player list.
        </p>
      )}

      <table className="w-full text-sm table-auto border-collapse">
        <thead className="bg-gray-100">
          <tr>
            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">
              Name
            </th>
            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">
              Team
            </th>
            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">
              Pos
            </th>
            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase w-8">
              Watch
            </th>
            <th className="px-3 py-2" aria-hidden="true"></th>
          </tr>
        </thead>
        <tbody>
          {filteredPlayers.map((player) => (
            <tr
              key={player.id}
              className={`border-t transition ${draftedIds.includes(player.id) ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-50'}`}
            >
              <td className="px-3 py-2 font-medium text-gray-800">
                {capitalizeWords(player.name)}
              </td>
              <td className="px-3 py-2 text-gray-600">
                {player.team
                  ? player.team.charAt(0).toUpperCase() + player.team.slice(1).toLowerCase()
                  : ''}
              </td>
              <td className="px-3 py-2 text-gray-600">
                {player.position
                  ? player.position.charAt(0).toUpperCase() + player.position.slice(1).toLowerCase()
                  : ''}
              </td>
              <td className="px-2 py-2 text-center w-8">
                <button
                  onClick={() => onWatchToggle(player.id)}
                  aria-label="Toggle watch status"
                  className={`text-lg ${watchedIds.includes(player.id) ? 'text-yellow-600' : 'text-gray-300'} transition`}
                >
                  ★
                </button>
              </td>
              <td className="px-3 py-2 text-right w-24">
                <button
                  onClick={() => onConfirmDraft(player)}
                  disabled={!isMyPick || draftedIds.includes(player.id)}
                  className="w-full px-4 py-2 text-sm font-semibold rounded transition
                    disabled:cursor-not-allowed disabled:bg-blue-200 disabled:text-blue-600
                    bg-blue-600 text-white hover:bg-blue-700"
                >
                  Draft
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default AvailablePlayersTable;
