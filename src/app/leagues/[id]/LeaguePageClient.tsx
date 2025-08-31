'use client';

import { useAuth } from '@/AuthContext';
import { AppLayout } from '@/components/navigation';
import { LoadingSpinner, Alert } from '@/components/ui';
import LeagueOverview from '@/components/league/LeagueOverview';
import type { League, LeagueMember } from '@/types/leagues';
import { useEffect, useState } from 'react';
import OnboardingChecklist from './OnboardingChecklist';

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

  const retryFetch = async () => {
    try {
      setLoading(true);
      setError(null);
      const r = await fetch(`/api/leagues/${leagueId}`);
      if (!r.ok) throw new Error(`status ${r.status}`);
      const j = await r.json();
      setCurLeague(j?.data?.league ?? null);
      setCurMembers(j?.data?.members ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch league data.');
    } finally {
      setLoading(false);
    }
  };

  if (error) {
    return (
      <AppLayout>
        <div className="max-w-4xl mx-auto px-4 py-6">
          <Alert type="error" variant="light" title="Failed to load league" actions={
            <button
              onClick={() => void retryFetch()}
              disabled={loading}
              className="mt-2 inline-flex items-center px-3 py-1.5 text-sm font-medium bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? 'Retrying…' : 'Retry'}
            </button>
          }>
            {error}
          </Alert>
        </div>
      </AppLayout>
    );
  }

  if (!curLeague) {
    return (
      <AppLayout>
        <div className="max-w-4xl mx-auto px-4 py-6">
          <Alert
            type="warning"
            variant="light"
            title="League not found"
            actions={
              <button
                onClick={() => void retryFetch()}
                disabled={loading}
                className="mt-2 inline-flex items-center px-3 py-1.5 text-sm font-medium bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {loading ? 'Retrying…' : 'Retry'}
              </button>
            }
          >
            We couldn't find this league. It may have been removed or you might not have access.
          </Alert>
        </div>
      </AppLayout>
    );
  }

  const currentMember = curMembers.find((m) => m.userId === user?.uid);

  return (
    <AppLayout>
      <div>
        <h1 className="text-3xl font-bold mb-6">{curLeague.name}</h1>
        <OnboardingChecklist member={currentMember} />
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
