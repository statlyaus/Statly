import 'server-only';

import type { PrismaClient } from '@prisma/client';

import { prisma as defaultPrisma } from '@/lib/prisma';
import { parseLineupSlotsJson, totalActiveLineupSlots } from '@/server/leagues/lineupSettings';
import { parseStoredCategoryRows } from '@/server/leagues/matchupReadModel';
import { isActivePrismaMembership } from '@/server/leagues/membership';
import {
  getAuthorizedLeagueSeasonState,
  type LeagueSeasonState,
  type LeagueSeasonStateRound,
} from '@/server/leagues/seasonState';
import { buildLeagueStandings } from '@/server/leagues/standingsReadModel';
import {
  FANTASY_CATEGORIES,
  normalizeFantasyCategoryKeys,
  REAL_DATA_NINE_CATEGORY_PRESET,
  type FantasyCategoryKey,
} from '@/types/fantasyCategories';

type ManagerHomeClient = Pick<
  PrismaClient,
  | 'leagueMember'
  | 'leagueTradeOffer'
  | 'teamAction'
  | 'league'
  | 'leagueCompetitionRound'
  | 'leagueStanding'
  | 'leagueMatchup'
  | 'leagueLineup'
  | 'leagueMatchupScore'
>;

export type ManagerHomeLeagueStatus =
  | { kind: 'draft_live'; draftId: string; currentPick: number; totalPicks: number }
  | { kind: 'draft_paused'; draftId: string }
  | { kind: 'draft_scheduled'; draftId: string | null; startsAt: string | null }
  | { kind: 'round_live'; roundLabel: string; endsAt: string | null }
  | { kind: 'round_upcoming'; roundLabel: string; startsAt: string | null }
  | { kind: 'season_complete' }
  | { kind: 'season_setup' };

export interface ManagerHomeTeam {
  teamName: string;
  logoUrl: string | null;
}

export type CategoryResult = 'won' | 'lost' | 'drawn' | 'pending';

export interface ManagerHomeMatchup {
  roundLabel: string;
  status: 'live' | 'final' | 'scheduled';
  endsAt: string | null;
  startsAt: string | null;
  yourCategoryWins: number;
  opponentCategoryWins: number;
  opponent: ManagerHomeTeam | null;
  categories: Array<{
    key: FantasyCategoryKey;
    label: string;
    shortLabel: string;
    result: CategoryResult;
    /** Null until the round has started. */
    yourValue: number | null;
    opponentValue: number | null;
  }>;
}

export type FormResult = 'W' | 'L' | 'D';

export interface ManagerHomeLadderRow {
  position: number;
  teamName: string;
  logoUrl: string | null;
  wins: number;
  losses: number;
  draws: number;
  categoryWins: number;
  categoryLosses: number;
  isYou: boolean;
}

export interface ManagerHomeLeague {
  leagueId: string;
  leagueName: string;
  teamName: string;
  logoUrl: string | null;
  role: 'commissioner' | 'manager';
  memberCount: number;
  maxTeams: number;
  timeZone: string;
  seasonLabel: string | null;
  status: ManagerHomeLeagueStatus;
  record: { wins: number; losses: number; draws: number; rank: number; teams: number } | null;
  matchup: ManagerHomeMatchup | null;
  lineup: { roundLabel: string; filled: number; required: number; locksAt: string | null } | null;
  /** Most recent first, finalised matchups only. */
  form: FormResult[];
  /** Top four plus your row when you are outside it. */
  ladder: ManagerHomeLadderRow[] | null;
  tradeOffersAwaitingYou: { count: number; earliestExpiresAt: string | null };
  pendingWaiverClaims: number;
}

export interface ManagerHome {
  generatedAt: string;
  leagues: ManagerHomeLeague[];
}

type SeasonStateLoader = (input: {
  leagueId: string;
  userId: string;
  now: Date;
}) => Promise<LeagueSeasonState | null>;

/** Derive the post-draft competition status from the authorised season state. */
export function deriveSeasonStatus(seasonState: LeagueSeasonState | null): ManagerHomeLeagueStatus {
  if (!seasonState) return { kind: 'season_setup' };
  if (seasonState.competitionStatus === 'COMPLETE') return { kind: 'season_complete' };

  const live = seasonState.schedule.find((round) => round.status === 'in_progress');
  if (live) return { kind: 'round_live', roundLabel: live.roundLabel, endsAt: live.endsAt };

  const upcoming = seasonState.schedule.find((round) => round.status === 'scheduled');
  if (upcoming) {
    return { kind: 'round_upcoming', roundLabel: upcoming.roundLabel, startsAt: upcoming.startsAt };
  }

  const allFinal =
    seasonState.schedule.length > 0 &&
    seasonState.schedule.every(
      (round) => round.status === 'final' || round.status === 'no_matchup'
    );
  return allFinal ? { kind: 'season_complete' } : { kind: 'season_setup' };
}

function parseCategories(value: string | null): FantasyCategoryKey[] {
  if (!value) return [...REAL_DATA_NINE_CATEGORY_PRESET];
  try {
    return normalizeFantasyCategoryKeys(JSON.parse(value), REAL_DATA_NINE_CATEGORY_PRESET);
  } catch {
    return [...REAL_DATA_NINE_CATEGORY_PRESET];
  }
}

/** The round a manager cares about now: the live one, else the next, else the most recent. */
function focusRound(schedule: LeagueSeasonStateRound[]): LeagueSeasonStateRound | null {
  return (
    schedule.find((round) => round.status === 'in_progress') ??
    schedule.find((round) => round.status === 'scheduled') ??
    [...schedule].reverse().find((round) => round.status === 'final') ??
    null
  );
}

/**
 * Read model for the signed-in manager's home page. Every value comes from Prisma, which owns
 * league, membership, draft, competition, standings, lineup, trade and waiver state.
 */
export async function loadManagerHome(
  input: { userId: string; now?: Date },
  client: ManagerHomeClient = defaultPrisma,
  loadSeasonState: SeasonStateLoader = async ({ leagueId, userId, now }) => {
    const result = await getAuthorizedLeagueSeasonState({ leagueId, userId, now }, client);
    return result.ok ? result.data : null;
  }
): Promise<ManagerHome> {
  const now = input.now ?? new Date();

  const memberships = (
    await client.leagueMember.findMany({
      where: { userId: input.userId },
      orderBy: { joinedAt: 'desc' },
      select: {
        id: true,
        role: true,
        teamName: true,
        teamLogoUrl: true,
        isActive: true,
        status: true,
        league: {
          select: {
            id: true,
            name: true,
            categoriesJson: true,
            settings: {
              select: { maxTeams: true, timeZone: true, startAt: true, lineupSlotsJson: true },
            },
            activeSeason: { select: { label: true } },
            drafts: {
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: { id: true, status: true, currentPick: true, totalPicks: true },
            },
            members: {
              select: {
                id: true,
                teamName: true,
                teamLogoUrl: true,
                draftSlot: true,
                isActive: true,
                status: true,
              },
            },
          },
        },
      },
    })
  ).filter(isActivePrismaMembership);

  if (memberships.length === 0) {
    return { generatedAt: now.toISOString(), leagues: [] };
  }

  const memberIds = memberships.map((membership) => membership.id);
  const memberLeague = new Map(
    memberships.map((membership) => [membership.id, membership.league.id])
  );

  const [offers, waiverClaims] = await Promise.all([
    client.leagueTradeOffer.findMany({
      where: {
        recipientMemberId: { in: memberIds },
        status: 'PROPOSED',
        expiresAt: { gt: now },
      },
      select: { recipientMemberId: true, expiresAt: true },
    }),
    client.teamAction.findMany({
      where: { memberId: { in: memberIds }, actionType: 'WAIVER_CLAIM', status: 'PENDING' },
      select: { memberId: true },
    }),
  ]);

  const offersByLeague = new Map<string, { count: number; earliest: Date | null }>();
  for (const offer of offers) {
    const leagueId = memberLeague.get(offer.recipientMemberId);
    if (!leagueId) continue;
    const entry = offersByLeague.get(leagueId) ?? { count: 0, earliest: null };
    entry.count += 1;
    if (!entry.earliest || offer.expiresAt < entry.earliest) entry.earliest = offer.expiresAt;
    offersByLeague.set(leagueId, entry);
  }

  const claimsByLeague = new Map<string, number>();
  for (const claim of waiverClaims) {
    const leagueId = memberLeague.get(claim.memberId);
    if (!leagueId) continue;
    claimsByLeague.set(leagueId, (claimsByLeague.get(leagueId) ?? 0) + 1);
  }

  const leagues = await Promise.all(
    memberships.map(async (membership): Promise<ManagerHomeLeague> => {
      const league = membership.league;
      const draft = league.drafts[0] ?? null;
      const activeMembers = league.members.filter(isActivePrismaMembership);

      let status: ManagerHomeLeagueStatus;
      let record: ManagerHomeLeague['record'] = null;
      let matchup: ManagerHomeMatchup | null = null;
      let lineup: ManagerHomeLeague['lineup'] = null;
      let form: FormResult[] = [];
      let ladder: ManagerHomeLeague['ladder'] = null;

      if (draft?.status === 'LIVE') {
        status = {
          kind: 'draft_live',
          draftId: draft.id,
          currentPick: draft.currentPick,
          totalPicks: draft.totalPicks,
        };
      } else if (draft?.status === 'PAUSED') {
        status = { kind: 'draft_paused', draftId: draft.id };
      } else if (!draft || draft.status === 'SCHEDULED') {
        status = {
          kind: 'draft_scheduled',
          draftId: draft?.id ?? null,
          startsAt: league.settings.startAt?.toISOString() ?? null,
        };
      } else {
        const seasonState = await loadSeasonState({
          leagueId: league.id,
          userId: input.userId,
          now,
        });
        status = deriveSeasonStatus(seasonState);

        const round = seasonState ? focusRound(seasonState.schedule) : null;
        const standingRows = await client.leagueStanding.findMany({
          where: { leagueId: league.id },
          select: {
            id: true,
            memberId: true,
            wins: true,
            losses: true,
            draws: true,
            categoryWins: true,
            categoryLosses: true,
            categoryDraws: true,
            pointsFor: true,
            pointsAgainst: true,
          },
        });

        if (standingRows.length > 0) {
          const table = buildLeagueStandings({ members: activeMembers, standings: standingRows });
          const index = table.findIndex((row) => row.memberId === membership.id);
          if (index >= 0) {
            const row = table[index];
            record = {
              wins: row.wins,
              losses: row.losses,
              draws: row.draws,
              rank: index + 1,
              teams: table.length,
            };
          }
          ladder = table
            .map((row, position) => ({
              position: position + 1,
              teamName: row.teamName,
              logoUrl: row.teamLogoUrl,
              wins: row.wins,
              losses: row.losses,
              draws: row.draws,
              categoryWins: row.categoryWins,
              categoryLosses: row.categoryLosses,
              isYou: row.memberId === membership.id,
            }))
            .filter((row) => row.position <= 4 || row.isYou);
        }

        const recent = await client.leagueMatchupScore.findMany({
          where: { leagueId: league.id, memberId: membership.id, status: 'FINAL' },
          orderBy: { round: 'desc' },
          take: 5,
          select: { matchupWin: true, matchupLoss: true },
        });
        form = recent.map((score) => (score.matchupWin ? 'W' : score.matchupLoss ? 'L' : 'D'));

        if (round) {
          const found = await client.leagueMatchup.findFirst({
            where: {
              competitionRoundId: round.id,
              OR: [
                { homeMemberId: membership.id },
                { awayMemberId: membership.id },
                { byeMemberId: membership.id },
              ],
            },
            select: {
              homeMemberId: true,
              awayMemberId: true,
              homeCategoryWins: true,
              awayCategoryWins: true,
              scores: { where: { memberId: membership.id }, select: { categoriesJson: true } },
            },
          });

          if (found) {
            const isHome = found.homeMemberId === membership.id;
            const opponentId = isHome ? found.awayMemberId : found.homeMemberId;
            const opponent = league.members.find((member) => member.id === opponentId) ?? null;
            const rows = parseStoredCategoryRows(found.scores[0]?.categoriesJson);
            const played = round.status !== 'scheduled';

            matchup = {
              roundLabel: round.roundLabel,
              status:
                round.status === 'in_progress'
                  ? 'live'
                  : round.status === 'final'
                    ? 'final'
                    : 'scheduled',
              startsAt: round.startsAt,
              endsAt: round.endsAt,
              yourCategoryWins: isHome ? found.homeCategoryWins : found.awayCategoryWins,
              opponentCategoryWins: isHome ? found.awayCategoryWins : found.homeCategoryWins,
              opponent: opponent
                ? { teamName: opponent.teamName, logoUrl: opponent.teamLogoUrl }
                : null,
              categories: parseCategories(league.categoriesJson).map((key) => {
                const row = rows.find((candidate) => candidate.category === key);
                let result: CategoryResult = 'pending';
                if (played && row) {
                  result =
                    row.winner === 'draw'
                      ? 'drawn'
                      : (row.winner === 'home') === isHome
                        ? 'won'
                        : 'lost';
                }
                const category = FANTASY_CATEGORIES[key];
                return {
                  key,
                  label: category.label,
                  shortLabel: category.shortLabel ?? category.label,
                  result,
                  yourValue: played && row ? (isHome ? row.homeValue : row.awayValue) : null,
                  opponentValue: played && row ? (isHome ? row.awayValue : row.homeValue) : null,
                };
              }),
            };
          }
        }

        const nextRound = seasonState?.schedule.find(
          (candidate) => candidate.status === 'scheduled'
        );
        if (nextRound) {
          const saved = await client.leagueLineup.findUnique({
            where: {
              leagueId_memberId_round: {
                leagueId: league.id,
                memberId: membership.id,
                round: nextRound.round,
              },
            },
            select: {
              players: {
                where: { slot: { in: ['FWD', 'DEF', 'MID', 'RUC', 'UTIL'] } },
                select: { id: true },
              },
            },
          });
          lineup = {
            roundLabel: nextRound.roundLabel,
            filled: saved?.players.length ?? 0,
            required: totalActiveLineupSlots(parseLineupSlotsJson(league.settings.lineupSlotsJson)),
            locksAt: nextRound.startsAt,
          };
        }
      }

      const offerEntry = offersByLeague.get(league.id);

      return {
        leagueId: league.id,
        leagueName: league.name,
        teamName: membership.teamName,
        logoUrl: membership.teamLogoUrl,
        role: membership.role === 'OWNER' ? 'commissioner' : 'manager',
        memberCount: activeMembers.length,
        maxTeams: league.settings.maxTeams,
        timeZone: league.settings.timeZone,
        seasonLabel: league.activeSeason?.label ?? null,
        status,
        record,
        matchup,
        lineup,
        form,
        ladder,
        tradeOffersAwaitingYou: {
          count: offerEntry?.count ?? 0,
          earliestExpiresAt: offerEntry?.earliest?.toISOString() ?? null,
        },
        pendingWaiverClaims: claimsByLeague.get(league.id) ?? 0,
      };
    })
  );

  return { generatedAt: now.toISOString(), leagues };
}
