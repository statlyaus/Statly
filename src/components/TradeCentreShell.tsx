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

  const teams = useMemo(
    () => unique(initialPlayers.map((p) => String(p.team ?? 'Unknown'))).sort(),
    [initialPlayers]
  );

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
    <div className="relative min-h-[calc(100vh-112px)] lg:h-[calc(100vh-112px)] overflow-hidden grid lg:grid-cols-[minmax(0,1fr)_380px] gap-6">
      {/* LEFT COLUMN */}
      <div className="min-h-0 flex flex-col overflow-hidden">
        {/* Sticky controls */}
        <div className="sticky top-0 z-10 bg-gray-900/95 backdrop-blur border-b border-gray-800">
          <div className="px-4 pt-3 flex items-center gap-2">
            <button
              className={`px-3 py-1 rounded ${
                tab === 'market' ? 'bg-gray-800 text-white' : 'text-gray-300 hover:bg-gray-800/60'
              }`}
              onClick={() => setTab('market')}
            >
              Market
            </button>
            <button
              className={`px-3 py-1 rounded ${
                tab === 'compare' ? 'bg-gray-800 text-white' : 'text-gray-300 hover:bg-gray-800/60'
              }`}
              onClick={() => setTab('compare')}
            >
              Compare & Trade
            </button>
          </div>

          {tab === 'compare' && (
            <div className="px-4 pb-3">
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
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
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

      {/* RIGHT COLUMN (sticky dock) */}
      <div className="hidden lg:block">
        <div className="sticky top-4">
          <OfferDock />
        </div>
      </div>
    </div>
  );
}