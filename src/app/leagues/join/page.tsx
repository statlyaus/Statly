'use client';

import { type FormEvent, type ReactElement, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

import { useAuth } from '@/AuthContext';
import Button from '@/components/Button';
import { LoadingSpinner } from '@/components/ui';
import { AppLayout } from '@/components/navigation';
import { fetchApi } from '@/lib/api';
import { LEAGUE_CONSTRAINTS } from '@/types/leagues';

interface JoinedLeague {
  id: string;
  name: string;
  draftDate?: string;
}

interface JoinLeagueResponse {
  data?: {
    league?: JoinedLeague;
  };
}

export function normalizeInviteCode(value: string): string {
  return value
    .replace(/[^a-z0-9]/gi, '')
    .toUpperCase()
    .slice(0, LEAGUE_CONSTRAINTS.code.length);
}

function buildJoinReturnPath(code: string, teamName: string): string {
  const params = new URLSearchParams();
  const trimmedTeamName = teamName.trim();

  if (code) params.set('code', code);
  if (trimmedTeamName) params.set('team', trimmedTeamName);

  const query = params.toString();
  return query ? `/leagues/join?${query}` : '/leagues/join';
}

export default function JoinLeaguePage(): ReactElement {
  const [code, setCode] = useState('');
  const [teamName, setTeamName] = useState('');
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState('');
  const [codeError, setCodeError] = useState('');
  const [joinedLeague, setJoinedLeague] = useState<JoinedLeague | null>(null);
  const { user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const normalizedCode = normalizeInviteCode(code);
  const isInviteCodeComplete = normalizedCode.length === LEAGUE_CONSTRAINTS.code.length;
  const codeHelpId = 'league-code-help';
  const codeErrorId = 'league-code-error';
  const formErrorId = 'join-league-error';
  const loginHref = useMemo(
    () => `/login?next=${encodeURIComponent(buildJoinReturnPath(normalizedCode, teamName))}`,
    [normalizedCode, teamName]
  );

  useEffect(() => {
    const urlCode = searchParams?.get('code');
    const urlTeam = searchParams?.get('team');
    if (urlCode) {
      setCode(normalizeInviteCode(urlCode));
    }
    if (urlTeam) {
      setTeamName(urlTeam.slice(0, LEAGUE_CONSTRAINTS.teamName.maxLength));
    }
  }, [searchParams]);

  const handleJoinLeague = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFormError('');
    setCodeError('');

    if (!user) {
      setFormError('You must be logged in to join a league');
      return;
    }

    if (!normalizedCode) {
      setCodeError('Please enter a league code');
      return;
    }

    if (!isInviteCodeComplete) {
      setCodeError(`Invite code must be ${LEAGUE_CONSTRAINTS.code.length} characters`);
      return;
    }

    setLoading(true);

    try {
      const result = (await fetchApi('leagues/join', {
        method: 'POST',
        body: JSON.stringify({
          code: normalizedCode,
          teamName: teamName.trim() || undefined,
        }),
        headers: {
          'Content-Type': 'application/json',
        },
      })) as JoinLeagueResponse;

      const league = result.data?.league;
      if (!league?.id || !league.name) {
        throw new Error('League joined, but the server did not return league details');
      }

      setJoinedLeague(league);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Failed to join league');
    } finally {
      setLoading(false);
    }
  };

  if (!user) {
    return (
      <AppLayout>
        <div className="mx-auto mt-12 w-full max-w-md rounded-lg border border-border bg-card p-6 text-card-foreground shadow-sm">
          <h1 className="mb-3 text-center text-2xl font-bold text-foreground">Join League</h1>
          <p className="mb-6 text-center text-sm leading-6 text-muted-foreground">
            Sign in to join an existing Statly league. If your invite link included a code, it will
            be preserved after login.
          </p>
          <Button href={loginHref} className="w-full justify-center">
            Log in to continue
          </Button>
        </div>
      </AppLayout>
    );
  }

  const handleAddToCalendar = () => {
    if (!joinedLeague?.draftDate) return;
    const format = (date: string) => date.replace(/[-:]/g, '').split('.')[0] + 'Z';
    const ics = `BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//Statly//EN\nBEGIN:VEVENT\nUID:${joinedLeague.id}-draft@statly\nDTSTAMP:${format(new Date().toISOString())}\nDTSTART:${format(joinedLeague.draftDate)}\nSUMMARY:${joinedLeague.name} Draft\nDESCRIPTION:Draft for ${joinedLeague.name}\nEND:VEVENT\nEND:VCALENDAR`;
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${joinedLeague.name.replace(/\s+/g, '_')}_draft.ics`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  if (joinedLeague) {
    return (
      <AppLayout>
        <div
          className="mx-auto mt-12 w-full max-w-md rounded-lg border border-border bg-card p-6 text-card-foreground shadow-sm"
          role="status"
          aria-live="polite"
        >
          <div className="text-center">
            <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-muted text-foreground">
              <svg
                className="size-8"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <h1 className="mb-2 text-xl font-semibold text-foreground">
              Successfully Joined {joinedLeague.name}!
            </h1>
            <p className="text-sm text-muted-foreground">
              Your team is now connected to this league workspace.
            </p>
            <div className="mt-4 flex flex-col gap-3">
              {joinedLeague.draftDate && (
                <Button onClick={handleAddToCalendar}>Add Draft to Calendar</Button>
              )}
              <Button
                variant="secondary"
                onClick={() => router.push(`/leagues/${joinedLeague.id}`)}
              >
                Go to League
              </Button>
            </div>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="mx-auto mt-12 w-full max-w-md rounded-lg border border-border bg-card p-6 text-card-foreground shadow-sm">
        <h1 className="mb-3 text-center text-2xl font-bold text-foreground">Join League</h1>
        <p className="mb-6 text-center text-sm leading-6 text-muted-foreground">
          Enter your commissioner invite code to join an existing AFL fantasy league.
        </p>

        <form onSubmit={handleJoinLeague} className="space-y-4">
          <div>
            <label htmlFor="code" className="mb-1 block text-sm font-medium text-foreground">
              League Code *
            </label>
            <input
              id="code"
              type="text"
              value={normalizedCode}
              onChange={(e) => {
                setCode(normalizeInviteCode(e.target.value));
                if (codeError) setCodeError('');
                if (formError) setFormError('');
              }}
              placeholder={`Enter ${LEAGUE_CONSTRAINTS.code.length}-character code`}
              maxLength={LEAGUE_CONSTRAINTS.code.length}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-center font-mono text-lg tracking-wider text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              disabled={loading}
              aria-describedby={codeError ? codeErrorId : codeHelpId}
              aria-invalid={codeError ? 'true' : undefined}
              required
            />
            {codeError ? (
              <p id={codeErrorId} className="mt-1 text-sm text-destructive" role="alert">
                {codeError}
              </p>
            ) : (
              <p id={codeHelpId} className="mt-1 text-xs text-muted-foreground">
                Ask your commissioner for the {LEAGUE_CONSTRAINTS.code.length}-character invite
                code.
              </p>
            )}
          </div>

          <div>
            <label htmlFor="teamName" className="mb-1 block text-sm font-medium text-foreground">
              Team Name (Optional)
            </label>
            <input
              id="teamName"
              type="text"
              value={teamName}
              onChange={(e) => {
                setTeamName(e.target.value);
                if (formError) setFormError('');
              }}
              placeholder="My Awesome Team"
              maxLength={LEAGUE_CONSTRAINTS.teamName.maxLength}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              disabled={loading}
              aria-describedby="team-name-help"
            />
            <p id="team-name-help" className="mt-1 text-xs text-muted-foreground">
              Leave blank for an auto-generated team name.
            </p>
          </div>

          {formError && (
            <div
              id={formErrorId}
              className="rounded-lg border border-destructive bg-card p-3"
              role="alert"
            >
              <p className="text-sm text-destructive">{formError}</p>
            </div>
          )}

          <Button
            type="submit"
            disabled={loading || !normalizedCode}
            className="w-full justify-center"
            aria-describedby={formError ? formErrorId : undefined}
          >
            {loading ? (
              <>
                <LoadingSpinner />
                Joining League...
              </>
            ) : (
              'Join League'
            )}
          </Button>
        </form>

        <div className="mt-6 border-t border-border pt-6">
          <p className="text-center text-sm text-muted-foreground">
            Don&apos;t have a league code?{' '}
            <Link
              href="/leagues/new"
              className="font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Create your own league
            </Link>
          </p>
        </div>
      </div>
    </AppLayout>
  );
}
