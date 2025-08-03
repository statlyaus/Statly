// src/components/PlayerSummaryCard.tsx
'use client';

import React from 'react';
import type { Player } from '../types';

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

  // Type assertion for summary
  const summaryStats = summary as Record<string, number>;

  function capitalizeWords(str: string) {
    return str.replace(/\b\w/g, (c) => c.toUpperCase());
  }

  return (
    <div className="bg-white rounded shadow p-4 flex flex-col gap-2 w-full max-w-2xl mx-auto">
      <div className="font-bold text-lg">{capitalizeWords(name)}</div>
      <div className="flex gap-2 mt-1">
        {team && <span className="bg-gray-200 rounded px-2">{team}</span>}
        {position && <span className="border rounded px-2">{position}</span>}
        {injury && <span className="bg-red-200 text-red-800 rounded px-2">Injured</span>}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-4">
        {games !== undefined && (
          <div>
            <div className="text-xs text-gray-500">Games</div>
            <div className="font-semibold">{games}</div>
          </div>
        )}
        {Object.entries(statLabels).map(([key, label]) =>
          typeof summaryStats[key] === 'number' ? (
            <div key={key}>
              <div className="text-xs text-gray-500">{label}</div>
              <div className="font-semibold">{summaryStats[key]}</div>
            </div>
          ) : null
        )}
      </div>
    </div>
  );
};

export default PlayerSummaryCard;
