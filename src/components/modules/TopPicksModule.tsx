'use client';

import { useMemo } from 'react';
import { FixedSizeList } from 'react-window';
import { useQuery } from '@tanstack/react-query';
import DashboardCard from '../dashboard/DashboardCard';
import { useSocketChannel } from '@/providers/SocketProvider';
import { Player } from '@/types/players';

interface TopPickPlayer extends Player {
  score: number;
}

async function fetchTopPicks(): Promise<TopPickPlayer[]> {
  const res = await fetch('/api/top-picks');
  if (!res.ok) throw new Error('Failed to load');
  return res.json();
}

// Simple debounce helper
function debounce<T extends (...args: any[]) => void>(fn: T, wait: number) {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), wait);
  };
}

export default function TopPicksModule() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['top-picks'],
    queryFn: fetchTopPicks,
    staleTime: 30_000,
  });

  const debouncedRefetch = useMemo(() => debounce(() => refetch(), 500), [refetch]);
  useSocketChannel('topPicks', debouncedRefetch);

  return (
    <DashboardCard
      title="Top Picks"
      isLoading={isLoading}
      error={error?.message}
      empty={!data || data.length === 0}
    >
      {data && (
        <FixedSizeList height={300} itemCount={data.length} itemSize={48} width="100%">
          {({ index, style }) => {
            const p = data[index];
            return (
              <div style={style} className="flex justify-between px-2">
                <span>{p.name}</span>
                <span className="font-semibold">{p.score}</span>
              </div>
            );
          }}
        </FixedSizeList>
      )}
    </DashboardCard>
  );
}
