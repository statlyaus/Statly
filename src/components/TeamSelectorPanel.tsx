'use client';

import React from 'react';

type Props = {
  /** List of team names, e.g. ["Carlton","Sydney","GWS"] */
  teams: string[];
  /** Currently selected left team (your team) */
  leftTeam: string;
  /** Currently selected right team (target team) */
  rightTeam: string;
  onLeftChange: (team: string) => void;
  onRightChange: (team: string) => void;
};

export default function TeamSelectorPanel({
  teams,
  leftTeam,
  rightTeam,
  onLeftChange,
  onRightChange,
}: Props) {
  const leftId = 'team-left';
  const rightId = 'team-right';

  return (
    <section
      className="rounded-lg border border-gray-700 bg-gray-900 p-4"
      aria-label="Team selector"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={leftId} className="block text-sm text-gray-300 mb-1">
            Your team
          </label>
          <select
            id={leftId}
            className="w-full rounded bg-gray-800 border border-gray-700 p-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={leftTeam}
            onChange={(e) => onLeftChange(e.target.value)}
          >
            {teams.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor={rightId} className="block text-sm text-gray-300 mb-1">
            Target team
          </label>
          <select
            id={rightId}
            className="w-full rounded bg-gray-800 border border-gray-700 p-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={rightTeam}
            onChange={(e) => onRightChange(e.target.value)}
          >
            {teams.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
      </div>
    </section>
  );
}