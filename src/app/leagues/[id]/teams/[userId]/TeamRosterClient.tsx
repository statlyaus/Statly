'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';

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

export default function TeamRosterClient({
  leagueId,
  userId,
}: TeamRosterClientProps): ReactElement {
  const { user: authUser, loading: authLoading } = useAuth();
  const [teamRoster, setTeamRoster] = useState<TeamRosterState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isDropping, setIsDropping] = useState(false);

  const canManageRoster = useMemo(
    () => Boolean(authUser?.uid && authUser.uid === userId) || isAuthBypassEnabled(),
    [authUser, userId]
  );

  const fetchRoster = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token =
        authUser && typeof authUser.getIdToken === 'function'
          ? await authUser.getIdToken()
          : null;
      const response = await fetch(`/api/leagues/${leagueId}/roster/${userId}`, {
        credentials: 'include',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        throw new Error(errorBody || `Failed to load roster (${response.status} ${response.statusText})`);
      }
      const rosterData = await response.json();
      const payload = rosterData?.data ?? rosterData;
      const roster = payload?.roster;
      const players = roster?.players || payload?.players || [];
      setTeamRoster({
        team: roster
          ? {
              id: String(roster.id),
              name: roster?.teamName || 'Team',
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
  }, [authUser, leagueId, userId]);

  useEffect(() => {
    if (!leagueId || !userId || authLoading) return;
    if (!authUser && !isAuthBypassEnabled()) return;

    void fetchRoster();
  }, [leagueId, userId, authUser, authLoading, fetchRoster]);

  const handleTeamAction = useCallback(
    async (action: string, player?: Player) => {
      if (action !== 'drop' || !player) return;
      if (!canManageRoster) return;
      if (!teamRoster?.team?.players?.length) return;
      const playerId = String(player.id);
      const currentPlayerIds = teamRoster.team.players.map((id) => String(id));
      if (!currentPlayerIds.includes(playerId)) return;
      const confirmed = window.confirm(`Drop ${player.name} from your roster?`);
      if (!confirmed) return;

      try {
        setActionError(null);
        setIsDropping(true);
        const token =
          authUser && typeof authUser.getIdToken === 'function'
            ? await authUser.getIdToken()
            : null;
        const response = await fetch(`/api/leagues/${leagueId}/actions/${userId}`, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            actionType: 'DROP_PLAYER',
            details: { playerId },
          }),
        });
        if (!response.ok) {
          const errorJson = (await response.json().catch(() => null)) as
            | { error?: string; message?: string }
            | null;
          throw new Error(errorJson?.error || errorJson?.message || 'Failed to drop player');
        }
        await fetchRoster();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'Failed to drop player');
      } finally {
        setIsDropping(false);
      }
    },
    [authUser, canManageRoster, fetchRoster, leagueId, teamRoster, userId]
  );

  if (!authUser && !isAuthBypassEnabled() && !authLoading) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        <p className="text-sm text-slate-600">Please sign in to view this team roster.</p>
      </div>
    );
  }

  return (
    <div className="space-y-0">
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

      {actionError && !loading && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {actionError}
        </div>
      )}

      {!loading && !error && (
        <MyTeamPanel
          team={teamRoster?.team}
          players={teamRoster?.players ?? []}
          showAdvancedFeatures
          readOnly={!canManageRoster}
          onTeamAction={handleTeamAction}
          isLoading={isDropping}
          maxHeight="none"
        />
      )}
    </div>
  );
}
