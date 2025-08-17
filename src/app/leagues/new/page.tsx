'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/AuthContext';
import { fetchApi } from '@/lib/api';
import Button from '@/components/Button';
import { AppLayout } from '@/components/navigation';

export default function NewLeaguePage() {
  const [leagueName, setLeagueName] = useState('');
  const [teamCount, setTeamCount] = useState(12);
  const [scoringFormat, setScoringFormat] = useState('standard');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const { user } = useAuth();

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!user) {
      setError('You must be logged in to create a league.');
      return;
    }
    setIsLoading(true);
    setError(null);

    try {
      const newLeague = await fetchApi('leagues', {
        method: 'POST',
        body: JSON.stringify({
          name: leagueName,
          teamCount,
          scoringFormat,
          commissionerId: user.uid,
        }),
      });
      router.push(`/leagues/${newLeague.id}`);
    } catch (err) {
      setError('Failed to create league. Please try again.');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-3xl font-bold mb-6">Create a New League</h1>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label htmlFor="leagueName" className="block text-sm font-medium mb-2">League Name</label>
          <input
            id="leagueName"
            type="text"
            value={leagueName}
            onChange={(e) => setLeagueName(e.target.value)}
            required
            placeholder="e.g. The Champions"
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label htmlFor="teamCount" className="block text-sm font-medium mb-2">Number of Teams</label>
          <select
            id="teamCount"
            value={String(teamCount)}
            onChange={(e) => setTeamCount(Number(e.target.value))}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {[8, 10, 12, 14, 16, 18].map((count) => (
              <option key={count} value={String(count)}>
                {count} Teams
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="scoringFormat" className="block text-sm font-medium mb-2">Scoring Format</label>
          <select
            id="scoringFormat"
            value={scoringFormat}
            onChange={(e) => setScoringFormat(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="standard">Standard</option>
            <option value="ppr">Points Per Reception (PPR)</option>
            <option value="nine-category">9-Category Head-to-Head</option>
          </select>
        </div>

        {error && <p className="text-red-500">{error}</p>}

        <Button type="submit" disabled={isLoading}>
          {isLoading ? 'Creating...' : 'Create League'}
        </Button>
      </form>
    </div>
  );
}