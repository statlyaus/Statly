'use client';

import { useAuth } from '@/AuthContext';
import { AppLayout } from '@/components/navigation';
import { LoadingSpinner } from '@/components/ui';
import LeagueOverview from '@/components/league/LeagueOverview';
import type { League, LeagueMember } from '@/types/leagues';
import { useEffect, useState } from 'react';

interface Props {
  league: League | null;
  members: LeagueMember[];
  leagueId: string;
  errorMsg?: string | null;
}

export default function LeaguePageClient({ league, members, leagueId, errorMsg }: Props) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(errorMsg ?? null);
  const [curLeague, setCurLeague] = useState<League | null>(league);
  const [curMembers, setCurMembers] = useState<LeagueMember[]>(members);

  // Optional: client refresh if server failed
  useEffect(() => {
    if (curLeague || error) return;
    let mounted = true;
    (async () => {
      try {
        setLoading(true);
        const r = await fetch(`/api/leagues/${leagueId}`);
        if (!r.ok) throw new Error(`status ${r.status}`);
        const j = await r.json();
        if (mounted) {
          setCurLeague(j?.data?.league ?? null);
          setCurMembers(j?.data?.members ?? []);
        }
      } catch (e) {
        if (mounted) setError('Failed to fetch league data.');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [curLeague, error, leagueId]);

  if (loading) {
    return (
      <AppLayout>
        <div className="flex justify-center items-center h-64">
          <LoadingSpinner />
        </div>
      </AppLayout>
    );
  }

  if (error) {
    return (
      <AppLayout>
        <p className="text-red-500 text-center">{error}</p>
      </AppLayout>
    );
  }

  if (!curLeague) {
    return (
      <AppLayout>
        <p className="text-center">League not found.</p>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div>
        <h1 className="text-3xl font-bold mb-6">{curLeague.name}</h1>
        {process.env.NODE_ENV === 'development' && (
          <div className="mb-4 p-4 bg-gray-100 rounded text-sm">
            <p><strong>Debug Info:</strong></p>
            <p>Current User ID: {user?.uid || 'Not logged in'}</p>
            <p>League Owner ID: {curLeague.ownerId}</p>
            <p>Is Admin: {user?.uid === curLeague.ownerId ? 'Yes' : 'No'}</p>
            <p>Member Count: {curMembers.length}</p>
          </div>
        )}
        <LeagueOverview league={curLeague} members={curMembers} currentUserId={user?.uid} />
      </div>
    </AppLayout>
  );
}


