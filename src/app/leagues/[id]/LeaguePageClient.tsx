'use client';

import { useEffect, useState } from 'react';

import { useAuth } from '@/AuthContext';
import LeagueTabs from '@/components/league/LeagueTabs';
import { AppLayout } from '@/components/navigation';
import { LoadingSpinner, Alert } from '@/components/ui';
import type { League, LeagueMember } from '@/types/leagues';

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

  useEffect(() => {
    setCurLeague(league);
    setCurMembers(members);
    setError(errorMsg ?? null);
  }, [league, members, errorMsg]);

  // Optional: client refresh if server failed
  useEffect(() => {
    if (curLeague || error || !leagueId) return;
    let mounted = true;
    (async () => {
      try {
        setLoading(true);
        const r = await fetch(`/api/leagues/${leagueId}`);
        if (!r.ok) {
          const errorText = await r.text().catch(() => '');
          throw new Error(`Failed to load league: status ${r.status}${errorText ? ` - ${errorText}` : ''}`);
        }
        const j = await r.json();
        if (mounted) {
          setCurLeague(j?.data?.league ?? null);
          setCurMembers(j?.data?.members ?? []);
        }
      } catch (e) {
        if (mounted) {
          const errorMsg = e instanceof Error ? e.message : 'Failed to fetch league data.';
          setError(errorMsg);
        }
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
        <div className="bg-[color:var(--league-page)]">
          <div className="mx-auto flex h-64 w-full max-w-[var(--app-shell-max-width)] items-center justify-center px-4 py-6 sm:px-6 lg:px-8">
            <LoadingSpinner />
          </div>
        </div>
      </AppLayout>
    );
  }

  const retryFetch = async () => {
    if (!leagueId) {
      setError('Invalid league ID');
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const r = await fetch(`/api/leagues/${leagueId}`);
      if (!r.ok) {
        const errorText = await r.text().catch(() => '');
        throw new Error(`Failed to load league (${leagueId}): status ${r.status}${errorText ? ` - ${errorText}` : ''}`);
      }
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
        <div className="bg-[color:var(--league-page)]">
          <div className="mx-auto w-full max-w-[var(--app-shell-max-width)] px-4 py-6 sm:px-6 lg:px-8">
            <Alert
              type="error"
              variant="light"
              title="Failed to load league"
              actions={
                <button
                  onClick={() => void retryFetch()}
                  disabled={loading}
                  className="mt-2 inline-flex items-center rounded-full bg-[color:var(--league-primary)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[color:var(--league-primary-hover)] disabled:opacity-50"
                >
                  {loading ? 'Retrying…' : 'Retry'}
                </button>
              }
            >
              {error}
            </Alert>
          </div>
        </div>
      </AppLayout>
    );
  }

  if (!curLeague) {
    return (
      <AppLayout>
        <div className="bg-[color:var(--league-page)]">
          <div className="mx-auto w-full max-w-[var(--app-shell-max-width)] px-4 py-6 sm:px-6 lg:px-8">
            <Alert
              type="warning"
              variant="light"
              title="League not found"
              actions={
                <button
                  onClick={() => void retryFetch()}
                  disabled={loading}
                  className="mt-2 inline-flex items-center rounded-full bg-[color:var(--league-primary)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[color:var(--league-primary-hover)] disabled:opacity-50"
                >
                  {loading ? 'Retrying…' : 'Retry'}
                </button>
              }
            >
              We couldn't find this league. It may have been removed or you might not have access.
            </Alert>
          </div>
        </div>
      </AppLayout>
    );
  }

  const handleLeagueUpdate = (nextLeague: League) => {
    setCurLeague(nextLeague);
  };

  return (
    <AppLayout>
      <div className="bg-[color:var(--league-page)]">
        <div className="mx-auto w-full max-w-[var(--app-shell-max-width)] px-4 py-6 sm:px-6 lg:px-8 2xl:px-10">
          <LeagueTabs
            league={curLeague}
            members={curMembers}
            currentUserId={user?.uid}
            onLeagueUpdate={handleLeagueUpdate}
          />
        </div>
      </div>
    </AppLayout>
  );
}
