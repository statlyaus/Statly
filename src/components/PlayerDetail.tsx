'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { useLeagueStatColumns } from '@/hooks/useLeagueStatColumns';
import { fetchApi } from '@/lib/api';
import { normalizeMatchLogStatValue, type MatchLogRow } from '@/lib/matchLogs';
import { STAT_COLUMNS } from '@/lib/stats/statColumns';
import type { CanonicalStatKey } from '@/lib/stats/statColumns';
import { getTeamAbbreviation } from '@/lib/teamLogos';
import { calculateTotalValue } from '@/types/fantasyCategories';
import type { MatchLog } from '@/types/matchLogs';
import type { Player } from '@/types/players';

import PlayerChart from './PlayerChart';
import PlayerSummaryCard from './PlayerSummaryCard';
import { LoadingSpinner } from './ui';

type PlayerDetailProps = {
  player: Player;
  leagueId?: string;
};

const formatStatValue = (value: number | null | undefined) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 0 ? value.toLocaleString() : '0';
  }
  return '-';
};

/**
 * Formats round number for display.
 * Round 0 = Finals, otherwise shows "Round N"
 */
const formatRoundNumber = (round: number | undefined | null): string => {
  if (round === undefined || round === null) return '—';
  if (round === 0) return 'Finals';
  return `R${round}`;
};

type ChartMetric = 'totalValue' | CanonicalStatKey;

function toNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function computeMatchTotalValue(stats: MatchLogRow['stats'] | undefined): number {
  const s: Record<string, unknown> = (stats as Record<string, unknown> | undefined) ?? {};
  return calculateTotalValue({
    games: 1,
    kicks: toNumber(s.kicks),
    handballs: toNumber(s.handballs),
    marks: toNumber(s.marks),
    tackles: toNumber(s.tackles),
    goals: toNumber(s.goals),
    hitouts: toNumber(s.hitouts),
    clearances: toNumber(s.clearances),
    inside50s: toNumber(s.inside50s),
    rebound50s: toNumber(s.rebound50s),
    clangers: toNumber(s.clangers),
    contestedPossessions: toNumber(s.contestedPossessions),
    uncontestedPossessions: toNumber(s.uncontestedPossessions),
    freesFor: toNumber(s.freesFor),
    freesAgainst: toNumber(s.freesAgainst),
    onePercenters: toNumber(s.onePercenters),
    goalAssists: toNumber(s.goalAssists),
    timeOnGroundPct: normalizeMatchLogStatValue('timeOnGroundPct', s.timeOnGroundPct),
    disposalEffPct: normalizeMatchLogStatValue('disposalEffPct', s.disposalEffPct),
    turnovers: toNumber(s.turnovers),
    intercepts: toNumber(s.intercepts),
    metresGained: toNumber(s.metresGained),
    contestedMarks: toNumber(s.contestedMarks),
    effectiveDisposals: toNumber(s.effectiveDisposals),
    scoreInvolvements: toNumber(s.scoreInvolvements),
  });
}

export const PlayerDetail = ({ player, leagueId }: PlayerDetailProps) => {
  const [matchLogs, setMatchLogs] = useState<MatchLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [seasonFilter, setSeasonFilter] = useState<string>('all');
  const [recentFilter, setRecentFilter] = useState<number>(0);
  const [chartMetric, setChartMetric] = useState<ChartMetric>('totalValue');
  const { visibleKeys, allKeys, toggleKey, defaultKeys, labels } = useLeagueStatColumns(leagueId);

  const loadMatchLogs = useCallback(async () => {
    if (!player?.id) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const data = await fetchApi(`players/${player.id}/matches`);
      const matches = Array.isArray(data) ? data : (data?.data ?? []);

      // API now returns MatchLogRow[] directly
      const matchRows = matches as MatchLogRow[];

      // Convert MatchLogRow to MatchLog for UI compatibility
      const processedMatches: MatchLog[] = matchRows.map((row) => ({
        round: row.roundNumber,
        opponent: row.opponent,
        season: row.season,
        matchId: row.matchId,
        stats: row.stats,
        matchDate: row.date,
        totalValue: computeMatchTotalValue(row.stats),
      }));

      processedMatches.sort((a, b) => {
        const timeA = a.matchDate ? new Date(a.matchDate).getTime() : 0;
        const timeB = b.matchDate ? new Date(b.matchDate).getTime() : 0;
        if (timeA !== timeB) return timeB - timeA;
        return (b.round ?? 0) - (a.round ?? 0);
      });
      setMatchLogs(processedMatches);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load match history.');
    } finally {
      setLoading(false);
    }
  }, [player?.id]);

  useEffect(() => {
    void loadMatchLogs();
  }, [loadMatchLogs]);

  const availableSeasons = useMemo(() => {
    const seasons = matchLogs
      .map((log) => log.season)
      .filter((season): season is number => typeof season === 'number');
    const unique = Array.from(new Set(seasons)).sort((a, b) => b - a);
    return ['all', ...unique.map((season) => String(season))];
  }, [matchLogs]);

  const filteredMatches = useMemo(() => {
    let logs = [...matchLogs];
    if (seasonFilter !== 'all') {
      const seasonNum = Number(seasonFilter);
      if (Number.isFinite(seasonNum)) {
        logs = logs.filter((log) => log.season === seasonNum);
      }
    }

    logs.sort((a, b) => {
      const dateA = a.matchDate ? new Date(a.matchDate).getTime() : 0;
      const dateB = b.matchDate ? new Date(b.matchDate).getTime() : 0;
      return dateB - dateA || (b.round ?? 0) - (a.round ?? 0);
    });

    if (recentFilter > 0) {
      logs = logs.slice(0, recentFilter);
    }
    return logs;
  }, [matchLogs, seasonFilter, recentFilter]);

  const chartMetricOptions = useMemo(() => ['totalValue', ...allKeys] as ChartMetric[], [allKeys]);

  const selectedMetricLabel = useMemo(() => {
    if (chartMetric === 'totalValue') return 'Total Value';
    return labels[chartMetric]?.label ?? STAT_COLUMNS[chartMetric]?.label ?? chartMetric;
  }, [chartMetric, labels]);

  const chartData = useMemo(
    () =>
      filteredMatches.map((log) => ({
        round: log.round ?? undefined,
        value:
          chartMetric === 'totalValue'
            ? typeof log.totalValue === 'number'
              ? log.totalValue
              : computeMatchTotalValue(log.stats as MatchLogRow['stats'] | undefined)
            : normalizeMatchLogStatValue(chartMetric, log.stats?.[chartMetric]),
        opposition: log.opponent,
      })),
    [filteredMatches, chartMetric]
  );

  if (!player) {
    return <p>No player data available.</p>;
  }

  const renderMatchHistoryError = (withRetry = false) => (
    <div
      role="alert"
      className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-destructive"
    >
      <p className="font-semibold text-foreground">Match history unavailable</p>
      <p className="mt-1 text-sm">{error}</p>
      {withRetry && (
        <button
          type="button"
          onClick={() => void loadMatchLogs()}
          disabled={loading}
          className="mt-3 rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          aria-label="Retry match history"
        >
          Retry
        </button>
      )}
    </div>
  );

  return (
    <div className="space-y-10">
      <PlayerSummaryCard player={player} />

      <section className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-6 bg-white rounded-2xl border border-border p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-foreground">Recent Performance</h2>
            <span className="text-xs text-muted-foreground">Last matches</span>
          </div>
          <div className="mb-4 flex flex-wrap gap-3 text-sm">
            <label className="flex items-center gap-2">
              <span className="font-semibold text-muted-foreground">Season:</span>
              <select
                value={seasonFilter}
                onChange={(event) => setSeasonFilter(event.target.value)}
                className="rounded-md border border-border bg-white px-3 py-1 text-sm text-foreground"
              >
                {availableSeasons.map((season) => (
                  <option key={season} value={season}>
                    {season === 'all' ? 'All' : season}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-muted-foreground">Recently:</span>
              {[
                { label: 'All', value: 0 },
                { label: 'Last 3', value: 3 },
                { label: 'Last 5', value: 5 },
                { label: 'Last 10', value: 10 },
              ].map((option) => (
                <button
                  key={option.label}
                  type="button"
                  onClick={() => setRecentFilter(option.value)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                    recentFilter === option.value
                      ? 'bg-foreground text-white'
                      : 'bg-muted text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2">
              <span className="font-semibold text-muted-foreground">Stat:</span>
              <select
                value={chartMetric}
                onChange={(event) => setChartMetric(event.target.value as ChartMetric)}
                className="rounded-md border border-border bg-white px-3 py-1 text-sm text-foreground"
              >
                {chartMetricOptions.map((metric) => (
                  <option key={metric} value={metric}>
                    {metric === 'totalValue'
                      ? 'Total Value'
                      : (labels[metric]?.label ?? STAT_COLUMNS[metric]?.label ?? metric)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {loading ? (
            <div className="flex justify-center items-center h-48">
              <LoadingSpinner />
            </div>
          ) : error ? (
            renderMatchHistoryError()
          ) : (
            <PlayerChart
              matchData={chartData}
              playerName={player.name}
              metricLabel={selectedMetricLabel}
            />
          )}
        </div>
        <div className="lg:col-span-6 bg-white rounded-2xl border border-border p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-foreground">Match Logs</h2>
            <button
              type="button"
              className="text-xs font-semibold text-muted-foreground hover:text-foreground"
              onClick={() => void loadMatchLogs()}
              disabled={loading}
              aria-label={error ? 'Retry match history' : 'Refresh match history'}
            >
              {error ? 'Retry' : 'Refresh'}
            </button>
          </div>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">
              Showing {visibleKeys.length} league columns (defaults: {defaultKeys.length})
            </span>
            {allKeys.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => toggleKey(key)}
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  visibleKeys.includes(key)
                    ? 'bg-foreground text-white'
                    : 'bg-muted text-foreground'
                }`}
              >
                {labels[key]?.short ?? labels[key]?.label ?? key}
              </button>
            ))}
          </div>
          {loading ? (
            <div className="flex justify-center items-center h-48">
              <LoadingSpinner />
            </div>
          ) : error ? (
            renderMatchHistoryError()
          ) : (
            <div className="overflow-auto max-h-[60vh] border border-border rounded-lg">
              <table className="min-w-full text-sm">
                <thead className="sticky top-0 bg-muted text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Round</th>
                    <th className="px-3 py-2 text-left">Date</th>
                    <th className="px-3 py-2 text-left">Opponent</th>
                    <th className="px-3 py-2 text-left">Result</th>
                    {visibleKeys.map((key) => (
                      <th key={key} className="px-3 py-2 text-right">
                        {STAT_COLUMNS[key]?.label ?? key}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredMatches.length === 0 ? (
                    <tr>
                      <td
                        colSpan={visibleKeys.length + 4}
                        className="px-3 py-6 text-center text-muted-foreground"
                      >
                        No matches found.
                      </td>
                    </tr>
                  ) : (
                    filteredMatches.map((match) => (
                      <tr
                        key={
                          match.matchId ??
                          `${match.round ?? 'round'}-${match.matchDate ?? 'date'}-${match.opponent ?? 'opponent'}`
                        }
                      >
                        <td className="px-3 py-3">{formatRoundNumber(match.round)}</td>
                        <td className="px-3 py-3">
                          {match.matchDate ? new Date(match.matchDate).toLocaleDateString() : '—'}
                        </td>
                        <td className="px-3 py-3">
                          <span title={match.opponent || 'Unknown'}>
                            {getTeamAbbreviation(match.opponent || 'Unknown')}
                          </span>
                        </td>
                        <td className="px-3 py-3">{match.result ?? '-'}</td>
                        {visibleKeys.map((key) => (
                          <td key={key} className="px-3 py-3 text-right font-mono">
                            {formatStatValue(match.stats?.[key as keyof typeof match.stats])}
                          </td>
                        ))}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
