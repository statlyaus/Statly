'use client';

import { useEffect, useState } from 'react';

import Image from 'next/image';

import { fetchApi } from '@/lib/api';
import { getTeamLogo } from '@/lib/teamLogos';
import { isAbortError } from '@/lib/utils';

import { LoadingSpinner } from './ui';

type RoundMatchesProps = {
  round: number;
  initialMatches?: ApiMatch[];
};

type ApiMatch = {
  id?: string;
  matchDate?: string | null;
  homeTeam: string;
  awayTeam: string;
  scoreHome: number | null;
  scoreAway: number | null;
  round: number;
};

export const RoundMatches = ({ round, initialMatches }: RoundMatchesProps) => {
  const [matches, setMatches] = useState<ApiMatch[]>(initialMatches ?? []);
  const [loading, setLoading] = useState(!initialMatches);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!Number.isFinite(round)) return;

    // If we have SSR data for this round, use it and skip fetching
    if (initialMatches && initialMatches.length) {
      setMatches(initialMatches);
      setLoading(false);
      setError(null);
      return;
    }

    const ac = new AbortController();
    let mounted = true;

    const getMatchData = async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await fetchApi(`matches?round=${round}`, { signal: ac.signal });
        const data = Array.isArray(res)
          ? res
          : res && typeof res === 'object' && 'data' in res && Array.isArray(res.data)
            ? res.data
            : [];
        if (mounted) setMatches(data);
      } catch (err) {
        if (isAbortError(err)) return;
        console.error('Failed to load match data for round', round, err);
        if (mounted) setError('Failed to load match data for this round.');
      } finally {
        if (mounted) setLoading(false);
      }
    };

    getMatchData();
    return () => {
      mounted = false;
      ac.abort();
    };
  }, [round, initialMatches]);

  if (loading) {
    return (
      <div
        className="flex justify-center items-center h-48"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <LoadingSpinner />
      </div>
    );
  }

  if (error) {
    return <p className="text-destructive text-center">{error}</p>;
  }

  if (!matches.length) {
    return <p className="text-center text-muted-foreground">No matches scheduled for this round.</p>;
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {matches.map((match: ApiMatch) => {
        const key =
          match.id ?? `${match.homeTeam}-${match.awayTeam}-${match.matchDate ?? match.round}`;
        const hasScores = Number.isFinite(match.scoreHome) && Number.isFinite(match.scoreAway);
        return (
          <div key={key} className="bg-white rounded-lg border border-border shadow-sm p-6">
            <div className="text-center text-lg mb-4">
              <div className="flex justify-around items-center">
                <span className="flex items-center gap-2">
                  <Image
                    src={getTeamLogo(match.homeTeam)}
                    alt={match.homeTeam}
                    width={24}
                    height={24}
                  />
                  {match.homeTeam}
                </span>
                <span>vs</span>
                <span className="flex items-center gap-2">
                  <Image
                    src={getTeamLogo(match.awayTeam)}
                    alt={match.awayTeam}
                    width={24}
                    height={24}
                  />
                  {match.awayTeam}
                </span>
              </div>
            </div>
            <div className="text-center">
              {hasScores ? (
                <p className="font-semibold text-xl">
                  {match.scoreHome} - {match.scoreAway}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">Scheduled</p>
              )}
              {match.matchDate && (
                <p className="text-sm text-muted-foreground mt-1">
                  {new Date(match.matchDate).toLocaleString()}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
