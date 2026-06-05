'use client';

import type { JSX } from 'react';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarClock, ChevronLeft, Loader2, Settings2, ShieldCheck, Trophy } from 'lucide-react';

import { useAuth } from '@/AuthContext';
import { fetchApi } from '@/lib/api';
import { AppLayout } from '@/components/navigation';
import type { FantasyCategoryKey } from '@/types/fantasyCategories';
import type {
  CreateLeagueRequest,
  DraftPickOrder,
  DraftTypeOption,
  League,
  WaiverResetPolicy,
} from '@/types/leagues';

const teamCounts = [8, 10, 12, 14, 16, 18];
type ScoringFormat = 'standard' | 'contested' | 'nine-category';

const categoriesByScoringFormat: Record<ScoringFormat, FantasyCategoryKey[]> = {
  standard: ['goals', 'kicks', 'handballs', 'marks', 'tackles'],
  contested: ['clearances', 'contestedPossessions', 'tackles', 'inside50s', 'scoreInvolvements'],
  'nine-category': [
    'goals',
    'kicks',
    'handballs',
    'marks',
    'tackles',
    'hitouts',
    'clearances',
    'inside50s',
    'rebound50s',
  ],
};

interface CreateLeagueResponse {
  success: boolean;
  data?: League;
  error?: string;
}

export default function NewLeaguePage(): JSX.Element {
  const [leagueName, setLeagueName] = useState('');
  const [teamCount, setTeamCount] = useState(12);
  const [scoringFormat, setScoringFormat] = useState<ScoringFormat>('standard');
  const [draftDate, setDraftDate] = useState('');
  const [draftType, setDraftType] = useState<DraftTypeOption>('snake');
  const [pickOrder, setPickOrder] = useState<DraftPickOrder>('random');
  const [waiverRule, setWaiverRule] = useState<WaiverResetPolicy>('weekly');
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
      const payload: CreateLeagueRequest = {
        name: leagueName.trim(),
        type: 'public',
        maxTeams: teamCount,
        categories: categoriesByScoringFormat[scoringFormat],
        draftDate: draftDate ? new Date(draftDate).toISOString() : undefined,
        draftType,
        pickOrder,
        waiverRule,
      };

      const response = (await fetchApi('leagues', {
        method: 'POST',
        body: JSON.stringify(payload),
      })) as CreateLeagueResponse;

      if (!response.success || !response.data?.id) {
        throw new Error(response.error || 'League creation response did not include a league id.');
      }

      router.push(`/leagues/${response.data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create league. Please try again.');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

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
                Commissioner setup
              </p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[color:var(--league-text)] sm:text-4xl">
                Create a new league
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-[color:var(--league-text-muted)] sm:text-base">
                Define the competition format, draft controls, and waiver defaults before you invite
                managers.
              </p>
            </header>

            <form onSubmit={handleSubmit} className="mt-8 space-y-6">
              <div>
                <label
                  htmlFor="leagueName"
                  className="text-sm font-semibold text-[color:var(--league-text)]"
                >
                  League name
                </label>
                <input
                  id="leagueName"
                  type="text"
                  value={leagueName}
                  onChange={(e) => setLeagueName(e.target.value)}
                  required
                  placeholder="e.g. Statly Premier League"
                  className="mt-2 h-11 w-full rounded-2xl border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-3 text-sm font-medium text-[color:var(--league-text)] outline-none transition placeholder:text-[color:var(--league-text-muted)] focus:border-[color:var(--league-primary)] focus:ring-2 focus:ring-[color:var(--league-primary)]/20"
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="teamCount"
                    className="text-sm font-semibold text-[color:var(--league-text)]"
                  >
                    Number of teams
                  </label>
                  <select
                    id="teamCount"
                    value={String(teamCount)}
                    onChange={(e) => setTeamCount(Number(e.target.value))}
                    className="mt-2 h-11 w-full rounded-2xl border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-3 text-sm font-semibold text-[color:var(--league-text)] outline-none transition focus:border-[color:var(--league-primary)] focus:ring-2 focus:ring-[color:var(--league-primary)]/20"
                  >
                    {teamCounts.map((count) => (
                      <option key={count} value={String(count)}>
                        {count} teams
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="scoringFormat"
                    className="text-sm font-semibold text-[color:var(--league-text)]"
                  >
                    Scoring format
                  </label>
                  <select
                    id="scoringFormat"
                    value={scoringFormat}
                    onChange={(e) => setScoringFormat(e.target.value as ScoringFormat)}
                    className="mt-2 h-11 w-full rounded-2xl border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-3 text-sm font-semibold text-[color:var(--league-text)] outline-none transition focus:border-[color:var(--league-primary)] focus:ring-2 focus:ring-[color:var(--league-primary)]/20"
                  >
                    <option value="standard">Standard</option>
                    <option value="contested">Contested ball</option>
                    <option value="nine-category">9-category head-to-head</option>
                  </select>
                </div>
              </div>

              <div>
                <label
                  htmlFor="draftDate"
                  className="text-sm font-semibold text-[color:var(--league-text)]"
                >
                  Draft date and time
                </label>
                <input
                  id="draftDate"
                  type="datetime-local"
                  value={draftDate}
                  onChange={(e) => setDraftDate(e.target.value)}
                  className="mt-2 h-11 w-full rounded-2xl border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-3 text-sm font-medium text-[color:var(--league-text)] outline-none transition focus:border-[color:var(--league-primary)] focus:ring-2 focus:ring-[color:var(--league-primary)]/20"
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <label
                    htmlFor="draftType"
                    className="text-sm font-semibold text-[color:var(--league-text)]"
                  >
                    Draft type
                  </label>
                  <select
                    id="draftType"
                    value={draftType}
                    onChange={(e) => setDraftType(e.target.value as DraftTypeOption)}
                    className="mt-2 h-11 w-full rounded-2xl border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-3 text-sm font-semibold text-[color:var(--league-text)] outline-none transition focus:border-[color:var(--league-primary)] focus:ring-2 focus:ring-[color:var(--league-primary)]/20"
                  >
                    <option value="snake">Snake</option>
                    <option value="linear">Linear</option>
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="pickOrder"
                    className="text-sm font-semibold text-[color:var(--league-text)]"
                  >
                    Pick order
                  </label>
                  <select
                    id="pickOrder"
                    value={pickOrder}
                    onChange={(e) => setPickOrder(e.target.value as DraftPickOrder)}
                    className="mt-2 h-11 w-full rounded-2xl border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-3 text-sm font-semibold text-[color:var(--league-text)] outline-none transition focus:border-[color:var(--league-primary)] focus:ring-2 focus:ring-[color:var(--league-primary)]/20"
                  >
                    <option value="random">Random</option>
                    <option value="manual">Manual</option>
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="waiverRule"
                    className="text-sm font-semibold text-[color:var(--league-text)]"
                  >
                    Waiver rule
                  </label>
                  <select
                    id="waiverRule"
                    value={waiverRule}
                    onChange={(e) => setWaiverRule(e.target.value as WaiverResetPolicy)}
                    className="mt-2 h-11 w-full rounded-2xl border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-3 text-sm font-semibold text-[color:var(--league-text)] outline-none transition focus:border-[color:var(--league-primary)] focus:ring-2 focus:ring-[color:var(--league-primary)]/20"
                  >
                    <option value="weekly">Weekly reset</option>
                    <option value="rolling">Rolling</option>
                  </select>
                </div>
              </div>

              {error && (
                <div className="rounded-2xl border border-[color:var(--league-danger)]/30 bg-[color:var(--league-danger-soft)] px-4 py-3 text-sm font-medium text-[color:var(--league-danger)]">
                  {error}
                </div>
              )}

              <div className="flex flex-col gap-3 border-t border-[color:var(--league-border)] pt-5 sm:flex-row">
                <button
                  type="submit"
                  disabled={isLoading || !leagueName.trim()}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-[color:var(--league-primary)] px-5 text-sm font-semibold text-[color:var(--league-primary-foreground)] transition hover:bg-[color:var(--league-primary-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isLoading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                  {isLoading ? 'Creating league' : 'Create league'}
                </button>
                <button
                  type="button"
                  onClick={() => router.push('/leagues')}
                  className="inline-flex h-11 items-center justify-center rounded-full border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-5 text-sm font-semibold text-[color:var(--league-text)] transition hover:bg-[color:var(--league-surface-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)]"
                >
                  Cancel
                </button>
              </div>
            </form>
          </section>

          <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
            {[
              { icon: Trophy, label: 'League size', value: `${teamCount} teams` },
              { icon: Settings2, label: 'Scoring', value: scoringFormat.replace('-', ' ') },
              {
                icon: CalendarClock,
                label: 'Draft',
                value: draftDate ? 'Scheduled' : 'Unscheduled',
              },
              { icon: ShieldCheck, label: 'Waivers', value: waiverRule },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.label}
                  className="rounded-[24px] border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-4 shadow-[0_18px_55px_-44px_rgba(23,34,48,0.35)]"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[color:var(--league-primary-soft)] text-[color:var(--league-primary)]">
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--league-text-muted)]">
                        {item.label}
                      </p>
                      <p className="mt-1 text-sm font-semibold capitalize text-[color:var(--league-text)]">
                        {item.value}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </aside>
        </div>
      </main>
    </AppLayout>
  );
}
