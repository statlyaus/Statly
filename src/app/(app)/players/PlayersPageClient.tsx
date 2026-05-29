'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ArrowRight, ChartBar, Search, SlidersHorizontal } from 'lucide-react';

import { useAuth } from '@/AuthContext';
import LeagueViewHeader from '@/components/league/LeagueViewHeader';
import { useLeagueStatColumns } from '@/hooks/useLeagueStatColumns';
import { useUserLeagues } from '@/hooks/useUserLeagues';
import { fetchApi } from '@/lib/api';
import { getDefaultAflSeason, getRecentAflSeasons } from '@/lib/aflSeason';
import { CANONICAL_STAT_KEYS, STAT_COLUMNS } from '@/lib/stats/statColumns';
import type { CanonicalStatKey } from '@/lib/stats/statColumns';
import { TeamLogo } from '@/components/TeamLogo';
import { getTeamAbbreviation } from '@/lib/teamLogos';
import {
  buildPreferenceCookie,
  LAST_LEAGUE_ID_COOKIE,
  PLAYERS_SEASON_COOKIE,
} from '@/lib/uiPreferences';
import type { Player } from '@/types/players';

interface PlayersPageClientProps {
  players: Player[];
  initialSeason?: number;
  initialLeagueId?: string;
  hasInitialSeasonPreference?: boolean;
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
  season?: number;
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

const STAT_COLUMN_GROUPS: Array<{
  id: string;
  label: string;
  keys: CanonicalStatKey[];
}> = [
  {
    id: 'scoring',
    label: 'Scoring',
    keys: ['goals', 'behinds', 'goalAssists', 'scoreInvolvements', 'inside50s'],
  },
  {
    id: 'possession',
    label: 'Possession',
    keys: [
      'kicks',
      'handballs',
      'disposals',
      'contestedPossessions',
      'uncontestedPossessions',
      'effectiveDisposals',
      'disposalEffPct',
      'metresGained',
    ],
  },
  {
    id: 'contests',
    label: 'Contests',
    keys: ['marks', 'tackles', 'clearances', 'contestedMarks', 'intercepts', 'hitouts'],
  },
  {
    id: 'discipline',
    label: 'Discipline',
    keys: ['turnovers', 'freesFor', 'freesAgainst', 'onePercenters', 'clangers', 'minutes'],
  },
];

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

function extractResolvedSeason(response: unknown): number | undefined {
  const body = response as PlayerApiResponse | null | undefined;
  return typeof body?.season === 'number' ? body.season : undefined;
}

function buildPlayerIdentityKey(name?: string, team?: string): string {
  return `${String(name ?? '')
    .trim()
    .toLowerCase()}|${String(team ?? '')
    .trim()
    .toLowerCase()}`;
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
        supplement.ownerTeam ??
        supplement.ownerTeamName ??
        player.ownerTeam ??
        player.ownerTeamName,
      ownerTeamName:
        supplement.ownerTeamName ??
        supplement.ownerTeam ??
        player.ownerTeamName ??
        player.ownerTeam,
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

export default function PlayersPageClient({
  players,
  initialSeason,
  initialLeagueId,
  hasInitialSeasonPreference = false,
  lockLeagueId = false,
  embedded = false,
}: PlayersPageClientProps) {
  const { user } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const fallbackInitialSeason = initialSeason ?? getDefaultAflSeason();
  const [leagueId, setLeagueId] = useState<string>(
    lockLeagueId && initialLeagueId ? initialLeagueId : (initialLeagueId ?? '')
  );
  const [selectedSeason, setSelectedSeason] = useState<number>(fallbackInitialSeason);
  const supportedSeasons = useMemo(
    () =>
      Array.from(new Set([fallbackInitialSeason, ...getRecentAflSeasons(6)])).sort((a, b) => b - a),
    [fallbackInitialSeason]
  );
  const effectiveSelectedSeason = supportedSeasons.includes(selectedSeason)
    ? selectedSeason
    : fallbackInitialSeason;
  const shouldFollowPublishedSeason =
    !hasInitialSeasonPreference && selectedSeason === fallbackInitialSeason;
  const [playerRows, setPlayerRows] = useState<PlayerRow[]>(players as PlayerRow[]);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [teamFilter, setTeamFilter] = useState<string>('all');
  const [positionFilter, setPositionFilter] = useState<string>('all');
  const [isLoadingLeagueData, setIsLoadingLeagueData] = useState(false);
  const [isColumnPickerOpen, setIsColumnPickerOpen] = useState(false);
  /** Latest SSR/player payload for error recovery (avoids stale closure when deps churn). */
  const playersBaselineRef = useRef(players as PlayerRow[]);
  const skipInitialHydrationFetchRef = useRef((players as PlayerRow[]).length > 0);
  playersBaselineRef.current = players as PlayerRow[];

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

  const { leagues: userLeagues, loading: userLeaguesLoading } = useUserLeagues(user?.uid);
  const selectedLeague = userLeagues.find((league) => league.id === leagueId);
  const effectiveLeagueId = lockLeagueId && initialLeagueId ? initialLeagueId : selectedLeague?.id;
  const {
    visibleKeys,
    allKeys,
    toggleKey,
    defaultKeys,
    setVisibleKeys,
    loading: columnsLoading,
  } = useLeagueStatColumns(effectiveLeagueId);

  useEffect(() => {
    const nextLeagueId =
      lockLeagueId && initialLeagueId ? initialLeagueId : (initialLeagueId ?? '');
    setLeagueId((currentLeagueId) =>
      currentLeagueId === nextLeagueId ? currentLeagueId : nextLeagueId
    );
  }, [initialLeagueId, lockLeagueId]);

  useEffect(() => {
    setSelectedSeason((currentSeason) =>
      currentSeason === fallbackInitialSeason ? currentSeason : fallbackInitialSeason
    );
  }, [fallbackInitialSeason]);

  const persistPreferenceCookies = (nextLeagueId: string, nextSeason: number) => {
    if (embedded || typeof document === 'undefined') return;

    document.cookie = buildPreferenceCookie(PLAYERS_SEASON_COOKIE, String(nextSeason));
    if (nextLeagueId) {
      document.cookie = buildPreferenceCookie(LAST_LEAGUE_ID_COOKIE, nextLeagueId);
    } else {
      document.cookie = buildPreferenceCookie(LAST_LEAGUE_ID_COOKIE, '', 0);
    }
  };

  const replaceRouteState = (nextLeagueId: string, nextSeason: number) => {
    if (embedded || !pathname) return;

    const params = new URLSearchParams(searchParams?.toString());
    if (nextLeagueId) {
      params.set('league', nextLeagueId);
    } else {
      params.delete('league');
    }
    if (nextSeason === fallbackInitialSeason) {
      params.delete('season');
    } else {
      params.set('season', String(nextSeason));
    }
    const nextQuery = params.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
  };

  const handleSeasonChange = (nextSeason: number) => {
    setSelectedSeason(nextSeason);
    persistPreferenceCookies(leagueId, nextSeason);
    replaceRouteState(leagueId, nextSeason);
  };

  const handleLeagueChange = (nextLeagueId: string) => {
    setLeagueId(nextLeagueId);
    persistPreferenceCookies(nextLeagueId, effectiveSelectedSeason);
    replaceRouteState(nextLeagueId, effectiveSelectedSeason);
  };

  useEffect(() => {
    if (lockLeagueId && initialLeagueId) {
      if (leagueId !== initialLeagueId) setLeagueId(initialLeagueId);
      return;
    }
    if (!leagueId && userLeagues.length > 0) {
      const nextLeagueId = userLeagues[0].id;
      setLeagueId(nextLeagueId);
      persistPreferenceCookies(nextLeagueId, effectiveSelectedSeason);
    }
  }, [effectiveSelectedSeason, initialLeagueId, leagueId, lockLeagueId, userLeagues]);

  useEffect(() => {
    let mounted = true;
    const currentLeagueTarget = effectiveLeagueId ?? '';
    const initialLeagueTarget = initialLeagueId ?? '';
    const shouldSkipInitialFetch =
      skipInitialHydrationFetchRef.current &&
      effectiveSelectedSeason === fallbackInitialSeason &&
      currentLeagueTarget === initialLeagueTarget;

    if (shouldSkipInitialFetch) {
      skipInitialHydrationFetchRef.current = false;
      return () => {
        mounted = false;
      };
    }
    skipInitialHydrationFetchRef.current = false;

    (async () => {
      setIsLoadingLeagueData(true);
      try {
        const params = new URLSearchParams({
          limit: '1000',
          page: '1',
        });
        if (!shouldFollowPublishedSeason) {
          params.set('season', String(effectiveSelectedSeason));
        }
        if (effectiveLeagueId) params.set('leagueId', effectiveLeagueId);

        const [playersSettled, leagueSettled] = await Promise.allSettled([
          fetchApi(`players?${params.toString()}`),
          effectiveLeagueId
            ? fetchApi(`leagues/${effectiveLeagueId}/players?limit=200`)
            : Promise.resolve(null),
        ]);

        const playersResponse = playersSettled.status === 'fulfilled' ? playersSettled.value : null;
        if (playersSettled.status === 'rejected') {
          console.error('Players list fetch failed:', playersSettled.reason);
        }

        const leaguePlayersResponse =
          leagueSettled.status === 'fulfilled' ? leagueSettled.value : null;
        if (leagueSettled.status === 'rejected') {
          console.warn(
            'League player supplement failed (ownership columns may be stale):',
            leagueSettled.reason
          );
        }

        const baseRows = extractPlayerRows(playersResponse);
        const resolvedSeason = extractResolvedSeason(playersResponse);
        const supplements = extractLeagueSupplements(leaguePlayersResponse);
        const mergedRows = mergeLeaguePlayerRows(baseRows, supplements);
        if (mounted && shouldFollowPublishedSeason && resolvedSeason) {
          setSelectedSeason(resolvedSeason);
        }
        if (mounted && mergedRows.length > 0) {
          setPlayerRows(mergedRows);
        }
      } catch (err) {
        console.error('Failed to fetch aggregated stats:', err);
        if (mounted) {
          const baseline = playersBaselineRef.current;
          if (baseline.length > 0) {
            setPlayerRows(baseline);
          }
        }
      } finally {
        if (mounted) setIsLoadingLeagueData(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [effectiveLeagueId, effectiveSelectedSeason, shouldFollowPublishedSeason]);

  useEffect(() => {
    if (!supportedSeasons.includes(selectedSeason)) {
      setSelectedSeason(fallbackInitialSeason);
    }
  }, [fallbackInitialSeason, selectedSeason, setSelectedSeason, supportedSeasons]);

  const filteredAndSortedPlayers = useMemo(() => {
    const filtered = playerRows.filter((player) => {
      const name = player.name?.toLowerCase() ?? '';
      const matchesSearch =
        searchQuery === '' ||
        name.includes(searchQuery.toLowerCase()) ||
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
        <span
          className={`rounded-full border px-2.5 py-0.5 ${tableStatusTextClassName} ${statusClasses}`}
        >
          {status}
        </span>
        {owner ? (
          <span
            className={tableMetaTextClassName}
            title={owner}
          >
            {getTeamAbbreviation(owner)}
          </span>
        ) : null}
      </div>
    );
  };

  const SortableHeader = ({
    columnKey,
    label,
    visibleLabel,
    variant = 'default',
    align = 'left',
  }: {
    columnKey: SortKey;
    label: string;
    visibleLabel?: string;
    variant?: 'default' | 'stat';
    align?: 'left' | 'center' | 'right';
  }) => {
    const isActive = sortKey === columnKey;
    const alignClass =
      align === 'center' ? 'text-center' : align === 'right' ? 'text-right' : 'text-left';
    const justifyClass =
      align === 'center' ? 'justify-center' : align === 'right' ? 'justify-end' : 'justify-start';
    const labelClassName =
      variant === 'stat' ? tableStatHeaderLabelClassName : 'leading-none whitespace-nowrap';

    return (
      <th
        scope="col"
        aria-sort={isActive ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
        className={`px-3 py-3 ${alignClass} ${tableHeaderTextClassName}`}
      >
        <button
          type="button"
          onClick={() => handleSort(columnKey)}
          className={`flex w-full items-center gap-1 rounded-md px-1 py-1 transition hover:bg-[color:color-mix(in_srgb,var(--league-primary-foreground)_10%,transparent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary-foreground)] ${justifyClass}`}
          aria-label={`Sort by ${label}${isActive ? `, currently ${sortDir === 'asc' ? 'ascending' : 'descending'}` : ''}`}
          title={label}
        >
          <span className={labelClassName}>{visibleLabel ?? label}</span>
          {isActive ? (
            <span className="text-[color:var(--league-primary-foreground)]">
              {sortDir === 'asc' ? '↑' : '↓'}
            </span>
          ) : null}
        </button>
      </th>
    );
  };

  const totalTeams = teams.length;
  const totalPositions = positions.length;
  const seasonOptions = supportedSeasons;
  const columnPresets = useMemo(() => {
    const dynamicDefault = defaultKeys.length > 0 ? defaultKeys : allKeys;
    const coreKeys: CanonicalStatKey[] = [
      'goals',
      'disposals',
      'marks',
      'tackles',
      'clearances',
      'inside50s',
      'intercepts',
      'metresGained',
      'disposalEffPct',
    ];
    const ballWinningKeys: CanonicalStatKey[] = [
      'kicks',
      'handballs',
      'disposals',
      'contestedPossessions',
      'uncontestedPossessions',
      'effectiveDisposals',
      'disposalEffPct',
      'metresGained',
    ];
    const impactKeys: CanonicalStatKey[] = [
      'goals',
      'behinds',
      'goalAssists',
      'scoreInvolvements',
      'inside50s',
      'clearances',
      'contestedMarks',
      'intercepts',
    ];

    const normalize = (keys: CanonicalStatKey[]) =>
      keys.filter((key, index) => allKeys.includes(key) && keys.indexOf(key) === index);

    return [
      { id: 'default', label: 'League default', keys: normalize(dynamicDefault) },
      { id: 'core', label: 'Core AFL', keys: normalize(coreKeys) },
      { id: 'ball', label: 'Ball winning', keys: normalize(ballWinningKeys) },
      { id: 'impact', label: 'Impact', keys: normalize(impactKeys) },
      { id: 'full', label: 'Full table', keys: normalize(allKeys) },
    ].filter((preset) => preset.keys.length > 0);
  }, [allKeys, defaultKeys]);
  const activePresetId = useMemo(() => {
    return (
      columnPresets.find(
        (preset) =>
          preset.keys.length === visibleKeys.length &&
          preset.keys.every((key, index) => visibleKeys[index] === key)
      )?.id ?? null
    );
  }, [columnPresets, visibleKeys]);
  const visibleColumnSummary = visibleKeys.length
    ? visibleKeys
        .slice(0, 7)
        .map((key) => STAT_COLUMNS[key]?.short ?? STAT_COLUMNS[key]?.label ?? key)
        .join(', ')
    : 'No stat columns selected';
  const leagueStatusLabel = isLoadingLeagueData
    ? `Loading ${effectiveSelectedSeason} season averages...`
    : leagueId && userLeaguesLoading
      ? 'Confirming league access...'
      : effectiveLeagueId
        ? `${effectiveSelectedSeason} season averages • Ownership for selected league`
        : `Showing ${effectiveSelectedSeason} season averages`;
  const shellClassName = embedded
    ? 'space-y-6'
    : 'mx-auto w-full max-w-[var(--app-shell-max-width)] space-y-6 px-4 py-6 sm:px-6 lg:px-8 2xl:px-10';
  const selectClassName =
    'w-full rounded-2xl border border-[color:var(--league-border)] bg-[color:var(--league-surface-muted)] px-4 py-3 text-sm text-[color:var(--league-text)] focus:outline-none focus:ring-2 focus:ring-[color:var(--league-primary)]';
  const searchFieldClassName =
    'flex items-center gap-3 rounded-2xl border border-[color:var(--league-border)] bg-[color:var(--league-surface-muted)] px-4 py-3 text-[color:var(--league-text)]';
  const tableViewportClassName = embedded
    ? 'overflow-x-auto overflow-y-visible'
    : 'max-h-[calc(100vh-18rem)] overflow-x-auto overflow-y-auto';
  const tableHeaderTextClassName =
    'text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[color:var(--league-primary-foreground)] opacity-85';
  const tableStatHeaderLabelClassName =
    'text-[11px] font-semibold uppercase tracking-normal text-[color:var(--league-primary-foreground)]';
  const tableIdentifierTextClassName =
    'text-[14px] font-semibold leading-[1.2] tracking-normal text-[color:var(--league-text)]';
  const tableMetaTextClassName =
    'text-[11.5px] font-medium uppercase tracking-[0.08em] text-[color:var(--league-text-muted)]';
  const tableBodyTextClassName =
    'text-[12.5px] font-medium leading-[1.25] tracking-normal text-[color:var(--league-text-muted)]';
  const tableNumericTextClassName =
    'text-center text-[13px] font-medium tabular-nums tracking-normal text-[color:var(--league-text)]';
  const tableStatusTextClassName =
    'text-[10.5px] font-semibold uppercase tracking-[0.08em]';
  const tableActionTextClassName =
    'text-[11.5px] font-semibold uppercase tracking-[0.08em]';

  return (
    <div className={embedded ? undefined : 'bg-[color:var(--league-page)]'}>
      <div className={shellClassName}>
        <LeagueViewHeader
          eyebrow={embedded ? 'Player pool' : 'Player market'}
          title={embedded ? 'Players and league ownership' : 'Players and season research'}
          description={
            embedded
              ? 'Research the full pool with league ownership context, then move directly into roster, waiver, or trade decisions without leaving the workspace.'
              : 'Built for fast player comparison on wide screens, with core filters and table access preserved on smaller devices.'
          }
          chips={[
            { label: `${playerRows.length} players` },
            { label: `${effectiveSelectedSeason} season`, tone: 'accent' },
            {
              label: selectedLeague ? selectedLeague.name : 'No league selected',
              tone: selectedLeague ? 'success' : 'neutral',
            },
            {
              label: leagueStatusLabel,
              tone:
                isLoadingLeagueData || (leagueId !== '' && userLeaguesLoading)
                  ? 'warning'
                  : effectiveLeagueId
                    ? 'success'
                    : 'neutral',
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
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                ) : null}
                <Link
                  href="/rankings"
                  className="inline-flex items-center gap-2 rounded-full bg-[color:var(--league-primary)] px-4 py-2.5 text-sm font-semibold text-[color:var(--league-primary-foreground)] transition hover:bg-[color:var(--league-primary-hover)]"
                >
                  Open rankings
                  <ChartBar className="h-4 w-4" aria-hidden="true" />
                </Link>
              </>
            )
          }
          aside={undefined}
        />

        <section className="overflow-hidden rounded-[32px] border border-[color:var(--league-border)] bg-[color:var(--league-surface)] shadow-[0_24px_60px_-45px_rgba(23,34,48,0.18)]">
          <div className="border-b border-[color:var(--league-border)] px-6 py-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-[color:var(--league-text-muted)]">
                  Research toolbar
                </p>
                <h2 className="mt-1.5 text-lg font-semibold tracking-[-0.01em] text-[color:var(--league-text)]">
                  Narrow the market, then stay in the table
                </h2>
                <p className="mt-1.5 text-[13px] text-[color:var(--league-text-muted)]">
                  Filters and column presets stay compact so the comparison grid remains the main
                  workspace.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[12.5px] font-medium text-[color:var(--league-text-muted)]">
                <span className="rounded-full border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-3.5 py-1.5">
                  {filteredAndSortedPlayers.length} visible
                </span>
                <span className="rounded-full border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-3.5 py-1.5">
                  {playerRows.length} loaded
                </span>
                <span className="rounded-full border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-3.5 py-1.5">
                  {totalTeams} teams • {totalPositions} positions
                </span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 px-6 py-4 lg:grid-cols-12">
            <div className="lg:col-span-4">
              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--league-text-muted)]">
                  Search
                </span>
                <div className={searchFieldClassName}>
                  <Search
                    className="h-5 w-5 shrink-0 text-[color:var(--league-text-muted)]"
                    aria-hidden="true"
                  />
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
                  value={effectiveSelectedSeason}
                  onChange={(event) => handleSeasonChange(Number(event.target.value))}
                  className={selectClassName}
                >
                  {seasonOptions.map((season) => (
                    <option key={season} value={season} className="text-foreground">
                      {season} Season
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="lg:col-span-2">
              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--league-text-muted)]">
                  League
                </span>
                {lockLeagueId && selectedLeague ? (
                  <div className={selectClassName}>{selectedLeague.name}</div>
                ) : (
                  <select
                    value={leagueId}
                    onChange={(event) => handleLeagueChange(event.target.value)}
                    className={selectClassName}
                  >
                    <option value="">Select league</option>
                    {userLeagues.map((league) => (
                      <option key={league.id} value={league.id} className="text-foreground">
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
                    <option key={team} value={team} className="text-foreground">
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
                    <option key={position} value={position} className="text-foreground">
                      {position}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="lg:col-span-1">
              <div className="flex h-full items-end">
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setTeamFilter('all');
                    setPositionFilter('all');
                    setVisibleKeys(defaultKeys.length > 0 ? defaultKeys : allKeys);
                  }}
                  className="inline-flex w-full items-center justify-center rounded-2xl border border-[color:var(--league-border)] bg-[color:var(--league-surface-muted)] px-4 py-3 text-sm font-semibold text-[color:var(--league-text)] transition hover:border-[color:var(--league-accent)] hover:bg-[color:var(--league-accent-soft)]"
                >
                  Reset
                </button>
              </div>
            </div>
          </div>
          <div className="border-t border-[color:var(--league-border)] px-6 py-4">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-[color:var(--league-text-muted)]">
                  Column presets
                </p>
                <p className="mt-1.5 text-[12.5px] text-[color:var(--league-text-muted)]">
                  {visibleKeys.length}/{allKeys.length} columns visible. Showing{' '}
                  {visibleColumnSummary}
                  {visibleKeys.length > 7 ? ' …' : ''}.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {columnPresets.map((preset) => {
                    const isActive = activePresetId === preset.id;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => setVisibleKeys(preset.keys)}
                        className={`rounded-full px-3 py-1.5 text-[12px] font-semibold transition ${
                          isActive
                            ? 'bg-[color:var(--league-primary)] text-[color:var(--league-primary-foreground)]'
                            : 'border border-[color:var(--league-border)] bg-[color:var(--league-page)] text-[color:var(--league-text)] hover:border-[color:var(--league-accent)] hover:bg-[color:var(--league-accent-soft)]'
                        }`}
                      >
                        {preset.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsColumnPickerOpen((open) => !open)}
                className="inline-flex items-center gap-2 self-start rounded-full border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-4 py-2 text-sm font-semibold text-[color:var(--league-text)] transition hover:border-[color:var(--league-accent)] hover:bg-[color:var(--league-accent-soft)]"
                aria-expanded={isColumnPickerOpen}
                aria-controls="player-column-picker"
              >
                <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
                {isColumnPickerOpen ? 'Hide groups' : 'Customize groups'}
              </button>
            </div>
          </div>
          {isColumnPickerOpen ? (
            <div
              id="player-column-picker"
              className="grid gap-4 border-t border-[color:var(--league-border)] px-6 pb-5 pt-4 lg:grid-cols-2"
            >
              {STAT_COLUMN_GROUPS.map((group) => {
                const availableKeys = group.keys.filter((key) => allKeys.includes(key));
                if (availableKeys.length === 0) return null;

                const selectedCount = availableKeys.filter((key) =>
                  visibleKeys.includes(key)
                ).length;
                const allSelected = selectedCount === availableKeys.length;

                return (
                  <div
                    key={group.id}
                    className="rounded-2xl border border-[color:var(--league-border)] bg-[color:var(--league-surface-muted)] p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[color:var(--league-text-muted)]">
                          {group.label}
                        </p>
                        <p className="mt-1 text-[12.5px] text-[color:var(--league-text-muted)]">
                          {selectedCount}/{availableKeys.length} selected
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setVisibleKeys(
                            allSelected
                              ? visibleKeys.filter((key) => !availableKeys.includes(key))
                              : Array.from(new Set([...visibleKeys, ...availableKeys]))
                          )
                        }
                        className="rounded-full border border-[color:var(--league-border)] bg-[color:var(--league-surface)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--league-text)] transition hover:border-[color:var(--league-accent)] hover:bg-[color:var(--league-accent-soft)]"
                      >
                        {allSelected ? 'Clear group' : 'Show group'}
                      </button>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {availableKeys.map((key) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() => toggleKey(key)}
                          className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                            visibleKeys.includes(key)
                              ? 'bg-[color:var(--league-primary)] text-[color:var(--league-primary-foreground)]'
                              : 'border border-[color:var(--league-border)] bg-[color:var(--league-surface)] text-[color:var(--league-text-muted)] hover:border-[color:var(--league-accent)] hover:bg-[color:var(--league-accent-soft)] hover:text-[color:var(--league-text)]'
                          }`}
                        >
                          {STAT_COLUMNS[key]?.short ?? STAT_COLUMNS[key]?.label ?? key}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
              {!columnsLoading && allKeys.length > 0 ? (
                <div className="rounded-2xl border border-dashed border-[color:var(--league-border)] bg-[color:var(--league-page)] p-4">
                  <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[color:var(--league-text-muted)]">
                    Selection rules
                  </p>
                  <p className="mt-2 text-[12.5px] text-[color:var(--league-text-muted)]">
                    Presets are the fastest way to switch analysis modes. Group controls are for
                    targeted adjustments once you know which stat family you need.
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>

        <section className="overflow-hidden rounded-[32px] border border-[color:var(--league-border)] bg-[color:var(--league-surface)] shadow-[0_24px_60px_-45px_rgba(23,34,48,0.18)]">
          <div className="border-b border-[color:var(--league-border)] px-6 py-3.5">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-[color:var(--league-text-muted)]">
                  Player table
                </p>
                <h2 className="mt-1.5 text-base font-semibold tracking-[-0.01em] text-[color:var(--league-text)]">
                  Season averages, ownership, and core AFL stats
                </h2>
              </div>
              <div className="text-[12.5px] font-medium text-[color:var(--league-text-muted)]">
                Showing {filteredAndSortedPlayers.length} of {playerRows.length} players
                {selectedLeague ? (
                  <span className="ml-2 text-[11px] uppercase tracking-[0.12em]">
                    • {selectedLeague.name}
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          <div className={tableViewportClassName}>
            <table className="min-w-full divide-y divide-[color:var(--league-border)]">
              <thead className="sticky top-0 z-10 bg-[color:var(--league-primary)] backdrop-blur">
                <tr>
                  <SortableHeader columnKey="name" label="Player" />
                  <SortableHeader columnKey="team" label="Team" />
                  <SortableHeader columnKey="position" label="Pos" />
                  <th
                    className={`px-3 py-3 text-center ${tableHeaderTextClassName}`}
                  >
                    Status
                  </th>
                  <SortableHeader columnKey="ownership" label="Own%" align="center" />
                  {visibleKeys.map((key) => (
                    <SortableHeader
                      key={key}
                      columnKey={key as SortKey}
                      label={STAT_COLUMNS[key]?.label ?? key}
                      visibleLabel={STAT_COLUMNS[key]?.short ?? STAT_COLUMNS[key]?.label ?? key}
                      variant="stat"
                      align="center"
                    />
                  ))}
                  <th
                    className={`px-3 py-3 text-left ${tableHeaderTextClassName}`}
                  >
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
                      <td className="whitespace-nowrap px-3 py-3.5">
                        <div className={tableIdentifierTextClassName}>{player.name}</div>
                        {player.injury ? (
                          <div className="mt-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[color:var(--league-danger)]">
                            Injury • {player.injury}
                          </div>
                        ) : null}
                      </td>
                      <td className={`whitespace-nowrap px-3 py-3.5 ${tableBodyTextClassName}`}>
                        {player.team ? (
                          <span className="inline-flex items-center gap-2" title={player.team}>
                            <TeamLogo team={player.team} size={18} withCircle decorative />
                            <span className={tableMetaTextClassName}>
                              {getTeamAbbreviation(player.team)}
                            </span>
                          </span>
                        ) : (
                          '-'
                        )}
                      </td>
                      <td className={`whitespace-nowrap px-3 py-3.5 ${tableBodyTextClassName}`}>
                        <span className={tableMetaTextClassName}>{player.position || '-'}</span>
                      </td>
                      <td
                        className={`whitespace-nowrap px-3 py-3.5 text-center ${tableBodyTextClassName}`}
                      >
                        {renderStatus(player)}
                      </td>
                      <td
                        className={`whitespace-nowrap px-3 py-3.5 ${tableNumericTextClassName}`}
                      >
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
                            className={`whitespace-nowrap px-3 py-3.5 ${tableNumericTextClassName}`}
                          >
                            {Number.isFinite(value) ? value.toFixed(1) : '-'}
                          </td>
                        );
                      })}
                      <td className={`whitespace-nowrap px-3 py-3.5 ${tableBodyTextClassName}`}>
                        <Link
                          href={
                            effectiveLeagueId
                              ? `/players/${player.id}?league=${encodeURIComponent(effectiveLeagueId)}`
                              : `/players/${player.id}`
                          }
                          className={`inline-flex items-center gap-1 rounded-full border border-[color:var(--league-border)] bg-[color:var(--league-surface)] px-3 py-1.5 text-[color:var(--league-text)] shadow-sm transition hover:border-[color:var(--league-accent)] hover:bg-[color:var(--league-accent-soft)] ${tableActionTextClassName}`}
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
