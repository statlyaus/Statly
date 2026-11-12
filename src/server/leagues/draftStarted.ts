import { DraftStatus, type Prisma } from '@prisma/client';

/** The draft fields that say whether a league's draft has started. */
export const DRAFT_STARTED_SELECT = {
  status: true,
  startedAt: true,
  lobbyStatus: true,
  _count: { select: { picks: true } },
} satisfies Prisma.DraftSelect;

export type DraftStartedFields = Prisma.DraftGetPayload<{ select: typeof DRAFT_STARTED_SELECT }>;

/**
 * The one test for "the draft has started", shared by member removal, joining and the settings
 * locks. A draft has started once it leaves SCHEDULED, starts, opens a live room or takes a pick.
 * Picks count on their own because rescheduling a LIVE draft puts it back to SCHEDULED with its
 * picks kept. A COUNTDOWN lobby is still forming (draft setup opens every lobby that way).
 */
export function hasDraftStarted(draft: DraftStartedFields | null | undefined): boolean {
  if (!draft) return false;
  return (
    draft.status !== DraftStatus.SCHEDULED ||
    draft.startedAt !== null ||
    draft.lobbyStatus === 'LIVE' ||
    draft._count.picks > 0
  );
}

/** Reads the league's draft and applies hasDraftStarted; false when the league has no draft. */
export async function readDraftStarted(
  client: Pick<Prisma.TransactionClient, 'draft'>,
  leagueId: string
): Promise<boolean> {
  const draft = await client.draft.findUnique({
    where: { leagueId },
    select: DRAFT_STARTED_SELECT,
  });
  return hasDraftStarted(draft);
}
