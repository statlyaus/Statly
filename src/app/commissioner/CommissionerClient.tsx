'use client';

import React, { useState, useEffect } from 'react';

import { useAuth } from '@/AuthContext';
import CommissionerTools from '@/components/commissioner/CommissionerTools';
import { AppLayout } from '@/components/navigation';
import { LoadingSpinner } from '@/components/ui';
import { fetchApi } from '@/lib/api';
import type {
  League,
  LeagueDetailResponse,
  LeagueMember,
  UserLeagueSummary,
} from '@/types/leagues';

export default function CommissionerClient() {
  const { user, loading } = useAuth();
  const [leagues, setLeagues] = useState<UserLeagueSummary[]>([]);
  const [selectedLeagueId, setSelectedLeagueId] = useState<string>('');
  const [selectedLeague, setSelectedLeague] = useState<League | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [isCommissioner, setIsCommissioner] = useState(false);
  const [detailCache, setDetailCache] = useState<
    Record<string, { league: League | null; isCommissioner: boolean }>
  >({});

  useEffect(() => {
    if (user) {
      const getLeagues = async () => {
        try {
          setListLoading(true);
          const response = await fetchApi(`leagues/user/${user.uid}`);
          const userLeagues = ((
            response as { leagues?: UserLeagueSummary[]; data?: { leagues?: UserLeagueSummary[] } }
          ).leagues ||
            (
              response as {
                leagues?: UserLeagueSummary[];
                data?: { leagues?: UserLeagueSummary[] };
              }
            ).data?.leagues ||
            []) as UserLeagueSummary[];
          setLeagues(userLeagues);
          setSelectedLeagueId(userLeagues[0]?.id ?? '');
        } catch (error) {
          console.error('Failed to fetch leagues:', error);
        } finally {
          setListLoading(false);
        }
      };
      getLeagues();
    }
  }, [user]);

  useEffect(() => {
    if (!user || !selectedLeagueId) {
      setSelectedLeague(null);
      setIsCommissioner(false);
      return;
    }

    const cachedDetail = detailCache[selectedLeagueId];
    if (cachedDetail) {
      setSelectedLeague(cachedDetail.league);
      setIsCommissioner(cachedDetail.isCommissioner);
      return;
    }

    let active = true;

    const getLeagueDetail = async () => {
      try {
        setDetailLoading(true);
        const response = (await fetchApi(`leagues/${selectedLeagueId}`)) as LeagueDetailResponse;
        const league = response.data?.league ?? null;
        const members = Array.isArray(response.data?.members) ? response.data.members : [];

        if (!active) return;

        setSelectedLeague(league);
        const currentMember = members.find((member) => member.userId === user.uid);
        const nextIsCommissioner =
          currentMember?.role === 'owner' || currentMember?.role === 'commissioner';
        setIsCommissioner(nextIsCommissioner);
        setDetailCache((currentCache) => ({
          ...currentCache,
          [selectedLeagueId]: {
            league,
            isCommissioner: nextIsCommissioner,
          },
        }));
      } catch (error) {
        if (!active) return;
        console.error('Failed to fetch league detail:', error);
        setSelectedLeague(null);
        setIsCommissioner(false);
      } finally {
        if (active) setDetailLoading(false);
      }
    };

    void getLeagueDetail();

    return () => {
      active = false;
    };
  }, [detailCache, selectedLeagueId, user]);

  if (loading || listLoading) {
    return (
      <AppLayout>
        <div className="flex justify-center items-center h-64">
          <LoadingSpinner />
        </div>
      </AppLayout>
    );
  }

  if (!user) {
    return (
      <AppLayout>
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-center">
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Access Denied</h2>
            <p className="text-gray-600">Please sign in to access commissioner tools.</p>
          </div>
        </div>
      </AppLayout>
    );
  }

  if (leagues.length === 0) {
    return (
      <AppLayout>
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-center">
            <h2 className="text-2xl font-bold text-gray-900 mb-2">No Leagues Found</h2>
            <p className="text-gray-600">
              You need to be a league owner to access commissioner tools.
            </p>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        {leagues.length > 1 && (
          <div className="bg-white rounded-lg shadow-sm p-4">
            <label htmlFor="league-select" className="block text-sm font-medium text-gray-700 mb-2">
              Select League to Manage
            </label>
            <select
              id="league-select"
              value={selectedLeagueId}
              onChange={(e) => {
                setSelectedLeagueId(e.target.value);
              }}
              disabled={detailLoading}
              className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
            >
              {leagues.map((league) => (
                <option key={league.id} value={league.id}>
                  {league.name}
                </option>
              ))}
            </select>
            {detailLoading ? (
              <p className="mt-2 text-xs text-gray-500">Loading league details…</p>
            ) : null}
          </div>
        )}

        {detailLoading && !selectedLeague ? (
          <div className="flex min-h-[16rem] items-center justify-center rounded-lg bg-white p-6 shadow-sm">
            <div className="text-center">
              <LoadingSpinner />
              <p className="mt-3 text-sm text-gray-600">Loading league details…</p>
            </div>
          </div>
        ) : null}

        {selectedLeague && (
          <CommissionerTools league={selectedLeague} isCommissioner={isCommissioner} />
        )}
      </div>
    </AppLayout>
  );
}
