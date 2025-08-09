// src/app/tradecentre/page.tsx
export const runtime = 'nodejs';

import React from 'react';
import Link from 'next/link';
import { getPlayers } from '@/lib/data';
import type { Player } from '@/types';

// Helper reads from top-level (detail page) or nested stats (list)
function readStat(p: Player, key: keyof Player | string) {
  // @ts-expect-error – allow flexible lookup
  const top = p[key];
  // @ts-expect-error – stats bag is loose
  const bag = p.stats?.[key as string];
  return top ?? bag;
}

function formatValue(v: unknown) {
  return v === null || v === undefined ? '–' : v;
}

function Stat({ label, value, hint }: { label: string; value: unknown; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between rounded px-2 py-1 bg-gray-700/50">
      <span className="text-gray-300" aria-label={hint ?? label} title={hint ?? label}>
        {label}
      </span>
      <span className="font-semibold tabular-nums">{formatValue(value)}</span>
    </div>
  );
}

const GROUPS: Array<{ title: string; items: Array<{ label: string; key: string; hint?: string }> }> = [
  {
    title: 'Possession',
    items: [
      { label: 'Kicks', key: 'kicks' },
      { label: 'Handballs', key: 'handballs' },
      { label: 'Marks', key: 'marks' },
      { label: 'Contested Possessions', key: 'contestedPossessions' },
      { label: 'Uncontested Possessions', key: 'uncontestedPossessions' },
      { label: 'Effective Disposals', key: 'effectiveDisposals' },
    ],
  },
  {
    title: 'Offense',
    items: [
      { label: 'Goals', key: 'goals' },
      { label: 'Goal Assists', key: 'goalAssists' },
      { label: 'Inside 50s', key: 'inside50s' },
      { label: 'Score Involvements', key: 'scoreInvolvements' },
      { label: 'Marks Inside 50', key: 'marksInside50' },
    ],
  },
  {
    title: 'Defense',
    items: [
      { label: 'Tackles', key: 'tackles' },
      { label: 'Intercepts', key: 'intercepts' },
      { label: 'Rebound 50s', key: 'rebound50s' },
      { label: 'One Percenters', key: 'onePercenters', hint: 'Spoils, smothers, shepherds, etc.' },
      { label: 'Clearances', key: 'clearances' },
      { label: 'Hitouts', key: 'hitouts' },
    ],
  },
  {
    title: 'Efficiency',
    items: [
      { label: 'Disposal Efficiency %', key: 'disposalEfficiency' },
      { label: 'Time on Ground %', key: 'timeOnGroundPct' },
      { label: 'Turnovers', key: 'turnovers' },
      { label: 'Frees For', key: 'freesFor' },
      { label: 'Frees Against', key: 'freesAgainst' },
      { label: 'Metres Gained', key: 'metresGained' },
    ],
  },
];

export default async function Tradecentre() {
  const players = await getPlayers();

  return (
    <main className="mx-auto max-w-7xl p-6">
      <h1 className="text-3xl font-bold text-white mb-4">Trade Centre</h1>
      <p className="text-sm text-gray-400 mb-6">
        Browse players. Click a card for full details. Values show season averages where available.
      </p>

      <section
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
        aria-label="Players list"
        role="list"
      >
        {players.map((p) => (
          <article
            key={p.id}
            className="bg-gray-800 rounded-xl shadow ring-1 ring-black/10 hover:ring-blue-500/40 hover:shadow-lg transition"
            role="listitem"
          >
            <Link
              href={`/players/${p.id}`}
              className="block focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-500/40 rounded-xl"
              aria-label={`View ${p.name} details`}
            >
              <header className="px-4 pt-4 pb-2">
                <h2 className="text-xl font-semibold text-blue-400 hover:underline">{p.name}</h2>
                <p className="text-gray-400">{p.team}{p.position ? ` • ${p.position}` : ''}</p>
              </header>

              <div className="px-4 pb-4 space-y-3">
                {GROUPS.map((g) => (
                  <div key={`${p.id}-${g.title}`}>
                    <h3 className="text-gray-300 font-semibold mb-1">{g.title}</h3>
                    <div className="grid grid-cols-2 gap-1">
                      {g.items.map(({ label, key, hint }) => (
                        <Stat
                          key={`${p.id}-${key}`}
                          label={label}
                          value={readStat(p, key)}
                          hint={hint}
                        />
                      ))}
                    </div>
                  </div>
                ))}

                <button
                  type="button"
                  className="mt-2 w-full rounded-md bg-blue-600 hover:bg-blue-700 text-white py-2 font-medium"
                  aria-label={`Open trade flow for ${p.name}`}
                >
                  Trade
                </button>
              </div>
            </Link>
          </article>
        ))}
      </section>
    </main>
  );
}