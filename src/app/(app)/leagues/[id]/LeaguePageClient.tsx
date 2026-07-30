'use client';

import { useAuth } from '@/AuthContext';
import Alert from '@/components/ui/Alert';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import LeagueTabs from '@/components/league/LeagueTabs';
import type {
  LeagueTradeCentreSnapshot,
  LeagueTradeDigest,
} from '@/server/leagues/trades/tradeContracts';
import type { League, LeagueMember } from '@/types/leagues';
import { useEffect, useState } from 'react';

interface Props {
  league: League | null;
  members: LeagueMember[];
  leagueId: string;
  initialUserId?: string | null;
  errorMsg?: string | null;
  initialTradeCentre?: LeagueTradeCentreSnapshot | null;
  initialTradeCentreError?: string | null;
  initialTradeDigest?: LeagueTradeDigest | null;
  initialTab?: string;
}

export default function LeaguePageClient({
  league,
  members,
  leagueId,
  initialUserId,
  errorMsg,
  initialTradeCentre,
  initialTradeCentreError,
  initialTradeDigest,
  initialTab,
}: Props) {
  const { user } = useAuth();
  const currentUserId = user?.uid ?? initialUserId ?? undefined;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(errorMsg ?? null);
  const [curLeague, setCurLeague] = useState<League | null>(league);
  const [curMembers, setCurMembers] = useState<LeagueMember[]>(members);

  useEffect(() => {
    setError(errorMsg ?? null);
    setCurLeague(league);
    setCurMembers(members);
  }, [errorMsg, league, members]);

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
      } catch (_e) {
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
        <div className="flex justify-center items-center h-64">
          <LoadingSpinner />
        </div>
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
    } catch (_e) {
      setError(_e instanceof Error ? _e.message : 'Failed to fetch league data.');
    } finally {
      setLoading(false);
    }
  };

  const handleMembersChange = (nextMembers: LeagueMember[]) => {
    setCurMembers(nextMembers);
    setCurLeague((current) =>
      current
        ? {
            ...current,
            currentTeams: nextMembers.length,
          }
        : current
    );
  };

  if (error) {
    return (
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
    );
  }

  if (!curLeague) {
    return (
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
            We couldn&apos;t find this league. It may have been removed or you might not have
            access.
          </Alert>
        </div>
    );
  }

  return (
      <main className="min-h-screen bg-[linear-gradient(180deg,var(--league-surface)_0%,var(--league-page)_44%,var(--league-surface-muted)_100%)] px-4 py-6 text-[color:var(--league-text)] sm:px-6 lg:px-8">
        <div className="mx-auto max-w-[var(--app-shell-max-width)]">
          <LeagueTabs
            league={curLeague}
            members={curMembers}
            currentUserId={currentUserId}
            onMembersChange={handleMembersChange}
            initialTradeCentre={initialTradeCentre}
            initialTradeCentreError={initialTradeCentreError}
            initialTradeDigest={initialTradeDigest}
            initialTab={initialTab}
          />
        </div>
      </main>
  );
}
