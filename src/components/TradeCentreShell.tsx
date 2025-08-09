'use client';

import React, { useMemo, useState } from 'react';
import type { Player } from '@/types';
import TradeCentreHeader from '@/components/TradeCentreHeader';
import SideBySideTeams from '@/components/SideBySideTeams';
import TradeCentreClient from '@/components/TradeCentreClient';
import OfferDock from '@/components/OfferDock';

export type TradeCentreShellProps = { initialPlayers: Player[] };

function unique<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

export default function TradeCentreShell({ initialPlayers }: TradeCentreShellProps) {
  const [tab, setTab] = useState<'compare' | 'market'>('compare');

  // derive team list from players (use plain strings now; header supports richer objects later)
  const teams = useMemo(
    () => unique(initialPlayers.map(p => String(p.team ?? 'Unknown'))).sort(),
    [initialPlayers]
  );

  const [leftTeam, setLeftTeam] = useState<string>(teams[0] ?? '');
  const [rightTeam, setRightTeam] = useState<string>(teams[1] ?? teams[0] ?? '');

  const leftPlayers = useMemo(
    () => initialPlayers.filter(p => String(p.team) === leftTeam),
    [initialPlayers, leftTeam]
  );
  const rightPlayers = useMemo(
    () => initialPlayers.filter(p => String(p.team) === rightTeam),
    [initialPlayers, rightTeam]
  );

  return (
    <div className="mx-auto max-w-7xl p-6">
      {/* HERO + SELECTORS */}
      <TradeCentreHeader
        teams={teams}
        leftTeam={leftTeam}
        rightTeam={rightTeam}
        onLeftChange={setLeftTeam}
        onRightChange={setRightTeam}
        activeTab={tab}
        onTabChange={setTab}
      />

      {/* MAIN LAYOUT: two columns, offer dock pinned on the right */}
      <div className="grid lg:grid-cols-[1fr_340px] gap-6">
        <div className="min-h-0 flex flex-col">
          {/* Content area */}
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

        {/* Offer dock sticky */}
        <OfferDock />
      </div>
    </div>
  );
}