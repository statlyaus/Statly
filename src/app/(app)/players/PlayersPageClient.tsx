'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowDownAZ, ArrowUpAZ, Search, SlidersHorizontal, Users } from 'lucide-react';

import { LeagueSocialDiscussButton } from '@/components/league/LeagueSocialDiscussButton';
import type { Player } from '@/types/players';

interface PlayersPageClientProps {
  players: Player[];
}

type SortKey =
  | 'name'
  | 'team'
  | 'position'
  | 'aflFantasy'
  | 'supercoach'
  | 'disposals'
  | 'goals'
  | 'tackles'
  | 'marks';
type SortDir = 'asc' | 'desc';

const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: 'name', label: 'Name' },
  { value: 'team', label: 'Club' },
  { value: 'position', label: 'Position' },
  { value: 'aflFantasy', label: 'AFL Fantasy' },
  { value: 'supercoach', label: 'SuperCoach' },
  { value: 'disposals', label: 'Disposals' },
  { value: 'goals', label: 'Goals' },
  { value: 'tackles', label: 'Tackles' },
  { value: 'marks', label: 'Marks' },
];

const CORE_STATS: Array<{ key: SortKey; label: string }> = [
  { key: 'aflFantasy', label: 'AF' },
  { key: 'supercoach', label: 'SC' },
  { key: 'disposals', label: 'D' },
  { key: 'goals', label: 'G' },
  { key: 'tackles', label: 'T' },
];

function getPlayerValue(player: Player, key: SortKey): string | number | null {
  const direct = player[key as keyof Player];
  const nested = player.stats?.[key];
  const value = direct ?? nested;

  if (typeof value === 'number' || typeof value === 'string') return value;
  return null;
}

function formatStat(value: string | number | null): string {
  if (value == null || value === '') return '-';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(1);
  return value;
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

export default function PlayersPageClient({ players }: PlayersPageClientProps) {
  const [query, setQuery] = useState('');
  const [teamFilter, setTeamFilter] = useState('ALL');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const teams = useMemo(() => {
    const unique = new Set(
      players
        .map((player) => player.team)
        .filter((value): value is string => Boolean(value))
        .map((value) => value.trim()),
    );
    return ['ALL', ...Array.from(unique).sort()];
  }, [players]);

  const visiblePlayers = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return players
      .filter((player) => {
        const matchesQuery =
          normalizedQuery.length === 0 ||
          player.name.toLowerCase().includes(normalizedQuery) ||
          player.team?.toLowerCase().includes(normalizedQuery);
        const matchesTeam = teamFilter === 'ALL' || player.team === teamFilter;
        return matchesQuery && matchesTeam;
      })
      .sort((a, b) => {
        const aValue = getPlayerValue(a, sortKey);
        const bValue = getPlayerValue(b, sortKey);

        if (aValue == null && bValue == null) return a.name.localeCompare(b.name);
        if (aValue == null) return 1;
        if (bValue == null) return -1;

        const direction = sortDir === 'asc' ? 1 : -1;
        if (typeof aValue === 'number' && typeof bValue === 'number') {
          return (aValue - bValue) * direction;
        }

        return String(aValue).localeCompare(String(bValue)) * direction;
      });
  }, [players, teamFilter, query, sortDir, sortKey]);

  const featuredPlayers = visiblePlayers.slice(0, 12);

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,var(--league-surface)_0%,var(--league-page)_44%,var(--league-surface-muted)_100%)] text-[color:var(--league-text)]">
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <section className="rounded-[28px] border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-5 shadow-[0_22px_70px_-46px_rgba(23,34,48,0.35)] sm:p-6">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <div className="max-w-3xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[color:var(--league-text-muted)]">
                Player database
              </p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[color:var(--league-text)] sm:text-4xl">
                AFL player board
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-[color:var(--league-text-muted)] sm:text-base">
                Search the player pool, compare core production, and move quickly from rankings
                into player profiles.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:min-w-[360px]">
              <div className="rounded-2xl border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--league-text-muted)]">
                  Players
                </p>
                <p className="mt-1 text-2xl font-semibold text-[color:var(--league-text)]">
                  {players.length}
                </p>
              </div>
              <div className="rounded-2xl border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--league-text-muted)]">
                  Showing
                </p>
                <p className="mt-1 text-2xl font-semibold text-[color:var(--league-text)]">
                  {visiblePlayers.length}
                </p>
              </div>
              <div className="col-span-2 rounded-2xl border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-4 py-3 sm:col-span-1">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--league-text-muted)]">
                  Clubs
                </p>
                <p className="mt-1 text-2xl font-semibold text-[color:var(--league-text)]">
                  {Math.max(teams.length - 1, 0)}
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-[28px] border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-4 shadow-[0_22px_70px_-48px_rgba(23,34,48,0.28)] sm:p-5">
          <div className="grid gap-3 lg:grid-cols-[minmax(260px,1fr)_180px_180px_auto]">
            <label className="relative block">
              <span className="sr-only">Search players</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--league-text-muted)]" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search player or club"
                className="h-11 w-full rounded-2xl border border-[color:var(--league-border)] bg-[color:var(--league-page)] pl-10 pr-3 text-sm font-medium text-[color:var(--league-text)] outline-none transition placeholder:text-[color:var(--league-text-muted)] focus:border-[color:var(--league-primary)] focus:ring-2 focus:ring-[color:var(--league-primary)]/20"
              />
            </label>

            <label className="block">
              <span className="sr-only">Filter by club</span>
              <select
                value={teamFilter}
                onChange={(event) => setTeamFilter(event.target.value)}
                className="h-11 w-full rounded-2xl border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-3 text-sm font-semibold text-[color:var(--league-text)] outline-none transition focus:border-[color:var(--league-primary)] focus:ring-2 focus:ring-[color:var(--league-primary)]/20"
              >
                {teams.map((option) => (
                  <option key={option} value={option}>
                    {option === 'ALL' ? 'All clubs' : option}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="sr-only">Sort players</span>
              <select
                value={sortKey}
                onChange={(event) => setSortKey(event.target.value as SortKey)}
                className="h-11 w-full rounded-2xl border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-3 text-sm font-semibold text-[color:var(--league-text)] outline-none transition focus:border-[color:var(--league-primary)] focus:ring-2 focus:ring-[color:var(--league-primary)]/20"
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    Sort: {option.label}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="button"
              onClick={() => setSortDir(sortDir === 'asc' ? 'desc' : 'asc')}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-4 text-sm font-semibold text-[color:var(--league-text)] transition hover:bg-[color:var(--league-surface-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)]"
              aria-label={`Sort ${sortDir === 'asc' ? 'descending' : 'ascending'}`}
            >
              {sortDir === 'asc' ? (
                <ArrowDownAZ className="h-4 w-4" aria-hidden="true" />
              ) : (
                <ArrowUpAZ className="h-4 w-4" aria-hidden="true" />
              )}
              {sortDir === 'asc' ? 'Ascending' : 'Descending'}
            </button>
          </div>
        </section>

        {featuredPlayers.length > 0 ? (
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {featuredPlayers.map((player) => (
              <article
                key={player.id}
                className="group rounded-[24px] border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-4 shadow-[0_18px_55px_-44px_rgba(23,34,48,0.4)] transition hover:-translate-y-0.5 hover:border-[color:var(--league-primary)]/35 hover:shadow-[0_24px_60px_-42px_rgba(23,34,48,0.45)]"
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[color:var(--league-primary)] text-sm font-semibold text-white">
                    {getInitials(player.name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="truncate text-base font-semibold tracking-tight text-[color:var(--league-text)]">
                          {player.name}
                        </h2>
                        <p className="mt-1 text-sm text-[color:var(--league-text-muted)]">
                          {[player.team, player.position].filter(Boolean).join(' / ') || 'No club'}
                        </p>
                      </div>
                      <span className="rounded-full border border-[color:var(--league-border)] bg-[color:var(--league-primary-soft)] px-2.5 py-1 text-xs font-semibold text-[color:var(--league-primary)]">
                        {player.position || player.team?.slice(0, 3).toUpperCase() || 'AFL'}
                      </span>
                    </div>
                  </div>
                </div>

                <dl className="mt-5 grid grid-cols-5 gap-2">
                  {CORE_STATS.map((stat) => (
                    <div
                      key={stat.key}
                      className="rounded-2xl border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-2 py-2 text-center"
                    >
                      <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--league-text-muted)]">
                        {stat.label}
                      </dt>
                      <dd className="mt-1 text-sm font-semibold text-[color:var(--league-text)]">
                        {formatStat(getPlayerValue(player, stat.key))}
                      </dd>
                    </div>
                  ))}
                </dl>

                <div className="mt-4 flex items-center justify-between gap-3 border-t border-[color:var(--league-border)] pt-4">
                  <div className="inline-flex items-center gap-2 text-xs font-medium text-[color:var(--league-text-muted)]">
                    <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                    {sortKey === 'name'
                      ? 'Profile ready'
                      : `${SORT_OPTIONS.find((option) => option.value === sortKey)?.label}: ${formatStat(
                          getPlayerValue(player, sortKey),
                        )}`}
                  </div>
                  <div className="flex items-center gap-2">
                    <LeagueSocialDiscussButton
                      context={{
                        type: 'player',
                        id: String(player.id),
                        title: player.name,
                        subtitle:
                          [player.team, player.position].filter(Boolean).join(' · ') || undefined,
                        metadata: {
                          ...(player.team ? { club: player.team } : {}),
                          ...(player.position ? { position: player.position } : {}),
                        },
                      }}
                    />
                    <Link
                      href={`/players/${player.id}`}
                      className="rounded-full bg-[color:var(--league-primary)] px-3 py-2 text-xs font-semibold text-white transition hover:bg-[color:var(--league-primary-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)] focus-visible:ring-offset-2"
                    >
                      View profile
                    </Link>
                  </div>
                </div>
              </article>
            ))}
          </section>
        ) : (
          <section className="rounded-[28px] border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-8 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[color:var(--league-primary-soft)] text-[color:var(--league-primary)]">
              <Users className="h-5 w-5" aria-hidden="true" />
            </div>
            <h2 className="mt-4 text-lg font-semibold text-[color:var(--league-text)]">
              No players match those filters
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[color:var(--league-text-muted)]">
              Clear the search field or choose all clubs to return to the full player board.
            </p>
          </section>
        )}
      </div>
    </main>
  );
}
