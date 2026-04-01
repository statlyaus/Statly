// src/components/TeamSelectorPanel.tsx
'use client';

import { UISelect } from '@/components/ui';

export interface TeamSelectorPanelProps {
  id?: string; // <-- add this
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
  const cls = 'bg-gray-900 text-white ring-1 ring-white/10' + (compact ? ' text-sm' : '');

  return (
    <div id={id} className="grid grid-cols-2 gap-3">
      <label className="block">
        <span className="mb-1 block text-xs text-gray-400">Your team</span>
        <UISelect
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
        </UISelect>
      </label>
      <label className="block">
        <span className="mb-1 block text-xs text-gray-400">Target team</span>
        <UISelect
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
        </UISelect>
      </label>
    </div>
  );
}
