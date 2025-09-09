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
  const res = await fetch('/api/top-picks');
  if (!res.ok) throw new Error('Failed to load');
  return res.json();
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
