'use client';

import { useRankings } from '@/hooks/useRankings';

type ValueChipProps = {
  playerId: string;
  compact?: boolean;
};

export function ValueChip({ playerId, compact = false }: ValueChipProps) {
  const { map, isLoading } = useRankings();

  if (isLoading) return null;

  const entry = map.get(playerId);
  if (!entry) return null;

  const label = `Rank ${entry.rank}, total value ${entry.totalValue.toFixed(2)}`;

  return (
    <span
      role="status"
      aria-label={label}
      title={label}
      className={
        compact
          ? 'ml-2 inline-flex items-center gap-1 rounded-md bg-blue-50 px-1.5 py-0.5 text-[11px] font-medium text-blue-700 ring-1 ring-inset ring-blue-200'
          : 'ml-2 inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-200'
      }
    >
      <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" className="-mt-px">
        <path d="M12 2l3 7h7l-5.5 4.1L18 21l-6-3.8L6 21l1.5-7.9L2 9h7z" />
      </svg>
      <span className="tabular-nums">#{entry.rank}</span>
      <span className="opacity-60">•</span>
      <span className="tabular-nums">{entry.totalValue.toFixed(2)}</span>
    </span>
  );
}