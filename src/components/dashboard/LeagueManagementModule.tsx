'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import type { User } from 'firebase/auth';
import type { League, LeagueMember } from '@/types/leagues';

interface LeagueWithMembers extends League {
  members: LeagueMember[];
}

interface LeagueManagementModuleProps {
  user: User;
  refreshTrigger?: number;
}

export default function LeagueManagementModule({
  user,
  refreshTrigger,
}: LeagueManagementModuleProps) {
  const [leagues, setLeagues] = useState<LeagueWithMembers[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchUserLeagues = async () => {
      try {
        setLoading(true);
        setError(null);

        // Early validation
        if (!user?.uid) {
          throw new Error('User not authenticated');
        }
        
        // Fetch user's league memberships
        const membershipsResponse = await fetch(`/api/leagues/user/${user.uid}`);
        
        if (!membershipsResponse.ok) {
          throw new Error('Failed to fetch user league memberships');
        }

        const membershipsData = await membershipsResponse.json();
        console.log('League memberships data:', membershipsData); // Debug log
        
        // Handle the API response format - it now returns leagues directly
        const leagues = membershipsData.leagues || membershipsData.data?.leagues || [];
        if (!Array.isArray(leagues)) {
          console.warn('Leagues data is not an array:', leagues);
          setLeagues([]);
          return;
        }
        
        setLeagues(leagues);
      } catch (err) {
        console.error('Error fetching user leagues:', err);
        setError('Failed to load leagues');
      } finally {
        setLoading(false);
      }
    };

    fetchUserLeagues();
  }, [user, refreshTrigger]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center text-center">
        <div>
          <div className="text-red-500 mb-2">⚠️</div>
          <p className="text-sm text-slate-600">{error}</p>
        </div>
      </div>
    );
  }

  if (leagues.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center space-y-4">
        <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center">
          <svg
            className="w-8 h-8 text-slate-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
            />
          </svg>
        </div>
        <div>
          <h3 className="font-medium text-slate-900 mb-1">No Leagues Yet</h3>
          <p className="text-sm text-slate-600 mb-3">
            Join or create your first league to get started
          </p>
          <div className="flex flex-col space-y-2">
            <Link
              href="/leagues/new"
              className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
            >
              Create League
            </Link>
            <Link
              href="/leagues/join"
              className="bg-slate-100 text-slate-700 px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-slate-200 transition-colors"
            >
              Join League
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const adminLeagueCount = leagues.filter((league) => league.ownerId === user.uid).length;

  return (
    <div className="h-full overflow-hidden flex flex-col">
      {/* Quick Stats */}
      <div className="grid grid-cols-2 gap-2 mb-4">
        <div className="bg-blue-50 rounded-lg p-3 text-center">
          <div className="text-lg font-bold text-blue-600">{leagues.length}</div>
          <div className="text-xs text-blue-600">Active Leagues</div>
        </div>
        <div className="bg-green-50 rounded-lg p-3 text-center">
          <div className="text-lg font-bold text-green-600">{adminLeagueCount}</div>
          <div className="text-xs text-green-600">Admin Of</div>
        </div>
      </div>

      {/* League List */}
      <div className="flex-1 overflow-y-auto space-y-2">
        {leagues.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full min-h-32 text-center space-y-3">
            <div className="text-slate-400">
              <svg className="w-12 h-12 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            </div>
            <div>
              <p className="text-sm text-slate-600 font-medium">No leagues joined yet</p>
              <p className="text-xs text-slate-500 mt-1">Create or join a league to get started</p>
            </div>
          </div>
        ) : (
          leagues.slice(0, 3).map((league, index) => {
            const isAdmin = league.ownerId === user.uid;

            return (
              <motion.div
                key={league.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
              >
                <Link
                  href={`/leagues/${league.id}`}
                  className="block p-3 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors group"
                >
                  <div className="flex items-center justify-between mb-1">
                    <h4 className="font-medium text-slate-900 text-sm truncate group-hover:text-blue-600 transition-colors">
                      {league.name}
                    </h4>
                    {isAdmin && (
                      <span className="text-xs bg-purple-100 text-purple-600 px-2 py-0.5 rounded">
                        Admin
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>
                      {league.currentTeams || 0} / {league.maxTeams} teams
                    </span>
                    <span className="font-mono">{league.code}</span>
                  </div>
                  {league.description && (
                    <p className="text-xs text-slate-600 mt-1 truncate">{league.description}</p>
                  )}
                </Link>
              </motion.div>
            );
          })
        )}
      </div>

      {/* View All Link */}
      {leagues.length > 3 && (
        <div className="mt-3 pt-3 border-t border-slate-200">
          <Link
            href="/leagues"
            className="block text-center text-sm text-blue-600 hover:text-blue-700 font-medium"
          >
            View All {leagues.length} Leagues →
          </Link>
        </div>
      )}

      {/* Quick Actions */}
      <div className="mt-3 pt-3 border-t border-slate-200">
        <div className="grid grid-cols-2 gap-2">
          <Link
            href="/leagues/new"
            className="bg-blue-600 text-white px-3 py-2 rounded-lg text-xs font-medium hover:bg-blue-700 transition-colors text-center"
          >
            + Create
          </Link>
          <Link
            href="/leagues"
            className="bg-slate-100 text-slate-700 px-3 py-2 rounded-lg text-xs font-medium hover:bg-slate-200 transition-colors text-center"
          >
            Browse
          </Link>
        </div>
      </div>
    </div>
  );
}
