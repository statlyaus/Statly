'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/AuthContext';
import Button from '@/components/Button';
import { AppLayout } from '@/components/navigation';
import { LoadingSpinner } from '@/components/ui';
import { fetchApi } from '@/lib/api';
import type { League } from '@/types/leagues';

export default function LeaguesClient() {
  const [leagues, setLeagues] = useState<League[]>([]);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();

  useEffect(() => {
    if (!user) {
      setLoading(false);
      setLeagues([]);
      return;
    }
    const load = async () => {
      try {
        setLoading(true);
        const response = await fetchApi(`leagues/user/${user.uid}`);
        const list = Array.isArray(response)
          ? response
          : response?.leagues
            ? response.leagues
            : response?.data?.leagues || [];
        setLeagues(list as League[]);
      } catch (e) {
        console.error('Failed to fetch leagues:', e);
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [user]);

  return (
    <AppLayout>
      <div className="p-6 max-w-[1600px] mx-auto">
        <section className="rounded-2xl bg-black text-white overflow-hidden mb-6">
          <div className="px-6 py-6 border-b border-white/10">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.35em] text-white/60">League Center</p>
                <h1 className="text-3xl font-semibold mt-2 tracking-tight">My Leagues</h1>
                <p className="text-sm text-white/70 mt-2">
                  Manage standings, drafts, and league activity from one place.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <span className="rounded-full bg-white/10 px-3 py-1 text-xs uppercase tracking-wide">
                  {leagues.length} Leagues
                </span>
              </div>
            </div>
          </div>
          <div className="px-6 py-5 bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950">
            <div className="flex flex-wrap gap-3">
              <Link href="/leagues/join">
                <Button variant="secondary">Join League</Button>
              </Link>
              <Link href="/leagues/new">
                <Button>Create New League</Button>
              </Link>
            </div>
          </div>
        </section>

        {loading ? (
          <div className="flex justify-center items-center h-64"><LoadingSpinner /></div>
        ) : leagues.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {leagues.map((league) => (
              <Link
                href={`/leagues/${league.id}`}
                key={league.id}
                className="group block"
              >
                <div className="bg-white rounded-2xl border border-gray-200 shadow-sm transition-all duration-200 group-hover:-translate-y-1 group-hover:shadow-lg">
                  <div className="p-6 space-y-4">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h3 className="text-lg font-semibold text-gray-900">{league.name}</h3>
                        <p className="text-sm text-gray-500 mt-1">
                          {league.maxTeams} Team Cap
                        </p>
                      </div>
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600 capitalize">
                        {league.status}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2">
                        <div className="text-xs text-slate-500">Categories</div>
                        <div className="text-lg font-semibold text-slate-900">
                          {league.categories.length}
                        </div>
                      </div>
                      <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2">
                        <div className="text-xs text-slate-500">Format</div>
                        <div className="text-lg font-semibold text-slate-900 capitalize">
                          {league.type}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-sm text-slate-500">
                      <span>Open the league hub</span>
                      <span className="text-slate-900 font-semibold">View</span>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center shadow-sm">
            <h2 className="text-xl font-semibold text-slate-900">No leagues yet</h2>
            <p className="mt-2 text-slate-500">
              Join a league with a code or spin up a new competition.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Link href="/leagues/join">
                <Button variant="secondary">Join League</Button>
              </Link>
              <Link href="/leagues/new">
                <Button>Create New League</Button>
              </Link>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
