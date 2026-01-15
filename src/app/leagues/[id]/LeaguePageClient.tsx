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
        <div className="flex justify-center items-center h-64">
          <LoadingSpinner />
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
        <div className="max-w-4xl mx-auto px-4 py-6">
          <Alert
            type="error"
            variant="light"
            title="Failed to load league"
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

  return (
    <AppLayout>
      <div>
        <div className="mb-6 overflow-hidden rounded-2xl border border-amber-200/70 bg-white shadow-sm">
          <div className="bg-gradient-to-r from-amber-100 via-amber-50 to-amber-100 px-6 py-6 text-center">
            <p className="text-xs uppercase tracking-[0.45em] text-amber-700/70">League</p>
            <h1 className="mt-2 text-3xl font-semibold text-amber-950 md:text-4xl">
              {curLeague.name}
            </h1>
            <div className="mt-4 flex items-center justify-center text-amber-700/80">
              <svg
                width="220"
                height="20"
                viewBox="0 0 220 20"
                fill="none"
                role="img"
                aria-label="Laurel divider"
              >
                <path
                  d="M8 10c8-7 20-7 28 0M12 6c6-5 14-5 20 0M20 16c4-3 10-3 14 0"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                />
                <path
                  d="M212 10c-8-7-20-7-28 0M208 6c-6-5-14-5-20 0M200 16c-4-3-10-3-14 0"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                />
                <line
                  x1="70"
                  y1="10"
                  x2="150"
                  y2="10"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  strokeDasharray="2 6"
                />
              </svg>
            </div>
          </div>
        </div>
        <LeagueTabs league={curLeague} members={curMembers} currentUserId={user?.uid} />
      </div>
    </AppLayout>
  );
}
