'use client';

import { useMemo, useState } from 'react';
import type { Player } from '@/types';
import TradeCentreClient from '@/components/TradeCentreClient';
import TeamSelectorPanel from '@/components/TeamSelectorPanel';
import SideBySideTeams from '@/components/SideBySideTeams';
import OfferDock from '@/components/OfferDock';

type Props = { initialPlayers: Player[] };

function unique<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

export default function TradeCentreShell({ initialPlayers }: Props) {
  const [tab, setTab] = useState<'market' | 'compare'>('compare');

  // derive available AFL clubs from dataset
  const teams = useMemo(
    () => unique(initialPlayers.map((p) => String(p.team ?? 'Unknown'))).sort(),
    [initialPlayers]
  );

  // pick defaults
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
    <div className="space-y-4">
      {/* tabs */}
      <div className="flex items-center gap-2 border-b border-gray-800 pb-2">
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

      {tab === 'market' ? (
        // old grid lives as the Market tab
        <TradeCentreClient initialPlayers={initialPlayers} />
      ) : (
        // new experience
        <div className="grid lg:grid-cols-[1fr_18rem] gap-6">
          <div className="space-y-4">
            <TeamSelectorPanel
              teams={teams}
              leftTeam={leftTeam}
              rightTeam={rightTeam}
              onLeftChange={setLeftTeam}
              onRightChange={setRightTeam}
            />

            <SideBySideTeams
              leftTitle={leftTeam || 'Team A'}
              rightTitle={rightTeam || 'Team B'}
              leftPlayers={leftPlayers}
              rightPlayers={rightPlayers}
            />
          </div>

          <OfferDock />
        </div>
      )}
    </div>
  );
}