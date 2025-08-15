'use client';

import { useMemo } from 'react';
import type { Player } from '../types/players';

type PlayerFiltersProps = {
  players: Player[];
  selectedTeam: string;
  setSelectedTeam: (team: string) => void;
  selectedPosition: string;
  setSelectedPosition: (position: string) => void;
};

const PlayerFilters = ({
  players,
  selectedTeam,
  setSelectedTeam,
  selectedPosition,
  setSelectedPosition,
}: PlayerFiltersProps) => {
  const teams = useMemo(() => ['All', ...new Set(players.map((p) => p.team))], [players]);
  const positions = useMemo(() => ['All', 'MID', 'FWD', 'DEF', 'RUC'], []);

  return (
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
  );
};

export default PlayerFilters;
