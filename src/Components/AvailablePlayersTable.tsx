import { useState, useMemo } from 'react';
import type { Player } from '../types';

type AvailablePlayersTableProps = {
  players: Player[];
  isMyPick?: boolean;
  watchedIds?: string[];
  draftedIds?: string[];
  onWatchToggle?: (playerId: string) => void;
  onConfirmDraft?: (player: Player) => void;
  onPlayerClick?: (player: Player) => void;
};

const AvailablePlayersTable = ({
  players = [],
  isMyPick = false,
  watchedIds = [],
  draftedIds = [],
  onWatchToggle = () => {},
  onConfirmDraft = () => {},
  onPlayerClick = () => {},
}: AvailablePlayersTableProps) => {
  const [selectedTeam, setSelectedTeam] = useState<string>('All');
  const [selectedPosition, setSelectedPosition] = useState<string>('All');

  const uniquePlayers = useMemo(() => {
    const seen = new Set<string>();
    return players.filter((p) => {
      if (!p.id || seen.has(p.id) || draftedIds.includes(p.id)) return false;
      seen.add(p.id);
      return true;
    });
  }, [players, draftedIds]);

  const teams = useMemo(() => ['All', ...new Set(uniquePlayers.map((p) => p.team))], [uniquePlayers]);
  const positions = ['All', 'MID', 'FWD', 'DEF', 'RUC'];

  const filteredPlayers = useMemo(() => {
    return uniquePlayers
      .filter((p) => selectedTeam === 'All' || p.team === selectedTeam)
      .filter((p) => selectedPosition === 'All' || p.position === selectedPosition);
  }, [uniquePlayers, selectedTeam, selectedPosition]);

  // Debug: log filteredPlayers
  console.log("AvailablePlayersTable filteredPlayers:", filteredPlayers);

  if (!players.length) return <p className="text-sm text-gray-500">No players available.</p>;

  function capitalizeWords(str: string) {
    return str.replace(/\b\w/g, (c) => c.toUpperCase());
  }

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
            {teams.map((team, idx) => (
              <option key={typeof team === "string" ? team : idx} value={team}>
                {typeof team === "string" ? team.charAt(0).toUpperCase() + team.slice(1).toLowerCase() : team}
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
            {positions.map((pos, idx) => (
              <option key={typeof pos === "string" ? pos : idx} value={pos}>
                {typeof pos === "string" ? pos.charAt(0).toUpperCase() + pos.slice(1).toLowerCase() : pos}
              </option>
            ))}
          </select>
        </label>
      </div>

      {!isMyPick && (
        <p className="text-sm text-gray-500 italic">Waiting for your turn – you can still browse the player list.</p>
      )}

      <table className="w-full text-sm table-auto border-collapse">
        <thead className="bg-gray-100">
          <tr>
            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Name</th>
            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Team</th>
            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Pos</th>
            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase w-8">Watch</th>
            <th className="px-3 py-2" aria-hidden="true"></th>
          </tr>
        </thead>
        <tbody>
          {filteredPlayers.map((player) => (
            <tr
              key={player.id}
              className={`border-t transition ${draftedIds.includes(player.id) ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-50'}`}
            >
              <td
                className="px-3 py-2 font-medium text-gray-800 cursor-pointer hover:underline"
                onClick={() => onPlayerClick(player)}
              >
                {capitalizeWords(player.name)}
              </td>
              <td className="px-3 py-2 text-gray-600">
                {player.team ? player.team.charAt(0).toUpperCase() + player.team.slice(1).toLowerCase() : ""}
              </td>
              <td className="px-3 py-2 text-gray-600">
                {player.position ? player.position.charAt(0).toUpperCase() + player.position.slice(1).toLowerCase() : ""}
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
