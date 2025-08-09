// src/components/TradeCentreShell.tsx
'use client';

import { useMemo, useState } from 'react';
import type { Player } from '@/types';
import TradeCentreClient from '@/components/TradeCentreClient';
import TeamSelectorPanel from '@/components/TeamSelectorPanel';
import SideBySideTeams from '@/components/SideBySideTeams';
import OfferDock from '@/components/OfferDock';

export type TradeCentreShellProps = { initialPlayers: Player[] };

function unique<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

export default function TradeCentreShell({ initialPlayers }: TradeCentreShellProps) {
  const [tab, setTab] = useState<'market' | 'compare'>('compare');

  // All AFL clubs found in the dataset
  const teams = useMemo(
    () => unique(initialPlayers.map((p) => String(p.team ?? 'Unknown'))).sort(),
    [initialPlayers]
  );

  // Default team selections
  const [leftTeam, setLeftTeam] = useState<string>(teams[0] ?? '');
  const [rightTeam, setRightTeam] = useState<string>(teams[1] ?? teams[0] ?? '');

  // Players filtered by selected teams
  const leftPlayers = useMemo(
    () => initialPlayers.filter((p) => String(p.team) === leftTeam),
    [initialPlayers, leftTeam]
  );
  const rightPlayers = useMemo(
    () => initialPlayers.filter((p) => String(p.team) === rightTeam),
    [initialPlayers, rightTeam]
  );

  return (
    <div
      className="
        h-[calc(100vh-120px)]  /* adjust if your top nav is taller/shorter */
        grid lg:grid-cols-[1fr_360px] gap-6
      "
    >
      {/* LEFT COLUMN: tabs + content */}
      <div className="min-h-0 flex flex-col">
        {/* Sticky header: tabs (+ team selector when in compare) */}
        <div className="sticky top-0 z-10 bg-gray-900/90 backdrop-blur border-b border-gray-800">
          {/* Tabs */}
          <div className="mx-auto max-w-7xl px-4 pt-3 pb-2 flex items-center gap-2">
            <button
              className={`px-3 py-1 rounded ${
                tab === 'market'
                  ? 'bg-gray-800 text-white'
                  : 'text-gray-300 hover:bg-gray-800/60'
              }`}
              onClick={() => setTab('market')}
              aria-pressed={tab === 'market'}
            >
              Market
            </button>
            <button
              className={`px-3 py-1 rounded ${
                tab === 'compare'
                  ? 'bg-gray-800 text-white'
                  : 'text-gray-300 hover:bg-gray-800/60'
              }`}
              onClick={() => setTab('compare')}
              aria-pressed={tab === 'compare'}
            >
              Compare &amp; Trade
            </button>
          </div>

          {/* When comparing, keep the team selector visible in the sticky header */}
          {tab === 'compare' && (
            <div className="mx-auto max-w-7xl">
              <TeamSelectorPanel
                teams={teams}
                leftTeam={leftTeam}
                rightTeam={rightTeam}
                onLeftChange={setLeftTeam}
                onRightChange={setRightTeam}
              />
            </div>
          )}
        </div>

        {/* Scrollable content area */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-7xl p-4">
            {tab === 'market' ? (
              <TradeCentreClient initialPlayers={initialPlayers} />
            ) : (
              <SideBySideTeams
                leftTitle={leftTeam || 'Team A'}
                rightTitle={rightTeam || 'Team B'}
                leftPlayers={leftPlayers}
                rightPlayers={rightPlayers}
              />
            )}
          </div>
        </div>
      </div>

      {/* RIGHT COLUMN: Offer dock only in Compare tab (sticky with its own scroll) */}
      {tab === 'compare' && <OfferDock />}
    </div>
  );
}