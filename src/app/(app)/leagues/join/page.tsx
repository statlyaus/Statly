'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { CalendarPlus, CheckCircle2, ChevronLeft, KeyRound, Loader2, UserPlus } from 'lucide-react';

import { useAuth } from '@/AuthContext';
import { fetchApi } from '@/lib/api';
import { AppLayout } from '@/components/navigation';
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
      <AppLayout>
        <main className="min-h-screen bg-[linear-gradient(180deg,var(--league-surface)_0%,var(--league-page)_44%,var(--league-surface-muted)_100%)] px-4 py-10 text-[color:var(--league-text)]">
          <section className="mx-auto max-w-md rounded-[28px] border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-6 text-center shadow-[0_22px_70px_-46px_rgba(23,34,48,0.35)]">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[color:var(--league-primary-soft)] text-[color:var(--league-primary)]">
              <UserPlus className="h-5 w-5" aria-hidden="true" />
            </div>
            <h1 className="mt-4 text-2xl font-semibold tracking-tight">Join league</h1>
            <p className="mt-2 text-sm leading-6 text-[color:var(--league-text-muted)]">
              Log in to accept an invite code and attach your team to a league.
            </p>
            <Link
              href={loginHref}
              className="mt-5 inline-flex h-11 w-full items-center justify-center rounded-full bg-[color:var(--league-primary)] px-5 text-sm font-semibold text-[color:var(--league-primary-foreground)] transition hover:bg-[color:var(--league-primary-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)] focus-visible:ring-offset-2"
            >
              Log in
            </Link>
          </section>
        </main>
      </AppLayout>
    );
  }

  if (joinedLeague) {
    return (
      <AppLayout>
        <main className="min-h-screen bg-[linear-gradient(180deg,var(--league-surface)_0%,var(--league-page)_44%,var(--league-surface-muted)_100%)] px-4 py-10 text-[color:var(--league-text)]">
          <section className="mx-auto max-w-lg rounded-[28px] border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-6 text-center shadow-[0_22px_70px_-46px_rgba(23,34,48,0.35)]">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[color:var(--league-success-soft)] text-[color:var(--league-success)]">
              <CheckCircle2 className="h-7 w-7" aria-hidden="true" />
            </div>
            <h1 className="mt-4 text-2xl font-semibold tracking-tight">
              Joined {joinedLeague.name}
            </h1>
            <p className="mt-2 text-sm leading-6 text-[color:var(--league-text-muted)]">
              Your team is connected. Continue to the league or save the draft time to your
              calendar.
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
              {joinedLeague.draftDate && (
                <button
                  type="button"
                  onClick={handleAddToCalendar}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-5 text-sm font-semibold text-[color:var(--league-text)] transition hover:bg-[color:var(--league-surface-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)]"
                >
                  <CalendarPlus className="h-4 w-4" aria-hidden="true" />
                  Add draft
                </button>
              )}
              <button
                type="button"
                onClick={() => router.push(`/leagues/${joinedLeague.id}`)}
                className="inline-flex h-11 items-center justify-center rounded-full bg-[color:var(--league-primary)] px-5 text-sm font-semibold text-[color:var(--league-primary-foreground)] transition hover:bg-[color:var(--league-primary-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)] focus-visible:ring-offset-2"
              >
                Go to league
              </button>
            </div>
          </section>
        </main>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <main className="min-h-screen bg-[linear-gradient(180deg,var(--league-surface)_0%,var(--league-page)_44%,var(--league-surface-muted)_100%)] text-[color:var(--league-text)]">
        <div className="mx-auto grid w-full max-w-[1180px] gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:px-8">
          <section className="rounded-[28px] border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-5 shadow-[0_22px_70px_-46px_rgba(23,34,48,0.35)] sm:p-6">
            <button
              type="button"
              onClick={() => router.push('/leagues')}
              className="inline-flex h-9 items-center gap-2 rounded-full border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-3 text-sm font-semibold text-[color:var(--league-text)] transition hover:bg-[color:var(--league-surface-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)]"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              Leagues
            </button>

            <header className="mt-6">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[color:var(--league-text-muted)]">
                Invite access
              </p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[color:var(--league-text)] sm:text-4xl">
                Join league
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-[color:var(--league-text-muted)] sm:text-base">
                Enter the commissioner invite code and choose the team name managers will see in the
                league room.
              </p>
            </header>

            <form onSubmit={handleJoinLeague} className="mt-8 space-y-6">
              <div>
                <label
                  htmlFor="code"
                  className="text-sm font-semibold text-[color:var(--league-text)]"
                >
                  League code
                </label>
                <input
                  id="code"
                  type="text"
                  value={code}
                  onChange={(e) => setCode(normalizeInviteCode(e.target.value))}
                  placeholder="ABC123"
                  maxLength={8}
                  className="mt-2 h-12 w-full rounded-2xl border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-3 text-center font-mono text-lg font-semibold tracking-[0.2em] text-[color:var(--league-text)] outline-none transition placeholder:tracking-normal placeholder:text-[color:var(--league-text-muted)] focus:border-[color:var(--league-primary)] focus:ring-2 focus:ring-[color:var(--league-primary)]/20"
                  disabled={loading}
                  required
                />
                <p className="mt-2 text-sm text-[color:var(--league-text-muted)]">
                  Ask the commissioner for the league invite code.
                </p>
              </div>

              <div>
                <label
                  htmlFor="teamName"
                  className="text-sm font-semibold text-[color:var(--league-text)]"
                >
                  Team name
                </label>
                <input
                  id="teamName"
                  type="text"
                  value={teamName}
                  onChange={(e) => setTeamName(e.target.value)}
                  placeholder="My Statly Team"
                  maxLength={30}
                  className="mt-2 h-11 w-full rounded-2xl border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-3 text-sm font-medium text-[color:var(--league-text)] outline-none transition placeholder:text-[color:var(--league-text-muted)] focus:border-[color:var(--league-primary)] focus:ring-2 focus:ring-[color:var(--league-primary)]/20"
                  disabled={loading}
                />
                <p className="mt-2 text-sm text-[color:var(--league-text-muted)]">
                  Leave blank to use an automatically generated team name.
                </p>
              </div>

              {error && (
                <div className="rounded-2xl border border-[color:var(--league-danger)]/30 bg-[color:var(--league-danger-soft)] px-4 py-3 text-sm font-medium text-[color:var(--league-danger)]">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading || !code.trim()}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-[color:var(--league-primary)] px-5 text-sm font-semibold text-[color:var(--league-primary-foreground)] transition hover:bg-[color:var(--league-primary-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                {loading ? 'Joining league' : 'Join league'}
              </button>
            </form>
          </section>

          <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
            <div className="rounded-[24px] border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-5 shadow-[0_18px_55px_-44px_rgba(23,34,48,0.35)]">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[color:var(--league-primary-soft)] text-[color:var(--league-primary)]">
                <KeyRound className="h-5 w-5" aria-hidden="true" />
              </div>
              <h2 className="mt-4 text-base font-semibold text-[color:var(--league-text)]">
                Invite code
              </h2>
              <p className="mt-2 text-sm leading-6 text-[color:var(--league-text-muted)]">
                Codes are issued by league commissioners and can include letters or numbers.
              </p>
            </div>

            <div className="rounded-[24px] border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-5">
              <p className="text-sm leading-6 text-[color:var(--league-text-muted)]">
                Need to run your own competition?
              </p>
              <Link
                href="/leagues/new"
                className="mt-4 inline-flex h-10 w-full items-center justify-center rounded-full border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-4 text-sm font-semibold text-[color:var(--league-text)] transition hover:bg-[color:var(--league-surface-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)]"
              >
                Create a league
              </Link>
            </div>
          </aside>
        </div>
      </main>
    </AppLayout>
  );
}
