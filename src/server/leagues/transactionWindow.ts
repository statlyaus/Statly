import 'server-only';

import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';

import {
  BLOODSUCKER_AUTO_FILL_GRACE_MINUTES,
  hasBloodsuckerAutoFillRun,
  loadLeagueDraftWindowState,
} from './bloodsuckerWindow';

/**
 * Free-agent adds, drops, waiver claims and trade proposals, accepts or counters open only after the
 * league's draft is COMPLETED. In a Bloodsucker league they then stay closed to everyone but the
 * Bloodsucker until its exclusive window ends (BR-11, BR-12) and the auto-fill of its empty roster
 * spots has run (E13, #1355). Every transaction route asks this one guard before it writes anything.
 */
export type TransactionWindow =
  | {
      open: true;
      /** The caller is the Bloodsucker inside its exclusive window: waiver holds do not apply. */
      bloodsuckerExclusive?: true;
    }
  | { open: false; code: 'DRAFT_NOT_COMPLETE'; reason: string }
  | { open: false; code: 'BLOODSUCKER_WINDOW_OPEN'; reason: string; closesAt: string }
  | { open: false; code: 'BLOODSUCKER_AUTO_FILL_PENDING'; reason: string };

export const BLOODSUCKER_AUTO_FILL_PENDING_MESSAGE =
  "The Bloodsucker's window has closed and its empty roster spots are being filled. Adds, drops, waiver claims and trades open in a few minutes.";

const DRAFT_NOT_COMPLETE: TransactionWindow = {
  open: false,
  code: 'DRAFT_NOT_COMPLETE',
  reason: 'Adds, waiver claims and trades open once the league draft is complete.',
};

const closeTimeFormat = new Intl.DateTimeFormat('en-AU', {
  timeZone: 'Australia/Melbourne',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
});

export async function getTransactionWindow(
  leagueId: string,
  db: Parameters<typeof loadLeagueDraftWindowState>[1] = prisma,
  /** Who is asking. With no member, a Bloodsucker window is closed to the caller. */
  actor: { memberId?: string | null; now?: Date } = {}
): Promise<TransactionWindow> {
  const state = await loadLeagueDraftWindowState(leagueId, db);
  if (state?.draftStatus !== 'COMPLETED') return DRAFT_NOT_COMPLETE;

  const now = actor.now ?? new Date();
  if (!state.bloodsucker) return { open: true };
  const { closesAt } = state.bloodsucker.window;
  if (now >= closesAt) {
    // E13: closed to every other team between the close time and the auto-fill. Bounded, so a
    // fill that keeps failing cannot lock the league: the sweep reports the failure.
    const graceEndsAt = closesAt.getTime() + BLOODSUCKER_AUTO_FILL_GRACE_MINUTES * 60 * 1000;
    if (
      actor.memberId === state.bloodsucker.memberId ||
      now.getTime() >= graceEndsAt ||
      (await hasBloodsuckerAutoFillRun(db, leagueId, state.bloodsucker.window))
    ) {
      return { open: true };
    }
    return {
      open: false,
      code: 'BLOODSUCKER_AUTO_FILL_PENDING',
      reason: BLOODSUCKER_AUTO_FILL_PENDING_MESSAGE,
    };
  }
  if (actor.memberId === state.bloodsucker.memberId) {
    return { open: true, bloodsuckerExclusive: true };
  }
  return {
    open: false,
    code: 'BLOODSUCKER_WINDOW_OPEN',
    reason: `The Bloodsucker has first pick of free agents until ${closeTimeFormat.format(closesAt)}. Adds, drops, waiver claims and trades open then.`,
    closesAt: closesAt.toISOString(),
  };
}

export function transactionsClosedResponse(
  window: Extract<TransactionWindow, { open: false }>
): NextResponse {
  return NextResponse.json(
    {
      error: window.reason,
      code: window.code,
      ...('closesAt' in window ? { closesAt: window.closesAt } : {}),
    },
    { status: 409 }
  );
}
