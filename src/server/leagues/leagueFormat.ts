// League format (epic #1275, BR-01 to BR-08). The format is its own column, independent of scoring
// mode and categories, and it locks with the draft structure. A BLOODSUCKER league names one member
// who skips the draft; that member must be active, and the league needs ROLLING waivers with no FAAB.

import type { Prisma } from '@prisma/client';

import type { LeagueFormat } from '@/types/leagues';

import { isActivePrismaMembership } from './activeMembership';

export type { LeagueFormat };

export const BLOODSUCKER_MIN_TEAMS = 8;
export const BLOODSUCKER_RECOMMENDED_TEAMS = 12;
export const BLOODSUCKER_REQUIRES_ROLLING_MESSAGE =
  'A Bloodsucker league must use rolling waivers with no FAAB budget.';

export function normalizeLeagueFormat(value: unknown, fallback: LeagueFormat = 'STANDARD') {
  if (value === 'BLOODSUCKER' || value === 'STANDARD') return value;
  return fallback;
}

/** BR-03: Bloodsucker waivers are ROLLING, so "priority 1" is a real priority, not a FAAB tie-break. */
export function getLeagueFormatWaiverError(input: {
  leagueFormat: LeagueFormat;
  waiverRule: string;
  faabBudget: number | null;
}): { code: 'BLOODSUCKER_REQUIRES_ROLLING'; error: string } | null {
  if (input.leagueFormat !== 'BLOODSUCKER') return null;
  if (input.waiverRule.toUpperCase() === 'ROLLING' && input.faabBudget === null) return null;
  return { code: 'BLOODSUCKER_REQUIRES_ROLLING', error: BLOODSUCKER_REQUIRES_ROLLING_MESSAGE };
}

/**
 * The Bloodsucker the league can use: set only in a BLOODSUCKER league and only while that member
 * is still active. A stale id (a member who left by a path that did not clear it) counts as unset.
 */
export function resolveBloodsuckerMemberId(
  settings: { leagueFormat: LeagueFormat | string; bloodsuckerMemberId: string | null },
  activeMemberIds: readonly string[]
): string | null {
  if (settings.leagueFormat !== 'BLOODSUCKER' || !settings.bloodsuckerMemberId) return null;
  return activeMemberIds.includes(settings.bloodsuckerMemberId)
    ? settings.bloodsuckerMemberId
    : null;
}

export interface LeagueFormatBlocker {
  code: 'bloodsucker_missing' | 'bloodsucker_insufficient_teams';
  message: string;
}

/** BR-02 and BR-06: what stops a Bloodsucker league's draft from starting. */
export function getLeagueFormatDraftBlockers(input: {
  leagueFormat: LeagueFormat | string;
  bloodsuckerMemberId: string | null;
  activeMemberIds: readonly string[];
}): LeagueFormatBlocker[] {
  if (input.leagueFormat !== 'BLOODSUCKER') return [];
  const blockers: LeagueFormatBlocker[] = [];
  if (!resolveBloodsuckerMemberId(input, input.activeMemberIds)) {
    blockers.push({ code: 'bloodsucker_missing', message: 'Choose a Bloodsucker.' });
  }
  if (input.activeMemberIds.length < BLOODSUCKER_MIN_TEAMS) {
    blockers.push({
      code: 'bloodsucker_insufficient_teams',
      message: `A Bloodsucker league needs at least ${BLOODSUCKER_MIN_TEAMS} teams (${BLOODSUCKER_RECOMMENDED_TEAMS} recommended).`,
    });
  }
  return blockers;
}

/**
 * The first format blocker for a league, read inside the draft-start transaction so a Bloodsucker
 * draft can never start (from the room or the scheduled worker) without its Bloodsucker or 8 teams.
 */
export async function findLeagueFormatStartBlocker(
  tx: Prisma.TransactionClient,
  leagueId: string
): Promise<LeagueFormatBlocker | null> {
  const league = await tx.league.findUnique({
    where: { id: leagueId },
    select: {
      settings: { select: { leagueFormat: true, bloodsuckerMemberId: true } },
      members: { where: { isActive: true }, select: { id: true, isActive: true, status: true } },
    },
  });
  if (!league?.settings) return null;
  return (
    getLeagueFormatDraftBlockers({
      leagueFormat: league.settings.leagueFormat,
      bloodsuckerMemberId: league.settings.bloodsuckerMemberId,
      activeMemberIds: league.members.filter(isActivePrismaMembership).map((member) => member.id),
    })[0] ?? null
  );
}

export interface LeagueFormatState {
  leagueFormat: LeagueFormat;
  bloodsuckerMemberId: string | null;
}

/** The audit row for a format or Bloodsucker change: actor, before, after and reason. */
export function buildLeagueFormatAudit(input: {
  leagueId: string;
  actorMemberId: string | null;
  before: LeagueFormatState;
  after: LeagueFormatState;
  reason: 'SETTINGS_UPDATED' | 'BLOODSUCKER_LEFT';
}): Prisma.LeagueCompetitionAuditUncheckedCreateInput {
  return {
    leagueId: input.leagueId,
    actorMemberId: input.actorMemberId,
    eventType: 'LEAGUE_FORMAT_CHANGED',
    payloadJson: {
      reason: input.reason,
      before: { ...input.before },
      after: { ...input.after },
    },
  };
}

/**
 * BR-07: when the Bloodsucker leaves or is removed, the setting is cleared and audited, so readiness
 * blocks until the commissioner sets a new one. Runs inside the transaction that deactivates them.
 */
export async function clearBloodsuckerOnDeparture(
  tx: Prisma.TransactionClient,
  input: { leagueId: string; memberId: string; actorMemberId: string | null }
): Promise<boolean> {
  const settings = await tx.leagueSettings.findFirst({
    where: { league: { id: input.leagueId }, bloodsuckerMemberId: input.memberId },
    select: { id: true, leagueFormat: true },
  });
  if (!settings) return false;

  await tx.leagueSettings.update({
    where: { id: settings.id },
    data: { bloodsuckerMemberId: null },
  });
  await tx.leagueCompetitionAudit.create({
    data: buildLeagueFormatAudit({
      leagueId: input.leagueId,
      actorMemberId: input.actorMemberId,
      before: { leagueFormat: settings.leagueFormat, bloodsuckerMemberId: input.memberId },
      after: { leagueFormat: settings.leagueFormat, bloodsuckerMemberId: null },
      reason: 'BLOODSUCKER_LEFT',
    }),
  });
  return true;
}
