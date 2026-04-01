'use client';

import { useState } from 'react';

import { useRouter } from 'next/navigation';

import { useAuth } from '@/AuthContext';
import Button from '@/components/Button';
import FormField from '@/components/FormField';
import { AppLayout } from '@/components/navigation';
import { UIInput, UISelect } from '@/components/ui';
import { fetchApi } from '@/lib/api';

export default function NewLeagueClient() {
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
      const response = await fetchApi('leagues', {
        method: 'POST',
        body: JSON.stringify({
          name: leagueName,
          teamCount,
          scoringFormat,
          commissionerId: user.uid,
        }),
      });
      const leagueId = (response as { data?: { id?: string } })?.data?.id;
      if (!leagueId) {
        throw new Error('League created but no league ID was returned');
      }
      router.push(`/leagues/${leagueId}?tab=draft`);
    } catch (err) {
      setError('Failed to create league. Please try again.');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold mb-6">Create a New League</h1>
        <form onSubmit={handleSubmit} className="space-y-6">
          <FormField label="League Name" required>
            <UIInput
              id="leagueName"
              type="text"
              value={leagueName}
              onChange={(e) => setLeagueName(e.target.value)}
              required
              placeholder="e.g. The Champions"
            />
          </FormField>

          <FormField label="Number of Teams">
            <UISelect
              id="teamCount"
              value={String(teamCount)}
              onChange={(e) => setTeamCount(Number(e.target.value))}
            >
              {[8, 10, 12, 14, 16, 18].map((count) => (
                <option key={count} value={String(count)}>
                  {count} Teams
                </option>
              ))}
            </UISelect>
          </FormField>

          <FormField label="Scoring Format">
            <UISelect
              id="scoringFormat"
              value={scoringFormat}
              onChange={(e) => setScoringFormat(e.target.value)}
            >
              <option value="standard">Standard</option>
              <option value="ppr">Points Per Reception (PPR)</option>
              <option value="nine-category">9-Category Head-to-Head</option>
            </UISelect>
          </FormField>

          {error && <p className="text-red-500">{error}</p>}

          <Button type="submit" disabled={isLoading} loading={isLoading}>
            {isLoading ? 'Creating...' : 'Create League'}
          </Button>
        </form>
      </div>
    </AppLayout>
  );
}
