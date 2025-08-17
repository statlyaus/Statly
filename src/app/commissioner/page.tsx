'use client';

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/AuthContext';
import { fetchApi } from '@/lib/api';
import { LoadingSpinner } from '@/components/ui';
import { AppLayout } from '@/components/navigation';
import CommissionerTools from '@/components/commissioner/CommissionerTools';
import type { League } from '@/types/leagues';

export default function CommissionerPage() {
  const { user, loading } = useAuth();
  const [leagues, setLeagues] = useState<League[]>([]);
  const [selectedLeague, setSelectedLeague] = useState<League | null>(null);
  const [leaguesLoading, setLeaguesLoading] = useState(false);

  useEffect(() => {
    if (user) {
      const getLeagues = async () => {
        try {
          setLeaguesLoading(true);
          const userLeagues = await fetchApi(`leagues/user/${user.uid}`);
          setLeagues(userLeagues);
          // Auto-select first league if available
          if (userLeagues.length > 0) {
            setSelectedLeague(userLeagues[0]);
          }
        } catch (error) {
          console.error('Failed to fetch leagues:', error);
        } finally {
          setLeaguesLoading(false);
        }
      };
      getLeagues();
    }
  }, [user]);

  if (loading || leaguesLoading) {
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
            <p className="text-gray-600">You need to be a league owner to access commissioner tools.</p>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* League Selector */}
        {leagues.length > 1 && (
          <div className="bg-white rounded-lg shadow-sm p-4">
            <label htmlFor="league-select" className="block text-sm font-medium text-gray-700 mb-2">
              Select League to Manage
            </label>
            <select
              id="league-select"
              value={selectedLeague?.id || ''}
              onChange={(e) => {
                const league = leagues.find(l => l.id === e.target.value);
                setSelectedLeague(league || null);
              }}
              className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
            >
              {leagues.map((league) => (
                <option key={league.id} value={league.id}>
                  {league.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {selectedLeague && (
          <CommissionerTools 
            league={selectedLeague}
            isCommissioner={selectedLeague.ownerId === user.uid}
          />
        )}
      </div>
    </AppLayout>
  );
}
