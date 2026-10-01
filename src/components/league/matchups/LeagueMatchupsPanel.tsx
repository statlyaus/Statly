'use client';

import { useEffect, useState } from 'react';

import {
  MatchupScoreLine,
  ResultChip,
  type CategoryResult,
} from '@/components/scores/MatchupScore';
import { authenticatedFetch } from '@/lib/authenticatedFetch';

interface LeagueMatchupsPanelProps {
  leagueId: string;
  currentUserId?: string;
}

interface MatchupModel {
  id?: string;
  round?: number;
  status?: 'SCHEDULED' | 'LIVE' | 'FINAL';
  startsAt?: string | null;
  finalizedAt?: string | null;
  homeMember?: MatchupTeamSummary | null;
  awayMember?: MatchupTeamSummary | null;
  byeMember?: { id?: string; teamName?: string; teamLogoUrl?: string | null } | null;
  homeCategoryWins?: number;
  awayCategoryWins?: number;
  drawnCategories?: number;
  categoryRows?: MatchupCategoryRow[];
}

interface MatchupTeamSummary {
  id?: string;
  teamName?: string;
  teamLogoUrl?: string | null;
  categoryWins?: number;
  categoryLosses?: number;
  categoryDraws?: number;
  pointsFor?: number;
  pointsAgainst?: number;
  matchupWin?: boolean;
  matchupLoss?: boolean;
  matchupDraw?: boolean;
  players?: MatchupPlayerContribution[];
}

interface MatchupCategoryRow {
  category: string;
  label: string;
  shortLabel: string;
  homeValue: number;
  awayValue: number;
  direction: 'HIGH_WINS' | 'LOW_WINS';
  winner: 'home' | 'away' | 'draw';
}

interface MatchupPlayerContribution {
  playerId: string;
  name: string;
  position: string;
  slot: string;
  slotIndex: number;
  total: number;
  hasStats?: boolean;
  categories: Array<{
    category: string;
    shortLabel: string;
    value: number;
  }>;
}

interface MatchupReadModel {
  round: number;
  scoringMode?: 'H2H_EACH_CATEGORY' | 'H2H_MOST_CATEGORIES';
  fixtureGenerationMode?: 'AUTOMATIC' | 'MANUAL';
  availableRounds?: number[];
  matchups: MatchupModel[];
  permissions?: { canManage?: boolean };
}

const BOX_SCORE_SLOT_LABELS: Record<string, string> = { INTERCHANGE: 'INT' };

function formatStatValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatDateTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

export function LeagueMatchupsPanel({ leagueId, currentUserId }: LeagueMatchupsPanelProps) {
  const [data, setData] = useState<MatchupReadModel | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState<string | null>(null);
  // Links such as Standings results open the Match Centre on a given round (?round=N).
  const [selectedRound, setSelectedRound] = useState<number | null>(() => {
    if (typeof window === 'undefined') return null;
    const requested = Number(new URLSearchParams(window.location.search).get('round'));
    return Number.isInteger(requested) && requested > 0 ? requested : null;
  });

  async function loadMatchups() {
    setStatus('loading');
    setMessage(null);
    try {
      const roundQuery = selectedRound ? `?round=${selectedRound}` : '';
      const response = await authenticatedFetch(
        `/api/leagues/${leagueId}/matchups${roundQuery}`,
        {},
        currentUserId
      );
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload.error ?? 'Failed to load matchups.');
      }
      setData(payload.data);
      setStatus('ready');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to load matchups.');
      setStatus('error');
    }
  }

  useEffect(() => {
    void loadMatchups();
  }, [leagueId, currentUserId, selectedRound]);

  if (status === 'loading') {
    return (
      <div className="rounded-lg border border-[color:var(--league-border)] p-4">
        Loading matchups
      </div>
    );
  }

  return (
    <section className="min-w-0 space-y-4" aria-labelledby="league-matchups-heading">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2
            id="league-matchups-heading"
            className="font-display text-2xl font-bold leading-tight text-[color:var(--league-text)]"
          >
            Matchups
          </h2>
          <p className="mt-1 text-sm text-[color:var(--league-text-muted)]">
            Weekly head-to-head Match Centre across the league scoring categories.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {data?.availableRounds?.length ? (
            <label className="flex items-center gap-2 text-sm text-[color:var(--league-text-muted)]">
              Round
              <select
                value={data.round}
                onChange={(event) => setSelectedRound(Number(event.target.value))}
                className="rounded-md border border-[color:var(--league-border)] bg-[color:var(--league-surface)] px-3 py-2 text-sm font-medium text-[color:var(--league-text)]"
              >
                {data.availableRounds.map((round) => (
                  <option key={round} value={round}>
                    Round {round}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      </div>

      {message && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {message}
        </div>
      )}
      {status === 'error' && !data ? null : data?.matchups.length ? (
        <div className="grid min-w-0 gap-3">
          {data.matchups.map((matchup, index) => (
            <article
              key={matchup.id ?? `matchup-${index}`}
              className="min-w-0 rounded-lg border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-4"
            >
              {matchup.byeMember ? (
                <div className="text-sm font-medium text-[color:var(--league-text)]">
                  {matchup.byeMember.teamName ?? 'Team'} has a bye
                </div>
              ) : (
                <div className="space-y-4">
                  <MatchupHeadToHeadCard matchup={matchup} />
                  <CategoryTotalsGrid matchup={matchup} />
                  <TeamBoxScores matchup={matchup} />
                </div>
              )}
            </article>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-4 text-sm text-[color:var(--league-text-muted)]">
          No weekly matchups are available yet. They appear once the league has at least two teams
          and the commissioner has set up the fixture.
        </div>
      )}
    </section>
  );
}

function matchupStatusLabel(matchup: MatchupModel): string {
  if (matchup.status === 'LIVE') return 'Live';
  if (matchup.status === 'FINAL') return 'Final';
  const startsAt = formatDateTime(matchup.startsAt);
  return startsAt ? `Starts ${startsAt}` : 'Not started';
}

function matchupResultLine(matchup: MatchupModel): string {
  const home = matchup.homeCategoryWins ?? 0;
  const away = matchup.awayCategoryWins ?? 0;
  const homeName = matchup.homeMember?.teamName ?? 'Home';
  const awayName = matchup.awayMember?.teamName ?? 'Away';
  const drawn = matchup.drawnCategories ? `, ${matchup.drawnCategories} drawn` : '';
  if (matchup.status === 'SCHEDULED' || !matchup.status) return 'Not started';
  if (home === away) {
    return matchup.status === 'FINAL'
      ? `Drawn ${home}–${away}${drawn}`
      : `Level ${home}–${away}${drawn}`;
  }
  const leader = home > away ? homeName : awayName;
  const margin = Math.abs(home - away);
  return matchup.status === 'FINAL'
    ? `${leader} won ${Math.max(home, away)}–${Math.min(home, away)}${drawn}`
    : `${leader} lead by ${margin} ${margin === 1 ? 'category' : 'categories'}${drawn}`;
}

/** Same score line as the league overview: teams either side, categories won, one result line. */
function MatchupHeadToHeadCard({ matchup }: { matchup: MatchupModel }) {
  return (
    <div className="border-b border-[color:var(--league-border)] pb-4">
      <p className="mb-3 flex items-center gap-2 text-xs text-[color:var(--league-text-muted)]">
        {matchup.status === 'LIVE' ? (
          <span aria-hidden="true" className="size-2 rounded-full bg-result-loss" />
        ) : null}
        <span
          className={matchup.status === 'LIVE' ? 'font-bold text-result-loss' : 'font-semibold'}
        >
          {matchupStatusLabel(matchup)}
        </span>
      </p>
      <MatchupScoreLine
        you={{
          teamName: matchup.homeMember?.teamName ?? 'Home',
          logoUrl: matchup.homeMember?.teamLogoUrl ?? null,
        }}
        opponent={{
          teamName: matchup.awayMember?.teamName ?? 'Away',
          logoUrl: matchup.awayMember?.teamLogoUrl ?? null,
        }}
        yourWins={matchup.homeCategoryWins ?? 0}
        opponentWins={matchup.awayCategoryWins ?? 0}
        resultLine={matchupResultLine(matchup)}
      />
    </div>
  );
}

function CategoryTotalsGrid({ matchup }: { matchup: MatchupModel }) {
  const categoryRows = matchup.categoryRows ?? [];
  const hasStarted = matchup.status === 'LIVE' || matchup.status === 'FINAL';

  return (
    <div className="relative overflow-x-auto rounded-md border border-[color:var(--league-border)]">
      <table className="min-w-full table-fixed border-collapse text-sm">
        <caption className="sr-only">Match-up totals by scoring category.</caption>
        <thead className="bg-[color:var(--league-surface-muted)] text-xs font-medium text-[color:var(--league-text-muted)]">
          <tr>
            <th scope="col" className="w-64 px-3 py-2 text-left">
              Team
            </th>
            {categoryRows.map((row) => (
              <th key={row.category} scope="col" className="px-3 py-2 text-center">
                <abbr title={row.label} className="no-underline">
                  {row.shortLabel}
                </abbr>
              </th>
            ))}
            <th scope="col" className="w-20 px-3 py-2 text-center">
              Score
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[color:var(--league-border)]">
          <CategoryTotalsRow
            team={matchup.homeMember}
            side="home"
            categoryRows={categoryRows}
            score={matchup.homeCategoryWins ?? 0}
            started={hasStarted}
          />
          <CategoryTotalsRow
            team={matchup.awayMember}
            side="away"
            categoryRows={categoryRows}
            score={matchup.awayCategoryWins ?? 0}
            started={hasStarted}
          />
        </tbody>
      </table>
    </div>
  );
}

function CategoryTotalsRow({
  team,
  side,
  categoryRows,
  score,
  started,
}: {
  team?: MatchupTeamSummary | null;
  side: 'home' | 'away';
  categoryRows: MatchupCategoryRow[];
  score: number;
  started: boolean;
}) {
  return (
    <tr className="bg-[color:var(--league-surface)]">
      <th scope="row" className="px-3 py-3 text-left font-semibold text-[color:var(--league-text)]">
        {team?.teamName ?? (side === 'home' ? 'Home' : 'Away')}
      </th>
      {categoryRows.map((row) => {
        const isWinner = row.winner === side;
        const isDraw = row.winner === 'draw';
        const result: CategoryResult = isWinner ? 'won' : isDraw ? 'drawn' : 'lost';
        return (
          <td
            key={row.category}
            className={`px-3 py-3 text-center tabular-nums ${
              isWinner
                ? 'font-bold text-[color:var(--league-text)]'
                : isDraw
                  ? 'font-semibold text-[color:var(--league-text)]'
                  : 'text-[color:var(--league-text-muted)]'
            }`}
          >
            <span className="inline-flex items-center justify-center gap-1.5">
              {formatStatValue(side === 'home' ? row.homeValue : row.awayValue)}
              {started ? (
                <ResultChip
                  result={result}
                  srLabel={`${row.label} ${result}`}
                  className="size-5 shrink-0"
                />
              ) : null}
            </span>
          </td>
        );
      })}
      <td className="border-l border-[color:var(--league-border)] px-3 py-3 text-center font-display text-xl font-bold tabular-nums text-[color:var(--league-text)]">
        {score}
      </td>
    </tr>
  );
}

function TeamBoxScores({ matchup }: { matchup: MatchupModel }) {
  const homePlayers = matchup.homeMember?.players ?? [];
  const awayPlayers = matchup.awayMember?.players ?? [];

  if (!homePlayers.length && !awayPlayers.length) {
    return (
      <div className="rounded-md border border-[color:var(--league-border)] bg-[color:var(--league-surface)] px-4 py-5 text-sm text-[color:var(--league-text-muted)]">
        <div className="font-semibold text-[color:var(--league-text)]">Set your lineup</div>
        <p className="mt-1">
          No players are set for this matchup yet. Open the My Team tab to pick your lineup.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display text-lg font-bold text-[color:var(--league-text)]">
          Player stats · Round {matchup.round ?? ''}
        </h3>
        <p className="text-xs text-[color:var(--league-text-muted)]">
          On-field and interchange players · – means no stats yet
        </p>
      </div>
      <TeamBoxScoreTable matchup={matchup} side="home" />
      <TeamBoxScoreTable matchup={matchup} side="away" />
    </div>
  );
}

function TeamBoxScoreTable({ matchup, side }: { matchup: MatchupModel; side: 'home' | 'away' }) {
  const team = side === 'home' ? matchup.homeMember : matchup.awayMember;
  const players = team?.players ?? [];
  const categoryHeaders = matchup.categoryRows ?? [];
  const teamName = team?.teamName ?? (side === 'home' ? 'Home' : 'Away');

  return (
    <div className="overflow-hidden rounded-md border border-[color:var(--league-border)] bg-[color:var(--league-surface)]">
      <div className="relative overflow-x-auto">
        <table
          className="w-full min-w-[720px] border-collapse text-left text-sm"
          aria-label={`${teamName} box score`}
        >
          <caption className="border-b border-[color:var(--league-border)] px-4 py-2.5 text-left font-display text-base font-bold text-[color:var(--league-text)]">
            {teamName}
          </caption>
          <thead className="bg-[color:var(--league-surface-muted)] text-xs font-medium text-[color:var(--league-text-muted)]">
            <tr>
              <th scope="col" className="w-16 px-4 py-2 text-left">
                Slot
              </th>
              <th scope="col" className="px-2 py-2 text-left">
                Player
              </th>
              {categoryHeaders.map((row) => (
                <th
                  key={row.category}
                  scope="col"
                  title={row.label}
                  className="w-14 px-2 py-2 text-right"
                >
                  {row.shortLabel}
                </th>
              ))}
              <th scope="col" className="w-4" aria-hidden="true" />
            </tr>
          </thead>
          <tbody className="divide-y divide-[color:var(--league-border)]">
            {players.length ? (
              players.map((player) => (
                <tr key={`${player.slot}-${player.slotIndex}-${player.playerId}`}>
                  <td className="px-4 py-2">
                    <BoxScoreSlot slot={player.slot} />
                  </td>
                  <th scope="row" className="px-2 py-2 text-left font-normal">
                    <span className="font-semibold text-[color:var(--league-text)]">
                      {player.name}
                    </span>
                    <span className="ml-2 text-xs text-[color:var(--league-text-muted)]">
                      {player.position}
                    </span>
                  </th>
                  {categoryHeaders.map((category) => (
                    <PlayerCategoryCell
                      key={category.category}
                      player={player}
                      category={category}
                    />
                  ))}
                  <td aria-hidden="true" />
                </tr>
              ))
            ) : (
              <tr>
                <td
                  colSpan={categoryHeaders.length + 3}
                  className="px-4 py-4 text-sm text-[color:var(--league-text-muted)]"
                >
                  No lineup set for this round.
                </td>
              </tr>
            )}
          </tbody>
          {players.length ? (
            <tfoot className="border-t-2 border-[color:var(--league-border)] bg-[color:var(--league-surface-muted)] text-[color:var(--league-text)]">
              <tr>
                <th scope="row" colSpan={2} className="px-4 py-2 text-left text-xs font-semibold">
                  Team total
                </th>
                {categoryHeaders.map((row) => {
                  const won = row.winner === side;
                  return (
                    <td
                      key={row.category}
                      className={`px-2 py-2 text-right tabular-nums ${won ? 'font-bold' : 'font-medium text-[color:var(--league-text-muted)]'}`}
                    >
                      {formatStatValue(side === 'home' ? row.homeValue : row.awayValue)}
                    </td>
                  );
                })}
                <td aria-hidden="true" />
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </div>
  );
}

function BoxScoreSlot({ slot }: { slot: string }) {
  const label = BOX_SCORE_SLOT_LABELS[slot] ?? slot;
  const isInterchange = slot === 'INTERCHANGE';
  return (
    <span
      className={`inline-flex h-6 w-11 items-center justify-center rounded-sm text-[11px] font-bold ${
        isInterchange
          ? 'border border-[color:var(--league-border)] text-[color:var(--league-text)]'
          : 'bg-[color:var(--league-primary)] text-white'
      }`}
    >
      {label}
    </span>
  );
}

function PlayerCategoryCell({
  player,
  category,
}: {
  player?: MatchupPlayerContribution;
  category: MatchupCategoryRow;
}) {
  const value = player?.categories.find((row) => row.category === category.category)?.value;
  const hasValue = value !== undefined && player?.hasStats !== false;

  return (
    <td
      className={`px-2 py-2 text-right tabular-nums ${hasValue ? 'font-medium text-[color:var(--league-text)]' : 'text-[color:var(--league-text-muted)]'}`}
    >
      {hasValue ? formatStatValue(value) : '–'}
    </td>
  );
}
