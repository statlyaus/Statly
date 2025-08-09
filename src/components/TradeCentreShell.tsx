'use client';

import { useMemo, useState } from 'react';
import type { Player } from '@/types';
import TeamSelectorPanel from '@/components/TeamSelectorPanel';
import SideBySideTeams from '@/components/SideBySideTeams';
import OfferDock from '@/components/OfferDock';

export type TradeCentreShellProps = { initialPlayers: Player[] };

function uniq<T>(xs: T[]): T[] {
  return Array.from(new Set(xs));
}

export default function TradeCentreShell({ initialPlayers }: TradeCentreShellProps) {
  const teams = useMemo(
    () => uniq(initialPlayers.map((p) => String(p.team ?? 'Unknown'))).sort(),
    [initialPlayers]
  );

  const [tab, setTab] = useState<'compare' | 'market'>('compare');
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
    <div className="mx-auto max-w-[1400px] lg:h-[calc(100vh-112px)] min-h-[calc(100vh-112px)] px-4">
      {/* Sticky header tools */}
      <div className="sticky top-0 z-20 bg-gray-900/95 backdrop-blur supports-[backdrop-filter]:bg-gray-900/75 border-b border-gray-800">
        <div className="flex items-center justify-between gap-3 py-3">
          {/* Segmented control */}
          <div className="inline-flex rounded-lg border border-gray-800 p-1">
            <button
              className={`px-3 py-1.5 text-sm rounded-md ${
                tab === 'compare'
                  ? 'bg-gray-200 text-gray-900'
                  : 'text-gray-300 hover:bg-gray-800/60'
              }`}
              onClick={() => setTab('compare')}
            >
              Compare & Trade
            </button>
            <button
              className={`px-3 py-1.5 text-sm rounded-md ${
                tab === 'market'
                  ? 'bg-gray-200 text-gray-900'
                  : 'text-gray-300 hover:bg-gray-800/60'
              }`}
              onClick={() => setTab('market')}
            >
              Market (browse all)
            </button>
          </div>

          <div className="hidden lg:block text-sm text-gray-400">
            Tip: add players to the offer on the right.
          </div>
        </div>

        {/* Team pickers always visible on compare tab */}
        {tab === 'compare' && (
          <div className="pb-3">
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

      {/* Content grid */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] h-[calc(100%-64px)]">
        {/* Left column: scrollable content */}
        <div className="min-h-0 overflow-y-auto py-4">
          {tab === 'compare' ? (
            <SideBySideTeams
              leftTitle={leftTeam || 'Team A'}
              rightTitle={rightTeam || 'Team B'}
              leftPlayers={leftPlayers}
              rightPlayers={rightPlayers}
            />
          ) : (
            // For now, reuse compare UI; you can pipe your market client in here
            <SideBySideTeams
              leftTitle="All players A–M"
              rightTitle="All players N–Z"
              leftPlayers={initialPlayers.slice(0, Math.ceil(initialPlayers.length / 2))}
              rightPlayers={initialPlayers.slice(Math.ceil(initialPlayers.length / 2))}
            />
          )}
        </div>

        {/* Right column: sticky dock */}
        <div className="hidden lg:block">
          <div className="sticky top-4">
            <OfferDock />
          </div>
        </div>
      </div>
    </div>
  );
}