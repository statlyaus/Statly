/**
 * US-8 AC2 (BR-40): before lock, the Bloodsucker's opponent is told what losing costs. A finals
 * matchup grants no bite (BR-18), so it gets no warning.
 */
export function shouldWarnOfBloodsucker(input: {
  matchupStatus?: string;
  /** The round's own status: it locks at the first game, before scoring moves the matchup. */
  roundStatus?: string | null;
  phase?: string | null;
  homeMemberId?: string | null;
  awayMemberId?: string | null;
  bloodsuckerMemberId?: string | null;
  viewerMemberId?: string | null;
}): boolean {
  const { bloodsuckerMemberId: bloodsucker, viewerMemberId: viewer } = input;
  if (!bloodsucker || !viewer || viewer === bloodsucker) return false;
  if (input.matchupStatus !== 'SCHEDULED' || input.phase === 'FINALS') return false;
  if (input.roundStatus === 'LOCKED' || input.roundStatus === 'FINAL') return false;
  const sides = [input.homeMemberId, input.awayMemberId];
  return sides.includes(bloodsucker) && sides.includes(viewer);
}

export function BloodsuckerMatchupWarning({
  bloodsuckerTeamName,
}: {
  bloodsuckerTeamName: string;
}) {
  return (
    <div
      role="note"
      aria-label="Bloodsucker matchup"
      className="rounded-md border border-[color:var(--league-danger)] bg-[color:var(--league-danger-soft)] p-3 text-sm text-[color:var(--league-text)]"
    >
      <p className="font-semibold">You play the Bloodsucker, {bloodsuckerTeamName}, this round.</p>
      <p className="mt-1">
        If you lose, it takes one player from your roster and sends one of its players back to you.
        The player you get back goes into the same lineup slot as the player you lose. A draw costs
        you nothing.
      </p>
    </div>
  );
}
