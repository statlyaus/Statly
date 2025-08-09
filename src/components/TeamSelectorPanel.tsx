// src/components/TeamSelectorPanel.tsx
'use client';

import React from 'react';

export interface TeamSelectorPanelProps {
  id?: string;                       // <-- add this
  teams: string[];
  leftTeam: string;
  rightTeam: string;
  onLeftChange: (team: string) => void;
  onRightChange: (team: string) => void;
  compact?: boolean;
}

export default function TeamSelectorPanel({
  id,
  teams,
  leftTeam,
  rightTeam,
  onLeftChange,
  onRightChange,
  compact = false,
}: TeamSelectorPanelProps) {
  const cls =
    'w-full rounded-md bg-gray-900 text-white ring-1 ring-white/10 px-3 py-2' +
    (compact ? ' text-sm' : '');

  return (
    <div id={id} className="grid grid-cols-2 gap-3">   {/* <-- use id */}
      <label className="block">
        <span className="mb-1 block text-xs text-gray-400">Your team</span>
        <select
          className={cls}
          value={leftTeam}
          onChange={(e) => onLeftChange(e.target.value)}
          aria-label="Your team"
        >
          {teams.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="mb-1 block text-xs text-gray-400">Target team</span>
        <select
          className={cls}
          value={rightTeam}
          onChange={(e) => onRightChange(e.target.value)}
          aria-label="Target team"
        >
          {teams.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}