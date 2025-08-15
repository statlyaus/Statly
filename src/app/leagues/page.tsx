'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { AppLayout } from '@/components/navigation';
import Button from '@/components/Button';
import FormField from '@/components/FormField';
import { fetchFromAPI } from '@/lib/api';
import type { League } from '@/types/leagues';
import { FANTASY_CATEGORIES } from '@/types/fantasyCategories';

export default function LeaguesPage() {
  const [publicLeagues, setPublicLeagues] = useState<League[]>([]);
  const [joinCode, setJoinCode] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isJoining, setIsJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    loadPublicLeagues();
  }, []);

  const loadPublicLeagues = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await fetchFromAPI<{ data: League[] }>('/api/leagues?type=public');
      setPublicLeagues(response.data || []);
    } catch (err) {
      console.error('Error loading leagues:', err);
      setError('Failed to load leagues');
      setPublicLeagues([]); // Ensure it's always an array
    } finally {
      setIsLoading(false);
    }
  };

  const handleJoinByCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinCode.trim()) return;

    try {
      setIsJoining(true);
      setError(null);

      const response = await fetchFromAPI<{ data: { league: { id: string; name: string } } }>(
        '/api/leagues/join',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code: joinCode.trim().toUpperCase(),
            teamName: '', // Will use default
          }),
        }
      );

      setSuccessMessage(`Successfully joined ${response.data.league.name}!`);
      setJoinCode('');

      // Redirect to league page after 2 seconds
      setTimeout(() => {
        window.location.href = `/leagues/${response.data.league.id}`;
      }, 2000);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to join league';
      setError(message);
    } finally {
      setIsJoining(false);
    }
  };

  return (
    <AppLayout>
      <main className="mx-auto max-w-6xl p-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-8"
        >
          {/* Header */}
          <div className="text-center">
            <h1 className="text-4xl font-bold text-gray-900 mb-2">Fantasy AFL Leagues</h1>
            <p className="text-lg text-gray-600">Join existing leagues or create your own</p>
          </div>

          {/* Action Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Create League */}
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl p-6 text-white"
            >
              <h2 className="text-2xl font-bold mb-2">Create a League</h2>
              <p className="mb-4 opacity-90">
                Set up your own fantasy league with custom settings, scoring categories, and rules.
              </p>
              <Link href="/leagues/new">
                <Button className="bg-white text-blue-600 hover:bg-gray-100">
                  Create New League
                </Button>
              </Link>
            </motion.div>

            {/* Join by Code */}
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              className="bg-white rounded-xl shadow-lg p-6 border-2 border-gray-200"
            >
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Join by Code</h2>
              <p className="text-gray-600 mb-4">
                Have a league code? Enter it below to join a private league.
              </p>

              <form onSubmit={handleJoinByCode} className="space-y-4">
                <FormField label="">
                  <input
                    className="w-full rounded-lg border border-gray-300 px-4 py-3 text-center text-lg font-mono uppercase tracking-wider focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                    placeholder="LEAGUE CODE"
                    maxLength={8}
                  />
                </FormField>

                {error && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                    <p className="text-red-600 text-sm">{error}</p>
                  </div>
                )}

                {successMessage && (
                  <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                    <p className="text-green-600 text-sm">{successMessage}</p>
                  </div>
                )}

                <Button type="submit" disabled={isJoining || !joinCode.trim()} className="w-full">
                  {isJoining ? 'Joining...' : 'Join League'}
                </Button>
              </form>
            </motion.div>
          </div>

          {/* Public Leagues */}
          <div className="bg-white rounded-xl shadow-lg p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-semibold text-gray-900">Public Leagues</h2>
              <Button
                onClick={loadPublicLeagues}
                className="btn-outline btn-sm"
                disabled={isLoading}
              >
                {isLoading ? 'Loading...' : 'Refresh'}
              </Button>
            </div>

            {isLoading ? (
              <div className="text-center py-12">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                <p className="mt-2 text-gray-600">Loading leagues...</p>
              </div>
            ) : error ? (
              <div className="text-center py-12 text-red-500">
                <p className="text-lg mb-2">Error loading leagues</p>
                <p className="text-sm">{error}</p>
                <Button onClick={loadPublicLeagues} className="mt-4 btn-outline">
                  Try Again
                </Button>
              </div>
            ) : !publicLeagues || publicLeagues.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <p className="text-lg mb-2">No public leagues found</p>
                <p>Be the first to create a public league!</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {publicLeagues.map((league, index) => (
                  <motion.div
                    key={league.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.1 }}
                    className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow"
                  >
                    <div className="mb-3">
                      <h3 className="font-semibold text-gray-900 mb-1">{league.name}</h3>
                      {league.description && (
                        <p className="text-gray-600 text-sm mb-2">{league.description}</p>
                      )}
                      <div className="flex items-center justify-between text-sm text-gray-500">
                        <span>{league.maxTeams} teams max</span>
                        <span className="capitalize">{league.status}</span>
                      </div>
                    </div>

                    {/* Categories Preview */}
                    <div className="mb-3">
                      <p className="text-xs text-gray-500 mb-1">Scoring Categories:</p>
                      <div className="flex flex-wrap gap-1">
                        {league.categories.slice(0, 3).map((category) => {
                          const categoryData = FANTASY_CATEGORIES[category];
                          return (
                            <span
                              key={category}
                              className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded"
                            >
                              {categoryData?.shortLabel || category}
                            </span>
                          );
                        })}
                        {league.categories.length > 3 && (
                          <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">
                            +{league.categories.length - 3}
                          </span>
                        )}
                      </div>
                    </div>

                    <Link href={`/leagues/${league.id}`}>
                      <Button className="w-full btn-sm">View League</Button>
                    </Link>
                  </motion.div>
                ))}
              </div>
            )}
          </div>
        </motion.div>
      </main>
    </AppLayout>
  );
}
