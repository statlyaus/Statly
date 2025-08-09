'use client';

import { useMemo, useState } from 'react';
import type { Player } from '@/types';
import TeamSelectorPanel from '@/components/TeamSelectorPanel';
import OfferDock from '@/components/OfferDock';
import { Column as TeamColumn } from '@/components/SideBySideTeams';

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
    <div className="space-y-6">
      {/* Banner */}
      <header className="rounded-2xl bg-gradient-to-r from-indigo-500/20 via-purple-500/20 to-pink-500/20 p-6 ring-1 ring-white/10">
        <div className="mb-4 flex items-center justify-between gap-4">
          <h1 className="text-4xl font-extrabold tracking-tight text-white">Trade Centre</h1>
          <div className="flex gap-2">
            <button
              className={`rounded-md px-3 py-1.5 text-sm ${
                tab === 'compare'
                  ? 'bg-white/10 text-white ring-1 ring-white/20'
                  : 'bg-white/5 text-gray-300 hover:bg-white/10'
              }`}
              onClick={() => setTab('compare')}
            >
              Compare & Trade
            </button>
            <button
              className={`rounded-md px-3 py-1.5 text-sm ${
                tab === 'market'
                  ? 'bg-white/10 text-white ring-1 ring-white/20'
                  : 'bg-white/5 text-gray-300 hover:bg-white/10'
              }`}
              onClick={() => setTab('market')}
            >
              Market (browse all)
            </button>
          </div>
        </div>

        <p className="text-sm text-gray-300 mb-4">
          Compare rosters, build offers, and send trades. Click stat headers (MG / Clr / G) to sort.
        </p>

        {/* single team selector */}
        <TeamSelectorPanel
          teams={teams}
          leftTeam={leftTeam}
          rightTeam={rightTeam}
          onLeftChange={setLeftTeam}
          onRightChange={setRightTeam}
          compact={false}
        />
      </header>

      <div className="grid lg:grid-cols-[1fr_360px] gap-8">
        <div className="min-h-0 space-y-4">
          <div className="grid gap-6 lg:grid-cols-2">
            <TeamColumn title={leftTeam || 'Team A'} side="outgoing" players={leftPlayers} />
            <TeamColumn title={rightTeam || 'Team B'} side="incoming" players={rightPlayers} />
          </div>
        </div>

        <OfferDock />
      </div>
    </div>
  );
}