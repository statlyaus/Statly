'use client';

import { LeagueSocialShell } from './social';

export default function LeagueChat({
  leagueId,
  currentUserId,
}: {
  leagueId: string;
  currentUserId?: string;
}): React.JSX.Element {
  return (
    <LeagueSocialShell
      leagueId={leagueId}
      currentUserId={currentUserId}
      initialView="chat"
      title="League chat"
    />
  );
}
