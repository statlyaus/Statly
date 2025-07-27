// src/components/DraftOrderBar.tsx
import React from 'react';
import type { Team } from '../types';

type Props = {
  draftOrder: Team[];
  currentPickIndex: number;
  myTeam: string;
  totalTeams: number;
  currentRound: number;
};

const DraftOrderBar = ({
  draftOrder,
  currentPickIndex,
  myTeam,
  totalTeams,
  currentRound,
}: Props) => {
  return (
    <div className="w-full pl-8 pr-6 py-3 border-b border-gray-200 bg-white">
      <div className="flex items-center justify-start gap-x-8">
        <div className="text-xl font-bold text-gray-800 min-w-[80px]">Round {currentRound}</div>
        <div className="w-px h-6 bg-gray-300" />
        <ul className="flex items-end space-x-2">
          {(() => {
            const start = Math.max(0, Math.min(currentPickIndex - 7, draftOrder.length - 15));
            const end = Math.min(draftOrder.length, start + 15);
            return draftOrder
              .map((team, i) => ({ team, i, round: Math.floor(i / totalTeams) + 1 }))
              .slice(start, end)
              .reduce<JSX.Element[]>((acc, { team, i, round }, idx, arr) => {
                const isCurrent = i === currentPickIndex;
                const isMyTeam = team.name === myTeam;
                const prevRound = idx > 0 ? arr[idx - 1].round : round;

                if (round !== prevRound) {
                  acc.push(
                    <li className="flex items-center px-2 text-xs text-gray-400" key={`divider-${i}`}>
                      ─ Round {round} ─
                    </li>
                  );
                }

                const baseClasses =
                  'relative min-w-[96px] px-4 py-3 rounded text-center text-base transition-all duration-200';

                const currentPickClasses = 'bg-red-500 text-white scale-105 shadow-md animate-pulse';
                const myTeamClasses = 'bg-blue-50 border border-blue-500 text-blue-700 font-semibold';
                const normalClasses = 'bg-white border border-gray-200 opacity-70';

                acc.push(
                  <li key={`${team.id}-${i}`}>
                    <div
                      className={`${baseClasses} ${
                        isCurrent
                          ? currentPickClasses
                          : isMyTeam
                          ? myTeamClasses
                          : normalClasses
                      }`}
                    >
                      {isMyTeam && !isCurrent && (
                        <span className="absolute top-0 right-0 mt-1 mr-1 bg-blue-500 text-white text-[10px] px-1 rounded-full">
                          You
                        </span>
                      )}
                      <p>{team.name}</p>
                      <p className="text-xs text-gray-600">Pick {i + 1}</p>
                    </div>
                  </li>
                );
                return acc;
              }, []);
          })()}
        </ul>
      </div>
    </div>
  );
};

export default DraftOrderBar;