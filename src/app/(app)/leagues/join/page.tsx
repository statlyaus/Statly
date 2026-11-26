'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { CalendarPlus, CheckCircle2, ChevronLeft, KeyRound, UserPlus } from 'lucide-react';
import { buttonStyles } from '@/components/ui/controlStyles';
import { Spinner } from '@/components/ui/Spinner';

import { useAuth } from '@/AuthContext';
import { fetchApi } from '@/lib/api';
import { LEAGUE_CONSTRAINTS } from '@/types/leagues';

function normalizeInviteCode(value: string): string {
  return value
    .replace(/[^a-z0-9]/gi, '')
    .toUpperCase()
    .slice(0, LEAGUE_CONSTRAINTS.code.length);
}

function trimInviteTeamName(value: string): string {
  return value.slice(0, LEAGUE_CONSTRAINTS.teamName.maxLength);
}

function buildJoinReturnPath(code: string, teamName: string): string {
  const params = new URLSearchParams();
  if (code) params.set('code', code);
  if (teamName) params.set('team', teamName);
  const query = params.toString();
  return query ? `/leagues/join?${query}` : '/leagues/join';
}

export default function JoinLeaguePage() {
  const [code, setCode] = useState('');
  const [teamName, setTeamName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [joinedLeague, setJoinedLeague] = useState<{
    id: string;
    name: string;
    draftDate?: string;
  } | null>(null);
  const { user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const urlCode = searchParams?.get('code');
    const urlTeam = searchParams?.get('team');
    if (urlCode) {
      setCode(normalizeInviteCode(urlCode));
    }
    if (urlTeam) {
      setTeamName(trimInviteTeamName(urlTeam));
    }
  }, [searchParams]);

  const searchCode = normalizeInviteCode(searchParams?.get('code') || '');
  const searchTeamName = trimInviteTeamName(searchParams?.get('team') || '');
  const loginHref = `/login?next=${encodeURIComponent(
    buildJoinReturnPath(code || searchCode, teamName || searchTeamName)
  )}`;

  const handleJoinLeague = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!user) {
      setError('You must be logged in to join a league.');
      return;
    }

    if (!code.trim()) {
      setError('Please enter a league code.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const result = await fetchApi('leagues/join', {
        method: 'POST',
        body: JSON.stringify({
          code: normalizeInviteCode(code),
          teamName: teamName.trim() || undefined,
        }),
        headers: {
          'Content-Type': 'application/json',
        },
      });

      setJoinedLeague(result.data.league);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to join league.');
    } finally {
      setLoading(false);
    }
  };

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

  if (!user) {
    return (
      <div className="min-h-screen bg-muted px-4 py-10 text-foreground">
        <section className="mx-auto max-w-md rounded-[28px] border border-border bg-card p-6 text-center shadow-[0_22px_70px_-46px_rgba(23,34,48,0.35)]">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-accent text-brand-bar">
            <UserPlus className="h-5 w-5" aria-hidden="true" />
          </div>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">Join league</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Log in to accept an invite code and attach your team to a league.
          </p>
          <Link
            href={loginHref}
            className={buttonStyles({ variant: 'primary', className: 'mt-5 w-full' })}
          >
            Log in
          </Link>
        </section>
      </div>
    );
  }

  if (joinedLeague) {
    return (
      <div className="min-h-screen bg-muted px-4 py-10 text-foreground">
        <section className="mx-auto max-w-lg rounded-[28px] border border-border bg-card p-6 text-center shadow-[0_22px_70px_-46px_rgba(23,34,48,0.35)]">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-success-soft text-success">
            <CheckCircle2 className="h-7 w-7" aria-hidden="true" />
          </div>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">Joined {joinedLeague.name}</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Your team is connected. Continue to the league or save the draft time to your calendar.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
            {joinedLeague.draftDate && (
              <button type="button" onClick={handleAddToCalendar} className={buttonStyles()}>
                <CalendarPlus className="size-5" aria-hidden="true" />
                Add draft
              </button>
            )}
            <button
              type="button"
              onClick={() => router.push(`/leagues/${joinedLeague.id}`)}
              className={buttonStyles({ variant: 'primary' })}
            >
              Go to league
            </button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted text-foreground">
      <div className="mx-auto grid w-full max-w-[1180px] gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:px-8">
        <section className="rounded-[28px] border border-border bg-card p-5 shadow-[0_22px_70px_-46px_rgba(23,34,48,0.35)] sm:p-6">
          <button
            type="button"
            onClick={() => router.push('/dashboard#leagues')}
            className={buttonStyles({ size: 'sm' })}
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
            Dashboard leagues
          </button>

          <header className="mt-6">
            <p className="text-xs font-semibold text-muted-foreground">Invite access</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Join league
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
              Enter the commissioner invite code and choose the team name managers will see in the
              league room.
            </p>
          </header>

          <form onSubmit={handleJoinLeague} className="mt-8 space-y-6">
            <div>
              <label htmlFor="code" className="text-sm font-semibold text-foreground">
                League code
              </label>
              <input
                id="code"
                type="text"
                value={code}
                onChange={(e) => setCode(normalizeInviteCode(e.target.value))}
                placeholder="ABC123"
                maxLength={8}
                className="mt-2 h-12 w-full rounded-2xl border border-border bg-field px-3 text-center font-mono text-lg font-semibold tracking-[0.2em] text-foreground outline-none transition placeholder:tracking-normal placeholder:text-muted-foreground focus:border-brand-bar focus:ring-2 focus:ring-brand-bar/20"
                disabled={loading}
                required
              />
              <p className="mt-2 text-sm text-muted-foreground">
                Ask the commissioner for the league invite code.
              </p>
            </div>

            <div>
              <label htmlFor="teamName" className="text-sm font-semibold text-foreground">
                Team name
              </label>
              <input
                id="teamName"
                type="text"
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                placeholder="My Statly Team"
                maxLength={30}
                className="mt-2 h-11 w-full rounded-2xl border border-border bg-field px-3 text-sm font-medium text-foreground outline-none transition placeholder:text-muted-foreground focus:border-brand-bar focus:ring-2 focus:ring-brand-bar/20"
                disabled={loading}
              />
              <p className="mt-2 text-sm text-muted-foreground">
                Leave blank to use an automatically generated team name.
              </p>
            </div>

            {error && (
              <div className="rounded-2xl border border-destructive-text/30 bg-destructive-soft px-4 py-3 text-sm font-medium text-destructive-text">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !code.trim()}
              className={buttonStyles({ variant: 'primary', className: 'w-full' })}
            >
              {loading && <Spinner size="sm" inherit />}
              {loading ? 'Joining league' : 'Join league'}
            </button>
          </form>
        </section>

        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-[24px] border border-border bg-card p-5 shadow-[0_18px_55px_-44px_rgba(23,34,48,0.35)]">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-accent text-brand-bar">
              <KeyRound className="h-5 w-5" aria-hidden="true" />
            </div>
            <h2 className="mt-4 text-base font-semibold text-foreground">Invite code</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Codes are issued by league commissioners and can include letters or numbers.
            </p>
          </div>

          <div className="rounded-[24px] border border-border bg-card p-5">
            <p className="text-sm leading-6 text-muted-foreground">
              Need to run your own competition?
            </p>
            <Link href="/leagues/new" className={buttonStyles({ className: 'mt-4 w-full' })}>
              Create a league
            </Link>
          </div>
        </aside>
      </div>
    </div>
  );
}
