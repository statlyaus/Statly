'use client';

import { useState, useEffect } from 'react';

import Link from 'next/link';

import { motion } from 'framer-motion';

import type { UserLeagueSummary } from '@/types/leagues';

import type { User } from 'firebase/auth';

interface LeagueManagementModuleProps {
  user: User;
  refreshTrigger?: number;
}

export default function LeagueManagementModule({
  user,
  refreshTrigger,
}: LeagueManagementModuleProps) {
  const [leagues, setLeagues] = useState<UserLeagueSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchUserLeagues = async () => {
      try {
        setLoading(true);
        setError(null);

        if (!user?.uid) {
          throw new Error('User not authenticated');
        }

        const membershipsResponse = await fetch(`/api/leagues/user/${user.uid}`);

        if (!membershipsResponse.ok) {
          throw new Error('Failed to fetch user league memberships');
        }

        const membershipsData = await membershipsResponse.json();

        const leagues = membershipsData.leagues || membershipsData.data?.leagues || [];
        if (!Array.isArray(leagues)) {
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
      <div className="flex min-h-36 items-center justify-center rounded-xl border border-slate-200 bg-slate-50">
        <div className="h-7 w-7 animate-spin rounded-full border-2 border-slate-200 border-t-slate-700"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-5 text-center">
        <div>
          <p className="text-sm font-semibold text-rose-700">League list unavailable</p>
          <p className="mt-1 text-sm text-rose-600">{error}</p>
        </div>
      </div>
    );
  }

  if (leagues.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-white">
          <svg
            className="h-7 w-7 text-slate-400"
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
        <div className="mt-4">
          <h3 className="text-sm font-semibold text-slate-900">No leagues yet</h3>
          <p className="mt-1 text-sm text-slate-600">
            Create or join your first league to start building your workspace.
          </p>
          <div className="mt-4 flex flex-col gap-2">
            <Link
              href="/leagues/new"
              className="inline-flex items-center justify-center rounded-xl bg-slate-950 px-3 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              Create League
            </Link>
            <Link
              href="/leagues/join"
              className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
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
    <div className="flex h-full flex-col gap-4">
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-center">
          <div className="text-lg font-semibold text-slate-950">{leagues.length}</div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
            Active Leagues
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-center">
          <div className="text-lg font-semibold text-slate-950">{adminLeagueCount}</div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
            Admin Of
          </div>
        </div>
      </div>

      <div className="space-y-2">
        {leagues.slice(0, 4).map((league, index) => {
          const isAdmin = league.ownerId === user.uid;

          return (
            <motion.div
              key={league.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.06 }}
            >
              <Link
                href={`/leagues/${league.id}`}
                className="block rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 transition hover:border-slate-300 hover:bg-white"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h4 className="truncate text-sm font-semibold text-slate-950">{league.name}</h4>
                    <p className="mt-1 text-xs text-slate-600">
                      {league.memberCount} / {league.maxTeams} teams
                    </p>
                  </div>
                  {isAdmin ? (
                    <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-white">
                      Admin
                    </span>
                  ) : null}
                </div>
                <div className="mt-3 flex items-center justify-between gap-3 text-xs text-slate-500">
                  <span className="truncate font-mono uppercase">{league.code}</span>
                  <span className="font-medium text-slate-700">Open →</span>
                </div>
                {league.description ? (
                  <p className="mt-2 truncate text-xs text-slate-500">{league.description}</p>
                ) : null}
              </Link>
            </motion.div>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-2 border-t border-slate-200 pt-4">
        <Link
          href="/leagues/new"
          className="inline-flex items-center justify-center rounded-xl bg-slate-950 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-800"
        >
          Create
        </Link>
        <Link
          href="/leagues"
          className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-white"
        >
          Browse leagues
        </Link>
      </div>

      {leagues.length > 4 ? (
        <div className="border-t border-slate-200 pt-3">
          <Link
            href="/leagues"
            className="block text-center text-sm font-medium text-slate-700 transition hover:text-slate-950"
          >
            View all {leagues.length} leagues
          </Link>
        </div>
      ) : null}
    </div>
  );
}
