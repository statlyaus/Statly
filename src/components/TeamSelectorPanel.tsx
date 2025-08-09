// src/components/TeamSelectorPanel.tsx
'use client';

import React from 'react';

export type TeamSelectorPanelProps = {
  teams: string[];
  leftTeam: string;
  rightTeam: string;
  onLeftChange: (team: string) => void;
  onRightChange: (team: string) => void;
  // Optional quick stats (by team name); keep it loose but typed
  summaries?: Record<
    string,
    { rank?: number; form?: string; points?: number } | undefined
  >;
};

export default function TeamSelectorPanel({
  teams,
  leftTeam,
  rightTeam,
  onLeftChange,
  onRightChange,
  summaries,
}: TeamSelectorPanelProps) {
  const leftId = 'team-left-select';
  const rightId = 'team-right-select';

  const LeftSummary = summaries?.[leftTeam];
  const RightSummary = summaries?.[rightTeam];

  return (
    <div className="px-4 pb-3">
      <div className="grid gap-3 md:grid-cols-2">
        {/* Your team */}
        <div>
          <label htmlFor={leftId} className="block text-sm text-gray-300 mb-1">
            Your team
          </label>
          <select
            id={leftId}
            className="w-full rounded-md bg-gray-800 border border-gray-700 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={leftTeam}
            onChange={(e) => onLeftChange(e.target.value)}
            aria-label="Select your team"
          >
            {teams.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>

          {/* optional quick stats */}
          {LeftSummary && (
            <TeamMiniSummary className="mt-2" {...LeftSummary} />
          )}
        </div>

        {/* Target team */}
        <div>
          <label htmlFor={rightId} className="block text-sm text-gray-300 mb-1">
            Target team
          </label>
          <select
            id={rightId}
            className="w-full rounded-md bg-gray-800 border border-gray-700 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={rightTeam}
            onChange={(e) => onRightChange(e.target.value)}
            aria-label="Select target team"
          >
            {teams.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>

          {RightSummary && (
            <TeamMiniSummary className="mt-2" {...RightSummary} />
          )}
        </div>
      </div>

      {/* Position filter chips can live below if you want */}
      {/* <PositionChips ... /> */}
    </div>
  );
}

function TeamMiniSummary({
  rank,
  form,
  points,
  className = '',
}: {
  rank?: number;
  form?: string;
  points?: number;
  className?: string;
}) {
  return (
    <div
      className={`flex items-center gap-3 text-xs text-gray-400 ${className}`}
      aria-live="polite"
    >
      {typeof rank === 'number' && (
        <span className="rounded bg-gray-800/70 px-2 py-1">Rank: {rank}</span>
      )}
      {typeof points === 'number' && (
        <span className="rounded bg-gray-800/70 px-2 py-1">Pts: {points}</span>
      )}
      {form && (
        <span className="rounded bg-gray-800/70 px-2 py-1">Form: {form}</span>
      )}
    </div>
  );
}