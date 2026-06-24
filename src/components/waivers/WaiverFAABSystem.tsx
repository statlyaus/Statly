'use client';

import React, { useMemo, useState } from 'react';
import Image from 'next/image';
import {
  CheckCircleIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline';

import { formatInTimezone, getBrowserTimeZone } from '@/lib/timezone';
import { getTeamAbbreviation, getTeamLogo } from '@/lib/teamLogos';
import {
  FANTASY_CATEGORIES,
  REAL_DATA_NINE_CATEGORY_PRESET,
  type FantasyCategoryKey,
  type PlayerStats,
} from '@/types/fantasyCategories';
import { type LeagueActivityItem } from '@/services/leagueDataService';

type WaiverClaimStatus = 'pending' | 'successful' | 'failed' | 'outbid';

interface WaiverClaim {
  id: string;
  playerId: string;
  playerName: string;
  playerPosition: string;
  playerTeam: string;
  action: 'add' | 'drop' | 'trade';
  dropPlayerId?: string;
  dropPlayerName?: string;
  bidAmount?: number;
  priority: number;
  status: WaiverClaimStatus;
  submittedAt: Date;
  processedAt?: Date;
  userId: string;
  userName: string;
}

interface PlayerOption {
  id: string;
  name: string;
  team?: string;
  club?: string;
  position?: string;
  ownership?: number;
  avgPoints?: number;
  averagePoints?: number;
  fantasyPoints?: number;
  gamesPlayed?: number;
  stats?: Partial<PlayerStats>;
  statsTotal?: Partial<PlayerStats>;
  statlyZScore?: number;
  statlyZBreakdown?: Array<{ category: FantasyCategoryKey; value: number; zScore: number }>;
  statlyZMissingCategories?: FantasyCategoryKey[];
}

type ActivityFeedItem = LeagueActivityItem & {
  playerName?: string;
  dropPlayerName?: string;
  teamName?: string;
};

interface WaiverFAABSystemProps {
  currentBalance?: number;
  pendingBids?: number;
  totalBudget?: number;
  userTeamName?: string;
  minimumBid?: number;
  userClaims?: WaiverClaim[];
  availablePlayers?: PlayerOption[];
  rosterDropOptions?: PlayerOption[];
  selectedCategories?: FantasyCategoryKey[];
  onSubmitClaim?: (claim: Partial<WaiverClaim>) => void;
  onCancelClaim?: (id: string) => void;
  activityItems?: ActivityFeedItem[];
  onLoadMorePlayers?: () => void;
  loadingMorePlayers?: boolean;
  hasMorePlayers?: boolean;
}

type WaiverSortKey = 'statlyZ' | 'name' | 'position' | 'club';

const PLAYER_COLUMN_WIDTH = 340;
const PROFILE_COLUMN_WIDTH = 180;
const STAT_COLUMN_WIDTH = 88;
const ACTIONS_COLUMN_WIDTH = 280;

function normalizeCategories(selectedCategories: readonly FantasyCategoryKey[]): FantasyCategoryKey[] {
  const seen = new Set<FantasyCategoryKey>();
  const normalized = selectedCategories.filter((category) => {
    if (!FANTASY_CATEGORIES[category] || seen.has(category)) return false;
    seen.add(category);
    return true;
  });

  return normalized.length > 0 ? normalized : [...REAL_DATA_NINE_CATEGORY_PRESET];
}

function readPlayerTeam(player: PlayerOption): string {
  return player.team || player.club || '';
}

function readStatlyZ(player: PlayerOption): number | null {
  return typeof player.statlyZScore === 'number' && Number.isFinite(player.statlyZScore)
    ? player.statlyZScore
    : null;
}

function readCategoryAverage(player: PlayerOption, category: FantasyCategoryKey): number | null {
  const value = player.stats?.[category];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function formatCategoryAverage(value: number | null, category: FantasyCategoryKey): string {
  if (value === null) return '-';

  const categoryData = FANTASY_CATEGORIES[category];
  if (categoryData.format === 'percentage') return `${value.toFixed(1)}%`;
  if (categoryData.format === 'decimal') return value.toFixed(2);
  return value.toFixed(1);
}

function claimStatusLabel(status: WaiverClaimStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function ClaimStatusIcon({ status }: { status: WaiverClaimStatus }): React.JSX.Element {
  if (status === 'successful') {
    return <CheckCircleIcon className="h-5 w-5 text-[color:var(--league-success)]" aria-hidden="true" />;
  }
  if (status === 'failed') {
    return <XCircleIcon className="h-5 w-5 text-[color:var(--league-danger)]" aria-hidden="true" />;
  }
  if (status === 'outbid') {
    return <ExclamationTriangleIcon className="h-5 w-5 text-muted-foreground" aria-hidden="true" />;
  }
  return <ClockIcon className="h-5 w-5 text-muted-foreground" aria-hidden="true" />;
}

function getClaimStatusClass(status: WaiverClaimStatus): string {
  if (status === 'successful') {
    return 'border-[color:var(--league-success)]/30 bg-[color:var(--league-success-soft)] text-[color:var(--league-success)]';
  }
  if (status === 'failed') {
    return 'border-[color:var(--league-danger)]/30 bg-[color:var(--league-danger-soft)] text-[color:var(--league-danger)]';
  }
  return 'border-border bg-muted text-muted-foreground';
}

function getSortValue(player: PlayerOption, sortBy: WaiverSortKey): string | number {
  if (sortBy === 'statlyZ') return readStatlyZ(player) ?? -Infinity;
  if (sortBy === 'position') return player.position || 'ZZZ';
  if (sortBy === 'club') return readPlayerTeam(player) || 'ZZZ';
  return player.name.toLowerCase();
}

function WaiverOverview(): React.JSX.Element {
  return (
    <section className="rounded-lg border border-border bg-card p-4 text-card-foreground">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))]">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Waivers Overview</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Players who are not on a league roster are available through the waiver wire. Add
            from this free-agent table, and drop a rostered player when your roster would exceed
            the league maximum.
          </p>
        </div>
        <div className="rounded-md border border-border bg-background p-3">
          <h2 className="text-sm font-semibold text-foreground">Standard Waivers</h2>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            Unsigned players go on waivers after the draft, weekly play, or roster drops. Claims
            process by waiver order, then unclaimed players become free agents.
          </p>
        </div>
        <div className="rounded-md border border-border bg-background p-3">
          <h2 className="text-sm font-semibold text-foreground">Salary Cap Continuous</h2>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            Teams bid from a budget. Claims process in batches; the highest offer wins, with
            waiver priority used as the tiebreaker.
          </p>
        </div>
        <div className="rounded-md border border-border bg-background p-3">
          <h2 className="text-sm font-semibold text-foreground">No Waivers</h2>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            Free agents are immediately available. Most leagues use waivers so every manager has
            a fair claim window.
          </p>
        </div>
      </div>
    </section>
  );
}

function WaiverToolbar({
  searchTerm,
  positionFilter,
  sortBy,
  availablePositions,
  filteredCount,
  totalCount,
  onSearchChange,
  onPositionFilterChange,
  onSortChange,
}: {
  searchTerm: string;
  positionFilter: string;
  sortBy: WaiverSortKey;
  availablePositions: string[];
  filteredCount: number;
  totalCount: number;
  onSearchChange: (value: string) => void;
  onPositionFilterChange: (value: string) => void;
  onSortChange: (value: WaiverSortKey) => void;
}): React.JSX.Element {
  return (
    <div className="border-b border-border bg-muted/50 px-4 py-4 sm:px-5">
      <div className="flex flex-col gap-4 xl:flex-row">
        <div className="flex-1">
          <label htmlFor="waiver-player-search" className="sr-only">
            Search waiver players
          </label>
          <input
            id="waiver-player-search"
            type="search"
            value={searchTerm}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search players by name, position, or club..."
            className="block w-full rounded-md border border-input bg-background px-3 py-2.5 text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        <div className="xl:w-48">
          <label htmlFor="waiver-position-filter" className="sr-only">
            Filter waiver players by position
          </label>
          <select
            id="waiver-position-filter"
            value={positionFilter}
            onChange={(event) => onPositionFilterChange(event.target.value)}
            className="block w-full rounded-md border border-input bg-background px-3 py-2.5 text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {availablePositions.map((position) => (
              <option key={position} value={position}>
                {position === 'ALL' ? 'All Positions' : position}
              </option>
            ))}
          </select>
        </div>

        <div className="xl:w-48">
          <label htmlFor="waiver-sort-by" className="sr-only">
            Sort waiver players
          </label>
          <select
            id="waiver-sort-by"
            value={sortBy}
            onChange={(event) => onSortChange(event.target.value as WaiverSortKey)}
            className="block w-full rounded-md border border-input bg-background px-3 py-2.5 text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="statlyZ">Sort by Statly Z</option>
            <option value="name">Sort by Name</option>
            <option value="position">Sort by Position</option>
            <option value="club">Sort by Club</option>
          </select>
        </div>
      </div>

      <div className="mt-3 text-sm text-muted-foreground">
        Showing {filteredCount} of {totalCount} free agents
      </div>
    </div>
  );
}

function WaiverPlayerTable({
  players,
  visibleCategories,
  selectedPlayerId,
  bidAmount,
  dropPlayerId,
  minimumBid,
  rosterDropOptions,
  onSelectPlayer,
  onBidChange,
  onDropChange,
  onSubmitClaim,
}: {
  players: PlayerOption[];
  visibleCategories: FantasyCategoryKey[];
  selectedPlayerId: string | null;
  bidAmount: number;
  dropPlayerId: string;
  minimumBid: number;
  rosterDropOptions: PlayerOption[];
  onSelectPlayer: (playerId: string | null) => void;
  onBidChange: (value: number) => void;
  onDropChange: (value: string) => void;
  onSubmitClaim?: (player: PlayerOption) => void;
}): React.JSX.Element {
  const statColumnCount = Math.max(visibleCategories.length, 1);
  const tableMinWidth =
    PLAYER_COLUMN_WIDTH +
    PROFILE_COLUMN_WIDTH +
    statColumnCount * STAT_COLUMN_WIDTH +
    ACTIONS_COLUMN_WIDTH;

  return (
    <div className="relative min-h-0">
      <div className="max-h-[680px] overflow-auto">
        <table
          className="w-full table-fixed border-collapse text-left"
          style={{ minWidth: tableMinWidth }}
          aria-label="Available waiver players"
        >
          <caption className="sr-only">
            Available waiver players with profile, league stats, and waiver claim actions.
          </caption>
          <colgroup>
            <col style={{ width: PLAYER_COLUMN_WIDTH }} />
            <col style={{ width: PROFILE_COLUMN_WIDTH }} />
            {visibleCategories.length > 0 ? (
              visibleCategories.map((category) => (
                <col key={category} style={{ width: STAT_COLUMN_WIDTH }} />
              ))
            ) : (
              <col style={{ width: STAT_COLUMN_WIDTH }} />
            )}
            <col style={{ width: ACTIONS_COLUMN_WIDTH }} />
          </colgroup>
          <thead className="sticky top-0 z-10 border-b border-border bg-muted/95 text-sm font-medium text-muted-foreground backdrop-blur">
            <tr>
              <th
                scope="col"
                rowSpan={visibleCategories.length > 0 ? 2 : 1}
                className="px-4 py-3 font-medium sm:px-5"
              >
                Player
              </th>
              <th
                scope="col"
                rowSpan={visibleCategories.length > 0 ? 2 : 1}
                className="px-4 py-3 font-medium"
              >
                Profile
              </th>
              <th
                scope={visibleCategories.length > 0 ? 'colgroup' : 'col'}
                colSpan={visibleCategories.length > 0 ? visibleCategories.length : 1}
                className="border-x border-border/70 px-4 py-3 text-center font-medium"
              >
                League Stats
              </th>
              <th
                scope="col"
                rowSpan={visibleCategories.length > 0 ? 2 : 1}
                className="px-4 py-3 text-center font-medium sm:px-5"
              >
                Actions
              </th>
            </tr>
            {visibleCategories.length > 0 && (
              <tr className="border-t border-border/70">
                {visibleCategories.map((category) => {
                  const categoryData = FANTASY_CATEGORIES[category];

                  return (
                    <th
                      key={category}
                      scope="col"
                      aria-label={categoryData.label}
                      className="border-l border-border/70 px-3 py-2 text-center text-[11px] font-semibold uppercase text-muted-foreground first:border-l"
                      title={categoryData.label}
                    >
                      {categoryData.abbrev}
                    </th>
                  );
                })}
              </tr>
            )}
          </thead>
          <tbody className="divide-y divide-border">
            {players.map((player) => {
              const team = readPlayerTeam(player);
              const teamLogo = getTeamLogo(team);
              const teamAbbreviation = getTeamAbbreviation(team);
              const isSelected = selectedPlayerId === player.id;
              const statlyZ = readStatlyZ(player);

              return (
                <tr
                  key={player.id}
                  className={`transition-colors hover:bg-muted/50 ${
                    isSelected ? 'bg-primary/5' : ''
                  }`}
                >
                  <th scope="row" className="px-4 py-4 font-normal sm:px-5">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-md border border-border bg-background p-1.5 shadow-sm">
                        <Image
                          src={teamLogo}
                          alt=""
                          aria-hidden="true"
                          width={32}
                          height={32}
                          unoptimized={teamLogo.endsWith('.svg')}
                          className="h-8 max-w-8 object-contain"
                          style={{ width: 'auto' }}
                        />
                      </span>
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-foreground">{player.name}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                          <span className="rounded-md border border-border bg-muted px-2 py-0.5 font-semibold text-foreground">
                            {player.position || 'UNK'}
                          </span>
                          <span className="rounded-md border border-border bg-background px-2 py-0.5 font-medium text-foreground">
                            {teamAbbreviation || '-'}
                          </span>
                          <span>{team || 'Club pending'}</span>
                        </div>
                      </div>
                    </div>
                  </th>
                  <td className="px-4 py-4 align-middle">
                    <div className="space-y-2">
                      <div>
                        <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                          Statly Z
                        </div>
                        <div className="mt-1 text-lg font-semibold leading-none text-foreground">
                          {statlyZ === null ? 'Pending' : statlyZ.toFixed(2)}
                        </div>
                      </div>
                      <span className="inline-flex rounded-md border border-border bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
                        On waivers
                      </span>
                    </div>
                  </td>
                  {visibleCategories.length > 0 ? (
                    visibleCategories.map((category) => (
                      <td
                        key={category}
                        className="border-l border-border/60 px-3 py-4 text-center align-middle text-sm font-semibold text-foreground"
                        aria-label={`${FANTASY_CATEGORIES[category].label}: ${formatCategoryAverage(
                          readCategoryAverage(player, category),
                          category
                        )}`}
                      >
                        <span className="inline-flex min-w-12 justify-center tabular-nums">
                          {formatCategoryAverage(readCategoryAverage(player, category), category)}
                        </span>
                      </td>
                    ))
                  ) : (
                    <td className="border-l border-border/60 px-4 py-4 align-middle text-sm text-muted-foreground">
                      League categories pending.
                    </td>
                  )}
                  <td className="border-l border-border/60 px-3 py-4 align-middle">
                    {isSelected ? (
                      <div className="space-y-3">
                        <div className="grid gap-2 sm:grid-cols-2">
                          <div>
                            <label
                              htmlFor={`waiver-bid-${player.id}`}
                              className="text-xs font-medium text-muted-foreground"
                            >
                              FAAB bid
                            </label>
                            <input
                              id={`waiver-bid-${player.id}`}
                              type="number"
                              min={minimumBid}
                              value={bidAmount}
                              onChange={(event) =>
                                onBidChange(Math.max(minimumBid, Number(event.target.value) || 0))
                              }
                              className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
                            />
                          </div>
                          <div>
                            <label
                              htmlFor={`waiver-drop-${player.id}`}
                              className="text-xs font-medium text-muted-foreground"
                            >
                              Drop player
                            </label>
                            <select
                              id={`waiver-drop-${player.id}`}
                              value={dropPlayerId}
                              onChange={(event) => onDropChange(event.target.value)}
                              className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
                            >
                              <option value="">None</option>
                              {rosterDropOptions.map((option) => (
                                <option key={option.id} value={option.id}>
                                  {option.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => onSubmitClaim?.(player)}
                            disabled={!onSubmitClaim || bidAmount < minimumBid}
                            aria-label={`Submit claim for ${player.name}`}
                            className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
                          >
                            Submit
                          </button>
                          <button
                            type="button"
                            onClick={() => onSelectPlayer(null)}
                            aria-label={`Cancel claim setup for ${player.name}`}
                            className="inline-flex h-9 items-center justify-center rounded-md border border-border bg-background px-3 text-sm font-medium text-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onSelectPlayer(player.id)}
                        className="inline-flex h-10 w-full items-center justify-center rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        aria-label={`Claim ${player.name}`}
                      >
                        Claim
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EmptyWaiverTable(): React.JSX.Element {
  return (
    <div className="flex min-h-80 flex-col items-center justify-center rounded-lg border border-border bg-card px-6 py-12 text-center text-card-foreground">
      <ClockIcon className="mb-3 h-10 w-10 text-muted-foreground" aria-hidden="true" />
      <h2 className="text-lg font-semibold text-foreground">No free agents available</h2>
      <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
        Every player is currently rostered or the waiver pool has not loaded yet.
      </p>
    </div>
  );
}

function MyClaimsPanel({
  claims,
  timeZone,
  onCancelClaim,
}: {
  claims: WaiverClaim[];
  timeZone: string;
  onCancelClaim?: (id: string) => void;
}): React.JSX.Element {
  return (
    <section className="rounded-lg border border-border bg-card p-4 text-card-foreground">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">My Claims</h2>
          <p className="mt-1 text-sm text-muted-foreground">Pending and processed waiver claims.</p>
        </div>
        <span className="rounded-md border border-border bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
          {claims.length}
        </span>
      </div>

      {claims.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">No active waiver claims.</p>
      ) : (
        <ul className="mt-4 divide-y divide-border">
          {claims.map((claim) => (
            <li key={claim.id} className="py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <ClaimStatusIcon status={claim.status} />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-foreground">
                      Add {claim.playerName}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {claim.playerPosition || 'Position pending'} -{' '}
                      {claim.playerTeam || 'Club pending'}
                      {claim.dropPlayerName ? ` - drop ${claim.dropPlayerName}` : ''}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      Submitted {formatInTimezone(claim.submittedAt, timeZone, 'PP p')}
                    </div>
                  </div>
                </div>
                <div className="flex flex-shrink-0 items-center gap-2">
                  <span
                    className={`rounded-md border px-2 py-1 text-xs font-medium ${getClaimStatusClass(
                      claim.status
                    )}`}
                  >
                    {claimStatusLabel(claim.status)}
                  </span>
                  {claim.status === 'pending' && onCancelClaim && (
                    <button
                      type="button"
                      onClick={() => onCancelClaim(claim.id)}
                      className="rounded-md border border-border bg-background px-2 py-1 text-xs font-medium text-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ActivityPanel({
  activityItems,
  timeZone,
}: {
  activityItems: ActivityFeedItem[];
  timeZone: string;
}): React.JSX.Element {
  return (
    <section className="rounded-lg border border-border bg-card p-4 text-card-foreground">
      <h2 className="text-base font-semibold text-foreground">League Activity</h2>
      <p className="mt-1 text-sm text-muted-foreground">Recent waiver submissions and outcomes.</p>

      {activityItems.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">No recent activity.</p>
      ) : (
        <ul className="mt-4 divide-y divide-border">
          {activityItems.slice(0, 8).map((item) => {
            const playerText = item.playerName || item.playerId || 'a player';
            const teamText = item.teamName || item.userId || 'Team';

            return (
              <li key={item.id} className="py-3 text-sm">
                <div className="font-medium text-foreground">
                  {teamText} updated {playerText}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {formatInTimezone(item.timestamp, timeZone, 'PP p')}
                  {typeof item.bidAmount === 'number' ? ` - $${item.bidAmount}` : ''}
                  {item.dropPlayerName ? ` - drop ${item.dropPlayerName}` : ''}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export default function WaiverFAABSystem({
  userClaims = [],
  availablePlayers = [],
  rosterDropOptions = [],
  selectedCategories = [...REAL_DATA_NINE_CATEGORY_PRESET],
  onSubmitClaim,
  onCancelClaim,
  activityItems = [],
  currentBalance,
  pendingBids = 0,
  totalBudget,
  userTeamName,
  minimumBid = 1,
  onLoadMorePlayers,
  loadingMorePlayers,
  hasMorePlayers,
}: WaiverFAABSystemProps): React.JSX.Element {
  const timeZone = useMemo(() => getBrowserTimeZone(), []);
  const [searchTerm, setSearchTerm] = useState('');
  const [positionFilter, setPositionFilter] = useState('ALL');
  const [sortBy, setSortBy] = useState<WaiverSortKey>('statlyZ');
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [dropPlayerId, setDropPlayerId] = useState('');
  const [bidAmount, setBidAmount] = useState(minimumBid);
  const visibleCategories = useMemo(
    () => normalizeCategories(selectedCategories),
    [selectedCategories]
  );
  const availablePositions = useMemo(() => {
    const positions = new Set(
      availablePlayers.map((player) => player.position).filter((position): position is string => Boolean(position))
    );
    return ['ALL', ...Array.from(positions).sort()];
  }, [availablePlayers]);
  const filteredPlayers = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    const filtered = availablePlayers.filter((player) => {
      const team = readPlayerTeam(player);
      const matchesSearch =
        normalizedSearch.length === 0 ||
        player.name.toLowerCase().includes(normalizedSearch) ||
        team.toLowerCase().includes(normalizedSearch) ||
        (player.position || '').toLowerCase().includes(normalizedSearch);
      const matchesPosition = positionFilter === 'ALL' || player.position === positionFilter;

      return matchesSearch && matchesPosition;
    });

    return filtered.sort((a, b) => {
      const aValue = getSortValue(a, sortBy);
      const bValue = getSortValue(b, sortBy);
      if (aValue < bValue) return sortBy === 'statlyZ' ? 1 : -1;
      if (aValue > bValue) return sortBy === 'statlyZ' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [availablePlayers, positionFilter, searchTerm, sortBy]);
  const selectedPlayer = useMemo(
    () => availablePlayers.find((player) => player.id === selectedPlayerId) ?? null,
    [availablePlayers, selectedPlayerId]
  );
  const balanceLabel =
    typeof currentBalance === 'number'
      ? `$${currentBalance}`
      : typeof totalBudget === 'number'
        ? `$${totalBudget}`
        : '-';

  const handleSelectPlayer = (playerId: string | null) => {
    setSelectedPlayerId(playerId);
    setDropPlayerId('');
    setBidAmount(minimumBid);
  };

  const handleSubmitClaim = (player: PlayerOption) => {
    onSubmitClaim?.({
      playerId: player.id,
      playerName: player.name,
      playerPosition: player.position || '',
      playerTeam: readPlayerTeam(player),
      action: 'add',
      dropPlayerId: dropPlayerId || undefined,
      dropPlayerName: rosterDropOptions.find((option) => option.id === dropPlayerId)?.name,
      bidAmount,
      priority: userClaims.length + 1,
      status: 'pending',
      submittedAt: new Date(),
      userId: '',
      userName: 'You',
    });
    handleSelectPlayer(null);
  };

  return (
    <div className="space-y-5">
      <WaiverOverview />

      <section className="rounded-lg border border-border bg-card text-card-foreground">
        <div className="flex flex-col gap-4 border-b border-border px-4 py-4 sm:px-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Waiver Wire</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {userTeamName ? `${userTeamName} can claim available free agents.` : 'Claim available free agents.'}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <div className="rounded-md border border-border bg-background px-3 py-2">
              <div className="text-xs font-medium text-muted-foreground">FAAB Remaining</div>
              <div className="mt-1 font-semibold text-foreground">{balanceLabel}</div>
            </div>
            <div className="rounded-md border border-border bg-background px-3 py-2">
              <div className="text-xs font-medium text-muted-foreground">Pending</div>
              <div className="mt-1 font-semibold text-foreground">${pendingBids}</div>
            </div>
            <div className="rounded-md border border-border bg-background px-3 py-2">
              <div className="text-xs font-medium text-muted-foreground">Pool</div>
              <div className="mt-1 font-semibold text-foreground">{availablePlayers.length}</div>
            </div>
          </div>
        </div>

        <WaiverToolbar
          searchTerm={searchTerm}
          positionFilter={positionFilter}
          sortBy={sortBy}
          availablePositions={availablePositions}
          filteredCount={filteredPlayers.length}
          totalCount={availablePlayers.length}
          onSearchChange={setSearchTerm}
          onPositionFilterChange={setPositionFilter}
          onSortChange={setSortBy}
        />

        {filteredPlayers.length === 0 ? (
          <div className="p-4">
            <EmptyWaiverTable />
          </div>
        ) : (
          <WaiverPlayerTable
            players={filteredPlayers}
            visibleCategories={visibleCategories}
            selectedPlayerId={selectedPlayer?.id ?? null}
            bidAmount={bidAmount}
            dropPlayerId={dropPlayerId}
            minimumBid={minimumBid}
            rosterDropOptions={rosterDropOptions}
            onSelectPlayer={handleSelectPlayer}
            onBidChange={setBidAmount}
            onDropChange={setDropPlayerId}
            onSubmitClaim={onSubmitClaim ? handleSubmitClaim : undefined}
          />
        )}

        {hasMorePlayers && (
          <div className="border-t border-border px-4 py-4 sm:px-5">
            <button
              type="button"
              onClick={onLoadMorePlayers}
              disabled={loadingMorePlayers}
              className="inline-flex h-10 items-center justify-center rounded-md border border-border bg-background px-4 text-sm font-medium text-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loadingMorePlayers ? 'Loading more...' : 'Load more free agents'}
            </button>
          </div>
        )}
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <MyClaimsPanel claims={userClaims} timeZone={timeZone} onCancelClaim={onCancelClaim} />
        <ActivityPanel activityItems={activityItems} timeZone={timeZone} />
      </div>
    </div>
  );
}
