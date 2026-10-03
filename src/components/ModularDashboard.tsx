'use client';

import type React from 'react';
import { useCallback, useEffect, useState } from 'react';

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

import type { AuthUser } from '@/AuthContext';
import {
  CategoryBoxScore,
  MatchupScoreLine,
  resultStyle,
  TeamMark,
} from '@/components/scores/MatchupScore';
import { fetchJson } from '@/lib/api';
import { authenticatedFetch } from '@/lib/authenticatedFetch';
import { logger } from '@/lib/logger';
import type {
  CategoryResult,
  FormResult,
  ManagerHome,
  ManagerHomeLeague,
  ManagerHomeLeagueStatus,
  ManagerHomeMatchup,
} from '@/server/dashboard/managerHome';

interface ModularDashboardProps {
  user: AuthUser;
}

export interface NeedsYouItem {
  key: string;
  priority: number;
  title: string;
  detail: string;
  leagueLabel: string;
  href: string;
  action: string;
}

const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';

/** Format an instant in the league's own timezone, e.g. "Sat, 3 Oct, 7:30 pm AEST". */
export function formatLeagueTime(iso: string, timeZone: string): string {
  const date = new Date(iso);
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  };
  try {
    return new Intl.DateTimeFormat('en-AU', { ...options, timeZone }).format(date);
  } catch {
    return new Intl.DateTimeFormat('en-AU', { ...options, timeZone: 'UTC' }).format(date);
  }
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function ordinal(value: number): string {
  const tens = value % 100;
  if (tens >= 11 && tens <= 13) return `${value}th`;
  return `${value}${['th', 'st', 'nd', 'rd'][value % 10] ?? 'th'}`;
}

export function leagueStatusLabel(
  status: ManagerHomeLeagueStatus,
  timeZone: string,
  now: Date
): string {
  switch (status.kind) {
    case 'draft_live':
      return 'Draft live';
    case 'draft_paused':
      return 'Draft paused';
    case 'draft_scheduled':
      if (!status.startsAt) return 'Draft not scheduled';
      return new Date(status.startsAt).getTime() > now.getTime()
        ? `Draft ${formatLeagueTime(status.startsAt, timeZone)}`
        : `Draft not started (was set for ${formatLeagueTime(status.startsAt, timeZone)})`;
    case 'round_live':
      return `${status.roundLabel} live`;
    case 'round_upcoming':
      return status.startsAt
        ? `${status.roundLabel} starts ${formatLeagueTime(status.startsAt, timeZone)}`
        : `${status.roundLabel} next`;
    case 'season_complete':
      return 'Season complete';
    case 'season_setup':
      return 'Season setup';
  }
}

/** Plain-language result line, e.g. "You lead by 3 categories". */
export function matchupResultLine(matchup: ManagerHomeMatchup): string {
  const diff = matchup.yourCategoryWins - matchup.opponentCategoryWins;
  const margin = plural(Math.abs(diff), 'category', 'categories');
  if (matchup.status === 'scheduled') return 'Not started';
  if (matchup.status === 'final') {
    return diff > 0 ? `You won by ${margin}` : diff < 0 ? `You lost by ${margin}` : 'Drawn';
  }
  return diff > 0 ? `You lead by ${margin}` : diff < 0 ? `You trail by ${margin}` : 'Level';
}

/** Rank the real, actionable decisions across every league. Nothing here is estimated. */
export function buildNeedsYou(leagues: ManagerHomeLeague[], now: Date): NeedsYouItem[] {
  const items: NeedsYouItem[] = [];

  for (const league of leagues) {
    const leagueLabel = `${league.teamName} · ${league.leagueName}`;
    const base = `/leagues/${encodeURIComponent(league.leagueId)}`;
    const { status } = league;

    if (status.kind === 'draft_live') {
      items.push({
        key: `${league.leagueId}:draft-live`,
        priority: 0,
        title: 'Your draft is live',
        detail: `Pick ${status.currentPick} of ${status.totalPicks} is on the clock.`,
        leagueLabel,
        href: `/drafts/${encodeURIComponent(status.draftId)}`,
        action: 'Enter draft room',
      });
    }

    if (league.tradeOffersAwaitingYou.count > 0) {
      const expiry = league.tradeOffersAwaitingYou.earliestExpiresAt;
      items.push({
        key: `${league.leagueId}:trades`,
        priority: 1,
        title: `${plural(league.tradeOffersAwaitingYou.count, 'trade offer', 'trade offers')} to answer`,
        detail: expiry ? `First expires ${formatLeagueTime(expiry, league.timeZone)}.` : '',
        leagueLabel,
        href: `${base}?tab=trades`,
        action: 'Review',
      });
    }

    if (league.lineup && league.lineup.filled < league.lineup.required) {
      const empty = league.lineup.required - league.lineup.filled;
      items.push({
        key: `${league.leagueId}:lineup`,
        priority: 2,
        title: `${plural(empty, 'empty lineup spot', 'empty lineup spots')} for ${league.lineup.roundLabel}`,
        detail: league.lineup.locksAt
          ? `Locks ${formatLeagueTime(league.lineup.locksAt, league.timeZone)}.`
          : '',
        leagueLabel,
        href: `${base}?tab=lineup`,
        action: 'Set lineup',
      });
    }

    if (
      status.kind === 'draft_scheduled' &&
      status.startsAt &&
      league.role === 'commissioner' &&
      new Date(status.startsAt).getTime() <= now.getTime()
    ) {
      items.push({
        key: `${league.leagueId}:draft-overdue`,
        priority: 3,
        title: 'Your draft has not started',
        detail: `It was set for ${formatLeagueTime(status.startsAt, league.timeZone)}.`,
        leagueLabel,
        href: status.draftId ? `/drafts/${encodeURIComponent(status.draftId)}` : base,
        action: 'Open lobby',
      });
    }

    if (
      status.kind === 'draft_scheduled' &&
      status.startsAt &&
      new Date(status.startsAt).getTime() > now.getTime()
    ) {
      items.push({
        key: `${league.leagueId}:draft-scheduled`,
        priority: 4,
        title: 'Prepare for your draft',
        detail: `Starts ${formatLeagueTime(status.startsAt, league.timeZone)}.`,
        leagueLabel,
        href: status.draftId ? `/drafts/${encodeURIComponent(status.draftId)}` : base,
        action: 'Open lobby',
      });
    }

    if (status.kind === 'draft_paused') {
      items.push({
        key: `${league.leagueId}:draft-paused`,
        priority: 5,
        title: 'Your draft is paused',
        detail: 'It resumes when the commissioner restarts the clock.',
        leagueLabel,
        href: `/drafts/${encodeURIComponent(status.draftId)}`,
        action: 'Open',
      });
    }

    if (league.pendingWaiverClaims > 0) {
      items.push({
        key: `${league.leagueId}:waivers`,
        priority: 6,
        title: `${plural(league.pendingWaiverClaims, 'waiver claim', 'waiver claims')} pending`,
        detail: 'Processed at the next waiver run.',
        leagueLabel,
        href: `${base}?tab=waivers`,
        action: 'View',
      });
    }
  }

  return items.sort((a, b) => a.priority - b.priority);
}

const statusOrder: Record<ManagerHomeLeagueStatus['kind'], number> = {
  round_live: 0,
  draft_live: 1,
  round_upcoming: 2,
  draft_paused: 3,
  draft_scheduled: 4,
  season_setup: 5,
  season_complete: 6,
};

/** Put the leagues with something happening first; keep the server order otherwise. */
export function sortLeagues(leagues: ManagerHomeLeague[]): ManagerHomeLeague[] {
  return [...leagues].sort((a, b) => statusOrder[a.status.kind] - statusOrder[b.status.kind]);
}

type LoadState =
  { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; home: ManagerHome };

const formToResult: Record<FormResult, CategoryResult> = { W: 'won', L: 'lost', D: 'drawn' };

function FormGuide({ form }: { form: FormResult[] }) {
  if (form.length === 0) return null;
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span>Form</span>
      <ol className="flex gap-1" aria-label="Last results, most recent first">
        {form.map((result, index) => {
          const style = resultStyle[formToResult[result]];
          return (
            <li
              key={index}
              className={`flex size-5 items-center justify-center rounded-sm text-xs font-bold ${style.className}`}
            >
              <span aria-hidden="true">{style.letter}</span>
              <span className="sr-only">{style.label}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function LiveLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase text-destructive">
      <span className="size-1.5 rounded-full bg-destructive" aria-hidden="true" />
      {children}
    </span>
  );
}

function Scorecard({
  league,
  matchup,
}: {
  league: ManagerHomeLeague;
  matchup: ManagerHomeMatchup;
}) {
  const timing =
    matchup.status === 'live' && matchup.endsAt
      ? `Closes ${formatLeagueTime(matchup.endsAt, league.timeZone)}`
      : matchup.status === 'scheduled' && matchup.startsAt
        ? `Starts ${formatLeagueTime(matchup.startsAt, league.timeZone)}`
        : null;
  const opponentName = matchup.opponent?.teamName ?? 'Bye';

  return (
    <div className="border-t border-border px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
          {matchup.roundLabel}
          {matchup.status === 'live' ? <LiveLabel>Live</LiveLabel> : null}
          {matchup.status === 'final' ? (
            <span className="text-xs font-bold uppercase text-muted-foreground">Final</span>
          ) : null}
        </p>
        {timing ? <p className="text-xs text-muted-foreground">{timing}</p> : null}
      </div>

      <div className="mt-3">
        {matchup.opponent ? (
          <MatchupScoreLine
            you={{ teamName: league.teamName, logoUrl: league.logoUrl }}
            opponent={matchup.opponent}
            yourWins={matchup.yourCategoryWins}
            opponentWins={matchup.opponentCategoryWins}
            resultLine={matchupResultLine(matchup)}
          />
        ) : (
          <p className="text-sm text-muted-foreground">Bye this round.</p>
        )}
      </div>

      <div className="mt-4">
        <CategoryBoxScore
          caption={`${matchup.roundLabel} category box score, ${league.teamName} against ${opponentName}`}
          categories={matchup.categories}
        />
      </div>
    </div>
  );
}

function DraftBody({ league, now }: { league: ManagerHomeLeague; now: Date }) {
  const { status } = league;
  if (status.kind === 'draft_live') {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-4 sm:px-5">
        <div>
          <LiveLabel>Draft live</LiveLabel>
          <p className="mt-1 font-display text-2xl font-bold tabular-nums leading-none text-foreground">
            Pick {status.currentPick}
            <span className="ml-1.5 text-base font-semibold text-muted-foreground">
              of {status.totalPicks}
            </span>
          </p>
        </div>
        <Link
          href={`/drafts/${encodeURIComponent(status.draftId)}`}
          className={`inline-flex min-h-11 items-center rounded-md bg-brand-bar px-4 text-sm font-semibold text-brand-bar-foreground hover:bg-brand-bar/90 ${focusRing}`}
        >
          Enter draft room
        </Link>
      </div>
    );
  }
  return (
    <div className="border-t border-border px-4 py-4 text-sm sm:px-5">
      <p className="font-semibold text-foreground">
        {leagueStatusLabel(status, league.timeZone, now)}
      </p>
      <p className="mt-0.5 text-muted-foreground">
        {plural(league.memberCount, 'team', 'teams')} of {league.maxTeams} joined
      </p>
    </div>
  );
}

function TeamCard({ league, now }: { league: ManagerHomeLeague; now: Date }) {
  const base = `/leagues/${encodeURIComponent(league.leagueId)}`;
  const inSeason = !league.status.kind.startsWith('draft_');
  const links = inSeason
    ? [
        { label: 'Match centre', href: `${base}?tab=matchups` },
        { label: 'Lineup', href: `${base}?tab=lineup` },
        { label: 'Ladder', href: `${base}?tab=standings` },
        { label: 'Trades', href: `${base}?tab=trades` },
      ]
    : [
        { label: 'League', href: base },
        { label: 'Teams', href: `${base}?tab=teams` },
      ];

  return (
    <article
      className="overflow-hidden rounded-lg border border-border bg-card"
      aria-labelledby={`team-${league.leagueId}`}
    >
      <header className="flex items-center gap-3 px-4 py-3 sm:px-5">
        <TeamMark teamName={league.teamName} logoUrl={league.logoUrl} />
        <div className="min-w-0 flex-1">
          <h3
            id={`team-${league.leagueId}`}
            className="truncate font-display text-xl font-bold leading-tight text-foreground"
          >
            <Link href={base} className={`rounded-sm hover:underline ${focusRing}`}>
              {league.teamName}
            </Link>
          </h3>
          <p className="truncate text-sm text-muted-foreground">
            {league.leagueName}
            {league.seasonLabel ? ` · ${league.seasonLabel}` : ''}
          </p>
        </div>
        {league.record ? (
          <div className="shrink-0 text-right">
            <p className="font-display text-xl font-bold tabular-nums leading-none text-foreground">
              {league.record.wins}–{league.record.losses}
              {league.record.draws > 0 ? `–${league.record.draws}` : ''}
            </p>
            <p className="mt-1 text-xs font-semibold text-muted-foreground">
              {ordinal(league.record.rank)} of {league.record.teams}
            </p>
          </div>
        ) : null}
      </header>

      {league.form.length > 0 ? (
        <div className="px-4 pb-3 sm:px-5">
          <FormGuide form={league.form} />
        </div>
      ) : null}

      {inSeason && league.matchup ? <Scorecard league={league} matchup={league.matchup} /> : null}
      {inSeason && !league.matchup ? (
        <p className="border-t border-border px-4 py-4 text-sm text-muted-foreground sm:px-5">
          {leagueStatusLabel(league.status, league.timeZone, now)}
        </p>
      ) : null}
      {!inSeason ? <DraftBody league={league} now={now} /> : null}

      <nav
        aria-label={`${league.teamName} shortcuts`}
        className="grid auto-cols-fr grid-flow-col border-t border-border bg-muted"
      >
        {links.map((link) => (
          <Link
            key={link.label}
            href={link.href}
            className={`inline-flex min-h-11 items-center justify-center whitespace-nowrap px-1 text-xs font-semibold text-foreground hover:bg-accent hover:text-accent-foreground sm:px-2 sm:text-sm ${focusRing}`}
          >
            {link.label}
            {link.label === 'Lineup' && league.lineup ? (
              <span className="ml-1.5 text-xs font-medium tabular-nums text-muted-foreground">
                {league.lineup.filled}/{league.lineup.required}
              </span>
            ) : null}
          </Link>
        ))}
      </nav>
    </article>
  );
}

function RailSection({
  id,
  title,
  count,
  children,
}: {
  id: string;
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className="overflow-hidden rounded-lg border border-border bg-card"
    >
      <h2
        id={id}
        className="flex items-baseline justify-between border-b border-border px-4 py-3 font-display text-lg font-bold text-foreground"
      >
        {title}
        {count ? (
          <span className="font-sans text-sm font-semibold tabular-nums text-muted-foreground">
            {count}
          </span>
        ) : null}
      </h2>
      {children}
    </section>
  );
}

const RAIL_PREVIEW = 4;

function NeedsYouRail({ items }: { items: NeedsYouItem[] }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, RAIL_PREVIEW);
  const hidden = items.length - visible.length;

  return (
    <RailSection id="needs-you-heading" title="Needs you now" count={items.length}>
      {items.length === 0 ? (
        <p className="px-4 py-4 text-sm text-muted-foreground">Nothing needs you right now.</p>
      ) : (
        <ul id="needs-you-list" className="divide-y divide-border">
          {visible.map((item) => (
            <li key={item.key}>
              <Link
                href={item.href}
                className={`flex items-center gap-3 px-4 py-3 hover:bg-muted ${focusRing}`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-foreground">{item.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {item.leagueLabel}
                  </span>
                  {item.detail ? (
                    <span className="block text-xs text-muted-foreground">{item.detail}</span>
                  ) : null}
                </span>
                <span className="inline-flex shrink-0 items-center text-sm font-semibold text-primary">
                  {item.action}
                  <ChevronRight className="size-4" aria-hidden="true" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {items.length > RAIL_PREVIEW ? (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls="needs-you-list"
          onClick={() => setExpanded((value) => !value)}
          className={`flex min-h-11 w-full items-center justify-center border-t border-border text-sm font-semibold text-foreground hover:bg-muted ${focusRing}`}
        >
          {expanded ? 'Show fewer' : `Show ${hidden} more`}
        </button>
      ) : null}
    </RailSection>
  );
}

function LadderRail({ league }: { league: ManagerHomeLeague }) {
  if (!league.ladder || league.ladder.length === 0) return null;
  const rows = league.ladder;
  return (
    <RailSection id={`ladder-${league.leagueId}`} title="Ladder">
      <p className="border-b border-border px-4 py-2 text-xs text-muted-foreground">
        {league.leagueName}
      </p>
      <table className="w-full table-fixed text-sm">
        <caption className="sr-only">{league.leagueName} ladder</caption>
        <colgroup>
          <col className="w-11" />
          <col />
          <col className="w-16" />
          <col className="w-16" />
        </colgroup>
        <thead>
          <tr className="border-b border-border text-xs text-muted-foreground">
            <th scope="col" className="px-3 py-2 text-left font-semibold">
              Pos
            </th>
            <th scope="col" className="px-2 py-2 text-left font-semibold">
              Team
            </th>
            <th scope="col" className="bg-muted px-2 py-2 text-right font-semibold text-foreground">
              W–L
            </th>
            <th scope="col" className="px-3 py-2 text-right font-semibold">
              Cats
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const gap = index > 0 && row.position - rows[index - 1].position > 1;
            return (
              <tr
                key={row.position}
                className={`h-11 border-b border-border last:border-b-0 ${
                  row.isYou ? 'bg-accent font-semibold text-accent-foreground' : 'text-foreground'
                } ${gap ? 'border-t-2 border-t-border' : ''}`}
              >
                <td className="px-3 tabular-nums">{row.position}</td>
                <td className="px-2">
                  <span className="flex items-center gap-2">
                    <TeamMark teamName={row.teamName} logoUrl={row.logoUrl} size="sm" />
                    <span className="min-w-0 truncate">
                      {row.teamName}
                      {row.isYou ? <span className="sr-only"> (your team)</span> : null}
                    </span>
                  </span>
                </td>
                <td className="bg-muted/70 px-2 text-right font-bold tabular-nums">
                  {row.wins}–{row.losses}
                  {row.draws > 0 ? `–${row.draws}` : ''}
                </td>
                <td className="px-3 text-right tabular-nums text-muted-foreground">
                  {row.categoryWins}–{row.categoryLosses}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <Link
        href={`/leagues/${encodeURIComponent(league.leagueId)}?tab=standings`}
        className={`flex min-h-11 items-center justify-center border-t border-border text-sm font-semibold text-foreground hover:bg-muted ${focusRing}`}
      >
        Full ladder
      </Link>
    </RailSection>
  );
}

function SecondaryLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={`inline-flex min-h-11 items-center justify-center rounded-md border border-border bg-card px-4 text-sm font-semibold text-foreground transition hover:bg-muted ${focusRing}`}
    >
      {children}
    </Link>
  );
}

export default function ModularDashboard({ user }: ModularDashboardProps): React.ReactElement {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: 'loading' });

    fetchJson<{ success: boolean; data: ManagerHome }>('/api/dashboard/home', {
      fetcher: authenticatedFetch,
      userId: user.uid,
      signal: controller.signal,
    })
      .then((response) => setState({ kind: 'ready', home: response.data }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        logger.error('Failed to load manager home', error);
        setState({ kind: 'error', message: 'We could not load your leagues.' });
      });

    return () => controller.abort();
  }, [attempt, user.uid]);

  const leagues = state.kind === 'ready' ? sortLeagues(state.home.leagues) : [];
  const generatedAt = state.kind === 'ready' ? new Date(state.home.generatedAt) : new Date(0);
  const needsYou = state.kind === 'ready' ? buildNeedsYou(leagues, generatedAt) : [];
  const ladderLeague = leagues.find((league) => league.ladder && league.ladder.length > 0) ?? null;

  return (
    <main className="min-h-screen bg-muted">
      <div className="mx-auto flex max-w-[var(--app-shell-max-width)] flex-col gap-5 px-4 pb-12 pt-6 sm:px-6 lg:px-8 2xl:px-10">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <h1 className="font-display text-3xl font-bold text-foreground">Your leagues</h1>
          <div className="flex gap-2">
            <SecondaryLink href="/leagues/join">Join league</SecondaryLink>
            <SecondaryLink href="/leagues/new">Create league</SecondaryLink>
          </div>
        </header>

        {state.kind === 'loading' ? (
          <p role="status" className="text-sm text-muted-foreground">
            Loading your leagues…
          </p>
        ) : null}

        {state.kind === 'error' ? (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-4 py-4"
          >
            <p className="text-sm text-foreground">{state.message}</p>
            <button
              type="button"
              onClick={retry}
              className={`inline-flex min-h-11 items-center rounded-md border border-border px-4 text-sm font-semibold text-foreground hover:bg-muted ${focusRing}`}
            >
              Try again
            </button>
          </div>
        ) : null}

        {state.kind === 'ready' && leagues.length === 0 ? (
          <section
            aria-labelledby="no-leagues-heading"
            className="rounded-lg border border-border bg-card px-4 py-6"
          >
            <h2 id="no-leagues-heading" className="font-semibold text-foreground">
              You are not in a league yet
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Join a league with an invite code, or create one and invite your friends.
            </p>
          </section>
        ) : null}

        {state.kind === 'ready' && leagues.length > 0 ? (
          <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="lg:col-start-2 lg:row-start-1">
              <NeedsYouRail items={needsYou} />
            </div>
            <section
              id="leagues"
              aria-labelledby="leagues-heading"
              className="scroll-mt-24 lg:col-start-1 lg:row-span-2 lg:row-start-1"
            >
              <h2 id="leagues-heading" className="sr-only">
                My teams
              </h2>
              <div className="grid items-start gap-5 xl:grid-cols-2">
                {leagues.map((league) => (
                  <TeamCard key={league.leagueId} league={league} now={generatedAt} />
                ))}
              </div>
            </section>
            {ladderLeague ? (
              <div className="lg:col-start-2 lg:row-start-2">
                <LadderRail league={ladderLeague} />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </main>
  );
}
