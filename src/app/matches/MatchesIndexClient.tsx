'use client';

import React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { RealTimeMatchCenter } from '@/components/advanced';
import { AppLayout } from '@/components/navigation';
import useUserProfile from '@/hooks/useUserProfile';

export default function MatchesIndexClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedLeagueId = searchParams?.get('leagueId') ?? undefined;
  const { getWatchlist, leagues } = useUserProfile();

  const userWatchlist = getWatchlist(selectedLeagueId);
  const watchlistPlayers = userWatchlist?.playerIds ?? [];

  const handleLeagueChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const leagueId = e.target.value;
    const params = new URLSearchParams(searchParams ? searchParams.toString() : '');
    if (!leagueId) {
      params.delete('leagueId');
    } else {
      params.set('leagueId', leagueId);
    }
    router.replace(`/matches?${params.toString()}`);
  };

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-semibold">Live Match Center</h1>
          <div className="flex items-center gap-2">
            <label htmlFor="league-select" className="text-sm text-gray-600">League</label>
            <select id="league-select" value={selectedLeagueId || ''} onChange={handleLeagueChange} className="border rounded px-2 py-1 text-sm">
              <option value="">All / Global</option>
              {leagues.map((m) => (
                <option key={m.leagueId} value={m.leagueId}>
                  {m.league?.name && m.league?.name.trim().length > 0 ? m.league.name : `Unknown League (${m.leagueId})`}
                </option>
              ))}
            </select>
          </div>
        </div>
        <RealTimeMatchCenter selectedLeague={selectedLeagueId} watchlistPlayers={watchlistPlayers} onPlayerSelect={(player) => { router.push(`/players/${player.id}`); }} />
      </div>
    </AppLayout>
  );
}

