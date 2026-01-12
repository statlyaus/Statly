// src/components/PlayerSummaryCard.tsx
'use client';

import React from 'react';

import { capitalizeWords } from '@/lib/utils';

import type { Player } from '../types/players';

type Props = {
  player: Player;
};

type StatItem = { label: string; keys: string[] };

const PlayerSummaryCard: React.FC<Props> = ({ player }) => {
  const { name, team, position, injury, games, stats = {}, avg, ownership } = player;
  const statsRecord = stats as Record<string, number | string | null | undefined>;

  const getStatValue = (keys: string[]) => {
    for (const key of keys) {
      const direct = statsRecord[key];
      if (typeof direct === 'number') return direct;
      if (typeof direct === 'string' && direct.trim() !== '' && !Number.isNaN(Number(direct))) {
        return Number(direct);
      }
      const fallback = (player as Record<string, unknown>)[key];
      if (typeof fallback === 'number') return fallback;
    }
    return undefined;
  };

  const primaryStats: StatItem[] = [
    { label: 'Goals', keys: ['goals'] },
    { label: 'Kicks', keys: ['kicks'] },
    { label: 'Handballs', keys: ['handballs'] },
    { label: 'Marks', keys: ['marks'] },
    { label: 'Tackles', keys: ['tackles'] },
    { label: 'Hitouts', keys: ['hitouts'] },
    { label: 'Inside 50s', keys: ['inside50s'] },
    { label: 'Rebound 50s', keys: ['rebound50s'] },
    { label: 'Cont. Poss', keys: ['contestedPossessions'] },
  ];

  const secondaryStats: StatItem[] = [
    { label: 'Clearances', keys: ['clearances'] },
    { label: 'Uncont. Poss', keys: ['uncontestedPossessions'] },
    { label: 'Effective Disposals', keys: ['effectiveDisposals'] },
    { label: 'Disp. Eff %', keys: ['disposalEffPct', 'disposalEfficiency'] },
    { label: 'Metres Gained', keys: ['metresGained'] },
    { label: 'Intercepts', keys: ['intercepts'] },
    { label: 'Contested Marks', keys: ['contestedMarks'] },
    { label: 'Score Involvements', keys: ['scoreInvolvements'] },
    { label: 'Goal Assists', keys: ['goalAssists'] },
    { label: 'Clangers', keys: ['clangers'] },
    { label: 'Turnovers', keys: ['turnovers'] },
  ];

  const allStats: StatItem[] = [...primaryStats, ...secondaryStats];

  const injuryLabel = injury ? injury : 'Available';
  const injuryTone = injury ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700';
  const initials = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <section className="bg-white rounded-b-xl rounded-t-none overflow-hidden">
      <div className="bg-black text-white px-6 py-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <div className="h-14 w-14 rounded-full bg-white/10 flex items-center justify-center text-lg font-semibold">
              {initials}
            </div>
            <div>
              <div className="text-xl font-semibold">{capitalizeWords(name)}</div>
              <div className="text-sm text-slate-200">
                {team ? team : 'Unknown Team'} • {position || 'Unknown Position'}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {games !== undefined && (
              <span className="rounded-full bg-white/10 px-3 py-1 text-xs uppercase tracking-wide">
                Games {games}
              </span>
            )}
            {typeof avg === 'number' && (
              <span className="rounded-full bg-white/10 px-3 py-1 text-xs uppercase tracking-wide">
                Avg {avg.toFixed(1)}
              </span>
            )}
            {typeof ownership === 'number' && (
              <span className="rounded-full bg-white/10 px-3 py-1 text-xs uppercase tracking-wide">
                Own {ownership}%
              </span>
            )}
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${injuryTone}`}>
              {injuryLabel}
            </span>
          </div>
        </div>
      </div>

      <div className="px-6 py-5">
        <div className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">
          Season Snapshot
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {allStats.map((item) => {
            const value = getStatValue(item.keys);
            if (typeof value !== 'number') return null;
            return (
              <div key={item.label} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs text-slate-500">{item.label}</div>
                <div className="text-lg font-semibold text-slate-900">{value}</div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};

export default PlayerSummaryCard;
