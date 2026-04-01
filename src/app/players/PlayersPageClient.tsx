'use client';

import { useEffect, useMemo, useState } from 'react';

import Link from 'next/link';
import {
  ArrowRightIcon,
  ChartBarIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/outline';

import { useAuth } from '@/AuthContext';
import LeagueViewHeader from '@/components/league/LeagueViewHeader';
import { useLeagueStatColumns } from '@/hooks/useLeagueStatColumns';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { useUserLeagues } from '@/hooks/useUserLeagues';
import { fetchApi } from '@/lib/api';
import { CANONICAL_STAT_KEYS, STAT_COLUMNS } from '@/lib/stats/statColumns';
import type { CanonicalStatKey } from '@/lib/stats/statColumns';
import { getTeamAbbreviation } from '@/lib/teamLogos';
import type { Player } from '@/types/players';

interface PlayersPageClientProps {
  players: Player[];
  initialLeagueId?: string;
  lockLeagueId?: boolean;
  embedded?: boolean;
}

type PlayerRow = Player & {
  ownershipStatus?: 'Owned' | 'Waiver' | 'Available';
  ownerTeam?: string;
  ownerUserId?: string;
  ownerTeamName?: string;
  statsSummary?: {
    disposals?: number;
    tackles?: number;
    marks?: number;
    goals?: number;
  };
};

type SortKey = 'name' | 'team' | 'position' | 'ownership' | CanonicalStatKey;

type LeaguePlayerSupplement = {
  id: string;
  name: string;
  team?: string;
  position?: string;
  ownership?: number;
  avg?: number;
  statsSummary?: PlayerRow['statsSummary'];
  ownershipStatus?: PlayerRow['ownershipStatus'];
  ownerUserId?: string;
  ownerTeam?: string;
  ownerTeamName?: string;
};

type PlayerApiResponse = {
  players?: Player[];
  data?: {
    players?: Player[];
  };
};

type LeaguePlayersApiResponse = {
  items?: LeaguePlayerSupplement[];
  data?: {
    items?: LeaguePlayerSupplement[];
  };
};

function getFallbackStatsFromSummary(summary?: PlayerRow['statsSummary']): Record<string, number> {
  if (!summary) return {};

  const stats: Record<string, number> = {};
  if (typeof summary.disposals === 'number') stats.disposals = summary.disposals;
  if (typeof summary.tackles === 'number') stats.tackles = summary.tackles;
  if (typeof summary.marks === 'number') stats.marks = summary.marks;
  if (typeof summary.goals === 'number') stats.goals = summary.goals;
  return stats;
}

function extractPlayerRows(response: unknown): PlayerRow[] {
  const body = response as PlayerApiResponse | Player[] | null | undefined;
  if (Array.isArray(body)) {
    return body as PlayerRow[];
  }
  if (Array.isArray(body?.players)) {
    return body.players as PlayerRow[];
  }
  if (Array.isArray(body?.data?.players)) {
    return body.data.players as PlayerRow[];
  }
  return [];
}

function extractLeagueSupplements(response: unknown): LeaguePlayerSupplement[] {
  const body = response as LeaguePlayersApiResponse | LeaguePlayerSupplement[] | null | undefined;
  if (Array.isArray(body)) {
    return body;
  }
  if (Array.isArray(body?.items)) {
    return body.items;
  }
  if (Array.isArray(body?.data?.items)) {
    return body.data.items;
  }
  return [];
}

function buildPlayerIdentityKey(name?: string, team?: string): string {
  return `${String(name ?? '').trim().toLowerCase()}|${String(team ?? '').trim().toLowerCase()}`;
}

export function mergeLeaguePlayerRows(
  baseRows: PlayerRow[],
  supplements: LeaguePlayerSupplement[]
): PlayerRow[] {
  if (supplements.length === 0) return baseRows;

  const supplementById = new Map(supplements.map((item) => [item.id, item]));
  const supplementByIdentity = new Map(
    supplements.map((item) => [buildPlayerIdentityKey(item.name, item.team), item])
  );
  const merged = baseRows.map((player) => {
    const supplement =
      supplementById.get(player.id) ??
      supplementByIdentity.get(buildPlayerIdentityKey(player.name, player.team));
    if (!supplement) return player;

    const mergedStats = {
      ...getFallbackStatsFromSummary(supplement.statsSummary),
      ...(player.stats ?? {}),
    };

    return {
      ...player,
      name: supplement.name || player.name,
      team: supplement.team ?? player.team,
      position: supplement.position ?? player.position,
      avg: supplement.avg ?? player.avg,
      ownership: supplement.ownership ?? player.ownership,
      ownershipStatus: supplement.ownershipStatus ?? player.ownershipStatus,
      ownerUserId: supplement.ownerUserId ?? player.ownerUserId,
      ownerTeam:
        supplement.ownerTeam ?? supplement.ownerTeamName ?? player.ownerTeam ?? player.ownerTeamName,
      ownerTeamName:
        supplement.ownerTeamName ?? supplement.ownerTeam ?? player.ownerTeamName ?? player.ownerTeam,
      statsSummary: supplement.statsSummary ?? player.statsSummary,
      stats: mergedStats,
    };
  });

  const knownIds = new Set(merged.map((player) => player.id));
  const knownIdentities = new Set(
    merged.map((player) => buildPlayerIdentityKey(player.name, player.team))
  );
  for (const supplement of supplements) {
    const identityKey = buildPlayerIdentityKey(supplement.name, supplement.team);
    if (knownIds.has(supplement.id) || knownIdentities.has(identityKey)) continue;

    const fallbackStats = getFallbackStatsFromSummary(supplement.statsSummary);
    merged.push({
      id: supplement.id,
      name: supplement.name,
      team: supplement.team,
      position: supplement.position,
      avg: supplement.avg,
      ownership: supplement.ownership,
      ownershipStatus: supplement.ownershipStatus,
      ownerUserId: supplement.ownerUserId,
      ownerTeam: supplement.ownerTeam ?? supplement.ownerTeamName,
      ownerTeamName: supplement.ownerTeamName ?? supplement.ownerTeam,
      statsSummary: supplement.statsSummary,
      stats: fallbackStats,
      ...fallbackStats,
    } as PlayerRow);
  }

  return merged;
}

const getStatValue = (player: Player, key: CanonicalStatKey): number => {
  const fromStats = player.stats?.[key];
  if (typeof fromStats === 'number') return fromStats;
  if (typeof fromStats === 'string') {
    const parsed = Number.parseFloat(fromStats);
    if (!Number.isNaN(parsed)) return parsed;
  }

  const fromPlayer = (player as unknown as Record<string, unknown>)[key];
  if (typeof fromPlayer === 'number') return fromPlayer;
  if (typeof fromPlayer === 'string') {
    const parsed = Number.parseFloat(fromPlayer);
    if (!Number.isNaN(parsed)) return parsed;
  }

  return 0;
};

const STAT_ACCESSORS: Record<CanonicalStatKey, (player: Player) => number> =
  CANONICAL_STAT_KEYS.reduce(
    (acc, key) => {
      acc[key] = (player: Player) => getStatValue(player, key);
      return acc;
    },
    {} as Record<CanonicalStatKey, (player: Player) => number>
  );

function getCurrentAflSeason(): number {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  return month >= 3 ? year : year - 1;
}

export default function PlayersPageClient({
  players,
  initialLeagueId,
  lockLeagueId = false,
  embedded = false,
}: PlayersPageClientProps) {
  const { user } = useAuth();
  const [leagueId, setLeagueId] = useLocalStorage<string>('ui.lastLeagueId', '');
  const [selectedSeason, setSelectedSeason] = useLocalStorage<number>(
    'ui.playersSeason',
    getCurrentAflSeason()
  );
  const [playerRows, setPlayerRows] = useState<PlayerRow[]>(players as PlayerRow[]);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [teamFilter, setTeamFilter] = useState<string>('all');
  const [positionFilter, setPositionFilter] = useState<string>('all');
  const [isLoadingLeagueData, setIsLoadingLeagueData] = useState(false);

  const teams = useMemo(() => {
    const teamSet = new Set<string>();
    playerRows.forEach((player) => {
      if (player.team) teamSet.add(player.team);
    });
    return Array.from(teamSet).sort();
  }, [playerRows]);

  const positions = useMemo(() => {
    const positionSet = new Set<string>();
    playerRows.forEach((player) => {
      if (player.position) positionSet.add(player.position);
    });
    return Array.from(positionSet).sort();
  }, [playerRows]);

  const { leagues: userLeagues } = useUserLeagues(user?.uid);
  const effectiveLeagueId = lockLeagueId && initialLeagueId ? initialLeagueId : leagueId;
  const selectedLeague = userLeagues.find((league) => league.id === effectiveLeagueId);
  const { visibleKeys, allKeys, toggleKey, defaultKeys } = useLeagueStatColumns(effectiveLeagueId);

  useEffect(() => {
    if (lockLeagueId && initialLeagueId) {
      if (leagueId !== initialLeagueId) setLeagueId(initialLeagueId);
      return;
    }
    if (!leagueId && userLeagues.length > 0) {
      setLeagueId(userLeagues[0].id);
    }
  }, [initialLeagueId, leagueId, lockLeagueId, setLeagueId, userLeagues]);

  useEffect(() => {
    let mounted = true;
    let didFetch = false;

    (async () => {
      setIsLoadingLeagueData(true);
      try {
        const params = new URLSearchParams({
          limit: '1000',
          page: '1',
          season: String(selectedSeason),
        });
        if (effectiveLeagueId) params.set('leagueId', effectiveLeagueId);

        const playersRequest = fetchApi(`players?${params.toString()}`);
        const leaguePlayersRequest = effectiveLeagueId
          ? fetchApi(`leagues/${effectiveLeagueId}/players?limit=1000`)
          : Promise.resolve(null);
        const [playersResponse, leaguePlayersResponse] = await Promise.all([
          playersRequest,
          leaguePlayersRequest,
        ]);
        didFetch = true;

        const baseRows = extractPlayerRows(playersResponse);
        const supplements = extractLeagueSupplements(leaguePlayersResponse);
        const mergedRows = mergeLeaguePlayerRows(baseRows, supplements);
        if (mounted && mergedRows.length) {
          setPlayerRows(mergedRows);
        }
      } catch (err) {
        console.error('Failed to fetch aggregated stats:', err);
        if (mounted && !didFetch) setPlayerRows(players as PlayerRow[]);
      } finally {
        if (mounted) setIsLoadingLeagueData(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [effectiveLeagueId, players, selectedSeason]);

  const filteredAndSortedPlayers = useMemo(() => {
    const filtered = playerRows.filter((player) => {
      const matchesSearch =
        searchQuery === '' ||
        player.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        player.team?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        player.position?.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesTeam = teamFilter === 'all' || player.team === teamFilter;
      const matchesPosition = positionFilter === 'all' || player.position === positionFilter;

      return matchesSearch && matchesTeam && matchesPosition;
    });

    filtered.sort((a, b) => {
      let aVal: number | string;
      let bVal: number | string;

      if (sortKey === 'name') {
        aVal = a.name;
        bVal = b.name;
      } else if (sortKey === 'team') {
        aVal = a.team || '';
        bVal = b.team || '';
      } else if (sortKey === 'position') {
        aVal = a.position || '';
        bVal = b.position || '';
      } else if (sortKey === 'ownership') {
        aVal = typeof a.ownership === 'number' ? a.ownership : 0;
        bVal = typeof b.ownership === 'number' ? b.ownership : 0;
      } else {
        const accessor = STAT_ACCESSORS[sortKey as CanonicalStatKey];
        aVal = accessor ? accessor(a) : 0;
        bVal = accessor ? accessor(b) : 0;
      }

      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
      }

      return sortDir === 'asc'
        ? String(aVal).localeCompare(String(bVal))
        : String(bVal).localeCompare(String(aVal));
    });

    return filtered;
  }, [playerRows, positionFilter, searchQuery, sortDir, sortKey, teamFilter]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const renderStatus = (player: PlayerRow) => {
    const status =
      player.ownershipStatus ??
      (typeof player.ownership === 'number' && player.ownership > 0 ? 'Owned' : 'Available');
    const owner = status === 'Owned' ? player.ownerTeam : undefined;
    const statusClasses =
      status === 'Owned'
        ? 'border-[color:var(--league-success-soft)] bg-[color:var(--league-success-soft)] text-[color:var(--league-success)]'
        : status === 'Waiver'
          ? 'border-[color:var(--league-warning-soft)] bg-[color:var(--league-warning-soft)] text-[color:var(--league-warning)]'
          : 'border-[color:var(--league-border)] bg-[color:var(--league-surface-muted)] text-[color:var(--league-text-muted)]';

    return (
      <div className="flex items-center justify-center gap-2">
        <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${statusClasses}`}>
          {status}
        </span>
        {owner ? (
          <span className="text-xs text-[color:var(--league-text-muted)]" title={owner}>
            {getTeamAbbreviation(owner)}
          </span>
        ) : null}
      </div>
    );
  };

  const SortableHeader = ({
    columnKey,
    label,
    align = 'left',
  }: {
    columnKey: SortKey;
    label: string;
    align?: 'left' | 'center' | 'right';
  }) => {
    const isActive = sortKey === columnKey;
    const alignClass =
      align === 'center' ? 'text-center' : align === 'right' ? 'text-right' : 'text-left';

    return (
      <th
        className={`cursor-pointer select-none px-3 py-3 ${alignClass} text-xs font-medium uppercase tracking-wider text-white/72 transition hover:bg-white/10`}
        onClick={() => handleSort(columnKey)}
      >
        <div className={`flex items-center gap-1 ${align === 'center' ? 'justify-center' : ''}`}>
          {label}
          {isActive ? <span className="text-white">{sortDir === 'asc' ? '↑' : '↓'}</span> : null}
        </div>
      </th>
    );
  };

  const totalTeams = teams.length;
  const totalPositions = positions.length;
  const seasonOptions = [...(getCurrentAflSeason() >= 2026 ? [2026] : []), 2025, 2024, 2023];
  const leagueStatusLabel = isLoadingLeagueData
    ? `Loading ${selectedSeason} season averages...`
    : leagueId
      ? `${selectedSeason} season averages • Ownership for selected league`
      : `Showing ${selectedSeason} season averages`;
  const shellClassName = embedded
    ? 'space-y-6'
    : 'mx-auto w-full max-w-[var(--app-shell-max-width)] space-y-6 px-4 py-6 sm:px-6 lg:px-8 2xl:px-10';
  const selectClassName =
    'w-full rounded-2xl border border-[color:var(--league-border)] bg-[color:var(--league-surface-muted)] px-4 py-3 text-sm text-[color:var(--league-text)] focus:outline-none focus:ring-2 focus:ring-[color:var(--league-primary)]';
  const searchFieldClassName =
    'flex items-center gap-3 rounded-2xl border border-[color:var(--league-border)] bg-[color:var(--league-surface-muted)] px-4 py-3 text-[color:var(--league-text)]';

  return (
    <div className={embedded ? undefined : 'bg-[color:var(--league-page)]'}>
      <div className={shellClassName}>
        <LeagueViewHeader
          eyebrow={embedded ? 'Player pool' : 'Player market'}
          title={embedded ? 'Players and league ownership' : 'Players and season research'}
          description={
            embedded
              ? 'Research the full pool with league ownership context, then move directly into roster, waiver, or trade decisions without leaving the workspace.'
              : 'A desktop research surface for comparing season averages, ownership, and league context with the same design language used across the updated product.'
          }
          chips={[
            { label: `${playerRows.length} players` },
            { label: `${selectedSeason} season`, tone: 'accent' },
            { label: `${totalTeams} teams` },
            { label: `${totalPositions} positions` },
            {
              label: selectedLeague ? selectedLeague.name : 'No league selected',
              tone: selectedLeague ? 'success' : 'neutral',
            },
            {
              label: leagueStatusLabel,
              tone: isLoadingLeagueData ? 'warning' : leagueId ? 'success' : 'neutral',
            },
          ]}
          actions={
            embedded ? undefined : (
              <>
                {selectedLeague ? (
                  <Link
                    href={`/leagues/${selectedLeague.id}?tab=players`}
                    className="inline-flex items-center gap-2 rounded-full border border-[color:var(--league-border)] bg-[color:var(--league-surface)] px-4 py-2.5 text-sm font-semibold text-[color:var(--league-text-muted)] transition hover:border-[color:var(--league-accent)] hover:bg-[color:var(--league-accent-soft)] hover:text-[color:var(--league-text)]"
                  >
                    Open league view
                    <ArrowRightIcon className="h-4 w-4" />
                  </Link>
                ) : null}
                <Link
                  href="/rankings"
                  className="inline-flex items-center gap-2 rounded-full bg-[color:var(--league-primary)] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[color:var(--league-primary-hover)]"
                >
                  Open rankings
                  <ChartBarIcon className="h-4 w-4" />
                </Link>
              </>
            )
          }
          aside={
            embedded ? undefined : (
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-[color:var(--league-border)] bg-[color:var(--league-surface)] px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[color:var(--league-text-muted)]">
                    Active league
                  </p>
                  <p className="mt-1 text-base font-semibold text-[color:var(--league-text)]">
                    {selectedLeague?.name ?? 'Global pool'}
                  </p>
                </div>
                <div className="rounded-2xl border border-[color:var(--league-border)] bg-[color:var(--league-surface)] px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[color:var(--league-text-muted)]">
                    Visible players
                  </p>
                  <p className="mt-1 text-base font-semibold text-[color:var(--league-text)]">
                    {filteredAndSortedPlayers.length}
                  </p>
                </div>
                <div className="rounded-2xl border border-[color:var(--league-border)] bg-[color:var(--league-surface)] px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[color:var(--league-text-muted)]">
                    Stat columns
                  </p>
                  <p className="mt-1 text-base font-semibold text-[color:var(--league-text)]">
                    {visibleKeys.length}/{allKeys.length}
                  </p>
                </div>
              </div>
            )
          }
        />

        <section className="overflow-hidden rounded-[32px] border border-[color:var(--league-border)] bg-[color:var(--league-surface)] shadow-[0_24px_60px_-45px_rgba(23,34,48,0.18)]">
          <div className="border-b border-[color:var(--league-border)] px-6 py-5">
            <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-[color:var(--league-text-muted)]">
                  Filter and compare
                </p>
                <h2 className="mt-2 text-xl font-semibold text-[color:var(--league-text)]">
                  Player research controls
                </h2>
                <p className="mt-2 text-sm text-[color:var(--league-text-muted)]">
                  Narrow the market by season, league, team, and position before comparing stat columns.
                </p>
              </div>
              <div className="rounded-2xl border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-4 py-3 text-sm text-[color:var(--league-text-muted)]">
                {filteredAndSortedPlayers.length} visible • {playerRows.length} total loaded
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 px-6 py-6 lg:grid-cols-12">
            <div className="lg:col-span-4">
              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--league-text-muted)]">
                  Search
                </span>
                <div className={searchFieldClassName}>
                  <MagnifyingGlassIcon className="h-5 w-5 shrink-0 text-[color:var(--league-text-muted)]" />
                  <input
                    type="text"
                    placeholder="Search players, teams, positions..."
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    className="w-full bg-transparent text-[color:var(--league-text)] placeholder:text-[color:var(--league-text-muted)] focus:outline-none"
                  />
                </div>
              </label>
            </div>
            <div className="lg:col-span-2">
              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--league-text-muted)]">
                  Season
                </span>
                <select
                  value={selectedSeason}
                  onChange={(event) => setSelectedSeason(Number(event.target.value))}
                  className={selectClassName}
                >
                  {seasonOptions.map((season) => (
                    <option key={season} value={season} className="text-slate-900">
                      {season} Season
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="lg:col-span-3">
              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--league-text-muted)]">
                  League
                </span>
                {lockLeagueId && selectedLeague ? (
                  <div className={selectClassName}>{selectedLeague.name}</div>
                ) : (
                  <select
                    value={leagueId}
                    onChange={(event) => setLeagueId(event.target.value)}
                    className={selectClassName}
                  >
                    <option value="">Select league</option>
                    {userLeagues.map((league) => (
                      <option key={league.id} value={league.id} className="text-slate-900">
                        {league.name}
                      </option>
                    ))}
                  </select>
                )}
              </label>
            </div>
            <div className="lg:col-span-2">
              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--league-text-muted)]">
                  AFL team
                </span>
                <select
                  value={teamFilter}
                  onChange={(event) => setTeamFilter(event.target.value)}
                  className={selectClassName}
                >
                  <option value="all">All Teams</option>
                  {teams.map((team) => (
                    <option key={team} value={team} className="text-slate-900">
                      {team}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="lg:col-span-1">
              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--league-text-muted)]">
                  Position
                </span>
                <select
                  value={positionFilter}
                  onChange={(event) => setPositionFilter(event.target.value)}
                  className={selectClassName}
                >
                  <option value="all">All Positions</option>
                  {positions.map((position) => (
                    <option key={position} value={position} className="text-slate-900">
                      {position}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        </section>

        <section className="overflow-hidden rounded-[32px] border border-[color:var(--league-border)] bg-[color:var(--league-surface)] shadow-[0_24px_60px_-45px_rgba(23,34,48,0.18)]">
          <div className="border-b border-[color:var(--league-border)] px-6 py-4">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-[color:var(--league-text-muted)]">
                  Stat columns
                </p>
                <h2 className="mt-2 text-lg font-semibold text-[color:var(--league-text)]">
                  Tune the comparison set
                </h2>
              </div>
              <div className="text-sm text-[color:var(--league-text-muted)]">
                League defaults: {defaultKeys.length} columns
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 px-6 py-5">
            {allKeys.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => toggleKey(key)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                  visibleKeys.includes(key)
                    ? 'bg-[color:var(--league-primary)] text-white'
                    : 'border border-[color:var(--league-border)] bg-[color:var(--league-surface-muted)] text-[color:var(--league-text-muted)] hover:border-[color:var(--league-accent)] hover:bg-[color:var(--league-accent-soft)] hover:text-[color:var(--league-text)]'
                }`}
              >
                {STAT_COLUMNS[key]?.short ?? STAT_COLUMNS[key]?.label ?? key}
              </button>
            ))}
          </div>
        </section>

        <section className="overflow-hidden rounded-[32px] border border-[color:var(--league-border)] bg-[color:var(--league-surface)] shadow-[0_24px_60px_-45px_rgba(23,34,48,0.18)]">
          <div className="border-b border-[color:var(--league-border)] px-6 py-4">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-[color:var(--league-text-muted)]">
                  Player table
                </p>
                <h2 className="mt-2 text-lg font-semibold text-[color:var(--league-text)]">
                  Season averages and ownership
                </h2>
              </div>
              <div className="text-sm text-[color:var(--league-text-muted)]">
                Showing {filteredAndSortedPlayers.length} of {playerRows.length} players
                {selectedLeague ? <span className="ml-2 text-xs">• {selectedLeague.name}</span> : null}
              </div>
            </div>
          </div>

          <div className="max-h-[calc(100vh-22rem)] overflow-x-auto overflow-y-auto">
            <table className="min-w-full divide-y divide-[color:var(--league-border)]">
              <thead className="sticky top-0 z-10 bg-[color:var(--league-primary)] backdrop-blur">
                <tr>
                  <SortableHeader columnKey="name" label="Player" />
                  <SortableHeader columnKey="team" label="Team" />
                  <SortableHeader columnKey="position" label="Pos" />
                  <th className="px-3 py-3 text-center text-xs font-medium uppercase tracking-wider text-white/72">
                    Status
                  </th>
                  <SortableHeader columnKey="ownership" label="Own%" align="center" />
                  {visibleKeys.map((key) => (
                    <SortableHeader
                      key={key}
                      columnKey={key as SortKey}
                      label={STAT_COLUMNS[key]?.label ?? key}
                      align="center"
                    />
                  ))}
                  <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-white/72">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[color:var(--league-border)] bg-[color:var(--league-surface)]">
                {filteredAndSortedPlayers.length === 0 ? (
                  <tr>
                    <td
                      colSpan={visibleKeys.length + 6}
                      className="px-6 py-10 text-center text-sm text-[color:var(--league-text-muted)]"
                    >
                      No players found matching your filters.
                    </td>
                  </tr>
                ) : (
                  filteredAndSortedPlayers.map((player, index) => (
                    <tr
                      key={player.id}
                      className={`transition-colors hover:bg-[color:var(--league-accent-soft)] ${
                        index % 2 === 0
                          ? 'bg-[color:var(--league-surface)]'
                          : 'bg-[color:var(--league-surface-muted)]'
                      }`}
                    >
                      <td className="whitespace-nowrap px-3 py-4">
                        <div className="text-sm font-medium text-[color:var(--league-text)]">
                          {player.name}
                        </div>
                        {player.injury ? (
                          <div className="text-xs text-[color:var(--league-danger)]">
                            Injury • {player.injury}
                          </div>
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-[color:var(--league-text-muted)]">
                        {player.team ? <span title={player.team}>{getTeamAbbreviation(player.team)}</span> : '-'}
                      </td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-[color:var(--league-text-muted)]">
                        {player.position || '-'}
                      </td>
                      <td className="whitespace-nowrap px-3 py-4 text-center text-sm text-[color:var(--league-text-muted)]">
                        {renderStatus(player)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-4 text-center text-sm font-semibold text-[color:var(--league-text-muted)]">
                        {typeof player.ownership === 'number' && Number.isFinite(player.ownership)
                          ? `${player.ownership}%`
                          : '-'}
                      </td>
                      {visibleKeys.map((key) => {
                        const statKey = key as CanonicalStatKey;
                        const value = getStatValue(player, statKey);
                        return (
                          <td
                            key={key}
                            className="whitespace-nowrap px-3 py-4 text-center font-mono text-sm tabular-nums text-[color:var(--league-text-muted)]"
                          >
                            {Number.isFinite(value) && value > 0 ? value.toFixed(1) : '-'}
                          </td>
                        );
                      })}
                      <td className="whitespace-nowrap px-3 py-4 text-sm">
                        <Link
                          href={`/players/${player.id}`}
                          className="inline-flex items-center gap-1 rounded-full border border-[color:var(--league-border)] bg-[color:var(--league-surface)] px-3 py-1.5 text-xs font-semibold text-[color:var(--league-text)] shadow-sm transition hover:border-[color:var(--league-accent)] hover:bg-[color:var(--league-accent-soft)]"
                        >
                          View
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
