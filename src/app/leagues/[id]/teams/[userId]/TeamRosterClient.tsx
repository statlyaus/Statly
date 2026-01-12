'use client';

import { useEffect, useState } from 'react';

import Link from 'next/link';

import { useAuth } from '@/AuthContext';
import MyTeamPanel from '@/components/MyTeamPanel';
import { isAuthBypassEnabled } from '@/lib/authBypass';
import type { Player, Team } from '@/types/players';

interface TeamRosterClientProps {
  leagueId: string;
  userId: string;
}

type TeamRosterState = {
  team: Team | undefined;
  players: Player[];
  averageScore?: number;
};

export default function TeamRosterClient({ leagueId, userId }: TeamRosterClientProps) {
  const { user: authUser, loading: authLoading } = useAuth();
  const [leagueName, setLeagueName] = useState<string>('');
  const [teamRoster, setTeamRoster] = useState<TeamRosterState | null>(null);
  const [teamName, setTeamName] = useState<string>('Team');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!leagueId) return;
    const fetchLeague = async () => {
      try {
        const response = await fetch(`/api/leagues/${leagueId}`);
        if (!response.ok) return;
        const json = await response.json();
        const name = json?.data?.league?.name;
        if (typeof name === 'string') setLeagueName(name);
      } catch (_error) {
        // Best-effort league name
      }
    };
    void fetchLeague();
  }, [leagueId]);

  useEffect(() => {
    if (!leagueId || !userId || authLoading) return;
    if (!authUser && !isAuthBypassEnabled()) return;

    const fetchRoster = async () => {
      setLoading(true);
      setError(null);
      try {
        const token =
          authUser && typeof authUser.getIdToken === 'function'
            ? await authUser.getIdToken()
            : null;
        const response = await fetch(`/api/leagues/${leagueId}/roster/${userId}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        if (!response.ok) {
          const errorBody = await response.text().catch(() => '');
          throw new Error(
            errorBody || `Failed to load roster (${response.status} ${response.statusText})`
          );
        }
        const rosterData = await response.json();
        const payload = rosterData?.data ?? rosterData;
        const roster = payload?.roster;
        const players = roster?.players || payload?.players || [];
        const resolvedTeamName = roster?.teamName || teamName;
        setTeamName(resolvedTeamName);
        setTeamRoster({
          team: roster
            ? {
                id: String(roster.id),
                name: resolvedTeamName,
                players: Array.isArray(roster?.players)
                  ? roster.players.map((p: { id: string | number }) => String(p.id))
                  : [],
              }
            : undefined,
          players,
          averageScore: roster?.averageScore,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load roster';
        setError(message);
      } finally {
        setLoading(false);
      }
    };

    void fetchRoster();
  }, [leagueId, userId, authUser, authLoading]);

  if (!authUser && !isAuthBypassEnabled() && !authLoading) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        <p className="text-sm text-slate-600">Please sign in to view this team roster.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.25em] text-slate-400">Team Roster</p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-900">{teamName}</h1>
          <p className="mt-1 text-sm text-slate-600">
            {leagueName ? `${leagueName} • ` : ''}
            Full roster and team statistics.
          </p>
        </div>
        <Link
          href={`/leagues/${leagueId}?tab=teams`}
          className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600 hover:border-slate-300 hover:text-slate-900"
        >
          Back to Teams
        </Link>
      </div>

      {loading && (
        <div className="flex items-center justify-center rounded-2xl border border-slate-200 bg-white py-10 shadow-sm">
          <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600" />
          <span className="ml-3 text-sm font-medium text-slate-600">Loading roster...</span>
        </div>
      )}

      {error && !loading && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {!loading && !error && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <p className="text-xs uppercase tracking-wide text-slate-400">Roster Size</p>
              <p className="mt-2 text-lg font-semibold text-slate-900">
                {teamRoster?.players?.length ?? 0}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <p className="text-xs uppercase tracking-wide text-slate-400">Average Score</p>
              <p className="mt-2 text-lg font-semibold text-slate-900">
                {typeof teamRoster?.averageScore === 'number'
                  ? Math.round(teamRoster.averageScore)
                  : '—'}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <p className="text-xs uppercase tracking-wide text-slate-400">Season</p>
              <p className="mt-2 text-lg font-semibold text-slate-900">2025</p>
            </div>
          </div>

          <MyTeamPanel
            team={teamRoster?.team}
            players={teamRoster?.players ?? []}
            showAdvancedFeatures
            readOnly
            maxHeight="700px"
          />
        </>
      )}
    </div>
  );
}
