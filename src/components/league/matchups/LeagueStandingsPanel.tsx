'use client';

import { useEffect, useState } from 'react';

import { StandingsLadder } from '@/components/league/standings/StandingsLadder';
import { StandingsRace } from '@/components/league/standings/StandingsRace';
import { StandingsResults } from '@/components/league/standings/StandingsResults';
import type { StandingsData } from '@/components/league/standings/standingsFormat';
import { authenticatedFetch } from '@/lib/authenticatedFetch';

interface LeagueStandingsPanelProps {
  leagueId: string;
  currentUserId?: string;
}

type View = 'ladder' | 'race' | 'results';

const VIEWS: Array<{ id: View; label: string }> = [
  { id: 'ladder', label: 'Ladder' },
  { id: 'race', label: 'Race' },
  { id: 'results', label: 'Results' },
];

export function LeagueStandingsPanel({ leagueId, currentUserId }: LeagueStandingsPanelProps) {
  const [data, setData] = useState<StandingsData | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [view, setView] = useState<View>('ladder');

  useEffect(() => {
    let mounted = true;
    async function loadStandings() {
      try {
        const response = await authenticatedFetch(
          `/api/leagues/${encodeURIComponent(leagueId)}/standings`,
          {},
          currentUserId
        );
        const payload = (await response.json().catch(() => null)) as {
          success?: boolean;
          data?: StandingsData;
          error?: string;
        } | null;
        if (!response.ok || !payload?.success || !payload.data) {
          throw new Error(payload?.error ?? 'Failed to load standings.');
        }
        if (mounted) setData(payload.data);
      } catch (error) {
        if (mounted) {
          setMessage(error instanceof Error ? error.message : 'Failed to load standings.');
        }
      }
    }
    void loadStandings();
    return () => {
      mounted = false;
    };
  }, [leagueId, currentUserId]);

  const latestCompleted = data?.completedRounds.at(-1) ?? null;
  const you = data?.teams.find((team) => team.memberId === data.viewerMemberId) ?? null;
  const summary = data
    ? [
        latestCompleted ? `After round ${latestCompleted}` : 'No rounds completed yet',
        data.liveRound ? `Round ${data.liveRound} live` : null,
        data.finalsTeams > 0 ? `Top ${data.finalsTeams} make finals` : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : null;

  return (
    <section className="space-y-4" aria-labelledby="league-standings-heading">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2
            id="league-standings-heading"
            className="font-display text-2xl font-bold leading-tight text-foreground"
          >
            Standings
          </h2>
          <p className="text-sm text-muted-foreground">{summary ?? ' '}</p>
        </div>
        {you ? (
          <p className="text-sm text-foreground">
            <span className="text-muted-foreground">Your team </span>
            <span className="font-semibold">
              {ordinal(you.rank)} · {you.wins}–{you.losses}
              {you.draws ? `–${you.draws}` : ''}
            </span>
            {data && data.finalsTeams > 0 ? (
              <span className="text-muted-foreground">
                {' '}
                ·{' '}
                {you.rank <= data.finalsTeams
                  ? 'in the finals places'
                  : `${gamesToFinals(data, you.rank)} out of the finals`}
              </span>
            ) : null}
          </p>
        ) : null}
      </header>

      <div role="tablist" aria-label="Standings view" className="flex gap-1 border-b border-border">
        {VIEWS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            id={`standings-tab-${entry.id}`}
            aria-selected={view === entry.id}
            aria-controls="standings-view"
            onClick={() => setView(entry.id)}
            className={`-mb-px min-h-11 border-b-2 px-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-bar ${
              view === entry.id
                ? 'border-brand-bar text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {message ? (
        <div role="alert" className="rounded-lg border border-border bg-card px-4 py-3 text-sm">
          {message}
        </div>
      ) : null}

      <div id="standings-view" role="tabpanel" aria-labelledby={`standings-tab-${view}`}>
        {!data && !message ? (
          <p
            role="status"
            className="rounded-lg border border-border bg-card px-4 py-6 text-sm text-muted-foreground"
          >
            Loading standings…
          </p>
        ) : null}
        {data && data.teams.length === 0 ? (
          <p className="rounded-lg border border-border bg-card px-4 py-6 text-sm text-muted-foreground">
            Standings appear once teams join the league.
          </p>
        ) : null}
        {data && data.teams.length > 0 ? (
          view === 'ladder' ? (
            <StandingsLadder data={data} leagueId={leagueId} />
          ) : view === 'race' ? (
            <StandingsRace data={data} />
          ) : (
            <StandingsResults data={data} leagueId={leagueId} />
          )
        ) : null}
      </div>
    </section>
  );
}

function ordinal(value: number): string {
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${value}th`;
  return `${value}${['th', 'st', 'nd', 'rd'][value % 10] ?? 'th'}`;
}

/** Games behind the last finals place, e.g. "1.5 games". */
function gamesToFinals(data: StandingsData, rank: number): string {
  const cutoff = data.teams[data.finalsTeams - 1];
  const team = data.teams[rank - 1];
  if (!cutoff || !team) return '';
  const games = (cutoff.wins - team.wins + (team.losses - cutoff.losses)) / 2;
  if (games <= 0) return 'level on wins but';
  return `${Number.isInteger(games) ? games : games.toFixed(1)} ${games === 1 ? 'game' : 'games'}`;
}
