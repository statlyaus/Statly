'use client';

import clsx from 'clsx';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

import { TeamLogo } from '@/components/TeamLogo';
import { normalizeTeamName } from '@/lib/teamLogos';
import LiveGameScoresPanel from '@/components/league/LiveGameScoresPanel';
import LeagueViewHeader from '@/components/league/LeagueViewHeader';
import { leagueStatusTonePatterns, leagueSurfacePatterns } from '@/styles/leagueDesignSystem';

type MatchupStarter = {
  id: string;
  name: string;
  team: string;
  position: string;
  stats: Record<string, number | undefined>;
};

type MatchupCategory = {
  key: string;
  label: string;
  home: number;
  away: number;
  winner: 'home' | 'away' | 'tie';
};

type MatchupPayload = {
  matchupId: string;
  leagueId: string;
  leagueName: string;
  season: number;
  round: number;
  roundLabel: string;
  status: 'scheduled' | 'in_progress' | 'final';
  live: boolean;
  lastUpdated: string | null;
  completedTeams?: string[];
  home: {
    userId: string;
    memberId: string;
    teamName: string;
    starters: MatchupStarter[];
    summary: { wins: number; losses: number; ties: number };
  };
  away: {
    userId: string;
    memberId: string;
    teamName: string;
    starters: MatchupStarter[];
    summary: { wins: number; losses: number; ties: number };
  };
  categories: MatchupCategory[];
  otherMatchups: Array<{
    matchupId: string;
    homeTeamName: string;
    awayTeamName: string;
    homeScore: number;
    awayScore: number;
    leaderText: string;
    isSelected: boolean;
  }>;
};

type MatchupDelta = {
  categoryKey: string;
  label: string;
  side: 'home' | 'away';
  value: number;
};

type PlayerStatDelta = {
  playerId: string;
  playerName: string;
  categoryKey: string;
  label: string;
  value: number;
};

type PlayerProgress = {
  played: number;
  remaining: number;
};

type PlayerRowState = 'live' | 'finished' | 'not_played' | 'no_score';

type MatchupScheduleWeek = {
  id: string;
  week: number;
  aflRound: number | null;
  roundLabel: string;
  status: 'scheduled' | 'in_progress' | 'final';
  current: boolean;
};

interface LeagueMatchupTabProps {
  leagueId: string;
  categories: string[];
  embedded?: boolean;
}

function formatStat(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '0';
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function normalizeStatAlias(rawKey: string): string {
  const normalized = rawKey.toLowerCase().replace(/[^a-z0-9]/g, '');

  const aliases: Record<string, string> = {
    goals: 'goals',
    kicks: 'kicks',
    handballs: 'handballs',
    marks: 'marks',
    tackles: 'tackles',
    hitouts: 'hitouts',
    clearances: 'clearances',
    inside50s: 'inside50s',
    inside50: 'inside50s',
    insidefifties: 'inside50s',
    i50: 'inside50s',
    rebound50s: 'rebound50s',
    rebound50: 'rebound50s',
    r50: 'rebound50s',
    clangers: 'clangers',
    freesfor: 'freesFor',
    freesagainst: 'freesAgainst',
    goalassists: 'goalAssists',
    effectivedisposals: 'effectiveDisposals',
    scoreinvolvements: 'scoreInvolvements',
    turnovers: 'turnovers',
    intercepts: 'intercepts',
    metresgained: 'metresGained',
    contestedmarks: 'contestedMarks',
    disposaleffpct: 'disposalEffPct',
    timeongroundpct: 'timeOnGroundPct',
    onepercenters: 'onePercenters',
    contestedpossessions: 'contestedPossessions',
    uncontestedpossessions: 'uncontestedPossessions',
  };

  return aliases[normalized] ?? rawKey;
}

function getPlayerCategoryStat(
  stats: Record<string, number | undefined>,
  categoryKey: string
): number | undefined {
  const canonicalCategoryKey = normalizeStatAlias(categoryKey);

  for (const [key, rawValue] of Object.entries(stats)) {
    const canonicalRawKey = normalizeStatAlias(key);
    if (canonicalRawKey !== canonicalCategoryKey) {
      continue;
    }
    if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
      return rawValue;
    }
  }

  return undefined;
}

function normalizeCategoryStatKey(categoryKey: string): string {
  return normalizeStatAlias(categoryKey);
}

function hasRoundStats(stats: Record<string, number | undefined>): boolean {
  return Object.values(stats).some((value) => typeof value === 'number' && Number.isFinite(value));
}

function hasCompletedWithoutScore(player: MatchupStarter, completedTeams: Set<string>): boolean {
  return !hasRoundStats(player.stats) && completedTeams.has(normalizeTeamName(player.team));
}

function getStatusLabel(status: MatchupPayload['status'], live: boolean): string {
  if (live || status === 'in_progress') {
    return 'In play';
  }
  if (status === 'final') {
    return 'Completed';
  }
  return status.replace('_', ' ');
}

function buildMatchupDeltas(previous: MatchupPayload | null, next: MatchupPayload): MatchupDelta[] {
  if (!previous) return [];

  const previousCategoryMap = new Map(
    previous.categories.map((category) => [category.key, category])
  );
  const deltas: MatchupDelta[] = [];

  for (const category of next.categories) {
    const prior = previousCategoryMap.get(category.key);
    if (!prior) continue;

    const homeDelta = category.home - prior.home;
    if (homeDelta !== 0) {
      deltas.push({
        categoryKey: category.key,
        label: category.label,
        side: 'home',
        value: homeDelta,
      });
    }

    const awayDelta = category.away - prior.away;
    if (awayDelta !== 0) {
      deltas.push({
        categoryKey: category.key,
        label: category.label,
        side: 'away',
        value: awayDelta,
      });
    }
  }

  return deltas;
}

function buildPlayerStatDeltas(
  previous: MatchupPayload | null,
  next: MatchupPayload
): PlayerStatDelta[] {
  if (!previous) return [];

  const deltas = new Map<string, PlayerStatDelta>();
  const previousPlayers = new Map<string, MatchupStarter>();
  const categoryLabels = new Map(
    next.categories.map((category) => [normalizeCategoryStatKey(category.key), category.label])
  );
  const allowedCategoryKeys = new Set(categoryLabels.keys());
  for (const player of [...previous.home.starters, ...previous.away.starters]) {
    previousPlayers.set(player.id, player);
  }

  for (const player of [...next.home.starters, ...next.away.starters]) {
    const prior = previousPlayers.get(player.id);
    if (!prior) continue;

    for (const [rawCategoryKey, nextValue] of Object.entries(player.stats)) {
      if (typeof nextValue !== 'number' || !Number.isFinite(nextValue)) continue;
      const categoryKey = normalizeCategoryStatKey(rawCategoryKey);
      if (!allowedCategoryKeys.has(categoryKey)) continue;
      const priorValue = getPlayerCategoryStat(prior.stats, categoryKey) ?? 0;
      const deltaValue = nextValue - priorValue;
      if (deltaValue === 0) continue;

      deltas.set(`${player.id}:${categoryKey}`, {
        playerId: player.id,
        playerName: player.name,
        categoryKey,
        label: categoryLabels.get(categoryKey) ?? categoryKey,
        value: deltaValue,
      });
    }
  }

  return Array.from(deltas.values());
}

function buildLeadChangeKeys(previous: MatchupPayload | null, next: MatchupPayload): string[] {
  if (!previous) return [];

  const previousCategoryMap = new Map(
    previous.categories.map((category) => [category.key, category])
  );

  return next.categories
    .filter((category) => {
      const prior = previousCategoryMap.get(category.key);
      return prior && prior.winner !== category.winner;
    })
    .map((category) => category.key);
}

function getPlayerProgress(players: MatchupStarter[], completedTeams: Set<string>): PlayerProgress {
  const played = players.filter(
    (player) => hasRoundStats(player.stats) || hasCompletedWithoutScore(player, completedTeams)
  ).length;
  return {
    played,
    remaining: Math.max(players.length - played, 0),
  };
}

function getCategorySwingText(
  category: MatchupCategory,
  homeTeamName: string,
  awayTeamName: string
): string {
  const difference = Math.abs(category.home - category.away);
  if (difference === 0) {
    return 'Dead even right now';
  }

  if (category.winner === 'home') {
    return `${homeTeamName} leads by ${formatStat(difference)}`;
  }

  if (category.winner === 'away') {
    return `${awayTeamName} leads by ${formatStat(difference)}`;
  }

  return 'Dead even right now';
}

function getCategoryMargin(category: MatchupCategory): number {
  return Math.abs(category.home - category.away);
}

function getCategoryUrgencyText(input: {
  category: MatchupCategory;
  homeTeamName: string;
  awayTeamName: string;
  homeProgress: PlayerProgress;
  awayProgress: PlayerProgress;
}): string {
  return getCategorySwingText(input.category, input.homeTeamName, input.awayTeamName);
}

function getCategoryStateSummary(category: MatchupCategory): string {
  const margin = getCategoryMargin(category);
  if (category.winner === 'tie') return 'Tied';
  if (category.winner === 'home') return `Leading by ${formatStat(margin)}`;
  return `Trailing by ${formatStat(margin)}`;
}

function getPlayerRowState(player: MatchupStarter, completedTeams: Set<string>): PlayerRowState {
  const hasStats = hasRoundStats(player.stats);
  const completedWithoutScore = hasCompletedWithoutScore(player, completedTeams);
  const teamCompleted = completedTeams.has(normalizeTeamName(player.team));

  if (completedWithoutScore) return 'no_score';
  if (hasStats && teamCompleted) return 'finished';
  if (hasStats) return 'live';
  return 'not_played';
}

function getPlayerRowStateMeta(state: PlayerRowState): {
  badge: string;
  badgeClassName: string;
  rowClassName: string;
} {
  const rowBase = 'border-l-[3px] bg-[color:var(--league-surface)]';

  switch (state) {
    case 'live':
      return {
        badge: 'Live now',
        badgeClassName: leagueStatusTonePatterns.success,
        rowClassName: `${rowBase} border-l-emerald-500`,
      };
    case 'finished':
      return {
        badge: 'Finished',
        badgeClassName: leagueStatusTonePatterns.neutral,
        rowClassName: `${rowBase} border-l-slate-400`,
      };
    case 'no_score':
      return {
        badge: 'No score',
        badgeClassName: leagueStatusTonePatterns.warning,
        rowClassName: `${rowBase} border-l-amber-500`,
      };
    default:
      return {
        badge: 'Not played',
        badgeClassName:
          'bg-[color:var(--league-surface-muted)] text-[color:var(--league-text-muted)] ring-[color:var(--league-border)]',
        rowClassName: `${rowBase} border-l-[color:var(--league-border)]`,
      };
  }
}

export default function LeagueMatchupTab({
  leagueId,
  categories,
  embedded = false,
}: LeagueMatchupTabProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [data, setData] = useState<MatchupPayload | null>(null);
  const [schedule, setSchedule] = useState<MatchupScheduleWeek[]>([]);
  const dataRef = useRef<MatchupPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [staleError, setStaleError] = useState<string | null>(null);
  const [liveDeltas, setLiveDeltas] = useState<MatchupDelta[]>([]);
  const [playerDeltas, setPlayerDeltas] = useState<PlayerStatDelta[]>([]);
  const [leadChangeKeys, setLeadChangeKeys] = useState<string[]>([]);
  const [lastChangeAt, setLastChangeAt] = useState<string | null>(null);
  const [showLeagueMatchups, setShowLeagueMatchups] = useState(false);
  const [selectedCategoryKey, setSelectedCategoryKey] = useState<string | null>(null);

  const fetchMatchup = useCallback(
    async (options?: { background?: boolean }) => {
      const controller = new AbortController();
      const timeout = window.setTimeout(
        () => {
          controller.abort();
        },
        options?.background ? 15000 : 12000
      );

      try {
        if (options?.background) {
          setRefreshing(true);
        }
        setError(null);
        const params = new URLSearchParams();
        params.set('categories', categories.join(','));
        const matchupId = searchParams?.get('matchupId');
        const round = searchParams?.get('round');
        if (matchupId) {
          params.set('matchupId', matchupId);
        }
        if (round) {
          params.set('round', round);
        }
        const response = await fetch(`/api/leagues/${leagueId}/matchup?${params.toString()}`, {
          credentials: 'include',
          cache: 'no-store',
          signal: controller.signal,
        });
        const body = await response.json().catch(() => null);
        if (!response.ok || !body?.success) {
          throw new Error(body?.error?.message || 'Failed to load matchup');
        }
        if (!body.data) {
          throw new Error('Matchup data is unavailable right now.');
        }
        const nextData = body.data as MatchupPayload;
        setStaleError(null);
        const previousData = dataRef.current;
        const deltas = buildMatchupDeltas(previousData, nextData);
        const nextPlayerDeltas = buildPlayerStatDeltas(previousData, nextData);
        const nextLeadChangeKeys = buildLeadChangeKeys(previousData, nextData);
        dataRef.current = nextData;
        setData(nextData);
        if (nextLeadChangeKeys.length > 0) {
          setLeadChangeKeys(nextLeadChangeKeys);
        }
        if (deltas.length > 0 || nextPlayerDeltas.length > 0) {
          setLiveDeltas(deltas);
          setPlayerDeltas(nextPlayerDeltas);
          setLastChangeAt(nextData.lastUpdated ?? new Date().toISOString());
        }
      } catch (err) {
        const message =
          err instanceof DOMException && err.name === 'AbortError'
            ? 'Matchup request timed out. Please try again.'
            : err instanceof Error
              ? err.message
              : 'Failed to load matchup';
        if (!options?.background) {
          setData(null);
          setError(message);
        } else {
          setStaleError(message);
        }
      } finally {
        window.clearTimeout(timeout);
        setRefreshing(false);
        setLoading(false);
      }
    },
    [categories, leagueId, searchParams]
  );

  useEffect(() => {
    let cancelled = false;

    const loadSchedule = async () => {
      try {
        const response = await fetch(`/api/leagues/${leagueId}/season-state`, {
          credentials: 'include',
          cache: 'no-store',
        });
        const payload = await response.json();
        if (!response.ok || !payload?.success) {
          return;
        }

        if (!cancelled && Array.isArray(payload.data?.schedule)) {
          setSchedule(payload.data.schedule as MatchupScheduleWeek[]);
        }
      } catch {
        // Keep matchup usable even if the round selector cannot load.
      }
    };

    void loadSchedule();
    return () => {
      cancelled = true;
    };
  }, [leagueId]);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    setLoading(true);
    void fetchMatchup();
  }, [fetchMatchup]);

  useEffect(() => {
    if (!data) return;
    const pollInterval = data.live ? 30000 : 60000;
    const interval = window.setInterval(() => {
      void fetchMatchup({ background: true });
    }, pollInterval);
    return () => window.clearInterval(interval);
  }, [data, fetchMatchup]);

  useEffect(() => {
    const revalidate = () => {
      void fetchMatchup({ background: true });
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        revalidate();
      }
    };

    window.addEventListener('focus', revalidate);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('focus', revalidate);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [fetchMatchup]);

  useEffect(() => {
    if (liveDeltas.length === 0) return;
    const timeout = window.setTimeout(() => {
      setLiveDeltas([]);
      setPlayerDeltas([]);
      setLastChangeAt(null);
    }, 5000);
    return () => window.clearTimeout(timeout);
  }, [liveDeltas]);

  useEffect(() => {
    if (leadChangeKeys.length === 0) return;
    const timeout = window.setTimeout(() => {
      setLeadChangeKeys([]);
    }, 1800);
    return () => window.clearTimeout(timeout);
  }, [leadChangeKeys]);

  useLayoutEffect(() => {
    if (!data?.live || typeof EventSource === 'undefined') {
      return;
    }

    const params = new URLSearchParams();
    params.set('categories', categories.join(','));
    const matchupId = searchParams?.get('matchupId');
    const round = searchParams?.get('round');
    if (matchupId) {
      params.set('matchupId', matchupId);
    }
    if (round) {
      params.set('round', round);
    }

    const source = new EventSource(`/api/leagues/${leagueId}/matchup/stream?${params.toString()}`);
    const handleMatchup = (event: MessageEvent<string>) => {
      try {
        const nextData = JSON.parse(event.data) as MatchupPayload;
        const previousData = dataRef.current;
        const deltas = buildMatchupDeltas(previousData, nextData);
        const nextPlayerDeltas = buildPlayerStatDeltas(previousData, nextData);
        const nextLeadChangeKeys = buildLeadChangeKeys(previousData, nextData);
        dataRef.current = nextData;
        setData(nextData);
        if (nextLeadChangeKeys.length > 0) {
          setLeadChangeKeys(nextLeadChangeKeys);
        }
        if (deltas.length > 0 || nextPlayerDeltas.length > 0) {
          setLiveDeltas(deltas);
          setPlayerDeltas(nextPlayerDeltas);
          setLastChangeAt(nextData.lastUpdated ?? new Date().toISOString());
        }
      } catch {
        // Ignore malformed stream payloads and fall back to interval refresh.
      }
    };

    source.addEventListener('matchup', handleMatchup);
    source.onerror = () => {
      source.close();
    };

    return () => {
      source.removeEventListener('matchup', handleMatchup);
      source.close();
    };
  }, [categories, data?.live, data?.round, leagueId, searchParams]);

  const matchupLeaderText = !data
    ? ''
    : data.home.summary.wins === data.away.summary.wins
      ? 'Matchup tied'
      : data.home.summary.wins > data.away.summary.wins
        ? `${data.home.teamName} leads ${data.home.summary.wins}-${data.away.summary.wins}`
        : `${data.away.teamName} leads ${data.away.summary.wins}-${data.home.summary.wins}`;

  const liveDeltaMap = new Map<string, MatchupDelta>();
  for (const delta of liveDeltas) {
    liveDeltaMap.set(`${delta.categoryKey}:${delta.side}`, delta);
  }

  const playerDeltaMap = new Map<string, PlayerStatDelta>();
  for (const delta of playerDeltas) {
    playerDeltaMap.set(`${delta.playerId}:${delta.categoryKey}`, delta);
  }
  const hasLiveUpdate = liveDeltas.length > 0 || playerDeltas.length > 0;

  if (loading) {
    return (
      <div className={`${leagueSurfacePatterns.panelSection} p-8 text-center`}>
        <p className="text-sm font-medium text-[color:var(--league-text-muted)]">
          Loading live matchup…
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`rounded-2xl p-6 text-sm shadow-sm ${leagueStatusTonePatterns.danger}`}>
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em]">Matchup</p>
            <p className="mt-2">{error}</p>
          </div>
          <button
            onClick={() => {
              setLoading(true);
              void fetchMatchup();
            }}
            className="inline-flex items-center justify-center rounded-xl border border-[color:var(--league-danger-soft)] bg-[color:var(--league-surface)] px-4 py-2 text-sm font-semibold text-[color:var(--league-danger)] shadow-sm transition hover:bg-[color:var(--league-danger-soft)]"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className={`${leagueSurfacePatterns.panelSection} p-8 text-center`}>
        <p className="text-sm font-semibold text-[color:var(--league-text)]">
          Matchup unavailable
        </p>
        <p className="mt-2 text-sm text-[color:var(--league-text-muted)]">
          We could not load this matchup panel. Try refreshing the matchup.
        </p>
        <button
          onClick={() => {
            setLoading(true);
            void fetchMatchup();
          }}
          className="mt-4 inline-flex items-center justify-center rounded-xl border border-[color:var(--league-border)] bg-[color:var(--league-surface)] px-4 py-2 text-sm font-semibold text-[color:var(--league-text)] shadow-sm transition hover:bg-[color:var(--league-surface-muted)]"
        >
          Retry
        </button>
      </div>
    );
  }

  const completedTeams = new Set(
    (data.completedTeams ?? []).map((team) => normalizeTeamName(team))
  );
  const homeProgress = getPlayerProgress(data.home.starters, completedTeams);
  const awayProgress = getPlayerProgress(data.away.starters, completedTeams);
  const recentScoringEvents =
    playerDeltas.length > 0
      ? playerDeltas.slice(0, 6)
      : liveDeltas.slice(0, 6).map((delta) => ({
          playerId: `${delta.side}:${delta.categoryKey}`,
          playerName: delta.side === 'home' ? data.home.teamName : data.away.teamName,
          categoryKey: delta.categoryKey,
          label: delta.label,
          value: delta.value,
        }));
  const selectedRound = searchParams?.get('round');

  const renderLineup = (team: MatchupPayload['home'], side: 'home' | 'away') => {
    const progress = getPlayerProgress(team.starters, completedTeams);
    const sortedStarters = [...team.starters].sort((a, b) => {
      if (!selectedCategoryKey) return 0;
      const aValue = getPlayerCategoryStat(a.stats, selectedCategoryKey) ?? 0;
      const bValue = getPlayerCategoryStat(b.stats, selectedCategoryKey) ?? 0;
      if (bValue !== aValue) return bValue - aValue;

      const aHasStats = hasRoundStats(a.stats) ? 1 : 0;
      const bHasStats = hasRoundStats(b.stats) ? 1 : 0;
      if (bHasStats !== aHasStats) return bHasStats - aHasStats;

      return a.name.localeCompare(b.name);
    });
    const topContributorIds = selectedCategoryKey
      ? new Set(
          sortedStarters
            .filter((player) => (getPlayerCategoryStat(player.stats, selectedCategoryKey) ?? 0) > 0)
            .slice(0, 3)
            .map((player) => player.id)
        )
      : new Set<string>();

    return (
      <div className={leagueSurfacePatterns.panel}>
        <div className={leagueSurfacePatterns.sectionHeaderCompact}>
          <p className="text-xs uppercase tracking-[0.3em] text-[color:var(--league-text-muted)]">
            {side === 'home' ? 'Your Lineup' : 'Opponent'}
          </p>
          <div className="mt-2 flex items-end justify-between gap-3">
            <div>
              <h3 className="text-xl font-semibold text-[color:var(--league-text)]">
                {team.teamName}
              </h3>
              <p className="mt-1 text-sm text-[color:var(--league-text-muted)]">
                {team.summary.wins}-{team.summary.losses}-{team.summary.ties} in categories
              </p>
              <p className="mt-1 text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--league-text-muted)]">
                {progress.played} played • {progress.remaining} remaining
              </p>
            </div>
            <div className="rounded-full bg-[color:var(--league-text)] px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white">
              {team.starters.length} active
            </div>
          </div>
        </div>
        <div className={leagueSurfacePatterns.dividedList}>
          {sortedStarters.map((player, index) => {
            const rowState = getPlayerRowState(player, completedTeams);
            const rowStateMeta = getPlayerRowStateMeta(rowState);
            const selectedCategoryValue = selectedCategoryKey
              ? (getPlayerCategoryStat(player.stats, selectedCategoryKey) ?? 0)
              : 0;
            const isTopContributor = selectedCategoryKey ? topContributorIds.has(player.id) : false;

            return (
              <div
                key={`${side}:${player.id}:${index}`}
                className={clsx(
                  'grid items-center gap-3 overflow-x-auto py-3 pl-4 pr-5 text-sm',
                  rowStateMeta.rowClassName,
                  selectedCategoryKey && isTopContributor && 'ring-1 ring-inset ring-warning'
                )}
                style={{
                  gridTemplateColumns: `minmax(180px,1.7fr) repeat(${data.categories.length}, minmax(88px, 0.75fr))`,
                }}
              >
                <div className="min-w-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <p className="truncate font-medium text-[color:var(--league-text)]">
                        {player.name}
                      </p>
                      {selectedCategoryKey && isTopContributor ? (
                        <span className="shrink-0 rounded-md bg-warning/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning ring-1 ring-inset ring-warning">
                          Hot
                        </span>
                      ) : null}
                    </div>
                    <span
                      className={clsx(
                        'shrink-0 rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset',
                        rowStateMeta.badgeClassName
                      )}
                    >
                      {rowStateMeta.badge}
                    </span>
                  </div>
                  <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 truncate text-xs text-[color:var(--league-text-muted)]">
                    <span className="shrink-0 uppercase tracking-wide">
                      {player.position || 'UTIL'}
                    </span>
                    <span className="shrink-0 opacity-50" aria-hidden="true">
                      •
                    </span>
                    {player.team ? (
                      <span className="inline-flex min-w-0 items-center gap-1.5 normal-case tracking-normal">
                        <TeamLogo
                          team={player.team}
                          size={16}
                          withCircle
                          decorative
                          className="shrink-0"
                        />
                        <span className="truncate">{player.team}</span>
                      </span>
                    ) : (
                      <span className="shrink-0 uppercase tracking-wide">FA</span>
                    )}
                  </p>
                  {selectedCategoryKey ? (
                    <p
                      className={clsx(
                        'mt-1 text-[11px]',
                        isTopContributor
                          ? 'font-semibold text-[color:var(--league-text)]'
                          : 'font-medium text-[color:var(--league-text-muted)]'
                      )}
                    >
                      {
                        data.categories.find((category) => category.key === selectedCategoryKey)
                          ?.label
                      }
                      :{' '}
                      <span className={clsx('text-[color:var(--league-text)]', 'font-semibold')}>
                        {formatStat(selectedCategoryValue)}
                      </span>
                    </p>
                  ) : null}
                </div>
                {data.categories.map((category) => (
                  <div
                    key={category.key}
                    className={clsx(
                      'rounded-lg px-2 py-1 text-right transition',
                      selectedCategoryKey === category.key
                        ? 'bg-foreground text-white shadow-sm'
                        : selectedCategoryKey
                          ? 'opacity-45'
                          : undefined
                    )}
                  >
                    <p
                      className={clsx(
                        'text-[10px] uppercase tracking-wide',
                        selectedCategoryKey === category.key
                          ? 'text-muted-foreground'
                          : 'text-[color:var(--league-text-muted)]'
                      )}
                    >
                      {category.label}
                    </p>
                    <div className="flex items-center justify-end gap-2">
                      {playerDeltaMap.get(`${player.id}:${category.key}`) ? (
                        <span
                          aria-label={`${player.name} ${category.label.toLowerCase()} changed by ${
                            playerDeltaMap.get(`${player.id}:${category.key}`)!.value > 0 ? '+' : ''
                          }${formatStat(playerDeltaMap.get(`${player.id}:${category.key}`)!.value)}`}
                          className={clsx(
                            'inline-flex items-center rounded-full px-2 py-1 text-[10px] font-semibold shadow-sm ring-1 ring-inset transition',
                            playerDeltaMap.get(`${player.id}:${category.key}`)!.value > 0
                              ? selectedCategoryKey === category.key
                                ? 'bg-white/15 text-success ring-white/10'
                                : 'bg-success/10 text-success ring-success'
                              : selectedCategoryKey === category.key
                                ? 'bg-white/15 text-destructive ring-white/10'
                                : 'bg-destructive/10 text-destructive ring-destructive'
                          )}
                        >
                          {playerDeltaMap.get(`${player.id}:${category.key}`)!.value > 0 ? '+' : ''}
                          {formatStat(playerDeltaMap.get(`${player.id}:${category.key}`)!.value)}
                        </span>
                      ) : null}
                      <p
                        className={clsx(
                          'font-semibold',
                          selectedCategoryKey === category.key
                            ? 'text-white'
                            : 'text-[color:var(--league-text)]'
                        )}
                      >
                        {formatStat(getPlayerCategoryStat(player.stats, category.key))}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-7">
      {staleError ? (
        <div
          role="status"
          className={`rounded-2xl p-4 text-sm shadow-sm ${leagueStatusTonePatterns.warning}`}
        >
          Matchup refresh failed. Showing the last loaded matchup. {staleError}
        </div>
      ) : null}

      {embedded ? (
        <LeagueViewHeader
          eyebrow={data.roundLabel}
          title={matchupLeaderText}
          description={`Live category scoring for Season ${data.season}, Round ${data.round}.`}
          chips={[
            {
              label: getStatusLabel(data.status, data.live),
              tone: data.live ? 'warning' : data.status === 'final' ? 'success' : 'neutral',
            },
            ...(data.lastUpdated
              ? [
                  {
                    label: `Updated ${new Date(data.lastUpdated).toLocaleTimeString('en-AU', {
                      hour: 'numeric',
                      minute: '2-digit',
                    })}`,
                  },
                ]
              : []),
            ...(hasLiveUpdate ? [{ label: 'Live update', tone: 'success' as const }] : []),
          ]}
          actions={
            <button
              onClick={() => {
                void fetchMatchup({ background: true });
              }}
              className="inline-flex items-center justify-center rounded-xl border border-[color:var(--league-border)] bg-[color:var(--league-surface)] px-4 py-2 text-sm font-semibold text-[color:var(--league-text)] transition hover:border-[color:var(--league-accent)] hover:bg-[color:var(--league-accent-soft)]"
            >
              Refresh matchup
            </button>
          }
          aside={
            hasLiveUpdate ? (
              <div className="flex flex-wrap items-center gap-2">
                {liveDeltas.slice(0, 4).map((delta) => (
                  <span
                    key={`${delta.categoryKey}:${delta.side}`}
                    className={clsx(
                      'inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold shadow-sm ring-1 ring-inset transition',
                      delta.value > 0
                        ? 'bg-success/10 text-success ring-success'
                        : 'bg-destructive/10 text-destructive ring-destructive'
                    )}
                  >
                    <span className="uppercase tracking-[0.2em]">{delta.label}</span>
                    <span>{delta.side === 'home' ? data.home.teamName : data.away.teamName}</span>
                    <span>
                      {delta.value > 0 ? `+${formatStat(delta.value)}` : formatStat(delta.value)}
                    </span>
                  </span>
                ))}
                {lastChangeAt ? (
                  <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                    {new Date(lastChangeAt).toLocaleTimeString('en-AU', {
                      hour: 'numeric',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </span>
                ) : null}
              </div>
            ) : null
          }
        />
      ) : (
        <div className="overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-foreground via-foreground to-info p-6 text-white shadow-xl">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.35em] text-info">
                {data.roundLabel}
              </p>
              <h2 className="mt-2 text-3xl font-semibold">{matchupLeaderText}</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Live category scoring for Season {data.season}, Round {data.round}.
              </p>
              <div className="mt-5 flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-info">
                <span className="rounded-full bg-white/10 px-3 py-1">
                  {data.home.teamName}: {homeProgress.played} played • {homeProgress.remaining}{' '}
                  remaining
                </span>
                <span className="rounded-full bg-white/10 px-3 py-1">
                  {data.away.teamName}: {awayProgress.played} played • {awayProgress.remaining}{' '}
                  remaining
                </span>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
                <span className="rounded-full bg-white/10 px-3 py-1 font-semibold">
                  {getStatusLabel(data.status, data.live)}
                </span>
                {data.lastUpdated ? (
                  <span className="rounded-full bg-white/10 px-3 py-1">
                    Updated{' '}
                    {new Date(data.lastUpdated).toLocaleTimeString('en-AU', {
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </span>
                ) : null}
                {refreshing ? <span className="text-info">Refreshing…</span> : null}
                {hasLiveUpdate ? (
                  <span className="rounded-full bg-success px-3 py-1 font-semibold text-success ring-1 ring-inset ring-success">
                    Live update
                  </span>
                ) : null}
              </div>
              {hasLiveUpdate ? (
                <div className="mt-5 flex flex-wrap items-center gap-2">
                  {liveDeltas.slice(0, 4).map((delta) => (
                    <span
                      key={`${delta.categoryKey}:${delta.side}`}
                      className={clsx(
                        'inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold shadow-sm ring-1 ring-inset transition',
                        delta.value > 0
                          ? 'bg-success text-success ring-success'
                          : 'bg-destructive text-destructive ring-destructive'
                      )}
                    >
                      <span className="uppercase tracking-[0.2em]">{delta.label}</span>
                      <span>{delta.side === 'home' ? data.home.teamName : data.away.teamName}</span>
                      <span>
                        {delta.value > 0 ? `+${formatStat(delta.value)}` : formatStat(delta.value)}
                      </span>
                    </span>
                  ))}
                  {lastChangeAt ? (
                    <span className="text-xs uppercase tracking-[0.2em] text-info">
                      {new Date(lastChangeAt).toLocaleTimeString('en-AU', {
                        hour: 'numeric',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
            <button
              onClick={() => {
                void fetchMatchup({ background: true });
              }}
              className="inline-flex items-center justify-center rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold text-white ring-1 ring-inset ring-white/15 transition hover:bg-white/15"
            >
              Refresh matchup
            </button>
          </div>
        </div>
      )}

      {schedule.length > 0 ? (
        <div className={leagueSurfacePatterns.panelCard}>
          <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <p className={leagueSurfacePatterns.sectionEyebrow}>Round Selector</p>
              <p className={leagueSurfacePatterns.body}>Browse round slates.</p>
            </div>
            {selectedRound ? (
              <Link
                href={`${pathname}?tab=matchup`}
                className="inline-flex items-center justify-center rounded-xl border border-[color:var(--league-border)] bg-[color:var(--league-surface-muted)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[color:var(--league-text-muted)] transition hover:border-[color:var(--league-accent)] hover:bg-[color:var(--league-accent-soft)] hover:text-[color:var(--league-text)]"
              >
                Back to current
              </Link>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {schedule
              .filter((week) => week.aflRound != null)
              .map((week) => {
                const params = new URLSearchParams(searchParams?.toString() ?? '');
                params.set('tab', 'matchup');
                params.set('round', String(week.aflRound));
                params.delete('matchupId');
                const href = `${pathname}?${params.toString()}`;
                const isSelected =
                  data.round === week.aflRound &&
                  ((selectedRound && Number(selectedRound) === week.aflRound) ||
                    (!selectedRound && week.current));

                return (
                  <Link
                    key={week.id}
                    href={href}
                    className={clsx(
                      'rounded-full border px-3 py-2 text-xs font-semibold uppercase tracking-wide transition',
                      isSelected
                        ? 'border-[color:var(--league-primary)] bg-[color:var(--league-primary)] text-white'
                        : week.current
                          ? 'border-[color:var(--league-accent)] bg-[color:var(--league-accent-soft)] text-[color:var(--league-accent)]'
                          : 'border-[color:var(--league-border)] bg-[color:var(--league-surface-muted)] text-[color:var(--league-text-muted)] hover:border-[color:var(--league-accent)] hover:bg-[color:var(--league-accent-soft)] hover:text-[color:var(--league-text)]'
                    )}
                  >
                    {week.roundLabel}
                  </Link>
                );
              })}
          </div>
        </div>
      ) : null}

      <LiveGameScoresPanel
        season={data.season}
        round={data.round}
        title="Live game scores"
        subtitle="AFL scoreboard for this round."
        emptyLabel={`No live AFL games in ${data.roundLabel}.`}
      />

      {data.otherMatchups.length > 0 ? (
        <div className={leagueSurfacePatterns.panelCard}>
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <p className={leagueSurfacePatterns.sectionEyebrow}>League Matchups</p>
              <p className={leagueSurfacePatterns.body}>Open any league head-to-head.</p>
            </div>
            <button
              type="button"
              onClick={() => setShowLeagueMatchups((current) => !current)}
              aria-expanded={showLeagueMatchups}
              aria-controls="league-matchups-panel"
              className="inline-flex items-center justify-center rounded-xl border border-[color:var(--league-border)] bg-[color:var(--league-surface-muted)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[color:var(--league-text-muted)] transition hover:border-[color:var(--league-accent)] hover:bg-[color:var(--league-accent-soft)] hover:text-[color:var(--league-text)]"
            >
              {showLeagueMatchups ? 'Hide' : 'Show'}
            </button>
          </div>
          {!showLeagueMatchups ? (
            <p className={leagueSurfacePatterns.body}>
              Collapsed by default. Expand to browse the other current league head-to-heads.
            </p>
          ) : (
            <div
              id="league-matchups-panel"
              className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
            >
              {data.otherMatchups.map((matchup) => {
                const nextParams = new URLSearchParams(searchParams?.toString() ?? '');
                nextParams.set('tab', 'matchup');
                nextParams.set('matchupId', matchup.matchupId);
                const href = `${pathname}?${nextParams.toString()}`;

                return (
                  <Link
                    key={matchup.matchupId}
                    href={href}
                    aria-label={`View ${matchup.homeTeamName} vs ${matchup.awayTeamName} matchup`}
                    className={`group ${leagueSurfacePatterns.subpanel} transition hover:border-[color:var(--league-accent)] hover:bg-[color:var(--league-accent-soft)]`}
                  >
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[color:var(--league-text-muted)]">
                      {data.roundLabel}
                    </p>
                    <div className="mt-3 flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-[color:var(--league-text)]">
                          {matchup.homeTeamName} vs {matchup.awayTeamName}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-lg font-semibold text-[color:var(--league-text)]">
                          {matchup.homeScore}-{matchup.awayScore}
                        </p>
                        <p className="mt-1 text-[11px] uppercase tracking-wide text-[color:var(--league-text-muted)]">
                          View matchup
                        </p>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      ) : null}

      {recentScoringEvents.length > 0 ? (
        <div className={leagueSurfacePatterns.panelCard}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className={leagueSurfacePatterns.sectionEyebrow}>Recent scoring events</p>
              <p className={leagueSurfacePatterns.body}>Latest player stat swings.</p>
            </div>
            {lastChangeAt ? (
              <span className="rounded-full bg-[color:var(--league-surface-muted)] px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[color:var(--league-text-muted)]">
                {new Date(lastChangeAt).toLocaleTimeString('en-AU', {
                  hour: 'numeric',
                  minute: '2-digit',
                  second: '2-digit',
                })}
              </span>
            ) : null}
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {recentScoringEvents.map((event) => (
              <div
                key={`${event.playerId}:${event.categoryKey}`}
                className={clsx(
                  'rounded-2xl border px-4 py-3 shadow-sm',
                  event.value > 0
                    ? 'border-success/20 bg-success/10'
                    : 'border-destructive/20 bg-destructive/10'
                )}
              >
                <p className="font-semibold text-[color:var(--league-text)]">{event.playerName}</p>
                <p className="mt-1 text-sm font-medium text-[color:var(--league-text-muted)]">
                  {event.label} {event.value > 0 ? '+' : ''}
                  {formatStat(event.value)}
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <section
        className={leagueSurfacePatterns.panelCard}
        aria-labelledby="matchup-category-battle-heading"
      >
        <div className="max-w-2xl space-y-0.5">
          <p className={leagueSurfacePatterns.sectionEyebrow}>Categories</p>
          <h3
            id="matchup-category-battle-heading"
            className="text-lg font-semibold text-[color:var(--league-text)]"
          >
            Live category battle
          </h3>
          <p className="text-xs leading-relaxed text-[color:var(--league-text-muted)]">
            Tap a category to sort lineups; tap again to clear.
          </p>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {data.categories.map((category) => {
            const urgencyText = getCategoryUrgencyText({
              category,
              homeTeamName: data.home.teamName,
              awayTeamName: data.away.teamName,
              homeProgress,
              awayProgress,
            });

            return (
              <button
                key={category.key}
                data-testid={`category-card-${category.key}`}
                type="button"
                aria-pressed={selectedCategoryKey === category.key}
                onClick={() =>
                  setSelectedCategoryKey((current) =>
                    current === category.key ? null : category.key
                  )
                }
                className={clsx(
                  'flex h-full flex-col gap-1.5 rounded-2xl border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-2.5 text-left shadow-sm transition',
                  category.winner === 'home'
                    ? 'border-t-2 border-t-emerald-400'
                    : category.winner === 'away'
                      ? 'border-t-2 border-t-rose-400'
                      : 'border-t-2 border-t-slate-300',
                  selectedCategoryKey === category.key &&
                    'ring-1 ring-[color:var(--league-text)] ring-offset-1 ring-offset-[color:var(--league-surface)]',
                  leadChangeKeys.includes(category.key) &&
                    'animate-pulse ring-1 ring-warning ring-offset-1 ring-offset-[color:var(--league-surface)]'
                )}
              >
                <div className="min-h-0 space-y-0.5">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[color:var(--league-text-muted)]">
                    {category.label}
                  </p>
                  <p className="line-clamp-2 text-xs font-semibold leading-tight text-[color:var(--league-text)]">
                    {getCategoryStateSummary(category)}
                  </p>
                </div>
                <p className="line-clamp-2 text-[11px] leading-snug text-[color:var(--league-text-muted)]">
                  {urgencyText}
                </p>
                <div className="mt-auto rounded-xl bg-[color:var(--league-surface-muted)] px-2 py-1.5">
                  <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-x-1.5">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[color:var(--league-text-muted)]">
                      You
                    </p>
                    <div className="text-center text-[10px] font-semibold uppercase tracking-[0.12em] text-[color:var(--league-text-muted)]">
                      Gap
                    </div>
                    <p className="text-right text-[10px] font-semibold uppercase tracking-[0.12em] text-[color:var(--league-text-muted)]">
                      Opp
                    </p>
                  </div>
                  <div className="mt-1 grid grid-cols-[1fr_auto_1fr] items-center gap-x-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-1">
                      <p className="tabular-nums text-base font-semibold leading-none tracking-tight text-[color:var(--league-text)]">
                        {formatStat(category.home)}
                      </p>
                      {liveDeltaMap.get(`${category.key}:home`) ? (
                        <span
                          aria-label={`${category.label} home changed by ${
                            liveDeltaMap.get(`${category.key}:home`)!.value > 0 ? '+' : ''
                          }${formatStat(liveDeltaMap.get(`${category.key}:home`)!.value)}`}
                          className={clsx(
                            'inline-flex shrink-0 items-center rounded-full px-1.5 py-px text-[10px] font-semibold ring-1 ring-inset transition',
                            liveDeltaMap.get(`${category.key}:home`)!.value > 0
                              ? 'bg-success/10 text-success ring-success'
                              : 'bg-destructive/10 text-destructive ring-destructive'
                          )}
                        >
                          {liveDeltaMap.get(`${category.key}:home`)!.value > 0 ? '+' : ''}
                          {formatStat(liveDeltaMap.get(`${category.key}:home`)!.value)}
                        </span>
                      ) : null}
                    </div>
                    <div className="flex justify-center px-0.5">
                      <p className="tabular-nums text-xs font-semibold text-[color:var(--league-text)]">
                        {category.winner === 'tie'
                          ? 'Even'
                          : formatStat(getCategoryMargin(category))}
                      </p>
                    </div>
                    <div className="flex min-w-0 flex-wrap items-center justify-end gap-1">
                      {liveDeltaMap.get(`${category.key}:away`) ? (
                        <span
                          aria-label={`${category.label} away changed by ${
                            liveDeltaMap.get(`${category.key}:away`)!.value > 0 ? '+' : ''
                          }${formatStat(liveDeltaMap.get(`${category.key}:away`)!.value)}`}
                          className={clsx(
                            'inline-flex shrink-0 items-center rounded-full px-1.5 py-px text-[10px] font-semibold ring-1 ring-inset transition',
                            liveDeltaMap.get(`${category.key}:away`)!.value > 0
                              ? 'bg-success/10 text-success ring-success'
                              : 'bg-destructive/10 text-destructive ring-destructive'
                          )}
                        >
                          {liveDeltaMap.get(`${category.key}:away`)!.value > 0 ? '+' : ''}
                          {formatStat(liveDeltaMap.get(`${category.key}:away`)!.value)}
                        </span>
                      ) : null}
                      <p className="tabular-nums text-base font-semibold leading-none tracking-tight text-[color:var(--league-text)]">
                        {formatStat(category.away)}
                      </p>
                    </div>
                  </div>
                  <div className="mt-1 grid grid-cols-[1fr_auto_1fr] items-center gap-x-1.5 text-[10px] leading-tight text-[color:var(--league-text-muted)]">
                    <p className="truncate">{homeProgress.remaining} left</p>
                    <span aria-hidden className="block min-h-[1em] min-w-px shrink-0" />
                    <p className="truncate text-right">{awayProgress.remaining} left</p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <div className="grid gap-7 xl:grid-cols-2">
        {renderLineup(data.home, 'home')}
        {renderLineup(data.away, 'away')}
      </div>
    </div>
  );
}
