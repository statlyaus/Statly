// src/components/ValueChip.tsx
'use client';

import { useRankings } from '@/hooks/useRankings';

export default function ValueChip({ playerId }: { playerId: string }) {
  const { get, isLoading } = useRankings();
  const val = get(playerId);

  if (isLoading) {
    return (
      <span className="inline-flex items-center rounded-md bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
        …
      </span>
    );
  }

  if (!val) {
    return (
      <span className="inline-flex items-center rounded-md bg-red-100 px-2 py-0.5 text-xs text-red-700">
        n/a
      </span>
    );
  }

  return (
    <span
      title={`Rank ${val.rank}`}
      className="inline-flex items-center rounded-md bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-200"
    >
      {val.totalValue.toFixed(2)}
    </span>
  );
}