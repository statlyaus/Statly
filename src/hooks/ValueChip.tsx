'use client';

import * as React from 'react';
import { useRankings } from './useRankings';

type Props = {
  playerId: string | number;
  compact?: boolean;
  className?: string;
};

export default function ValueChip({ playerId, compact = false, className = '' }: Props) {
  const { get, isLoading, error } = useRankings();
  const entry = get(String(playerId));

  if (error) return null;           // don’t scream in UI
  if (isLoading && !entry) return null;
  if (!entry) return null;

  const { rank, totalValue } = entry;
  const label = `Rank ${rank}, total value ${totalValue.toFixed(2)}`;

  return (
    <span
      role="status"
      aria-label={label}
      title={label}
      className={[
        compact
          ? 'inline-flex items-center gap-1 rounded-md bg-blue-50 px-1.5 py-0.5 text-[11px] font-medium text-blue-700 ring-1 ring-inset ring-blue-200'
          : 'inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-200',
        className,
      ].join(' ')}
    >
      <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" className="-mt-px">
        <path d="M12 2l3 7h7l-5.5 4.1L18 21l-6-3.8L6 21l1.5-7.9L2 9h7z" />
      </svg>
      <span className="tabular-nums">#{rank}</span>
      <span className="opacity-60">•</span>
      <span className="tabular-nums">{totalValue.toFixed(2)}</span>
    </span>
  );
}