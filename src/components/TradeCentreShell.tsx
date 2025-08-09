// src/components/TradeCentreShell.tsx
'use client';

import { useState, useMemo } from 'react';
import TeamSelectorPanel from '@/components/TeamSelectorPanel';
import SideBySideTeams from '@/components/SideBySideTeams';
import OfferDock from '@/components/OfferDock';
import type { Player } from '@/types';

type TeamLite = {
  id: string;
  name: string;
  logoUrl?: string;
  manager?: string;
  rank?: number;
  points?: number;
  form?: string;
};

type Props = {
  teams: TeamLite[];          // list of league teams
  playersByTeam: Record<string, Player[]>; // map teamId -> roster
};

export default function TradeCentreShell({ teams, playersByTeam }: Props) {
  // Default to first as "my team" and second as opponent (you can wire from auth later)
  const [myTeam, setMyTeam] = useState<string>(teams[0]?.id ?? '');
  const [oppTeam, setOppTeam] = useState<string>(teams[1]?.id ?? '');

  const myRoster = useMemo(() => playersByTeam[myTeam] ?? [], [playersByTeam, myTeam]);
  const oppRoster = useMemo(() => playersByTeam[oppTeam] ?? [], [playersByTeam, oppTeam]);

  return (
    <div className="grid lg:grid-cols-[18rem_1fr_22rem] gap-6">
      {/* Left: team selection & summaries */}
      <TeamSelectorPanel
        teams={teams}
        selectedMyTeam={myTeam}
        selectedOpponentTeam={oppTeam}
        onChangeMyTeam={setMyTeam}
        onChangeOpponentTeam={setOppTeam}
      />

      {/* Center: side-by-side roster comparison */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-white">Compare rosters</h2>
          {/* Optional quick filters (position chips, health, keeper, etc.) */}
        </div>
        <SideBySideTeams
          leftTitle="Your Team"
          rightTitle="Opponent"
          leftPlayers={myRoster}
          rightPlayers={oppRoster}
        />
      </div>

      {/* Right: offer dock (basket) */}
      <OfferDock />
    </div>
  );
}