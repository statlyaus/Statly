'use client';

import { useState, useEffect } from 'react';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { KeyRound, ShieldCheck, Users } from 'lucide-react';

import { useAuth } from '@/AuthContext';
import Button from '@/components/Button';
import FormField from '@/components/FormField';
import { buttonVariants } from '@/components/ui/button';
import { LoadingSpinner, UIInput } from '@/components/ui';
import { fetchApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  leagueStatusTonePatterns,
  leagueSurfacePatterns,
} from '@/styles/leagueDesignSystem';

import { LeagueOnboardingShell } from '../_components/LeagueOnboardingShell';

export function normalizeInviteCode(value: string) {
  return value.replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 8);
}

const joinHighlights = [
  {
    title: 'Invite code',
    value: '8 characters from your commissioner',
    icon: KeyRound,
  },
  {
    title: 'Team identity',
    value: 'Shown across league tools',
    icon: Users,
  },
  {
    title: 'Membership check',
    value: 'Account must be signed in',
    icon: ShieldCheck,
  },
];

const joinSteps = [
  {
    title: 'Enter invite code',
    description: 'Use the commissioner code to find the correct league.',
  },
  {
    title: 'Name your team',
    description: 'Set the team identity managers will see across league tools.',
  },
  {
    title: 'Review draft room',
    description: 'After joining you will land in the draft workspace.',
  },
];

const joinSummary = [
  { label: 'Required', value: 'Invite code' },
  { label: 'Optional', value: 'Team name' },
  { label: 'Next screen', value: 'Draft room' },
];

function JoinLeagueShell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <LeagueOnboardingShell
      eyebrow="League invite"
      title={title}
      description={description}
      primaryAction={{ href: '/leagues/join', label: 'Join league', active: true }}
      secondaryAction={{ href: '/leagues/new', label: 'Create league' }}
      steps={joinSteps}
      summary={joinSummary}
    >
      {children}
    </LeagueOnboardingShell>
  );
}

export default function JoinLeagueClient() {
  const [code, setCode] = useState('');
  const [teamName, setTeamName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const { user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const normalizedCode = normalizeInviteCode(code);

  useEffect(() => {
    const urlCode = searchParams?.get('code');
    if (urlCode) {
      setCode(normalizeInviteCode(urlCode));
    }
  }, [searchParams]);

  const handleJoinLeague = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!user) {
      setError('You must be logged in to join a league');
      return;
    }

    if (!normalizedCode) {
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
          code: normalizedCode,
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
    const loginHref = normalizedCode
      ? `/login?next=${encodeURIComponent(`/leagues/join?code=${normalizedCode}`)}`
      : '/login?next=%2Fleagues%2Fjoin';

    return (
      <JoinLeagueShell
        title="Sign in to join a league"
        description="League membership is tied to your Statly account so your team, draft room, and manager permissions stay connected."
      >
        <div className="space-y-6">
          <div>
            <p className={leagueSurfacePatterns.sectionEyebrow}>Manager setup</p>
            <h2 className="mt-3 text-2xl font-semibold text-[color:var(--league-text)]">
              Log in before entering your code
            </h2>
            <p className={cn(leagueSurfacePatterns.body, 'mt-3 max-w-2xl')}>
              Sign in first and Statly will bring you back to this invite flow with your
              code preserved.
            </p>
          </div>

          <Link
            href={loginHref}
            className={cn(buttonVariants({ variant: 'primary', size: 'md' }), 'w-fit')}
          >
            Log in to continue
          </Link>
        </div>
      </JoinLeagueShell>
    );
  }

  if (success) {
    return (
      <JoinLeagueShell
        title="Successfully joined league"
        description="Your membership is confirmed and the draft workspace is opening now."
      >
        <div className="space-y-5 text-center">
          <div className="mx-auto flex size-16 items-center justify-center rounded-full border border-[color:var(--league-success-soft)] bg-[color:var(--league-success-soft)] text-[color:var(--league-success)]">
            <ShieldCheck className="size-8" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-2xl font-semibold text-[color:var(--league-text)]">
              Successfully joined league
            </h2>
            <p className={cn(leagueSurfacePatterns.body, 'mx-auto mt-2 max-w-md')}>
              Redirecting you to your league draft room...
            </p>
          </div>
          <LoadingSpinner />
        </div>
      </JoinLeagueShell>
    );
  }

  return (
    <JoinLeagueShell
      title="Join a league with your invite code"
      description="Enter the commissioner invite code, name your team, and land in the league draft workspace."
    >
      <div className="space-y-6">
        <div>
          <p className={leagueSurfacePatterns.sectionEyebrow}>Manager setup</p>
          <h2 className="mt-3 text-2xl font-semibold text-[color:var(--league-text)]">
            Confirm your invite details
          </h2>
          <p className={cn(leagueSurfacePatterns.body, 'mt-3 max-w-2xl')}>
            Use the commissioner code to join the right league. Add a team name now, or
            leave it blank and Statly will generate one for you.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          {joinHighlights.map((item) => {
            const Icon = item.icon;

            return (
              <div key={item.title} className={leagueSurfacePatterns.subpanel}>
                <Icon
                  aria-hidden="true"
                  className="size-5 text-[color:var(--league-accent)]"
                />
                <h3 className="mt-3 text-sm font-semibold text-[color:var(--league-text)]">
                  {item.title}
                </h3>
                <p className="mt-1 text-sm text-[color:var(--league-text-muted)]">
                  {item.value}
                </p>
              </div>
            );
          })}
        </div>

        <form aria-label="Join league form" onSubmit={handleJoinLeague} className="space-y-6">
          <FormField
            label="League Code"
            required
            helpText="Paste the 8-character code from the commissioner invite."
          >
            <UIInput
              id="code"
              type="text"
              value={code}
              onChange={(e) => setCode(normalizeInviteCode(e.target.value))}
              placeholder="AB12CD34"
              inputMode="text"
              className="font-mono text-center text-lg tracking-[0.35em]"
              disabled={loading}
              required
            />
          </FormField>
          <FormField
            label="Team Name (Optional)"
            helpText="This can be changed later from league settings if needed."
          >
            <UIInput
              id="teamName"
              type="text"
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              placeholder="Gippsland Giants"
              maxLength={30}
              disabled={loading}
            />
          </FormField>
          {error && (
            <p
              className={cn(leagueStatusTonePatterns.danger, 'rounded-2xl px-4 py-3 text-sm')}
              role="alert"
            >
              {error}
            </p>
          )}

          <div className="flex flex-col gap-3 border-t border-[color:var(--league-border)] pt-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-[color:var(--league-text-muted)]">
              No code? Ask the commissioner or create your own league.
            </p>
            <Button
              type="submit"
              disabled={loading || !normalizedCode}
              loading={loading}
              loadingText="Joining league..."
            >
              Join league
            </Button>
          </div>
        </form>
      </div>
    </JoinLeagueShell>
  );
}
