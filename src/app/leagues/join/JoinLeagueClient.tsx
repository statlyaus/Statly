'use client';

import { useState, useEffect } from 'react';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Check } from 'lucide-react';

import { useAuth } from '@/AuthContext';
import Button from '@/components/Button';
import FormField from '@/components/FormField';
import { AppLayout } from '@/components/navigation';
import { LoadingSpinner, UIInput } from '@/components/ui';
import { fetchApi } from '@/lib/api';
import { leagueSurfacePatterns } from '@/styles/leagueDesignSystem';

const joinPanelClassName = `mx-auto mt-12 w-full max-w-md p-6 ${leagueSurfacePatterns.panel}`;

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
        <div className={joinPanelClassName}>
          <h1 className="mb-6 text-center text-2xl font-bold text-[color:var(--league-text)]">
            Join League
          </h1>
          <p className="mb-4 text-center text-sm text-[color:var(--league-text-muted)]">
            Please log in to join a league
          </p>
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
        <div className={joinPanelClassName}>
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-[color:var(--league-success-soft)] bg-[color:var(--league-success-soft)] text-[color:var(--league-success)]">
              <Check className="h-8 w-8" aria-hidden="true" />
            </div>
            <h2 className="mb-2 text-xl font-semibold text-[color:var(--league-text)]">
              Successfully Joined League!
            </h2>
            <p className="mb-4 text-sm text-[color:var(--league-text-muted)]">
              Redirecting you to your league in 2 seconds...
            </p>
            <LoadingSpinner />
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className={joinPanelClassName}>
        <h1 className="mb-6 text-center text-2xl font-bold text-[color:var(--league-text)]">
          Join League
        </h1>
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
            <div className="rounded-2xl border border-[color:var(--league-danger-soft)] bg-[color:var(--league-danger-soft)] p-3">
              <p className="text-sm font-medium text-[color:var(--league-danger)]">{error}</p>
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
        <div className="mt-6 border-t border-[color:var(--league-border)] pt-6">
          <p className="text-center text-sm text-[color:var(--league-text-muted)]">
            Don’t have a league code?{' '}
            <Link
              href="/leagues/new"
              className="font-medium text-[color:var(--league-accent)] transition hover:text-[color:var(--league-primary)]"
            >
              Create your own league
            </Link>
          </p>
        </div>
      </div>
    </AppLayout>
  );
}
