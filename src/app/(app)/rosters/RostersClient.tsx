// src/app/rosters/RostersClient.tsx
'use client';

import { useMemo, useState } from 'react';

import type { LegacyPlayerStat } from '@/types/fantasy'; // central shared type

type Props = {
  players: LegacyPlayerStat[];
};

export default function RostersClient({ players }: Props) {
  const [query] = useState('');
  const filtered = useMemo(
    () => players.filter((p) => p.name.toLowerCase().includes(query.toLowerCase())),
    [players, query]
  );

  return (
    <div>
      {/* any interactive UI lives here */}
      {/* <input value={query} onChange={(e) => setQuery(e.target.value)} /> */}
      {filtered.map((p) => (
        <div key={p.id}>
          {p.name} — {p.team}
        </div>
      ))}
    </div>
  );
}
