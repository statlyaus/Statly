'use client';

import React from 'react';
import type { Team as BaseTeam } from '@/types';

interface Team extends BaseTeam {
  name: string;
  manager?: string;
  logoUrl?: string; // optional – falls back to initials avatar
}

export type TradeCentreHeaderProps = {
  /** If you don’t have rich team objects yet, you can pass simple names – we’ll map to Team */
  teams: Array<string | Team>;
  leftTeam: string;
  rightTeam: string;
  onLeftChange: (team: string) => void;
  onRightChange: (team: string) => void;

  /** Tabs */
  activeTab: 'compare' | 'market';
  onTabChange: (tab: 'compare' | 'market') => void;
};

function toTeam(x: string | Team): Team {
  if (typeof x === 'string') {
    return { id: x, name: x };
  }
  return x;
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map(p => p[0]?.toUpperCase() ?? '').join('');
}

export default function TradeCentreHeader({
  teams,
  leftTeam,
  rightTeam,
  onLeftChange,
  onRightChange,
  activeTab,
  onTabChange,
}: TradeCentreHeaderProps) {
  const opts = teams.map(toTeam);

  return (
    <header className="relative -mx-6 -mt-6 mb-6">
      {/* Hero gradient */}
      <div
        className="bg-gradient-to-br from-sky-900/60 via-indigo-900/50 to-fuchsia-900/40
                    border-b border-white/10"
      >
        <div className="mx-auto max-w-7xl px-6 pt-10 pb-6">
          {/* Title + subtitle */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white">
                Trade Centre
              </h1>
              <p className="mt-1 text-sm sm:text-base text-white/70">
                Compare rosters, build offers, and send clean proposals—fast.
              </p>
            </div>

            {/* Tabs */}
            <div
              role="tablist"
              aria-label="Trade Centre views"
              className="inline-flex rounded-xl bg-white/5 p-1 ring-1 ring-white/10 backdrop-blur"
            >
              <button
                role="tab"
                aria-selected={activeTab === 'compare'}
                onClick={() => onTabChange('compare')}
                className={`px-3 sm:px-4 py-2 rounded-lg text-sm font-medium transition
                            ${activeTab === 'compare'
                              ? 'bg-white/90 text-gray-900 shadow'
                              : 'text-white/80 hover:text-white hover:bg-white/10'
                            }`}
              >
                Compare & Trade
              </button>
              <button
                role="tab"
                aria-selected={activeTab === 'market'}
                onClick={() => onTabChange('market')}
                className={`ml-1 px-3 sm:px-4 py-2 rounded-lg text-sm font-medium transition
                            ${activeTab === 'market'
                              ? 'bg-white/90 text-gray-900 shadow'
                              : 'text-white/80 hover:text-white hover:bg-white/10'
                            }`}
              >
                Market (browse all)
              </button>
            </div>
          </div>

          {/* Team selectors */}
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <TeamCard
              title="Your team"
              value={leftTeam}
              onChange={onLeftChange}
              options={opts}
              side="left"
            />
            <TeamCard
              title="Target team"
              value={rightTeam}
              onChange={onRightChange}
              options={opts}
              side="right"
            />
          </div>
        </div>
      </div>

      {/* Tip rail */}
      <div className="bg-gray-900/60 backdrop-blur supports-[backdrop-filter]:bg-gray-900/40 text-white/70 text-xs sm:text-sm border-b border-white/10">
        <div className="mx-auto max-w-7xl px-6 py-2">
          Tip: Pick teams, then click <span className="text-white">Add In</span> or{' '}
          <span className="text-white">Add Out</span> on a player to build an offer. The
          offer lives in the panel on the right.
        </div>
      </div>
    </header>
  );
}

function TeamCard({
  title,
  value,
  onChange,
  options,
  side,
}: {
  title: string;
  value: string;
  onChange: (team: string) => void;
  options: Team[];
  side: 'left' | 'right';
}) {
  const selected = options.find(o => o.name === value) ?? options[0];

  return (
    <div className="rounded-2xl bg-white/5 ring-1 ring-white/10 p-4 sm:p-5">
      <div className="flex items-center gap-3">
        <Avatar team={selected} />
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wider text-white/60">{title}</div>
          <div className="text-lg sm:text-xl font-semibold text-white truncate">
            {selected?.name ?? '—'}
          </div>
          {selected?.manager && (
            <div className="text-xs text-white/60 truncate">Mgr: {selected.manager}</div>
          )}
        </div>
      </div>

      {/* Selector */}
      <label className="mt-4 block text-xs text-white/60" htmlFor={`team-${side}`}>
        Select {title.toLowerCase()}
      </label>
      <div className="mt-1 relative">
        <select
          id={`team-${side}`}
          value={value}
          onChange={e => onChange(e.target.value)}
          className="w-full appearance-none rounded-xl bg-gray-900/70 text-white
                     ring-1 ring-white/10 focus:ring-2 focus:ring-sky-400
                     px-3 py-2 pr-9 text-sm"
          aria-label={title}
        >
          {options.map(o => (
            <option key={o.id} value={o.name}>
              {o.name}
            </option>
          ))}
        </select>
        {/* chevron */}
        <svg
          className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-white/60"
          viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 10.173l3.71-2.943a.75.75 0 11.94 1.166l-4.24 3.363a.75.75 0 01-.94 0L5.25 8.396a.75.75 0 01-.02-1.186z"
            clipRule="evenodd"
          />
        </svg>
      </div>
    </div>
  );
}

function Avatar({ team }: { team: Team }) {
  if (team.logoUrl) {
    return (
      <img
        src={team.logoUrl}
        alt=""
        className="h-10 w-10 sm:h-12 sm:w-12 rounded-xl object-cover ring-1 ring-white/10"
      />
    );
  }
  return (
    <div className="h-10 w-10 sm:h-12 sm:w-12 rounded-xl bg-white/10 ring-1 ring-white/10 grid place-items-center">
      <span className="text-white font-semibold">{initials(team.name)}</span>
    </div>
  );
}