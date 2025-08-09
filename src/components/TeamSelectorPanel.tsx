// src/components/TeamSelectorPanel.tsx
'use client';

import React from 'react';

type Team = {
  id: string;
  name: string;
  logoUrl?: string;
  manager?: string;
  rank?: number;     // league rank
  points?: number;   // ladder/fantasy points
  form?: string;     // e.g. "W-W-L-W-L"
};

type Props = {
  teams: Team[];
  selectedMyTeam: string | null;
  selectedOpponentTeam: string | null;
  onChangeMyTeam: (teamId: string) => void;
  onChangeOpponentTeam: (teamId: string) => void;
};

export default function TeamSelectorPanel({
  teams,
  selectedMyTeam,
  selectedOpponentTeam,
  onChangeMyTeam,
  onChangeOpponentTeam,
}: Props) {
  const myTeam = selectedMyTeam ? teams.find(t => t.id === selectedMyTeam) : undefined;
  const oppTeam = selectedOpponentTeam ? teams.find(t => t.id === selectedOpponentTeam) : undefined;

  return (
    <section
      className="rounded-xl border border-gray-700 bg-gray-900 p-4"
      aria-label="Team selector"
    >
      <h2 className="text-lg font-semibold text-white mb-3">Teams</h2>

      {/* Your Team */}
      <div className="mb-4">
        <label
          htmlFor="teamSelectMy"
          className="block text-sm font-medium text-gray-300"
        >
          Your Team
        </label>
        <select
          id="teamSelectMy"
          value={selectedMyTeam ?? ''}
          onChange={(e) => onChangeMyTeam(e.target.value)}
          className="mt-1 block w-full rounded-md bg-gray-800 border border-gray-700 text-white p-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          aria-describedby="myTeamHelp"
        >
          <option value="" disabled>
            Select your team…
          </option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>

        {myTeam && (
          <TeamSummary
            team={myTeam}
            id="myTeamHelp"
            className="mt-3"
          />
        )}
      </div>

      {/* Opponent Team */}
      <div>
        <label
          htmlFor="teamSelectOpp"
          className="block text-sm font-medium text-gray-300"
        >
          Opponent Team
        </label>
        <select
          id="teamSelectOpp"
          value={selectedOpponentTeam ?? ''}
          onChange={(e) => onChangeOpponentTeam(e.target.value)}
          className="mt-1 block w-full rounded-md bg-gray-800 border border-gray-700 text-white p-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          aria-describedby="oppTeamHelp"
        >
          <option value="" disabled>
            Select opponent…
          </option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>

        {oppTeam && (
          <TeamSummary
            team={oppTeam}
            id="oppTeamHelp"
            className="mt-3"
          />
        )}
      </div>
    </section>
  );
}

function TeamSummary({
  team,
  id,
  className = '',
}: {
  team: Team;
  id: string;
  className?: string;
}) {
  return (
    <div id={id} className={`flex items-center gap-3 rounded-lg bg-gray-800 p-3 ${className}`}>
      {team.logoUrl ? (
        <img
          src={team.logoUrl}
          alt={`${team.name} logo`}
          className="h-8 w-8 rounded bg-gray-700 object-cover"
        />
      ) : (
        <div
          aria-hidden="true"
          className="h-8 w-8 rounded bg-gray-700 flex items-center justify-center text-xs text-gray-300"
        >
          {initials(team.name)}
        </div>
      )}

      <div className="min-w-0">
        <div className="text-white font-medium truncate">{team.name}</div>
        <div className="text-xs text-gray-400">
          {team.manager ? <>Mgr: {team.manager} • </> : null}
          {team.rank != null ? <>Rank: {team.rank} • </> : null}
          {team.points != null ? <>Pts: {team.points} • </> : null}
          {team.form ? <>Form: {team.form}</> : null}
        </div>
      </div>
    </div>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
    .slice(0, 3);
}