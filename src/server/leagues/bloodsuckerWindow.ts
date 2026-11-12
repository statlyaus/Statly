import type { Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';

import { isActivePrismaMembership } from './activeMembership';

// The Bloodsucker's exclusive free-agency window (Bloodsucker 3/9, #1280; BR-11, E6). The one place
// the window is computed: the transaction guard (`transactionWindow.ts`) and the close-time auto-fill
// (`bloodsuckerAutoFill.ts`) both read it from here. No `server-only` import, so the draft service
// can reach the auto-fill.

const HOUR_MS = 60 * 60 * 1000;
export const BLOODSUCKER_WINDOW_MAX_HOURS = 24;
export const BLOODSUCKER_WINDOW_LOCK_BUFFER_HOURS = 2;
export const BLOODSUCKER_WINDOW_MIN_HOURS = 1;

export interface BloodsuckerWindow {
  opensAt: Date;
  closesAt: Date;
  /** Under an hour was left before round 1 (E6): no exclusive window, auto-fill runs at once. */
  skipped: boolean;
}

/**
 * BR-11: the Bloodsucker's exclusive free-agency window. It opens when the draft completes and
 * closes at the earlier of 24 hours later or 2 hours before round 1's first lock. A window that
 * would be shorter than an hour is skipped, and it then closes the moment it opens.
 */
export function computeBloodsuckerWindow(input: {
  completedAt: Date;
  roundOneFirstLockAt: Date | null;
}): BloodsuckerWindow {
  const opensAt = input.completedAt;
  const byClock = opensAt.getTime() + BLOODSUCKER_WINDOW_MAX_HOURS * HOUR_MS;
  const byLock = input.roundOneFirstLockAt
    ? input.roundOneFirstLockAt.getTime() - BLOODSUCKER_WINDOW_LOCK_BUFFER_HOURS * HOUR_MS
    : byClock;
  const closesAt = Math.min(byClock, byLock);
  if (closesAt - opensAt.getTime() < BLOODSUCKER_WINDOW_MIN_HOURS * HOUR_MS) {
    return { opensAt, closesAt: opensAt, skipped: true };
  }
  return { opensAt, closesAt: new Date(closesAt), skipped: false };
}

type WindowDb = Pick<Prisma.TransactionClient, 'draft' | 'leagueCompetitionRound'>;

export interface LeagueDraftWindowState {
  draftId: string;
  draftStatus: string;
  /** Set only in a Bloodsucker league with an active Bloodsucker and a completed draft. */
  bloodsucker: { memberId: string; window: BloodsuckerWindow } | null;
}

/** The league's draft status and, for a Bloodsucker league, its exclusive window. */
export async function loadLeagueDraftWindowState(
  leagueId: string,
  db: WindowDb = prisma
): Promise<LeagueDraftWindowState | null> {
  const draft = await db.draft.findUnique({
    where: { leagueId },
    select: {
      id: true,
      status: true,
      completedAt: true,
      league: {
        select: {
          settings: {
            select: {
              leagueFormat: true,
              competitionRulesVersion: true,
              bloodsuckerMember: { select: { id: true, isActive: true, status: true } },
            },
          },
        },
      },
    },
  });
  if (!draft) return null;

  const settings = draft.league?.settings;
  const bloodsuckerMember = settings?.bloodsuckerMember;
  if (
    draft.status !== 'COMPLETED' ||
    !draft.completedAt ||
    settings?.leagueFormat !== 'BLOODSUCKER' ||
    !bloodsuckerMember ||
    !isActivePrismaMembership(bloodsuckerMember)
  ) {
    return { draftId: draft.id, draftStatus: draft.status, bloodsucker: null };
  }

  // Round 1's first lock is its first AFL game start. An unpublished competition has no round yet,
  // so the window runs its full 24 hours.
  const roundOne =
    settings.competitionRulesVersion > 0
      ? await db.leagueCompetitionRound.findFirst({
          where: { leagueId, fixtureVersion: settings.competitionRulesVersion, round: 1 },
          select: { startsAt: true, fallbackLockAt: true },
        })
      : null;
  return {
    draftId: draft.id,
    draftStatus: draft.status,
    bloodsucker: {
      memberId: bloodsuckerMember.id,
      window: computeBloodsuckerWindow({
        completedAt: draft.completedAt,
        roundOneFirstLockAt: roundOne?.startsAt ?? roundOne?.fallbackLockAt ?? null,
      }),
    },
  };
}
