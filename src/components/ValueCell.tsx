'use client';

import { useRankings } from '@/hooks/useRankings';

export function ValueCell({ playerId }: { playerId: string }) {
  const { get, isLoading, error } = useRankings();
  const entry = get(playerId);

  if (error) return <span className="text-red-600">–</span>;
  if (isLoading && !entry) return <span>…</span>;
  if (!entry) return <span>–</span>;

  return (
    <span
      className="tabular-nums"
      title={`Rank ${entry.rank}, total value ${entry.totalValue.toFixed(2)}`}
    >
      {entry.totalValue.toFixed(2)}
    </span>
  );
}