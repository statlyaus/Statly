'use client';

import { useEffect, useState, useCallback } from 'react';

type TeamInfo = { memberId: string; leagueId: string; teamName?: string | null };

export function useTeamSwitcher() {
  const [teams, setTeams] = useState<TeamInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [activeLeague, setActiveLeague] = useState<string | null>(null);
  const [activeMember, setActiveMember] = useState<string | null>(null);

  const refreshTeams = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch('/api/user/teams', { cache: 'no-store' });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const json = await res.json();
      setTeams(json?.data || []);
      setActiveLeague(json?.active?.leagueId || null);
      setActiveMember(json?.active?.memberId || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch teams');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshTeams();
  }, [refreshTeams]);

  const switchTeam = useCallback(async (leagueId: string, memberId: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/user/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagueId, memberId }),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      // Update active cookies state
      setActiveLeague(leagueId);
      setActiveMember(memberId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to switch team');
    } finally {
      setLoading(false);
    }
  }, []);

  return { teams, loading, error, activeLeague, activeMember, refreshTeams, switchTeam };
}
