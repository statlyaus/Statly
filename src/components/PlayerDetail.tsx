'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { Player } from '@/types/players';
import type { MatchLog } from '@/types/matchLogs';
import { fetchApi } from '@/lib/api';
import { getTeamAbbreviation, getTeamLogo } from '@/lib/teamLogos';
import PlayerSummaryCard from './PlayerSummaryCard';
import MatchLogTable from './MatchLogTable';
import PlayerChart from './PlayerChart';
import { PlayerLeagueAvailabilityPanel } from './PlayerLeagueAvailabilityPanel';
import { LoadingSpinner } from './ui';

type PlayerDetailProps = {
  player: Player;
};

const categoryProfile = [
  { key: 'goals', label: 'Goals', shortLabel: 'G' },
  { key: 'goalAssists', label: 'Goal Assists', shortLabel: 'GA' },
  { key: 'tackles', label: 'Tackles', shortLabel: 'T' },
  { key: 'clearances', label: 'Clearances', shortLabel: 'CLR' },
  { key: 'inside50s', label: 'Inside 50s', shortLabel: 'I50' },
  { key: 'rebound50s', label: 'Rebound 50s', shortLabel: 'R50' },
  { key: 'hitouts', label: 'Hitouts', shortLabel: 'HO' },
  { key: 'marks', label: 'Marks', shortLabel: 'M' },
  { key: 'disposals', label: 'Disposals', shortLabel: 'D' },
] as const;

function normalizeMatchLogsResponse(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value as Record<string, unknown>[];

  if (
    typeof value === 'object' &&
    value !== null &&
    (value as { success?: unknown }).success === true &&
    Array.isArray((value as { data?: unknown }).data)
  ) {
    return (value as { data: Record<string, unknown>[] }).data;
  }

  return [];
}

function readPlayerNumber(player: Player, key: string): number | null {
  const aliases: Record<string, string[]> = {
    goalAssists: ['goal_assists'],
    inside50s: ['inside_50s'],
    rebound50s: ['rebound_50s'],
    scoreInvolvements: ['score_involvements'],
    effectiveDisposals: ['effective_disposals'],
  };
  const direct = player[key as keyof Player];
  if (typeof direct === 'number' && Number.isFinite(direct)) return direct;

  const stat = player.stats?.[key];
  if (typeof stat === 'number' && Number.isFinite(stat)) return stat;
  if (typeof stat === 'string') {
    const parsed = Number(stat);
    return Number.isFinite(parsed) ? parsed : null;
  }

  for (const alias of aliases[key] ?? []) {
    const aliasStat = player.stats?.[alias];
    if (typeof aliasStat === 'number' && Number.isFinite(aliasStat)) return aliasStat;
    if (typeof aliasStat === 'string') {
      const parsed = Number(aliasStat);
      if (Number.isFinite(parsed)) return parsed;
    }
  }

  return null;
}

function readMatchCategory(log: MatchLog, key: string): number | null {
  const value = log[key as keyof MatchLog];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return null;
}

function readStatlyValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readPlayerStatlyValue(player: Player): number | null {
  const source = player as Player & {
    statlyZScore?: unknown;
    totalValue?: unknown;
    overall?: unknown;
    rank?: unknown;
  };
  return (
    readStatlyValue(source.statlyZScore) ??
    readStatlyValue(source.totalValue) ??
    readStatlyValue(source.overall)
  );
}

function readMatchStatlyValue(log: MatchLog): number | null {
  return readStatlyValue(log.totalValue);
}

function formatNumber(value: number | null, digits = 0): string {
  if (value === null || !Number.isFinite(value)) return '-';
  return value.toLocaleString('en-AU', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function averageMatchCategory(matchLogs: MatchLog[], key: string): number | null {
  const values = matchLogs
    .map((log) => readMatchCategory(log, key))
    .filter((value): value is number => value !== null);
  return average(values);
}

function buildTrendLabel(recentAverage: number | null, seasonAverage: number | null): string {
  if (recentAverage === null || seasonAverage === null) return 'Season profile';
  const delta = recentAverage - seasonAverage;
  if (Math.abs(delta) < 3) return 'Holding level';
  return delta > 0 ? `Up ${formatNumber(delta, 1)}` : `Down ${formatNumber(Math.abs(delta), 1)}`;
}

function hasAggregateStats(player: Player): boolean {
  if (typeof player.games === 'number' && player.games > 0) return true;
  return categoryProfile.some((category) => readPlayerNumber(player, category.key) !== null);
}

function buildCoverageLabel(player: Player, matchLogCount: number): string {
  const games = typeof player.games === 'number' && player.games > 0 ? player.games : null;
  if (matchLogCount > 0) return `${matchLogCount} match logs`;
  if (games !== null) return `${games} season games, no match logs`;
  return 'No match logs';
}

function getInjuryLabel(player: Player): string | null {
  const injury = typeof player.injury === 'string' ? player.injury.trim() : '';
  if (!injury || ['home', 'away', 'unknown', '-'].includes(injury.toLowerCase())) return null;
  return injury;
}

function PlayerDecisionDashboard({
  player,
  matchLogs,
}: {
  player: Player;
  matchLogs: MatchLog[];
}): React.JSX.Element {
  const statlyValues = matchLogs
    .map(readMatchStatlyValue)
    .filter((value): value is number => value !== null);
  const recentStatlyValues = statlyValues.slice(0, 3);
  const seasonStatlyValue = average(statlyValues) ?? readPlayerStatlyValue(player);
  const recentStatlyValue = average(recentStatlyValues);
  const latestLog = matchLogs[0] ?? null;
  const latestStatlyValue = latestLog ? readMatchStatlyValue(latestLog) : null;
  const categoryRows = categoryProfile.map((category) => ({
    ...category,
    value: averageMatchCategory(matchLogs, category.key) ?? readPlayerNumber(player, category.key),
  }));
  const topCategories = [...categoryRows]
    .filter((category) => category.value !== null)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
    .slice(0, 3)
    .map((category) => category.key);
  const injuryLabel = getInjuryLabel(player);
  const riskLabel = injuryLabel ?? 'No injury flag on player record';
  const aggregateStatsAvailable = hasAggregateStats(player);
  const coverageLabel = buildCoverageLabel(player, matchLogs.length);
  const roleSignals = [
    { label: 'Club', value: player.team?.trim() || 'Unlisted' },
    { label: 'Position', value: player.position?.trim() || 'Unlisted' },
    { label: 'Games', value: formatNumber(player.games ?? matchLogs.length) },
    { label: 'Data coverage', value: coverageLabel },
  ];

  return (
    <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-6">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Decision Hub</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Player signals calculated from available season totals and match history.
          </p>
        </div>
        <span className="rounded-full border border-border bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground">
          {matchLogs.length > 0
            ? buildTrendLabel(recentStatlyValue, seasonStatlyValue)
            : aggregateStatsAvailable
              ? 'Aggregate season data'
              : 'No player data'}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-[220px_minmax(0,1fr)_220px] gap-4">
        <div className="rounded-md border border-border bg-background p-3">
          <h3 className="text-sm font-semibold text-foreground">Form Snapshot</h3>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Metric label="Latest value" value={formatNumber(latestStatlyValue, 2)} detail={latestLog ? `R${latestLog.round} vs ${latestLog.opponent || '-'}` : 'No round log'} />
            <Metric label="3-game value" value={formatNumber(recentStatlyValue, 2)} detail={`${recentStatlyValues.length} games counted`} />
            <Metric
              label="Statly value"
              value={formatNumber(seasonStatlyValue, 2)}
              detail={statlyValues.length > 0 ? `${statlyValues.length} value samples` : aggregateStatsAvailable ? 'From player record' : 'Pending value'}
            />
            <Metric label="Categories" value={formatNumber(categoryRows.filter((category) => category.value !== null).length)} detail="Available category averages" />
          </div>
        </div>

        <div className="rounded-md border border-border bg-background p-3">
          <h3 className="text-sm font-semibold text-foreground">Category Profile</h3>
          <div className="mt-3 grid grid-cols-4 gap-3">
            {categoryRows.map((category) => (
              <div
                key={category.key}
                className={`rounded-md border p-3 ${
                  topCategories.includes(category.key)
                    ? 'border-primary/40 bg-primary/10'
                    : 'border-border bg-card'
                }`}
              >
                <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  {category.label}
                </div>
                <div className="mt-2 text-xl font-semibold text-foreground">
                  {formatNumber(category.value, category.value !== null && category.value < 10 ? 1 : 0)}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-md border border-border bg-background p-3">
          <h3 className="text-sm font-semibold text-foreground">Role And Risk</h3>
          <div className="mt-3 space-y-2">
            {roleSignals.map((signal) => (
              <div key={signal.label} className="flex items-center justify-between gap-4 border-b border-border pb-2 last:border-b-0 last:pb-0">
                <span className="text-sm text-muted-foreground">{signal.label}</span>
                <span className="text-sm font-semibold text-foreground">{signal.value}</span>
              </div>
            ))}
          </div>
          <div className={`mt-3 rounded-md border p-3 text-sm ${
            injuryLabel
              ? 'border-destructive/30 bg-destructive/10 text-destructive'
              : 'border-emerald-200 bg-emerald-50 text-emerald-900'
          }`}>
            <span className="font-semibold">Availability:</span> {riskLabel}
          </div>
        </div>
      </div>
    </section>
  );
}

function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}): React.JSX.Element {
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold text-foreground">{value}</div>
      <div className="mt-1 truncate text-xs text-muted-foreground">{detail}</div>
    </div>
  );
}

export const PlayerDetail = ({ player }: PlayerDetailProps) => {
  const [matchLogs, setMatchLogs] = useState<MatchLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const aggregateStatsAvailable = hasAggregateStats(player);
  const coverageLabel = buildCoverageLabel(player, matchLogs.length);
  const teamLogo = getTeamLogo(player.team || '');
  const teamAbbreviation = player.team ? getTeamAbbreviation(player.team) : 'AFL';
  const chartData = useMemo(
    () =>
      matchLogs.map((log) => ({
        season: log.season,
        round: log.round,
        totalValue: readMatchStatlyValue(log) ?? 0,
        opposition: log.opponent,
        categories: Object.fromEntries(
          categoryProfile.map((category) => [category.key, readMatchCategory(log, category.key) ?? 0])
        ),
      })),
    [matchLogs]
  );

  useEffect(() => {
    if (!player || !player.id) {
      setLoading(false);
      return;
    }

    const getMatchLogs = async () => {
      try {
        setLoading(true);
        const data = await fetchApi(`players/${player.id}/matches`);
        const matches = normalizeMatchLogsResponse(data);

        // Transform API data to match MatchLog interface
        const processedMatches: MatchLog[] = matches.map((match) => {
          const categories = (match.categories ?? {}) as Record<string, unknown>;
          const stats = (match.stats ?? {}) as Record<string, unknown>;
          const readMatchNumber = (...keys: string[]): number | undefined => {
            for (const key of keys) {
              const value = match[key] ?? categories[key] ?? stats[key];
              if (typeof value === 'number' && Number.isFinite(value)) return value;
            }
            return undefined;
          };

          return {
            season: match.season as number,
            round: match.round as number,
            opponent: (match.opponent as string) || (match.opposition as string) || '',
            goals: readMatchNumber('goals'),
            disposals: readMatchNumber('disposals'),
            marks: readMatchNumber('marks'),
            tackles: readMatchNumber('tackles'),
            clearances: readMatchNumber('clearances'),
            inside50s: readMatchNumber('inside50s', 'inside_50s'),
            rebound50s: readMatchNumber('rebound50s', 'rebound_50s'),
            hitouts: readMatchNumber('hitouts'),
            intercepts: readMatchNumber('intercepts'),
            goalAssists: readMatchNumber('goalAssists', 'goal_assists'),
            scoreInvolvements: readMatchNumber('scoreInvolvements', 'score_involvements'),
            effectiveDisposals: readMatchNumber('effectiveDisposals', 'effective_disposals'),
            fantasyPoints: (match.fantasyPoints as number) || (match.fantasyScore as number),
            matchDate: match.matchDate as string,
            venue: match.venue as string,
            result: match.result as 'W' | 'L' | 'D',
            margin: match.margin as number,
            kickingAccuracy: match.kickingAccuracy as string,
            timeOnGround: match.timeOnGround as number,
            superCoachScore: match.superCoachScore as number,
            dreamTeamScore: match.dreamTeamScore as number,
            totalValue: match.totalValue as number,
            fantasyScore: match.fantasyScore as number, // For backward compatibility
          };
        });

        // Sort matches by round in descending order
        processedMatches.sort((a, b) => b.round - a.round);

        setMatchLogs(processedMatches);
      } catch (err: unknown) {
        setError('Failed to load match history.');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    getMatchLogs();
  }, [player]);

  if (!player) {
    return <p>No player data available.</p>;
  }

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,var(--league-surface)_0%,var(--league-page)_42%,var(--league-surface-muted)_100%)] text-[color:var(--league-text)]">
      <div className="mx-auto grid w-full max-w-[var(--app-shell-max-width)] grid-cols-[minmax(0,1fr)_430px] gap-5 px-5 py-5 lg:px-8">
      <div className="min-w-0 space-y-5">
        <nav
          aria-label="Player page"
          className="flex h-12 items-center justify-between gap-4 rounded-lg border border-border bg-card px-4 shadow-sm"
        >
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-background p-1">
              <Image
                src={teamLogo}
                alt={`${player.team || 'AFL'} logo`}
                width={28}
                height={28}
                className="h-7 w-7 object-contain"
                style={{ width: 'auto', height: 'auto' }}
                unoptimized={teamLogo.endsWith('.svg')}
              />
            </div>
            <Link
              href="/players"
              className="inline-flex h-8 items-center rounded-md border border-border bg-background px-3 text-sm font-semibold text-foreground transition hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Players
            </Link>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">{player.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {teamAbbreviation} · {coverageLabel}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2 text-xs font-semibold text-muted-foreground">
            <span className="rounded-full border border-border bg-muted px-3 py-1">
              {aggregateStatsAvailable ? 'Season profile' : 'Limited data'}
            </span>
            {getInjuryLabel(player) ? (
              <span className="rounded-full border border-destructive/30 bg-destructive/10 px-3 py-1 text-destructive">
                Injury flag
              </span>
            ) : null}
          </div>
        </nav>

        <PlayerSummaryCard player={player} />

        <section className="min-w-0">
          {loading ? (
            <div className="flex h-64 items-center justify-center rounded-lg border border-border bg-card shadow-sm">
              <LoadingSpinner />
            </div>
          ) : error ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-5 text-sm text-destructive">
              {error}
            </div>
          ) : (
            <PlayerChart
              matchData={chartData}
              playerName={player.name}
              seasonGames={player.games}
              hasAggregateStats={aggregateStatsAvailable}
            />
          )}
        </section>

        <section className="min-w-0">
          {loading ? (
            <div className="flex h-64 items-center justify-center rounded-lg border border-border bg-card shadow-sm">
              <LoadingSpinner />
            </div>
          ) : error ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-5 text-sm text-destructive">
              {error}
            </div>
          ) : (
            <MatchLogTable
              matchLogs={matchLogs}
              playerName={player.name}
              onRefresh={() => window.location.reload()}
            />
          )}
        </section>

        <PlayerDecisionDashboard player={player} matchLogs={matchLogs} />
      </div>

      <aside className="sticky top-20 max-h-[calc(100vh-6rem)] min-w-0 overflow-y-auto">
        <PlayerLeagueAvailabilityPanel playerId={player.id} />
      </aside>
      </div>
    </div>
  );
};
