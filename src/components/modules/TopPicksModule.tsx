'use client';

import React from 'react';
import { FixedSizeList } from 'react-window';
import { useQuery } from '@tanstack/react-query';
import DashboardCard from '../dashboard/DashboardCard';
import { useSocketChannel } from '@/providers/SocketProvider';

interface Player {
  id: string;
  name: string;
  score: number;
}

async function fetchTopPicks(): Promise<Player[]> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

  try {
    const res = await fetch('/api/top-picks', {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      throw new Error(`Failed to load top picks: ${res.status} ${res.statusText}`);
    }
    return res.json();
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Request timeout: Failed to load top picks');
    }
    throw error;
  }
}

export default function TopPicksModule() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['top-picks'],
    queryFn: fetchTopPicks,
    staleTime: 30_000,
  });

  useSocketChannel('topPicks', () => refetch());

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
