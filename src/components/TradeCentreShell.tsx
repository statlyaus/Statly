'use client';

import React, { useMemo, useState } from 'react';
import type { Player } from '@/types';
import TeamSelectorPanel from '@/components/TeamSelectorPanel';
import SideBySideTeams from '@/components/SideBySideTeams';
import OfferDock from '@/components/OfferDock';

export type TradeCentreShellProps = { initialPlayers: Player[] };

function unique<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

export default function TradeCentreShell({ initialPlayers }: TradeCentreShellProps) {
  const [tab, setTab] = useState<'market' | 'compare'>('compare');

  // teams derived from data
  const teams = useMemo(
    () => unique(initialPlayers.map((p) => String(p.team ?? 'Unknown'))).sort(),
    [initialPlayers]
  );

  // default selection (fall back defensively)
  const [leftTeam, setLeftTeam] = useState<string>(teams[0] ?? '');
  const [rightTeam, setRightTeam] = useState<string>(teams[1] ?? teams[0] ?? '');

  const leftPlayers = useMemo(
    () => initialPlayers.filter((p) => String(p.team) === leftTeam),
    [initialPlayers, leftTeam]
  );
  const rightPlayers = useMemo(
    () => initialPlayers.filter((p) => String(p.team) === rightTeam),
    [initialPlayers, rightTeam]
  );

  return (
    <div className="flex min-h-[calc(100vh-120px)] flex-col gap-6">
      {/* Banner */}
      <header className="rounded-2xl bg-gradient-to-r from-blue-800/40 via-indigo-700/30 to-purple-700/30 ring-1 ring-white/10 px-6 py-6 sm:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl sm:text-4xl font-bold text-white tracking-tight">Trade Centre</h1>
            <p className="mt-1 text-sm text-gray-300/90">
              Compare rosters, build offers, and send trades. Click stat headers (MG / Clr / G) to sort.
            </p>
          </div>

          {/* Tabs */}
          <div className="inline-flex rounded-lg bg-gray-800/70 p-1 ring-1 ring-white/10">
            <button
              onClick={() => setTab('compare')}
              className={`px-3 py-1.5 text-sm rounded-md transition ${
                tab === 'compare'
                  ? 'bg-white/10 text-white'
                  : 'text-gray-300 hover:text-white hover:bg-white/5'
              }`}
            >
              Compare & Trade
            </button>
            <button
              onClick={() => setTab('market')}
              className={`px-3 py-1.5 text-sm rounded-md transition ${
                tab === 'market'
                  ? 'bg-white/10 text-white'
                  : 'text-gray-300 hover:text-white hover:bg-white/5'
              }`}
            >
              Market (browse all)
            </button>
          </div>
        </div>

        {/* Team selectors */}
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <div>
            <label htmlFor="your-team" className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-400">
              Your team
            </label>
            <TeamSelectorPanel
              id="your-team"
              teams={teams}
              leftTeam={leftTeam}
              rightTeam={rightTeam}
              onLeftChange={setLeftTeam}
              onRightChange={setRightTeam}
              compact // just styles inside that component; harmless if ignored
            />
          </div>
          <div>
            <label htmlFor="target-team" className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-400">
              Target team
            </label>
            {/* Reuse the same component – right selector is controlled by props */}
            <TeamSelectorPanel
              id="target-team"
              teams={teams}
              leftTeam={leftTeam}
              rightTeam={rightTeam}
              onLeftChange={setLeftTeam}
              onRightChange={setRightTeam}
              compact
            />
          </div>
        </div>
      </header>

      {/* Content → offer rail */}
      <div className="grid lg:grid-cols-[1fr_360px] gap-8">
        {/* LEFT */}
        <div className="min-h-0">
          {tab === 'compare' ? (
            <SideBySideTeams
              leftTitle={leftTeam || 'Team A'}
              rightTitle={rightTeam || 'Team B'}
              leftPlayers={leftPlayers}
              rightPlayers={rightPlayers}
            />
          ) : (
            // If you have a Market grid component, drop it here.
            // For now, re-use comparison view; you can swap later.
            <SideBySideTeams
              leftTitle={leftTeam || 'Team A'}
              rightTitle={rightTeam || 'Team B'}
              leftPlayers={leftPlayers}
              rightPlayers={rightPlayers}
            />
          )}
        </div>

        {/* RIGHT */}
        <OfferDock />
      </div>
    </div>
  );
}