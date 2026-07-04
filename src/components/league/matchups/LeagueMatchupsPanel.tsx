'use client';

import { useEffect, useState } from 'react';

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

const MATCH_CENTRE_PLAYER_COLUMN_WIDTH = 256;
const MATCH_CENTRE_SLOT_COLUMN_WIDTH = 84;
const MATCH_CENTRE_STAT_COLUMN_WIDTH = 70;

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

function scoreLine(matchup: MatchupModel): string {
  return `${matchup.homeCategoryWins ?? 0}-${matchup.awayCategoryWins ?? 0}${
    matchup.drawnCategories ? `-${matchup.drawnCategories}` : ''
  }`;
}

export function LeagueMatchupsPanel({ leagueId, currentUserId }: LeagueMatchupsPanelProps) {
  const [data, setData] = useState<MatchupReadModel | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const [selectedRound, setSelectedRound] = useState<number | null>(null);

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
    <section className="space-y-4" aria-labelledby="league-matchups-heading">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2
            id="league-matchups-heading"
            className="text-xl font-semibold text-[color:var(--league-text)]"
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
                    {round}
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
        <div className="grid gap-3">
          {data.matchups.map((matchup, index) => (
            <article
              key={matchup.id ?? `matchup-${index}`}
              className="rounded-lg border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-4"
            >
              {matchup.byeMember ? (
                <div className="text-sm font-medium text-[color:var(--league-text)]">
                  {matchup.byeMember.teamName ?? 'Team'} has a bye
                </div>
              ) : (
                <div className="space-y-4">
                  <MatchupHeadToHeadCard matchup={matchup} />
                  <CategoryTotalsGrid matchup={matchup} />
                  <MirroredPlayerMatchupTable matchup={matchup} />
                </div>
              )}
            </article>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-4 text-sm text-[color:var(--league-text-muted)]">
          No weekly matchups are available yet. Check the league has at least two teams and fixture
          generation is enabled in League Settings.
        </div>
      )}
    </section>
  );
}

function MatchupHeadToHeadCard({ matchup }: { matchup: MatchupModel }) {
  const startsAt = formatDateTime(matchup.startsAt);

  return (
    <div className="grid gap-4 border-b border-[color:var(--league-border)] pb-4 md:grid-cols-[1fr_auto_1fr] md:items-center">
      <MatchupTeamSummaryBlock team={matchup.homeMember} align="left" />
      <div className="text-center">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
          <div className="text-3xl font-semibold tabular-nums text-[color:var(--league-text)]">
            {matchup.homeCategoryWins ?? 0}
          </div>
          <div>
            <div className="text-xs font-medium text-[color:var(--league-text-muted)]">Points</div>
            <div className="mt-1 rounded-full border border-[color:var(--league-border)] bg-[color:var(--league-surface-muted)] px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-[color:var(--league-text-muted)]">
              {matchup.status ?? 'SCHEDULED'}
            </div>
          </div>
          <div className="text-3xl font-semibold tabular-nums text-[color:var(--league-text)]">
            {matchup.awayCategoryWins ?? 0}
          </div>
        </div>
        <div className="mt-2 text-sm text-[color:var(--league-text-muted)]">
          {scoreLine(matchup)}
          {startsAt ? ` | ${startsAt}` : ''}
        </div>
      </div>
      <MatchupTeamSummaryBlock team={matchup.awayMember} align="right" />
    </div>
  );
}

function MatchupTeamSummaryBlock({
  team,
  align,
}: {
  team?: MatchupTeamSummary | null;
  align: 'left' | 'right';
}) {
  return (
    <div className={align === 'right' ? 'text-left md:text-right' : 'text-left'}>
      <div className="text-lg font-semibold text-[color:var(--league-primary)]">
        {team?.teamName ?? (align === 'right' ? 'Away' : 'Home')}
      </div>
      <div className="mt-1 text-sm text-[color:var(--league-text-muted)]">
        {team?.categoryWins ?? 0}-{team?.categoryLosses ?? 0}
        {team?.categoryDraws ? `-${team.categoryDraws}` : ''} |{' '}
        {team?.matchupWin ? 'Leading' : team?.matchupDraw ? 'Drawn' : 'Chasing'}
      </div>
    </div>
  );
}

function CategoryTotalsGrid({ matchup }: { matchup: MatchupModel }) {
  const categoryRows = matchup.categoryRows ?? [];

  return (
    <div className="overflow-x-auto rounded-md border border-[color:var(--league-border)]">
      <table className="min-w-full table-fixed border-collapse text-sm">
        <caption className="sr-only">Match-up totals by scoring category.</caption>
        <thead className="bg-[color:var(--league-surface-muted)] text-xs font-medium text-[color:var(--league-text-muted)]">
          <tr>
            <th scope="col" className="w-64 px-3 py-2 text-left">
              Team
            </th>
            {categoryRows.map((row) => (
              <th key={row.category} scope="col" className="px-3 py-2 text-center">
                {row.shortLabel}
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
          />
          <CategoryTotalsRow
            team={matchup.awayMember}
            side="away"
            categoryRows={categoryRows}
            score={matchup.awayCategoryWins ?? 0}
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
}: {
  team?: MatchupTeamSummary | null;
  side: 'home' | 'away';
  categoryRows: MatchupCategoryRow[];
  score: number;
}) {
  return (
    <tr className="bg-[color:var(--league-surface)]">
      <th
        scope="row"
        className="px-3 py-3 text-left font-medium text-[color:var(--league-primary)]"
      >
        {team?.teamName ?? (side === 'home' ? 'Home' : 'Away')}
      </th>
      {categoryRows.map((row) => {
        const isWinner = row.winner === side;
        const isDraw = row.winner === 'draw';
        return (
          <td
            key={row.category}
            className={`border-l border-[color:var(--league-border)] px-3 py-3 text-center font-semibold tabular-nums ${
              isWinner
                ? 'bg-[color:var(--league-success-soft)] text-[color:var(--league-success)]'
                : isDraw
                  ? 'bg-[color:var(--league-surface-muted)] text-[color:var(--league-text)]'
                  : 'text-[color:var(--league-text-muted)]'
            }`}
          >
            {formatStatValue(side === 'home' ? row.homeValue : row.awayValue)}
          </td>
        );
      })}
      <td className="border-l border-[color:var(--league-border)] bg-[color:var(--league-surface-muted)] px-3 py-3 text-center text-lg font-semibold tabular-nums text-[color:var(--league-text)]">
        {score}
      </td>
    </tr>
  );
}

function MirroredPlayerMatchupTable({ matchup }: { matchup: MatchupModel }) {
  const homePlayers = matchup.homeMember?.players ?? [];
  const awayPlayers = matchup.awayMember?.players ?? [];
  const categoryHeaders = matchup.categoryRows ?? [];
  const rows = Math.max(homePlayers.length, awayPlayers.length);
  const tableMinWidth =
    MATCH_CENTRE_PLAYER_COLUMN_WIDTH * 2 +
    MATCH_CENTRE_SLOT_COLUMN_WIDTH +
    MATCH_CENTRE_STAT_COLUMN_WIDTH * categoryHeaders.length * 2;

  if (!rows) {
    return (
      <div className="rounded-md border border-[color:var(--league-border)] bg-[color:var(--league-surface)] px-4 py-5 text-sm text-[color:var(--league-text-muted)]">
        <div className="font-semibold text-[color:var(--league-text)]">Set your lineup</div>
        <p className="mt-1">
          No active lineup players are set for this matchup yet. Open the My Lineup tab to place
          roster players onto the field, then save to populate the Match Centre contribution table.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border border-[color:var(--league-border)] bg-[color:var(--league-surface)]">
      <div className="border-b border-[color:var(--league-border)] px-4 py-3 text-center text-sm font-semibold text-[color:var(--league-text)]">
        Today&apos;s Stats
      </div>
      <div className="overflow-x-auto">
        <table
          className="w-full table-fixed border-collapse text-left text-sm"
          style={{ minWidth: tableMinWidth }}
          aria-label="Mirrored player contribution table"
        >
          <caption className="sr-only">
            Active lineup player contributions for both matchup teams.
          </caption>
          <colgroup>
            <col style={{ width: MATCH_CENTRE_PLAYER_COLUMN_WIDTH }} />
            {categoryHeaders.map((row) => (
              <col key={`home-${row.category}`} style={{ width: MATCH_CENTRE_STAT_COLUMN_WIDTH }} />
            ))}
            <col style={{ width: MATCH_CENTRE_SLOT_COLUMN_WIDTH }} />
            <col style={{ width: MATCH_CENTRE_PLAYER_COLUMN_WIDTH }} />
            {categoryHeaders.map((row) => (
              <col key={`away-${row.category}`} style={{ width: MATCH_CENTRE_STAT_COLUMN_WIDTH }} />
            ))}
          </colgroup>
          <thead className="sticky top-0 z-10 bg-[color:var(--league-surface-muted)] text-xs font-medium text-[color:var(--league-text-muted)]">
            <tr>
              <th scope="col" className="px-3 py-2 text-left">
                Player
              </th>
              {categoryHeaders.map((row) => (
                <th key={`home-head-${row.category}`} scope="col" className="px-2 py-2 text-center">
                  {row.shortLabel}
                </th>
              ))}
              <th scope="col" className="px-2 py-2 text-center">
                Pos
              </th>
              <th scope="col" className="px-3 py-2 text-left">
                Player
              </th>
              {categoryHeaders.map((row) => (
                <th key={`away-head-${row.category}`} scope="col" className="px-2 py-2 text-center">
                  {row.shortLabel}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[color:var(--league-border)]">
            {Array.from({ length: rows }, (_, index) => {
              const homePlayer = homePlayers[index];
              const awayPlayer = awayPlayers[index];
              return (
                <tr
                  key={`${homePlayer?.playerId ?? 'home-empty'}-${awayPlayer?.playerId ?? 'away-empty'}-${index}`}
                >
                  <PlayerIdentityCell player={homePlayer} />
                  {categoryHeaders.map((category) => (
                    <PlayerCategoryCell
                      key={`home-${category.category}`}
                      player={homePlayer}
                      category={category}
                    />
                  ))}
                  <td className="bg-[color:var(--league-surface-muted)] px-2 py-3 text-center text-xs font-semibold text-[color:var(--league-text-muted)]">
                    {homePlayer?.slot ?? awayPlayer?.slot ?? '-'}
                  </td>
                  <PlayerIdentityCell player={awayPlayer} />
                  {categoryHeaders.map((category) => (
                    <PlayerCategoryCell
                      key={`away-${category.category}`}
                      player={awayPlayer}
                      category={category}
                    />
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PlayerIdentityCell({ player }: { player?: MatchupPlayerContribution }) {
  if (!player) {
    return <td className="px-3 py-3 text-[color:var(--league-text-muted)]">-</td>;
  }

  return (
    <th scope="row" className="px-3 py-3 text-left font-normal">
      <div className="font-semibold text-[color:var(--league-primary)]">{player.name}</div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-[color:var(--league-text-muted)]">
        <span className="rounded-sm border border-[color:var(--league-border)] bg-[color:var(--league-surface-muted)] px-1.5 py-0.5 font-semibold text-[color:var(--league-text)]">
          {player.position}
        </span>
        <span>
          {player.slot}
          {player.slotIndex + 1}
        </span>
      </div>
    </th>
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

  return (
    <td className="border-l border-[color:var(--league-border)] px-2 py-3 text-center font-medium tabular-nums text-[color:var(--league-text)]">
      {value === undefined ? '-' : formatStatValue(value)}
    </td>
  );
}
