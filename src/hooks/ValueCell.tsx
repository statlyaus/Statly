'use client';

import * as React from 'react';
import { useRankings } from '@/lib/hooks/useRankings';

export default function ValueCell({ playerId }: { playerId: string }) {
  const { map, isLoading, error } = useRankings();

  if (isLoading) return <span className="opacity-60">…</span>;
  if (error) return <span className="text-red-500">—</span>;

  const v = map.get(playerId)?.totalValue;
  return <span>{typeof v === 'number' ? v.toFixed(2) : '—'}</span>;
}