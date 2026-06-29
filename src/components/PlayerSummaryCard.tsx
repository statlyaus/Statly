// src/components/PlayerSummaryCard.tsx
'use client';

import Image from 'next/image';
import React from 'react';
import { getTeamLogo } from '@/lib/teamLogos';
import { capitalizeWords } from '@/lib/utils';
import type { Player } from '../types/players';

type Props = {
  player: Player;
};

const statLabels: Record<string, string> = {
  MG: 'Metres Gained',
  CP: 'Cont. Poss',
  UP: 'Uncont. Poss',
  DE: 'Disp. Eff %',
  ED: 'Effective Disposals',
  CL: 'Clangers',
  CCL: 'Centre Clearances',
  SCL: 'Stoppage Clearances',
  SI: 'Score Involvements',
  T5: 'Tackles I50',
  MI5: 'Marks I50',
  ITC: 'Intercepts',
  BO: 'Bounces',
  GA: 'Goal Assists',
  TOG: 'Time on Ground %',
};

const PlayerSummaryCard: React.FC<Props> = ({ player }) => {
  const { name, team, position, injury, games, summary = {} } = player;
  const summaryStats = summary as Record<string, number>;
  const displayName = capitalizeWords(name) || 'Unknown player';
  const displayPosition = position ? String(position) : '-';
  const teamLogo = getTeamLogo(team || '');

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
      <div className="bg-foreground px-5 py-6 text-background sm:px-7">
        <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
          <div className="flex min-w-0 gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border border-background/15 bg-background p-2 shadow-sm">
              <Image
                src={teamLogo}
                alt={`${team || 'AFL'} logo`}
                width={48}
                height={48}
                className="h-12 w-12 object-contain"
                style={{ width: 'auto', height: 'auto' }}
                unoptimized={teamLogo.endsWith('.svg')}
              />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-background/70">
                Player profile
              </p>
              <h1 className="mt-2 break-words text-3xl font-bold leading-tight sm:text-4xl">
                {displayName}
              </h1>
              <div className="mt-4 flex flex-wrap gap-2">
                {team && (
                  <span className="rounded-full border border-background/20 bg-background/10 px-3 py-1 text-sm font-medium text-background">
                    {team}
                  </span>
                )}
                {position && (
                  <span className="rounded-full border border-background/20 bg-background/10 px-3 py-1 text-sm font-medium text-background">
                    {position}
                  </span>
                )}
                {injury && (
                  <span className="rounded-full border border-destructive/20 bg-destructive/15 px-3 py-1 text-sm font-semibold text-background">
                    Injured
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="grid min-w-0 grid-cols-2 gap-3 sm:min-w-56">
            <div className="rounded-lg border border-background/15 bg-background/10 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-background/70">
                Games
              </div>
              <div className="mt-1 text-3xl font-bold">{games ?? '-'}</div>
            </div>
            <div className="rounded-lg border border-background/15 bg-background/10 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-background/70">
                Position
              </div>
              <div className="mt-1 text-2xl font-bold">{displayPosition}</div>
            </div>
          </div>
        </div>
      </div>

      {Object.entries(statLabels).some(([key]) => typeof summaryStats[key] === 'number') && (
        <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-3 lg:grid-cols-6">
          {Object.entries(statLabels).map(([key, label]) =>
            typeof summaryStats[key] === 'number' ? (
              <div key={key} className="bg-card px-4 py-3">
                <div className="text-xs font-medium text-muted-foreground">{label}</div>
                <div className="mt-1 text-lg font-semibold text-card-foreground">
                  {summaryStats[key]}
                </div>
              </div>
            ) : null
          )}
        </div>
      )}
    </section>
  );
};

export default PlayerSummaryCard;
