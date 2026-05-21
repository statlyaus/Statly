import { DraftType, LeagueRole } from '@prisma/client';

import { getPlayers } from '@/lib/data';
import { normalizeDraftPickSeconds } from '@/lib/draftClock';
import { adminAuth } from '@/lib/firebaseAdmin';
import { getWeekWindowStart, isCantCutPlayer, parseLeagueWaiverRules } from '@/lib/leagueRules';
import { deriveLeagueScheduleSettings, getComputedLeagueSeasonState } from '@/lib/leagueSeason';
import { FANTASY_CATEGORIES, type FantasyCategoryKey } from '@/types/fantasyCategories';
import type { League, LeagueMember, UserLeagueSummary } from '@/types/leagues';

import { leagueRepository } from '../repository/LeagueRepository';

type LeagueSummary = {
  id: string;
  name: string;
  code: string;
  type: 'public' | 'private';
  ownerId: string;
  maxTeams: number;
  currentTeams: number;
  status: 'preseason' | 'active' | 'completed';
  categories: FantasyCategoryKey[];
  draftDate?: string;
  createdAt: string;
  description?: string;
  tradeSettings: {
    tradeLimit: number;
    tradeReview: 'none' | 'admin' | 'veto';
    tradeVetoPeriodHours?: number;
    tradeDeadline?: string;
  };
  waiverWire: {
    waiverOrder: string[];
    waiverPeriodHours: number;
    waiverResetPolicy: 'weekly' | 'rolling';
    waiverSystem?: 'ROLLING_LIST' | 'FAAB';
    waiverPriorityMode?: 'ROLLING' | 'REVERSE_LADDER';
    waiverFaabBudget?: number;
    waiverMinimumBid?: number;
    waiverMaxWeekAcquisitions?: number;
    waiverMaxSeasonAcquisitions?: number;
    waiverMoveWinnerToBack?: boolean;
    waiverAcquisitionLocked?: boolean;
    cantDropList?: string[];
  };
  rosterSettings?: {
    rosterSize: number;
    benchSize: number;
  };
  draftSettings?: {
    draftType: 'snake' | 'linear';
    timePerPick: number;
    allowAutoPick: boolean;
    enableReminders: boolean;
  };
  captainSettings?: {
    enableCaptainSystem: boolean;
    captainMultiplier: number;
    viceCaptainMultiplier: number;
  };
  seasonSettings?: {
    seasonWeeks: number;
    matchupsPerOpponent: 1 | 2;
    playoffsEnabled: boolean;
    playoffTeams: number;
    playoffLegLengthWeeks: number;
    playoffReseedEachRound: boolean;
    playoffIncludeConsolation: boolean;
  };
};

type LeagueSettingsSnapshot = {
  rosterSize: number;
  benchSize: number;
  maxTeams: number;
  pickSeconds: number;
  allowAutoPick: boolean;
  enableDraftReminders: boolean;
  draftType: DraftType;
  startAt: Date;
  timeZone: string;
  locked: boolean;
  enableCaptainSystem: boolean;
  captainMultiplier: number;
  viceCaptainMultiplier: number;
  seasonWeeks: number;
  matchupsPerOpponent: number;
  playoffsEnabled: boolean;
  playoffTeams: number;
  playoffLegLengthWeeks: number;
  playoffReseedEachRound: boolean;
  playoffIncludeConsolation: boolean;
};

const DEFAULT_LEAGUE_CATEGORIES: FantasyCategoryKey[] = [
  'goals',
  'kicks',
  'handballs',
  'marks',
  'tackles',
  'hitouts',
];

function parseStringArray(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function normalizeCategories(categories: string[]): FantasyCategoryKey[] {
  const validKeys = new Set(Object.keys(FANTASY_CATEGORIES) as FantasyCategoryKey[]);
  const normalized = categories.filter((category): category is FantasyCategoryKey =>
    validKeys.has(category as FantasyCategoryKey)
  );

  return normalized.length > 0 ? normalized : DEFAULT_LEAGUE_CATEGORIES;
}

function buildPlayerLookupKey(name?: string, team?: string) {
  return `${String(name || '')
    .trim()
    .toLowerCase()}|${String(team || '')
    .trim()
    .toLowerCase()}`;
}

function getAverageValue(player?: { avg?: number; stats?: Record<string, unknown> }) {
  if (!player) return undefined;
  if (typeof player.avg === 'number' && Number.isFinite(player.avg)) {
    return Math.round(player.avg * 10) / 10;
  }
  const aflFantasy = player.stats?.aflFantasy;
  if (typeof aflFantasy === 'number' && Number.isFinite(aflFantasy)) {
    return Math.round(aflFantasy * 10) / 10;
  }
  return undefined;
}

function getStatsSummary(player?: { stats?: Record<string, unknown> }) {
  if (!player?.stats) return undefined;
  const read = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 10) / 10 : undefined;
  const summary = {
    disposals: read(player.stats.disposals),
    tackles: read(player.stats.tackles),
    marks: read(player.stats.marks),
    goals: read(player.stats.goals),
  };
  if (Object.values(summary).every((value) => value === undefined)) return undefined;
  return summary;
}

function parseJsonOptionalStringArray(value: string | null | undefined): string[] {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function buildWaiverRulesFromLeague(league: {
  waiverSystem: string;
  waiverPriorityMode: string;
  waiverFaabBudget: number | null;
  waiverMinimumBid: number;
  waiverPeriodHours: number;
  waiverMaxWeekAcquisitions: number | null;
  waiverMaxSeasonAcquisitions: number | null;
  waiverMoveWinnerToBack: boolean;
  waiverAcquisitionLocked: boolean;
  cantDropListJson: string | null;
}) {
  return parseLeagueWaiverRules({
    waiverPeriodHours: league.waiverPeriodHours,
    waiverResetPolicy: league.waiverPriorityMode === 'REVERSE_LADDER' ? 'weekly' : 'rolling',
    waiverSettings: {
      system: league.waiverSystem,
      minimumBid: league.waiverMinimumBid,
      waiverPeriodHours: league.waiverPeriodHours,
      maxWeekAcquisitions: league.waiverMaxWeekAcquisitions ?? undefined,
      maxSeasonAcquisitions: league.waiverMaxSeasonAcquisitions ?? undefined,
      priorityMode: league.waiverPriorityMode,
      moveWinnerToBack: league.waiverMoveWinnerToBack,
      acquisitionLocked: league.waiverAcquisitionLocked,
      cantDropList: parseJsonOptionalStringArray(league.cantDropListJson),
      faabBudget: league.waiverFaabBudget ?? undefined,
    },
  });
}

function normalizeMatchupsPerOpponent(value: number | null | undefined): 1 | 2 {
  return value === 2 ? 2 : 1;
}

function getLeagueSettingsSnapshot(value: unknown): LeagueSettingsSnapshot {
  return value as LeagueSettingsSnapshot;
}

function mapLeagueMemberRole(input: {
  memberUserId: string;
  ownerId: string;
  role: LeagueRole;
}): LeagueMember['role'] {
  if (input.memberUserId === input.ownerId) {
    return 'owner';
  }

  if (input.role === LeagueRole.COMMISSIONER) {
    return 'commissioner';
  }

  if (input.role === LeagueRole.MANAGER) {
    return 'manager';
  }

  return 'member';
}

function hasCommissionerPrivileges(input: {
  actorUserId: string;
  ownerId: string;
  members: Array<{ userId: string; role: LeagueRole }>;
}): boolean {
  if (input.actorUserId === input.ownerId) {
    return true;
  }

  const actorMember = input.members.find((member) => member.userId === input.actorUserId);
  return actorMember?.role === LeagueRole.COMMISSIONER;
}

export function canProcessWaiverClaimsForRole(role: LeagueRole | string | null | undefined) {
  return role === LeagueRole.OWNER || role === LeagueRole.COMMISSIONER;
}

function toLeagueSummary(
  league: Awaited<ReturnType<typeof leagueRepository.findLeagueById>> extends infer T
    ? Exclude<T, null>
    : never
): LeagueSummary {
  const categories = normalizeCategories(parseStringArray(league.categoriesJson));
  const settings = getLeagueSettingsSnapshot(league.settings);
  return {
    id: league.id,
    name: league.name,
    code: league.inviteCode,
    type: league.type === 'public' ? 'public' : 'private',
    ownerId: league.ownerId,
    maxTeams: settings.maxTeams,
    currentTeams: league.members.length,
    status: league.drafts[0]
      ? leagueRepository.mapDraftStatus(league.drafts[0].status)
      : (league.status as 'preseason' | 'active' | 'completed'),
    categories,
    draftDate: league.draftDate?.toISOString(),
    createdAt: league.createdAt.toISOString(),
    description: league.description ?? undefined,
    tradeSettings: {
      tradeLimit: league.tradeLimit,
      tradeReview:
        league.tradeReview === 'admin' || league.tradeReview === 'veto'
          ? league.tradeReview
          : 'none',
      tradeVetoPeriodHours: league.tradeVetoPeriodHours,
      tradeDeadline: league.tradeDeadline?.toISOString(),
    },
    waiverWire: {
      waiverOrder: parseStringArray(league.waiverOrderJson),
      waiverPeriodHours: league.waiverPeriodHours,
      waiverResetPolicy: league.waiverResetPolicy === 'rolling' ? 'rolling' : 'weekly',
      waiverSystem: league.waiverSystem === 'FAAB' ? 'FAAB' : 'ROLLING_LIST',
      waiverPriorityMode:
        league.waiverPriorityMode === 'REVERSE_LADDER' ? 'REVERSE_LADDER' : 'ROLLING',
      ...(league.waiverFaabBudget !== null ? { waiverFaabBudget: league.waiverFaabBudget } : {}),
      waiverMinimumBid: league.waiverMinimumBid,
      ...(league.waiverMaxWeekAcquisitions !== null
        ? { waiverMaxWeekAcquisitions: league.waiverMaxWeekAcquisitions }
        : {}),
      ...(league.waiverMaxSeasonAcquisitions !== null
        ? { waiverMaxSeasonAcquisitions: league.waiverMaxSeasonAcquisitions }
        : {}),
      waiverMoveWinnerToBack: league.waiverMoveWinnerToBack,
      waiverAcquisitionLocked: league.waiverAcquisitionLocked,
      cantDropList: parseJsonOptionalStringArray(league.cantDropListJson),
    },
    rosterSettings: {
      rosterSize: settings.rosterSize,
      benchSize: settings.benchSize,
    },
    draftSettings: {
      draftType: String(settings.draftType) === 'LINEAR' ? 'linear' : 'snake',
      timePerPick: settings.pickSeconds,
      allowAutoPick: settings.allowAutoPick,
      enableReminders: settings.enableDraftReminders,
    },
    captainSettings: {
      enableCaptainSystem: settings.enableCaptainSystem,
      captainMultiplier: settings.captainMultiplier,
      viceCaptainMultiplier: settings.viceCaptainMultiplier,
    },
    seasonSettings: {
      seasonWeeks: settings.seasonWeeks,
      matchupsPerOpponent: normalizeMatchupsPerOpponent(settings.matchupsPerOpponent),
      playoffsEnabled: settings.playoffsEnabled,
      playoffTeams: settings.playoffTeams,
      playoffLegLengthWeeks: settings.playoffLegLengthWeeks,
      playoffReseedEachRound: settings.playoffReseedEachRound,
      playoffIncludeConsolation: settings.playoffIncludeConsolation,
    },
  };
}

function toLeagueMembers(
  league: Awaited<ReturnType<typeof leagueRepository.findLeagueById>> extends infer T
    ? Exclude<T, null>
    : never
): LeagueMember[] {
  return league.members.map((member) => ({
    id: member.id,
    leagueId: member.leagueId,
    userId: member.userId,
    teamName: member.teamName,
    draftSlot: member.draftSlot ?? undefined,
    joinedAt: member.joinedAt.toISOString(),
    isActive: true,
    role: mapLeagueMemberRole({
      memberUserId: member.userId,
      ownerId: league.ownerId,
      role: member.role,
    }),
  }));
}

export class LeagueApplicationService {
  async createLeague(input: {
    userId: string;
    name: string;
    type: 'public' | 'private';
    maxTeams: number;
    categories: FantasyCategoryKey[];
    description?: string;
    tradeSettings?: {
      tradeLimit?: number;
      tradeReview?: 'none' | 'admin' | 'veto';
      tradeVetoPeriodHours?: number;
      tradeDeadline?: string;
    };
    waiverWire?: {
      waiverOrder?: string[];
      waiverPeriodHours?: number;
      waiverResetPolicy?: 'weekly' | 'rolling';
    };
    draftDate?: string;
  }): Promise<League> {
    return leagueRepository.transaction(async (tx) => {
      let user = await leagueRepository.findUser(tx, input.userId);

      if (!user) {
        const firebaseUser = await adminAuth.getUser(input.userId).catch(() => null);
        user = await leagueRepository.createUser(tx, {
          id: input.userId,
          email: firebaseUser?.email || `${input.userId}@firebase.local`,
          displayName: firebaseUser?.displayName || 'League Owner',
          timeZone: 'Australia/Melbourne',
        });
      }

      const scheduleDefaults = deriveLeagueScheduleSettings(input.maxTeams);
      const league = await leagueRepository.createLeague(tx, {
        name: input.name,
        inviteCode: await this.generateUniqueLeagueCode(tx),
        type: input.type,
        ownerId: user.id,
        description: input.description,
        status: 'preseason',
        categoriesJson: JSON.stringify(input.categories),
        draftDate: input.draftDate ? new Date(input.draftDate) : undefined,
        tradeLimit: input.tradeSettings?.tradeLimit ?? 10,
        tradeReview: input.tradeSettings?.tradeReview ?? 'none',
        tradeVetoPeriodHours: input.tradeSettings?.tradeVetoPeriodHours ?? 24,
        tradeDeadline: input.tradeSettings?.tradeDeadline
          ? new Date(input.tradeSettings.tradeDeadline)
          : undefined,
        waiverOrderJson: JSON.stringify(input.waiverWire?.waiverOrder ?? []),
        waiverPeriodHours: input.waiverWire?.waiverPeriodHours ?? 24,
        waiverResetPolicy: input.waiverWire?.waiverResetPolicy ?? 'weekly',
        settings: {
          rosterSize: 18,
          benchSize: 4,
          maxTeams: input.maxTeams,
          pickSeconds: 120,
          allowAutoPick: true,
          enableDraftReminders: true,
          draftType: DraftType.SNAKE,
          startAt: input.draftDate ? new Date(input.draftDate) : new Date(),
          timeZone: 'Australia/Melbourne',
          locked: false,
          seasonWeeks: scheduleDefaults.seasonWeeks,
          matchupsPerOpponent: scheduleDefaults.matchupsPerOpponent,
          playoffsEnabled: Boolean(scheduleDefaults.playoffs?.enabled),
          playoffTeams: scheduleDefaults.playoffs?.teams ?? 0,
          playoffLegLengthWeeks: scheduleDefaults.playoffs?.legLengthWeeks ?? 1,
          playoffReseedEachRound: Boolean(scheduleDefaults.playoffs?.reseedEachRound),
          playoffIncludeConsolation: Boolean(scheduleDefaults.playoffs?.includeConsolation),
          enableCaptainSystem: false,
          captainMultiplier: 2.0,
          viceCaptainMultiplier: 1.5,
        },
        ownerMember: {
          userId: user.id,
          teamName: `${input.name} Owner`,
        },
      });

      const summary = toLeagueSummary(league);
      return {
        id: summary.id,
        name: summary.name,
        code: summary.code,
        type: summary.type,
        ownerId: summary.ownerId,
        maxTeams: summary.maxTeams,
        categories: summary.categories,
        tradeSettings: summary.tradeSettings,
        waiverWire: summary.waiverWire,
        createdAt: summary.createdAt,
        status: summary.status,
        description: summary.description,
        draftDate: summary.draftDate,
        currentTeams: summary.currentTeams,
        rosterSettings: summary.rosterSettings,
        draftSettings: summary.draftSettings,
        captainSettings: summary.captainSettings,
        seasonSettings: summary.seasonSettings,
      };
    });
  }

  async getLeagueDetail(
    leagueId: string
  ): Promise<{ league: League; members: LeagueMember[] } | null> {
    return leagueRepository.transaction(async (tx) => {
      const league = await leagueRepository.findLeagueById(tx, leagueId);
      if (!league) {
        return null;
      }

      const summary = toLeagueSummary(league);
      return {
        league: {
          id: summary.id,
          name: summary.name,
          code: summary.code,
          type: summary.type,
          ownerId: summary.ownerId,
          maxTeams: summary.maxTeams,
          categories: summary.categories,
          tradeSettings: summary.tradeSettings,
          waiverWire: summary.waiverWire,
          createdAt: summary.createdAt,
          status: summary.status,
          description: summary.description,
          draftDate: summary.draftDate,
          currentTeams: summary.currentTeams,
          rosterSettings: summary.rosterSettings,
          draftSettings: summary.draftSettings,
          captainSettings: summary.captainSettings,
          seasonSettings: summary.seasonSettings,
        },
        members: toLeagueMembers(league),
      };
    });
  }

  async getLeagueDraftSummary(leagueId: string) {
    return leagueRepository.transaction(async (tx) => {
      const league = await leagueRepository.findLeagueById(tx, leagueId);
      if (!league) {
        return null;
      }

      const draft = league.drafts[0] ?? null;
      return {
        league: {
          id: league.id,
          name: league.name,
        },
        draft: draft
          ? {
              id: draft.id,
              status: draft.status,
              createdAt: draft.createdAt.toISOString(),
              startAt: league.settings.startAt.toISOString(),
            }
          : null,
      };
    });
  }

  async getDraftSettings(leagueId: string) {
    return leagueRepository.transaction(async (tx) => {
      const league = await leagueRepository.findLeagueById(tx, leagueId);
      if (!league) {
        return null;
      }
      const settings = getLeagueSettingsSnapshot(league.settings);

      return {
        draftDate: league.draftDate?.toISOString(),
        draftType: String(settings.draftType) === 'LINEAR' ? 'linear' : 'snake',
        timePerPick: settings.pickSeconds,
        allowAutoPick: settings.allowAutoPick,
        enableReminders: settings.enableDraftReminders,
        rosterSize: settings.rosterSize,
        benchSize: settings.benchSize,
      };
    });
  }

  async updateDraftSettings(
    leagueId: string,
    input: {
      actorUserId: string;
      draftDate?: string;
      draftType?: 'snake' | 'linear';
      timePerPick?: number;
      allowAutoPick?: boolean;
      enableReminders?: boolean;
      rosterSize?: number;
      benchSize?: number;
    }
  ) {
    return leagueRepository.transaction(async (tx) => {
      const league = await leagueRepository.findLeagueById(tx, leagueId);
      if (!league) {
        return null;
      }

      const canManageLeague = hasCommissionerPrivileges({
        actorUserId: input.actorUserId,
        ownerId: league.ownerId,
        members: league.members,
      });
      if (!canManageLeague) {
        throw new Error('forbidden:Only the owner or a commissioner can update draft settings');
      }

      const updated = await leagueRepository.updateLeagueAndSettings(tx, {
        leagueId,
        league: {
          draftDate: input.draftDate ? new Date(input.draftDate) : null,
        },
        settings: {
          startAt: input.draftDate ? new Date(input.draftDate) : undefined,
          draftType:
            input.draftType === 'linear'
              ? ('LINEAR' as typeof DraftType.SNAKE)
              : input.draftType === 'snake'
                ? DraftType.SNAKE
                : undefined,
          pickSeconds: input.timePerPick,
          allowAutoPick: input.allowAutoPick,
          enableDraftReminders: input.enableReminders,
          rosterSize: input.rosterSize,
          benchSize: input.benchSize,
        },
      });

      if (!updated) {
        return null;
      }
      const settings = getLeagueSettingsSnapshot(updated.settings);

      return {
        draftDate: updated.league.draftDate?.toISOString(),
        draftType: String(settings.draftType) === 'LINEAR' ? 'linear' : 'snake',
        timePerPick: settings.pickSeconds,
        allowAutoPick: settings.allowAutoPick,
        enableReminders: settings.enableDraftReminders,
        rosterSize: settings.rosterSize,
        benchSize: settings.benchSize,
      };
    });
  }

  async updateLeagueSetup(input: {
    leagueId: string;
    actorUserId: string;
    name?: string;
    type?: 'public' | 'private';
    description?: string;
    categories?: FantasyCategoryKey[];
    draftDate?: string;
    draftType?: 'snake' | 'linear';
    timePerPick?: number;
    maxTeams?: number;
    regenerateInviteCode?: boolean;
    allowAutoPick?: boolean;
    enableReminders?: boolean;
    rosterSize?: number;
    benchSize?: number;
    enableCaptainSystem?: boolean;
    captainMultiplier?: number;
    viceCaptainMultiplier?: number;
    tradeLimit?: number;
    tradeReview?: 'none' | 'admin' | 'veto';
    tradeVetoPeriodHours?: number;
    tradeDeadline?: string;
    waiverPeriodHours?: number;
    waiverResetPolicy?: 'weekly' | 'rolling';
    waiverSystem?: 'ROLLING_LIST' | 'FAAB';
    waiverPriorityMode?: 'ROLLING' | 'REVERSE_LADDER';
    waiverFaabBudget?: number;
    waiverMinimumBid?: number;
    waiverMaxWeekAcquisitions?: number;
    waiverMaxSeasonAcquisitions?: number;
    waiverMoveWinnerToBack?: boolean;
    waiverAcquisitionLocked?: boolean;
    cantDropList?: string[];
    seasonWeeks?: number;
    matchupsPerOpponent?: 1 | 2;
    playoffsEnabled?: boolean;
    playoffTeams?: number;
    playoffLegLengthWeeks?: number;
    playoffReseedEachRound?: boolean;
    playoffIncludeConsolation?: boolean;
  }) {
    return leagueRepository.transaction(async (tx) => {
      const league = await leagueRepository.findLeagueById(tx, input.leagueId);
      if (!league) {
        throw new Error('not_found:League not found');
      }

      const canManageLeague = hasCommissionerPrivileges({
        actorUserId: input.actorUserId,
        ownerId: league.ownerId,
        members: league.members,
      });

      if (!canManageLeague) {
        throw new Error('forbidden:Only the owner or a commissioner can update league setup');
      }

      if (input.regenerateInviteCode && league.ownerId !== input.actorUserId) {
        throw new Error('forbidden:Only league owner can regenerate the invite code');
      }

      if (input.maxTeams !== undefined && league.ownerId !== input.actorUserId) {
        throw new Error('forbidden:Only league owner can change league capacity');
      }

      const nextCategories =
        input.categories && input.categories.length > 0
          ? normalizeCategories(input.categories)
          : undefined;
      const nextTradeLimit =
        input.tradeLimit !== undefined ? Math.max(0, Math.trunc(input.tradeLimit)) : undefined;
      const nextPickSeconds =
        input.timePerPick !== undefined
          ? normalizeDraftPickSeconds(Math.trunc(input.timePerPick))
          : undefined;
      const nextMaxTeams =
        input.maxTeams !== undefined ? Math.max(4, Math.trunc(input.maxTeams)) : undefined;
      const nextRosterSize =
        input.rosterSize !== undefined ? Math.max(1, Math.trunc(input.rosterSize)) : undefined;
      const nextBenchSize =
        input.benchSize !== undefined ? Math.max(0, Math.trunc(input.benchSize)) : undefined;
      const nextCaptainMultiplier =
        input.captainMultiplier !== undefined
          ? Math.max(1, Number(input.captainMultiplier))
          : undefined;
      const nextViceCaptainMultiplier =
        input.viceCaptainMultiplier !== undefined
          ? Math.max(1, Number(input.viceCaptainMultiplier))
          : undefined;
      const nextTradeVetoPeriodHours =
        input.tradeVetoPeriodHours !== undefined
          ? Math.min(336, Math.max(1, Math.trunc(input.tradeVetoPeriodHours)))
          : undefined;
      const nextWaiverPeriodHours =
        input.waiverPeriodHours !== undefined
          ? Math.max(1, Math.trunc(input.waiverPeriodHours))
          : undefined;
      const nextWaiverMinimumBid =
        input.waiverMinimumBid !== undefined
          ? Math.max(0, Math.trunc(input.waiverMinimumBid))
          : undefined;
      const nextWaiverFaabBudget =
        input.waiverFaabBudget !== undefined
          ? Math.max(0, Math.trunc(input.waiverFaabBudget))
          : undefined;
      const nextWaiverMaxWeekAcquisitions =
        input.waiverMaxWeekAcquisitions !== undefined
          ? Math.max(0, Math.trunc(input.waiverMaxWeekAcquisitions))
          : undefined;
      const nextWaiverMaxSeasonAcquisitions =
        input.waiverMaxSeasonAcquisitions !== undefined
          ? Math.max(0, Math.trunc(input.waiverMaxSeasonAcquisitions))
          : undefined;
      const nextCantDropList =
        input.cantDropList !== undefined
          ? input.cantDropList
              .map((entry) => entry.trim())
              .filter((entry, index, array) => entry.length > 0 && array.indexOf(entry) === index)
          : undefined;
      const nextSeasonWeeks =
        input.seasonWeeks !== undefined ? Math.max(1, Math.trunc(input.seasonWeeks)) : undefined;
      const nextMatchupsPerOpponent =
        input.matchupsPerOpponent !== undefined
          ? normalizeMatchupsPerOpponent(input.matchupsPerOpponent)
          : undefined;
      const nextPlayoffTeams =
        input.playoffTeams !== undefined ? Math.max(0, Math.trunc(input.playoffTeams)) : undefined;
      const nextPlayoffLegLengthWeeks =
        input.playoffLegLengthWeeks !== undefined
          ? Math.max(1, Math.trunc(input.playoffLegLengthWeeks))
          : undefined;

      if (nextMaxTeams !== undefined && nextMaxTeams < league.members.length) {
        throw new Error(
          `bad_request:Max teams cannot be lower than the current member count (${league.members.length})`
        );
      }

      if (
        nextBenchSize !== undefined &&
        nextRosterSize !== undefined &&
        nextBenchSize > nextRosterSize
      ) {
        throw new Error('bad_request:Bench size cannot be greater than total roster size');
      }

      if (
        nextViceCaptainMultiplier !== undefined &&
        nextCaptainMultiplier !== undefined &&
        nextViceCaptainMultiplier > nextCaptainMultiplier
      ) {
        throw new Error('bad_request:Vice-captain multiplier cannot exceed captain multiplier');
      }

      if (nextPlayoffTeams !== undefined) {
        const effectiveMaxTeams = nextMaxTeams ?? league.settings.maxTeams;
        if (nextPlayoffTeams > effectiveMaxTeams) {
          throw new Error('bad_request:Playoff teams cannot exceed league size');
        }
      }

      const nextInviteCode = input.regenerateInviteCode
        ? await this.generateUniqueLeagueCode(tx)
        : undefined;

      const updated = await leagueRepository.updateLeagueAndSettings(tx, {
        leagueId: input.leagueId,
        league: {
          ...(input.name !== undefined ? { name: input.name.trim() } : {}),
          ...(nextInviteCode ? { inviteCode: nextInviteCode } : {}),
          ...(input.type !== undefined ? { type: input.type } : {}),
          ...(input.description !== undefined ? { description: input.description || null } : {}),
          ...(nextCategories ? { categoriesJson: JSON.stringify(nextCategories) } : {}),
          ...(input.draftDate !== undefined
            ? { draftDate: input.draftDate ? new Date(input.draftDate) : null }
            : {}),
          ...(nextTradeLimit !== undefined ? { tradeLimit: nextTradeLimit } : {}),
          ...(input.tradeReview !== undefined ? { tradeReview: input.tradeReview } : {}),
          ...(nextTradeVetoPeriodHours !== undefined
            ? { tradeVetoPeriodHours: nextTradeVetoPeriodHours }
            : {}),
          ...(input.tradeDeadline !== undefined
            ? { tradeDeadline: input.tradeDeadline ? new Date(input.tradeDeadline) : null }
            : {}),
          ...(nextWaiverPeriodHours !== undefined
            ? { waiverPeriodHours: nextWaiverPeriodHours }
            : {}),
          ...(input.waiverResetPolicy !== undefined
            ? { waiverResetPolicy: input.waiverResetPolicy }
            : {}),
          ...(input.waiverSystem !== undefined ? { waiverSystem: input.waiverSystem } : {}),
          ...(input.waiverPriorityMode !== undefined
            ? { waiverPriorityMode: input.waiverPriorityMode }
            : {}),
          ...(input.waiverFaabBudget !== undefined
            ? { waiverFaabBudget: nextWaiverFaabBudget ?? null }
            : {}),
          ...(nextWaiverMinimumBid !== undefined ? { waiverMinimumBid: nextWaiverMinimumBid } : {}),
          ...(input.waiverMaxWeekAcquisitions !== undefined
            ? { waiverMaxWeekAcquisitions: nextWaiverMaxWeekAcquisitions ?? null }
            : {}),
          ...(input.waiverMaxSeasonAcquisitions !== undefined
            ? { waiverMaxSeasonAcquisitions: nextWaiverMaxSeasonAcquisitions ?? null }
            : {}),
          ...(input.waiverMoveWinnerToBack !== undefined
            ? { waiverMoveWinnerToBack: input.waiverMoveWinnerToBack }
            : {}),
          ...(input.waiverAcquisitionLocked !== undefined
            ? { waiverAcquisitionLocked: input.waiverAcquisitionLocked }
            : {}),
          ...(input.cantDropList !== undefined
            ? { cantDropListJson: JSON.stringify(nextCantDropList ?? []) }
            : {}),
        },
        settings: {
          ...(input.draftDate !== undefined
            ? { startAt: input.draftDate ? new Date(input.draftDate) : undefined }
            : {}),
          ...(nextMaxTeams !== undefined ? { maxTeams: nextMaxTeams } : {}),
          ...(input.draftType !== undefined
            ? {
                draftType:
                  input.draftType === 'linear'
                    ? ('LINEAR' as typeof DraftType.SNAKE)
                    : DraftType.SNAKE,
              }
            : {}),
          ...(input.allowAutoPick !== undefined ? { allowAutoPick: input.allowAutoPick } : {}),
          ...(input.enableReminders !== undefined
            ? { enableDraftReminders: input.enableReminders }
            : {}),
          ...(nextPickSeconds !== undefined ? { pickSeconds: nextPickSeconds } : {}),
          ...(nextRosterSize !== undefined ? { rosterSize: nextRosterSize } : {}),
          ...(nextBenchSize !== undefined ? { benchSize: nextBenchSize } : {}),
          ...(input.enableCaptainSystem !== undefined
            ? { enableCaptainSystem: input.enableCaptainSystem }
            : {}),
          ...(nextCaptainMultiplier !== undefined
            ? { captainMultiplier: nextCaptainMultiplier }
            : {}),
          ...(nextViceCaptainMultiplier !== undefined
            ? { viceCaptainMultiplier: nextViceCaptainMultiplier }
            : {}),
          ...(nextSeasonWeeks !== undefined ? { seasonWeeks: nextSeasonWeeks } : {}),
          ...(nextMatchupsPerOpponent !== undefined
            ? { matchupsPerOpponent: nextMatchupsPerOpponent }
            : {}),
          ...(input.playoffsEnabled !== undefined
            ? { playoffsEnabled: input.playoffsEnabled }
            : {}),
          ...(nextPlayoffTeams !== undefined ? { playoffTeams: nextPlayoffTeams } : {}),
          ...(nextPlayoffLegLengthWeeks !== undefined
            ? { playoffLegLengthWeeks: nextPlayoffLegLengthWeeks }
            : {}),
          ...(input.playoffReseedEachRound !== undefined
            ? { playoffReseedEachRound: input.playoffReseedEachRound }
            : {}),
          ...(input.playoffIncludeConsolation !== undefined
            ? { playoffIncludeConsolation: input.playoffIncludeConsolation }
            : {}),
        },
      });

      if (!updated) {
        throw new Error('not_found:League not found');
      }
      const settings = getLeagueSettingsSnapshot(updated.settings);

      return {
        categories: normalizeCategories(parseStringArray(updated.league.categoriesJson)),
        name: updated.league.name,
        type: updated.league.type === 'public' ? 'public' : 'private',
        description: updated.league.description ?? undefined,
        draftDate: updated.league.draftDate?.toISOString(),
        draftType: String(settings.draftType) === 'LINEAR' ? 'linear' : 'snake',
        timePerPick: settings.pickSeconds,
        maxTeams: settings.maxTeams,
        rosterSettings: {
          rosterSize: settings.rosterSize,
          benchSize: settings.benchSize,
        },
        draftSettings: {
          draftType: String(settings.draftType) === 'LINEAR' ? 'linear' : 'snake',
          timePerPick: settings.pickSeconds,
          allowAutoPick: settings.allowAutoPick,
          enableReminders: settings.enableDraftReminders,
        },
        captainSettings: {
          enableCaptainSystem: settings.enableCaptainSystem,
          captainMultiplier: settings.captainMultiplier,
          viceCaptainMultiplier: settings.viceCaptainMultiplier,
        },
        seasonSettings: {
          seasonWeeks: settings.seasonWeeks,
          matchupsPerOpponent: normalizeMatchupsPerOpponent(settings.matchupsPerOpponent),
          playoffsEnabled: settings.playoffsEnabled,
          playoffTeams: settings.playoffTeams,
          playoffLegLengthWeeks: settings.playoffLegLengthWeeks,
          playoffReseedEachRound: settings.playoffReseedEachRound,
          playoffIncludeConsolation: settings.playoffIncludeConsolation,
        },
        tradeSettings: {
          tradeLimit: updated.league.tradeLimit,
          tradeReview:
            updated.league.tradeReview === 'admin' || updated.league.tradeReview === 'veto'
              ? updated.league.tradeReview
              : 'none',
          tradeVetoPeriodHours: updated.league.tradeVetoPeriodHours,
          tradeDeadline: updated.league.tradeDeadline?.toISOString(),
        },
        waiverWire: {
          waiverOrder: parseStringArray(updated.league.waiverOrderJson),
          waiverPeriodHours: updated.league.waiverPeriodHours,
          waiverResetPolicy: updated.league.waiverResetPolicy === 'rolling' ? 'rolling' : 'weekly',
          waiverSystem: updated.league.waiverSystem === 'FAAB' ? 'FAAB' : 'ROLLING_LIST',
          waiverPriorityMode:
            updated.league.waiverPriorityMode === 'REVERSE_LADDER' ? 'REVERSE_LADDER' : 'ROLLING',
          ...(updated.league.waiverFaabBudget !== null
            ? { waiverFaabBudget: updated.league.waiverFaabBudget }
            : {}),
          waiverMinimumBid: updated.league.waiverMinimumBid,
          ...(updated.league.waiverMaxWeekAcquisitions !== null
            ? { waiverMaxWeekAcquisitions: updated.league.waiverMaxWeekAcquisitions }
            : {}),
          ...(updated.league.waiverMaxSeasonAcquisitions !== null
            ? { waiverMaxSeasonAcquisitions: updated.league.waiverMaxSeasonAcquisitions }
            : {}),
          waiverMoveWinnerToBack: updated.league.waiverMoveWinnerToBack,
          waiverAcquisitionLocked: updated.league.waiverAcquisitionLocked,
          cantDropList: parseJsonOptionalStringArray(updated.league.cantDropListJson),
        },
        inviteCode: updated.league.inviteCode,
      };
    });
  }

  async listLeagues(type?: 'public' | 'private') {
    return leagueRepository.transaction(async (tx) => {
      const leagues = await leagueRepository.listLeagues(tx, type);
      return leagues.map((league) => ({
        id: league.id,
        name: league.name,
        code: league.inviteCode,
        type: league.type === 'public' ? 'public' : 'private',
        ownerId: league.ownerId,
        maxTeams: league.settings.maxTeams,
        categories: normalizeCategories(parseStringArray(league.categoriesJson)),
        tradeSettings: {
          tradeLimit: league.tradeLimit,
          tradeReview:
            league.tradeReview === 'admin' || league.tradeReview === 'veto'
              ? league.tradeReview
              : 'none',
          tradeVetoPeriodHours: league.tradeVetoPeriodHours,
          tradeDeadline: league.tradeDeadline?.toISOString(),
        },
        waiverWire: {
          waiverOrder: parseStringArray(league.waiverOrderJson),
          waiverPeriodHours: league.waiverPeriodHours,
          waiverResetPolicy: league.waiverResetPolicy === 'rolling' ? 'rolling' : 'weekly',
        },
        createdAt: league.createdAt.toISOString(),
        status: league.status as 'preseason' | 'active' | 'completed',
        description: league.description ?? undefined,
        draftDate: league.draftDate?.toISOString(),
        currentTeams: league.members.length,
      }));
    });
  }

  async listUserLeagues(userId: string): Promise<UserLeagueSummary[]> {
    return leagueRepository.transaction(async (tx) => {
      const memberships = await leagueRepository.listLeaguesForUser(tx, userId);

      return memberships.map((membership) => {
        const league = membership.league;
        const latestDraft = league.drafts[0];
        const categories = normalizeCategories(parseStringArray(league.categoriesJson));

        return {
          id: league.id,
          name: league.name,
          teamName: membership.teamName,
          status: league.status as 'preseason' | 'active' | 'completed',
          draftCompleted: latestDraft?.status === 'COMPLETED',
          memberCount: league.members.length,
          maxTeams: league.settings.maxTeams,
          description: league.description ?? undefined,
          ownerId: league.ownerId,
          type: league.type === 'public' ? 'public' : 'private',
          code: league.inviteCode,
          categories,
          draftDate: league.draftDate?.toISOString(),
          createdAt: league.createdAt.toISOString(),
          updatedAt: latestDraft?.createdAt.toISOString() ?? league.createdAt.toISOString(),
        };
      });
    });
  }

  async joinLeague(input: { userId: string; code: string; teamName?: string }) {
    return leagueRepository.transaction(async (tx) => {
      let user = await leagueRepository.findUser(tx, input.userId);

      if (!user) {
        const firebaseUser = await adminAuth.getUser(input.userId).catch(() => null);
        user = await leagueRepository.createUser(tx, {
          id: input.userId,
          email: firebaseUser?.email || `${input.userId}@firebase.local`,
          displayName: firebaseUser?.displayName || 'League Member',
          timeZone: 'Australia/Melbourne',
        });
      }

      const league = await leagueRepository.findLeagueByInviteCode(tx, input.code);
      if (!league) {
        throw new Error(`bad_request:League with code "${input.code}" not found`);
      }

      if (league.status !== 'preseason') {
        throw new Error('bad_request:League is no longer accepting new members');
      }

      if (league.members.length >= league.settings.maxTeams) {
        throw new Error('bad_request:League is full');
      }

      const existingMember = league.members.find((member) => member.userId === input.userId);
      if (existingMember) {
        throw new Error('bad_request:Already a member of this league');
      }

      let finalTeamName = input.teamName?.trim();
      if (!finalTeamName) {
        finalTeamName = `${league.name} Team ${league.members.length + 1}`;
      }

      const duplicateName = league.members.find(
        (member) => member.teamName.toLowerCase() === finalTeamName!.toLowerCase()
      );
      if (duplicateName) {
        throw new Error('bad_request:Team name already taken');
      }

      const usedSlots = new Set(
        league.members
          .map((member) => member.draftSlot)
          .filter((slot): slot is number => typeof slot === 'number')
      );
      let nextDraftSlot: number | null = null;
      for (let slot = 1; slot <= league.settings.maxTeams; slot++) {
        if (!usedSlots.has(slot)) {
          nextDraftSlot = slot;
          break;
        }
      }

      const member = await leagueRepository.createLeagueMember(tx, {
        leagueId: league.id,
        userId: input.userId,
        teamName: finalTeamName,
        draftSlot: nextDraftSlot,
      });

      return {
        member: {
          id: member.id,
          leagueId: member.leagueId,
          userId: member.userId,
          role: 'member' as const,
          teamName: member.teamName,
          joinedAt: member.joinedAt.toISOString(),
          isActive: true,
        },
        league: {
          id: league.id,
          name: league.name,
          code: league.inviteCode,
          type: league.type === 'public' ? 'public' : 'private',
          status: league.status as 'preseason' | 'active' | 'completed',
        },
      };
    });
  }

  async getLeagueSeasonState(input: { leagueId: string; season: number }) {
    const state = await getComputedLeagueSeasonState(input);
    const currentWeek = state.scheduleWeeks.find((week) => week.current)?.week ?? null;

    return {
      leagueId: input.leagueId,
      season: input.season,
      currentWeek,
      schedule: state.scheduleWeeks
        .map((week) => ({
          id: `${input.leagueId}:${input.season}:${week.week}`,
          season: input.season,
          week: week.week,
          aflRound: week.aflRound,
          roundLabel: week.roundLabel,
          status: week.status,
          matchupCount: week.matchupIds.length,
          current: week.current,
        }))
        .sort((left, right) => left.week - right.week),
      ladder: state.memberSnapshots
        .map((member) => ({
          userId: member.userId,
          teamName: member.teamName,
          ladderRank: member.ladderRank,
          record: member.record,
          points: member.points,
          categoriesWon: member.categoriesWon,
          categoriesLost: member.categoriesLost,
          categoriesTied: member.categoriesTied,
          scheduleWeek: member.scheduleWeek,
          currentOpponentUserId: member.currentOpponentUserId ?? null,
          currentOpponentTeamName: member.currentOpponentTeamName ?? null,
        }))
        .sort((left, right) => {
          if (left.ladderRank !== right.ladderRank) return left.ladderRank - right.ladderRank;
          if (right.record.w !== left.record.w) return right.record.w - left.record.w;
          return left.teamName.localeCompare(right.teamName);
        }),
    };
  }

  async getLeagueRosterContext(input: { leagueId: string; userId: string }) {
    return leagueRepository.transaction(async (tx) => {
      const context = await leagueRepository.findRosterContextByLeagueAndUser(tx, input);
      if (!context) {
        return null;
      }

      return {
        member: context.member,
        league: context.league,
        playerIds: context.rosterPlayers.map((row) => String(row.playerId)),
        roster: context.member.rosters[0] ?? null,
      };
    });
  }

  async getLeagueOwnershipStats(input: { leagueId: string; playerIds?: string[] }) {
    const totalTeams = await leagueRepository.countLeagueMembers(input.leagueId);
    const rows = await leagueRepository.findLeagueRosterOwnershipRows(input);
    const counts = new Map<string, number>();
    const owners = new Map<string, string[]>();
    const seenMembersByPlayer = new Map<string, Set<string>>();

    rows.forEach((row) => {
      const playerId = String(row.playerId);
      const memberIds = seenMembersByPlayer.get(playerId) ?? new Set<string>();
      if (!memberIds.has(String(row.memberId))) {
        memberIds.add(String(row.memberId));
        counts.set(playerId, memberIds.size);
        seenMembersByPlayer.set(playerId, memberIds);
      }

      const teamName = row.member.teamName?.trim();
      if (teamName) {
        const list = owners.get(playerId) ?? [];
        if (!list.includes(teamName)) {
          list.push(teamName);
          owners.set(playerId, list);
        }
      }
    });

    return {
      totalTeams,
      counts,
      owners,
    };
  }

  async listLeaguePlayers(input: {
    leagueId: string;
    team?: string;
    position?: string;
    cursor?: string;
    limit: number;
    owned?: boolean;
  }) {
    const [playerRows, total, ownership, staticPlayers, pendingWaiverPlayerIds] = await Promise.all(
      [
        leagueRepository.listLeaguePlayers({
          team: input.team,
          position: input.position,
          cursor: input.cursor,
          take: Math.min(200, Math.max(input.limit * 3, input.limit)),
        }),
        leagueRepository.countLeaguePlayers({
          team: input.team,
          position: input.position,
        }),
        this.getLeagueOwnershipStats({ leagueId: input.leagueId }),
        getPlayers(),
        this.getPendingWaiverPlayerIds(input.leagueId),
      ]
    );

    const staticById = new Map(staticPlayers.map((player) => [String(player.id), player]));
    const staticByIdentity = new Map(
      staticPlayers.map((player) => [buildPlayerLookupKey(player.name, player.team), player])
    );

    const items = playerRows
      .map((player) => {
        const playerId = String(player.id);
        const ownerTeams = ownership.owners.get(playerId) ?? [];
        const ownedCount = ownership.counts.get(playerId) ?? 0;
        const isOwned = ownedCount > 0;
        const onWaiverHold = pendingWaiverPlayerIds.has(playerId);
        const staticPlayer =
          staticById.get(playerId) ??
          staticByIdentity.get(buildPlayerLookupKey(player.name, player.club));

        return {
          id: playerId,
          name: player.name,
          team: player.club ?? undefined,
          position: player.position ?? undefined,
          ownership:
            ownership.totalTeams > 0
              ? Math.max(0, Math.min(100, Math.round((ownedCount / ownership.totalTeams) * 100)))
              : 0,
          avg: getAverageValue(staticPlayer),
          statsSummary: getStatsSummary(staticPlayer),
          ownershipStatus: onWaiverHold ? 'Waiver' : isOwned ? 'Owned' : 'Available',
          ownerTeam: ownerTeams[0],
          ownerTeamName: ownerTeams[0],
        };
      })
      .filter((item) => {
        if (typeof input.owned !== 'boolean') return true;
        if (input.owned) return item.ownershipStatus === 'Owned';
        return item.ownershipStatus === 'Available';
      })
      .slice(0, input.limit);

    return {
      items,
      nextCursor: items.length > 0 ? items[items.length - 1].id : null,
      total,
    };
  }

  private async getPendingWaiverPlayerIds(leagueId: string) {
    return leagueRepository.transaction(async (tx) => {
      const claims = await leagueRepository.listWaiverClaims(tx, leagueId);
      return new Set(
        claims.filter((claim) => claim.status === 'PENDING').map((claim) => String(claim.playerId))
      );
    });
  }

  async getWaiverSettings(leagueId: string) {
    return leagueRepository.transaction(async (tx) => {
      const league = await leagueRepository.getLeagueWaiverConfig(tx, leagueId);
      if (!league) {
        return null;
      }

      return {
        waiverSettings: {
          system: league.waiverSystem,
          faabBudget: league.waiverFaabBudget ?? undefined,
          minimumBid: league.waiverMinimumBid,
          waiverPeriod: league.waiverPeriodHours,
          processTime: 'Next processing window',
        },
      };
    });
  }

  async listWaivers(leagueId: string) {
    return leagueRepository.transaction(async (tx) => {
      const [claims, priorities] = await Promise.all([
        leagueRepository.listWaiverClaims(tx, leagueId),
        leagueRepository.listWaiverPriorities(tx, leagueId),
      ]);

      return {
        claims: claims.map((claim) => ({
          id: claim.id,
          userId: claim.member.userId,
          teamId: claim.member.id,
          playerId: claim.playerId,
          dropPlayerId: claim.dropPlayerId ?? undefined,
          priority: claim.priority,
          status: claim.status,
          createdAt: claim.createdAt.toISOString(),
          processedAt: claim.processedAt?.toISOString(),
          processingAt: claim.processingAt?.toISOString(),
          bidAmount: claim.bidAmount ?? undefined,
        })),
        priorities: priorities.map((priority) => ({
          userId: priority.member.userId,
          teamId: priority.member.id,
          teamName: priority.member.teamName,
          currentPriority: priority.currentPriority ?? undefined,
          remainingFAAB: priority.remainingFaab ?? undefined,
          pendingBidTotal: priority.pendingBidTotal || undefined,
        })),
      };
    });
  }

  async submitWaiverClaim(input: {
    leagueId: string;
    userId: string;
    teamId?: string;
    playerId: string;
    dropPlayerId?: string;
    priority?: number;
    bidAmount?: number;
  }) {
    return leagueRepository.transaction(async (tx) => {
      const [member, league, ownership] = await Promise.all([
        leagueRepository.findLeagueMemberByReference(tx, {
          leagueId: input.leagueId,
          memberIdOrUserId: input.userId,
        }),
        leagueRepository.getLeagueWaiverConfig(tx, input.leagueId),
        this.getLeagueOwnershipStats({
          leagueId: input.leagueId,
          playerIds: [input.playerId],
        }),
      ]);

      if (!member) {
        throw new Error('forbidden:Not a league member');
      }
      if (!league) {
        throw new Error('not_found:League not found');
      }

      const rules = buildWaiverRulesFromLeague(league);
      if (rules.acquisitionLocked) {
        throw new Error('locked:Acquisitions are locked for the current round');
      }

      if ((ownership.counts.get(input.playerId) ?? 0) > 0) {
        throw new Error('conflict:Player already owned');
      }

      if (isCantCutPlayer(String(input.playerId), rules)) {
        throw new Error(
          "bad_request:This player is on the can't cut list and cannot be acquired via waivers"
        );
      }
      if (input.dropPlayerId && isCantCutPlayer(String(input.dropPlayerId), rules)) {
        throw new Error("bad_request:Selected drop player is on the can't cut list");
      }

      const rosterPlayerIds = member.rosterPlayers
        .slice()
        .sort((left, right) => left.sortOrder - right.sortOrder)
        .map((row) => String(row.playerId));
      const rosterCapacity = member.league.settings
        ? member.league.settings.rosterSize + member.league.settings.benchSize
        : undefined;
      if (
        !input.dropPlayerId &&
        typeof rosterCapacity === 'number' &&
        rosterPlayerIds.length >= rosterCapacity
      ) {
        throw new Error(
          'bad_request:Roster is at limit. Include a player to drop with this claim.'
        );
      }

      const [seasonClaims, weekClaims, existingPriority, memberCount] = await Promise.all([
        rules.maxSeasonAcquisitions != null
          ? leagueRepository.countSuccessfulWaiverClaims(tx, {
              leagueId: input.leagueId,
              memberId: member.id,
            })
          : Promise.resolve(0),
        rules.maxWeekAcquisitions != null
          ? leagueRepository.countSuccessfulWaiverClaims(tx, {
              leagueId: input.leagueId,
              memberId: member.id,
              processedSince: getWeekWindowStart(),
            })
          : Promise.resolve(0),
        leagueRepository.findWaiverPriorityByMemberId(tx, {
          leagueId: input.leagueId,
          memberId: member.id,
        }),
        tx.leagueMember.count({
          where: { leagueId: input.leagueId },
        }),
      ]);

      if (rules.maxSeasonAcquisitions != null && seasonClaims >= rules.maxSeasonAcquisitions) {
        throw new Error('bad_request:Season acquisition limit reached');
      }
      if (rules.maxWeekAcquisitions != null && weekClaims >= rules.maxWeekAcquisitions) {
        throw new Error('bad_request:Weekly acquisition limit reached');
      }

      const isFaab = rules.system === 'FAAB';
      const validatedBid =
        typeof input.bidAmount === 'number' ? Math.round(input.bidAmount) : undefined;
      if (isFaab) {
        if (typeof validatedBid !== 'number' || validatedBid < rules.minimumBid) {
          throw new Error('bad_request:Invalid bid amount');
        }
      }

      const currentPriority =
        existingPriority?.currentPriority ?? member.draftSlot ?? memberCount + 1;
      const remainingFaab = existingPriority?.remainingFaab ?? league.waiverFaabBudget ?? null;
      const pendingBidTotal = existingPriority?.pendingBidTotal ?? 0;

      if (isFaab && typeof validatedBid === 'number' && typeof remainingFaab === 'number') {
        if (pendingBidTotal + validatedBid > remainingFaab) {
          throw new Error('bad_request:Insufficient FAAB');
        }
      }

      const claim = await leagueRepository.createWaiverClaim(tx, {
        leagueId: input.leagueId,
        memberId: member.id,
        playerId: input.playerId,
        dropPlayerId: input.dropPlayerId,
        priority: input.priority ?? currentPriority,
        bidAmount: validatedBid,
      });

      await leagueRepository.upsertWaiverPriority(tx, {
        leagueId: input.leagueId,
        memberId: member.id,
        currentPriority,
        remainingFaab,
        pendingBidTotal:
          isFaab && typeof validatedBid === 'number'
            ? pendingBidTotal + validatedBid
            : pendingBidTotal,
      });

      return {
        id: claim.id,
        userId: claim.member.userId,
        teamId: claim.member.id,
        playerId: claim.playerId,
        dropPlayerId: claim.dropPlayerId ?? undefined,
        priority: claim.priority,
        bidAmount: claim.bidAmount ?? undefined,
        status: claim.status,
        createdAt: claim.createdAt.toISOString(),
      };
    });
  }

  async cancelWaiverClaim(input: { leagueId: string; claimId: string; callerUserId: string }) {
    return leagueRepository.transaction(async (tx) => {
      const [claim, callerMember] = await Promise.all([
        leagueRepository.findWaiverClaimById(tx, {
          leagueId: input.leagueId,
          claimId: input.claimId,
        }),
        leagueRepository.findLeagueMember(tx, input.leagueId, input.callerUserId),
      ]);

      if (!claim) {
        throw new Error('not_found:Claim not found');
      }
      if (!callerMember) {
        throw new Error('forbidden:Not a league member');
      }
      if (claim.status !== 'PENDING') {
        throw new Error('conflict:Only pending claims can be cancelled');
      }

      const canCancel =
        claim.member.userId === input.callerUserId || callerMember.role === LeagueRole.OWNER;
      if (!canCancel) {
        throw new Error('forbidden:Forbidden');
      }

      await leagueRepository.updateWaiverClaim(tx, {
        claimId: claim.id,
        data: {
          status: 'CANCELLED',
          processedAt: new Date(),
          cancelledByUserId: input.callerUserId,
          cancelledAt: new Date(),
        },
      });

      if (typeof claim.bidAmount === 'number' && claim.bidAmount > 0) {
        const priority = await leagueRepository.findWaiverPriorityByMemberId(tx, {
          leagueId: input.leagueId,
          memberId: claim.member.id,
        });
        await leagueRepository.upsertWaiverPriority(tx, {
          leagueId: input.leagueId,
          memberId: claim.member.id,
          pendingBidTotal: Math.max(0, (priority?.pendingBidTotal ?? 0) - claim.bidAmount),
        });
      }

      return { ok: true };
    });
  }

  async processWaiverClaims(input: { leagueId: string; callerUserId: string }) {
    const { league, pendingClaims } = await leagueRepository.transaction(async (tx) => {
      const [callerMember, league, claims] = await Promise.all([
        leagueRepository.findLeagueMember(tx, input.leagueId, input.callerUserId),
        leagueRepository.getLeagueWaiverConfig(tx, input.leagueId),
        leagueRepository.listWaiverClaims(tx, input.leagueId),
      ]);

      if (!callerMember || !canProcessWaiverClaimsForRole(callerMember.role)) {
        throw new Error('forbidden:Forbidden');
      }
      if (!league) {
        throw new Error('not_found:League not found');
      }

      return {
        league,
        pendingClaims: claims.filter((claim) => claim.status === 'PENDING'),
      };
    });

    if (pendingClaims.length === 0) {
      return {
        processed: 0,
        results: [] as Array<{ id: string; status: string; reason?: string }>,
      };
    }

    const rules = buildWaiverRulesFromLeague(league);
    const sortedClaims = pendingClaims.slice().sort((left, right) => {
      if (rules.system === 'FAAB') {
        const bidDiff = (right.bidAmount ?? 0) - (left.bidAmount ?? 0);
        if (bidDiff !== 0) return bidDiff;
      }
      const priorityDiff = left.priority - right.priority;
      if (priorityDiff !== 0) return priorityDiff;
      return left.createdAt.getTime() - right.createdAt.getTime();
    });

    const winners: string[] = [];
    const results: Array<{ id: string; status: string; reason?: string }> = [];

    for (const claim of sortedClaims) {
      const result = await leagueRepository.transaction(async (tx) => {
        const freshClaim = await leagueRepository.findWaiverClaimById(tx, {
          leagueId: input.leagueId,
          claimId: claim.id,
        });
        if (!freshClaim) {
          return { id: claim.id, status: 'SKIPPED', reason: 'Missing claim' };
        }
        if (freshClaim.status !== 'PENDING') {
          return { id: claim.id, status: 'SKIPPED', reason: 'Already processed' };
        }

        const member = await leagueRepository.findLeagueMemberByReference(tx, {
          leagueId: input.leagueId,
          memberIdOrUserId: freshClaim.member.id,
        });
        if (!member) {
          await leagueRepository.updateWaiverClaim(tx, {
            claimId: freshClaim.id,
            data: {
              status: 'FAILED',
              reason: 'Roster not found',
              processedAt: new Date(),
            },
          });
          return { id: claim.id, status: 'FAILED', reason: 'Roster not found' };
        }

        if (
          isCantCutPlayer(String(freshClaim.playerId), rules) ||
          (freshClaim.dropPlayerId && isCantCutPlayer(String(freshClaim.dropPlayerId), rules))
        ) {
          await this.adjustPendingBidTotal(tx, {
            leagueId: input.leagueId,
            memberId: member.id,
            bidAmount: freshClaim.bidAmount ?? undefined,
            direction: 'decrement',
          });
          await leagueRepository.updateWaiverClaim(tx, {
            claimId: freshClaim.id,
            data: {
              status: 'CANCELLED',
              reason: "Claim includes a player on the can't cut list",
              processedAt: new Date(),
            },
          });
          return {
            id: claim.id,
            status: 'CANCELLED',
            reason: "Claim includes a player on the can't cut list",
          };
        }

        const existingOwner = await tx.leagueRosterPlayer.findFirst({
          where: {
            leagueId: input.leagueId,
            playerId: freshClaim.playerId,
          },
          select: { memberId: true },
        });
        if (existingOwner) {
          await this.adjustPendingBidTotal(tx, {
            leagueId: input.leagueId,
            memberId: member.id,
            bidAmount: freshClaim.bidAmount ?? undefined,
            direction: 'decrement',
          });
          await leagueRepository.updateWaiverClaim(tx, {
            claimId: freshClaim.id,
            data: {
              status: 'FAILED',
              reason: 'Player already owned',
              processedAt: new Date(),
            },
          });
          return { id: claim.id, status: 'FAILED', reason: 'Player already owned' };
        }

        const rosterPlayerIds = member.rosterPlayers
          .slice()
          .sort((left, right) => left.sortOrder - right.sortOrder)
          .map((row) => String(row.playerId));

        if (freshClaim.dropPlayerId) {
          const dropIdx = rosterPlayerIds.indexOf(String(freshClaim.dropPlayerId));
          if (dropIdx === -1) {
            await this.adjustPendingBidTotal(tx, {
              leagueId: input.leagueId,
              memberId: member.id,
              bidAmount: freshClaim.bidAmount ?? undefined,
              direction: 'decrement',
            });
            await leagueRepository.updateWaiverClaim(tx, {
              claimId: freshClaim.id,
              data: {
                status: 'FAILED',
                reason: 'Drop player not on roster',
                processedAt: new Date(),
              },
            });
            return { id: claim.id, status: 'FAILED', reason: 'Drop player not on roster' };
          }
          rosterPlayerIds.splice(dropIdx, 1);
        }

        if (rules.system === 'FAAB' && typeof freshClaim.bidAmount === 'number') {
          const priority = await leagueRepository.findWaiverPriorityByMemberId(tx, {
            leagueId: input.leagueId,
            memberId: member.id,
          });
          const remainingFaab = priority?.remainingFaab ?? league.waiverFaabBudget ?? null;
          if (typeof remainingFaab !== 'number' || freshClaim.bidAmount > remainingFaab) {
            await this.adjustPendingBidTotal(tx, {
              leagueId: input.leagueId,
              memberId: member.id,
              bidAmount: freshClaim.bidAmount,
              direction: 'decrement',
            });
            await leagueRepository.updateWaiverClaim(tx, {
              claimId: freshClaim.id,
              data: {
                status: 'FAILED',
                reason: 'Insufficient FAAB',
                processedAt: new Date(),
              },
            });
            return { id: claim.id, status: 'FAILED', reason: 'Insufficient FAAB' };
          }

          await leagueRepository.upsertWaiverPriority(tx, {
            leagueId: input.leagueId,
            memberId: member.id,
            remainingFaab: remainingFaab - freshClaim.bidAmount,
          });
        }

        rosterPlayerIds.push(String(freshClaim.playerId));
        await leagueRepository.updateMemberRoster(tx, {
          leagueId: input.leagueId,
          memberId: member.id,
          playerIds: rosterPlayerIds,
        });
        await this.adjustPendingBidTotal(tx, {
          leagueId: input.leagueId,
          memberId: member.id,
          bidAmount: freshClaim.bidAmount ?? undefined,
          direction: 'decrement',
        });
        await leagueRepository.updateWaiverClaim(tx, {
          claimId: freshClaim.id,
          data: {
            status: 'SUCCESSFUL',
            processedAt: new Date(),
          },
        });

        return { id: claim.id, status: 'SUCCESSFUL', memberId: member.id };
      });

      results.push({
        id: result.id,
        status: result.status,
        ...(result.reason ? { reason: result.reason } : {}),
      });
      if (result.status === 'SUCCESSFUL' && typeof result.memberId === 'string') {
        winners.push(result.memberId);
      }
    }

    if (rules.system !== 'FAAB' && rules.priorityMode === 'ROLLING' && rules.moveWinnerToBack) {
      const uniqueWinnerIds = Array.from(new Set(winners));
      if (uniqueWinnerIds.length > 0) {
        await leagueRepository.transaction(async (tx) => {
          const priorities = await leagueRepository.listWaiverPriorities(tx, input.leagueId);
          let maxPriority = priorities.reduce(
            (max, priority) => Math.max(max, priority.currentPriority ?? 0),
            0
          );
          for (const memberId of uniqueWinnerIds) {
            maxPriority += 1;
            await leagueRepository.upsertWaiverPriority(tx, {
              leagueId: input.leagueId,
              memberId,
              currentPriority: maxPriority,
              lastClaimDate: new Date(),
            });
          }
        });
      }
    }

    return {
      processed: results.length,
      results,
    };
  }

  private async adjustPendingBidTotal(
    tx: Parameters<Parameters<typeof leagueRepository.transaction>[0]>[0],
    input: {
      leagueId: string;
      memberId: string;
      bidAmount?: number;
      direction: 'increment' | 'decrement';
    }
  ) {
    const amount = typeof input.bidAmount === 'number' ? input.bidAmount : 0;
    if (amount <= 0) return;

    const priority = await leagueRepository.findWaiverPriorityByMemberId(tx, {
      leagueId: input.leagueId,
      memberId: input.memberId,
    });
    const pendingBidTotal = priority?.pendingBidTotal ?? 0;
    const nextPendingBidTotal =
      input.direction === 'increment'
        ? pendingBidTotal + amount
        : Math.max(0, pendingBidTotal - amount);

    await leagueRepository.upsertWaiverPriority(tx, {
      leagueId: input.leagueId,
      memberId: input.memberId,
      pendingBidTotal: nextPendingBidTotal,
    });
  }

  async getLeagueMembers(leagueId: string): Promise<LeagueMember[] | null> {
    return leagueRepository.transaction(async (tx) => {
      const league = await leagueRepository.findLeagueById(tx, leagueId);
      if (!league) {
        return null;
      }

      return toLeagueMembers(league);
    });
  }

  async updateLeagueMember(input: {
    leagueId: string;
    actorUserId: string;
    targetUserId: string;
    updates: Partial<LeagueMember> & { draftSlot?: number };
  }) {
    return leagueRepository.transaction(async (tx) => {
      const league = await leagueRepository.findLeagueById(tx, input.leagueId);
      if (!league) {
        throw new Error('not_found:League not found');
      }

      const isOwner = league.ownerId === input.actorUserId;
      const hasCommissionerAccess = hasCommissionerPrivileges({
        actorUserId: input.actorUserId,
        ownerId: league.ownerId,
        members: league.members,
      });
      const isSelf = input.actorUserId === input.targetUserId;
      if (!hasCommissionerAccess && !isSelf) {
        throw new Error('forbidden:Not authorized to update this member');
      }

      const target = league.members.find((member) => member.userId === input.targetUserId);
      if (!target) {
        throw new Error('not_found:Member not found');
      }

      let teamName: string | undefined;
      if (input.updates.teamName && input.updates.teamName.trim()) {
        const normalized = input.updates.teamName.trim();
        const duplicate = league.members.find(
          (member) =>
            member.userId !== input.targetUserId &&
            member.teamName.toLowerCase() === normalized.toLowerCase()
        );
        if (duplicate) {
          throw new Error('bad_request:Team name already taken');
        }
        teamName = normalized;
      }

      let role: LeagueRole | undefined;
      if (isOwner && input.updates.role) {
        if (input.updates.role === 'owner') {
          throw new Error('bad_request:Use transfer ownership to assign a new owner');
        }
        if (target.userId === league.ownerId) {
          throw new Error('bad_request:Use transfer ownership to change the owner role');
        }

        role = input.updates.role === 'commissioner' ? LeagueRole.COMMISSIONER : LeagueRole.MANAGER;
      }

      let draftSlot: number | undefined;
      if (input.updates.draftSlot !== undefined) {
        if (!hasCommissionerAccess) {
          throw new Error('forbidden:Only the owner or a commissioner can assign draft slots');
        }

        if (
          !Number.isInteger(input.updates.draftSlot) ||
          input.updates.draftSlot < 1 ||
          input.updates.draftSlot > league.settings.maxTeams
        ) {
          throw new Error(
            `bad_request:Draft slot must be an integer between 1 and ${league.settings.maxTeams}`
          );
        }

        const duplicateSlot = league.members.find(
          (member) =>
            member.userId !== input.targetUserId && member.draftSlot === input.updates.draftSlot
        );
        if (duplicateSlot) {
          throw new Error(`bad_request:Draft slot ${input.updates.draftSlot} is already assigned`);
        }

        draftSlot = input.updates.draftSlot;
      }

      const updated = await leagueRepository.updateLeagueMember(tx, {
        leagueId: input.leagueId,
        userId: input.targetUserId,
        teamName,
        role,
        draftSlot,
      });

      if (!updated) {
        throw new Error('not_found:Member not found');
      }

      return {
        id: updated.id,
        leagueId: updated.leagueId,
        userId: updated.userId,
        role: mapLeagueMemberRole({
          memberUserId: updated.userId,
          ownerId: league.ownerId,
          role: updated.role,
        }),
        teamName: updated.teamName,
        draftSlot: updated.draftSlot ?? undefined,
        joinedAt: updated.joinedAt.toISOString(),
        isActive: true,
      } satisfies LeagueMember;
    });
  }

  async reorderLeagueDraftSlots(input: {
    leagueId: string;
    actorUserId: string;
    orderedUserIds: string[];
  }) {
    return leagueRepository.transaction(async (tx) => {
      const league = await leagueRepository.findLeagueById(tx, input.leagueId);
      if (!league) {
        throw new Error('not_found:League not found');
      }

      const hasCommissionerAccess = hasCommissionerPrivileges({
        actorUserId: input.actorUserId,
        ownerId: league.ownerId,
        members: league.members,
      });

      if (!hasCommissionerAccess) {
        throw new Error('forbidden:Only the owner or a commissioner can assign draft slots');
      }

      const normalizedUserIds = input.orderedUserIds.map((userId) => userId.trim()).filter(Boolean);
      if (normalizedUserIds.length !== league.members.length) {
        throw new Error('bad_request:Draft order must include every league member exactly once');
      }

      const uniqueUserIds = new Set(normalizedUserIds);
      if (uniqueUserIds.size !== normalizedUserIds.length) {
        throw new Error('bad_request:Draft order cannot include duplicate members');
      }

      const memberByUserId = new Map(league.members.map((member) => [member.userId, member]));
      for (const userId of normalizedUserIds) {
        if (!memberByUserId.has(userId)) {
          throw new Error(`bad_request:Unknown member in draft order: ${userId}`);
        }
      }

      const temporaryOffset = league.settings.maxTeams + league.members.length + 10;
      for (const [index, userId] of normalizedUserIds.entries()) {
        await leagueRepository.updateLeagueMember(tx, {
          leagueId: input.leagueId,
          userId,
          draftSlot: temporaryOffset + index,
        });
      }

      for (const [index, userId] of normalizedUserIds.entries()) {
        await leagueRepository.updateLeagueMember(tx, {
          leagueId: input.leagueId,
          userId,
          draftSlot: index + 1,
        });
      }

      const refreshedLeague = await leagueRepository.findLeagueById(tx, input.leagueId);
      if (!refreshedLeague) {
        throw new Error('not_found:League not found');
      }

      return toLeagueMembers(refreshedLeague);
    });
  }

  async removeLeagueMember(input: { leagueId: string; actorUserId: string; targetUserId: string }) {
    return leagueRepository.transaction(async (tx) => {
      const league = await leagueRepository.findLeagueById(tx, input.leagueId);
      if (!league) {
        throw new Error('not_found:League not found');
      }

      const isOwner = league.ownerId === input.actorUserId;
      const isSelf = input.actorUserId === input.targetUserId;
      if (!isOwner && !isSelf) {
        throw new Error('forbidden:Not authorized to remove this member');
      }

      if (input.targetUserId === league.ownerId) {
        throw new Error('bad_request:Cannot remove league owner');
      }

      const removed = await leagueRepository.removeLeagueMember(tx, {
        leagueId: input.leagueId,
        userId: input.targetUserId,
      });

      if (!removed) {
        throw new Error('not_found:Member not found');
      }

      return { removed: true };
    });
  }

  async transferLeagueOwnership(input: {
    leagueId: string;
    actorUserId: string;
    targetUserId: string;
  }) {
    return leagueRepository.transaction(async (tx) => {
      const league = await leagueRepository.findLeagueById(tx, input.leagueId);
      if (!league) {
        throw new Error('not_found:League not found');
      }

      if (league.ownerId !== input.actorUserId) {
        throw new Error('forbidden:Only league owner can transfer ownership');
      }

      const target = league.members.find((member) => member.userId === input.targetUserId);
      if (!target) {
        throw new Error('not_found:Target user is not a member of this league');
      }

      const transferred = await leagueRepository.transferLeagueOwnership(tx, {
        leagueId: input.leagueId,
        currentOwnerId: input.actorUserId,
        nextOwnerId: input.targetUserId,
      });

      if (!transferred) {
        throw new Error('not_found:Ownership transfer failed');
      }

      return transferred;
    });
  }

  private async generateUniqueLeagueCode(
    tx: Parameters<typeof leagueRepository.findLeagueByInviteCode>[0]
  ): Promise<string> {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const code = this.generateLeagueCode();
      const existing = await leagueRepository.findLeagueByInviteCode(tx, code);
      if (!existing) {
        return code;
      }
    }

    throw new Error('internal:Failed to generate a unique league code');
  }

  private generateLeagueCode(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 8; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }
}

export const leagueApplicationService = new LeagueApplicationService();
