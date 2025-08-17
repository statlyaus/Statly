'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/AuthContext';
import { fetchApi } from '@/lib/api';
import type { League } from '@/types/leagues';
import Button from '@/components/Button';
import { LoadingSpinner } from '@/components/ui';
import { AppLayout } from '@/components/navigation';

export default function LeaguesPage() {
  const [leagues, setLeagues] = useState<League[]>([]);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();

  useEffect(() => {
    if (user) {
      const getLeagues = async () => {
        try {
          setLoading(true);
          const response = await fetchApi(`leagues/user/${user.uid}`);
          console.log('Leagues API response:', response); // Debug log
          const userLeagues = response.leagues || response.data?.leagues || [];
          setLeagues(userLeagues);
        } catch (error) {
          console.error('Failed to fetch leagues:', error);
          // Optionally set an error state here to show in the UI
        } finally {
          setLoading(false);
        }
      };
      getLeagues();
    } else {
      setLoading(false);
      setLeagues([]);
    }
  }, [user]);

  return (
    <AppLayout>
      <div>
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold">My Leagues</h1>
          <div className="flex gap-3">
            <Link href="/leagues/join">
              <Button variant="secondary">Join League</Button>
            </Link>
            <Link href="/leagues/new">
              <Button>Create New League</Button>
            </Link>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center items-center h-64">
            <LoadingSpinner />
          </div>
        ) : leagues.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {leagues.map((league) => (
              <Link href={`/leagues/${league.id}`} key={league.id} className="block hover:scale-105 transition-transform duration-200">
                <div className="bg-white rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
                  <div className="p-6">
                    <h3 className="text-lg font-semibold mb-2">{league.name}</h3>
                    <p className="text-sm text-gray-600 mb-4">{league.maxTeams} Teams (Max)</p>
                    <div className="space-y-2">
                      <p className="text-sm text-gray-500">
                        Categories: <span className="font-medium text-gray-800">{league.categories.length}</span>
                      </p>
                      <p className="text-sm text-gray-500">
                        Status: <span className="font-medium text-gray-800 capitalize">{league.status}</span>
                      </p>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="text-center py-12 border-2 border-dashed rounded-lg">
            <h2 className="text-xl font-semibold">No Leagues Found</h2>
            <p className="mt-2 text-gray-500 mb-6">
              You haven&apos;t joined any leagues yet. Get started below!
            </p>
            <div className="flex justify-center gap-4">
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