'use client';

import { useState, useEffect } from 'react';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

import { useAuth } from '@/AuthContext';
import Button from '@/components/Button';
import FormField from '@/components/FormField';
import { AppLayout } from '@/components/navigation';
import { LoadingSpinner, UIInput } from '@/components/ui';
import { fetchApi } from '@/lib/api';

export default function JoinLeagueClient() {
  const [code, setCode] = useState('');
  const [teamName, setTeamName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const { user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const urlCode = searchParams?.get('code');
    if (urlCode) {
      setCode(urlCode.trim().toUpperCase());
    }
  }, [searchParams]);

  const handleJoinLeague = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!user) {
      setError('You must be logged in to join a league');
      return;
    }

    if (!code.trim()) {
      setError('Please enter a league code');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const idToken =
        user && typeof user.getIdToken === 'function' ? await user.getIdToken() : null;
      const result = await fetchApi('leagues/join', {
        method: 'POST',
        body: JSON.stringify({
          code: code.trim().toUpperCase(),
          teamName: teamName.trim() || undefined,
        }),
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
      });

      setSuccess(true);

      setTimeout(() => {
        router.push(`/leagues/${result.data.league.id}?tab=draft`);
      }, 2000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to join league');
    } finally {
      setLoading(false);
    }
  };

  if (!user) {
    return (
      <AppLayout>
        <div className="max-w-md mx-auto mt-12 p-6 bg-white rounded-lg shadow-sm border border-gray-200">
          <h1 className="text-2xl font-bold text-center mb-6">Join League</h1>
          <p className="text-gray-600 text-center mb-4">Please log in to join a league</p>
          <Link href="/login" className="block">
            <Button className="w-full">Log In</Button>
          </Link>
        </div>
      </AppLayout>
    );
  }

  if (success) {
    return (
      <AppLayout>
        <div className="max-w-md mx-auto mt-12 p-6 bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="text-center">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg
                className="w-8 h-8 text-green-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">
              Successfully Joined League!
            </h2>
            <p className="text-gray-600 mb-4">Redirecting you to your league in 2 seconds...</p>
            <LoadingSpinner />
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-md mx-auto mt-12 p-6 bg-white rounded-lg shadow-sm border border-gray-200">
        <h1 className="text-2xl font-bold text-center mb-6">Join League</h1>
        <form onSubmit={handleJoinLeague} className="space-y-4">
          <FormField label="League Code" required helpText="Ask the league admin for the join code">
            <UIInput
              id="code"
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="Enter 8-character code"
              maxLength={8}
              className="font-mono text-center text-lg tracking-[0.35em]"
              disabled={loading}
              required
            />
          </FormField>
          <FormField label="Team Name (Optional)" helpText="Leave blank for auto-generated name">
            <UIInput
              id="teamName"
              type="text"
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              placeholder="My Awesome Team"
              maxLength={30}
              disabled={loading}
            />
          </FormField>
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}
          <Button
            type="submit"
            disabled={loading || !code.trim()}
            className="w-full"
            loading={loading}
          >
            {loading ? <>Joining League...</> : 'Join League'}
          </Button>
        </form>
        <div className="mt-6 pt-6 border-t border-gray-200">
          <p className="text-sm text-gray-600 text-center">
            Don’t have a league code?{' '}
            <Link href="/leagues/new" className="text-blue-600 hover:text-blue-700 font-medium">
              Create your own league
            </Link>
          </p>
        </div>
      </div>
    </AppLayout>
  );
}
