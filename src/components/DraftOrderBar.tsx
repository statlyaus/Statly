import React from 'react';
import type { Team } from '../types/players';

interface DraftOrderBarProps {
  teams?: Team[];
  currentPickIndex: number;
  myTeamId?: string;
}

const DraftOrderBar = ({ teams = [], currentPickIndex, myTeamId }: DraftOrderBarProps) => {
  return (
    <div className="flex items-center space-x-2 overflow-x-auto p-2 bg-gray-100 rounded shadow border-2 border-blue-500">
      {teams.map((team, index) => {
        const isCurrent = index === currentPickIndex;
        const isMyTeam = team.id === myTeamId;
        const displayName = team.name || team.id; // fall back to id so a label is always shown; aim to provide names consistently

        return (
          <div
            key={team.id}
            title={displayName}
            className={`flex items-center justify-center px-3 py-1 rounded text-xs font-medium border transition
              ${isCurrent ? 'bg-red-500 text-white animate-pulse' : 'bg-white text-gray-700'}
              ${isMyTeam ? 'ring-2 ring-indigo-500' : ''}`}
          >
            {displayName}
          </div>
        );
      })}
    </div>
  );
};

export default DraftOrderBar;
