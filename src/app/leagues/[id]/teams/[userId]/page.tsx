import type React from 'react';

import TeamRosterClient from './TeamRosterClient';

export default async function TeamRosterPage({
  params,
}: {
  params: Promise<{ id: string; userId: string }>;
}): Promise<React.ReactElement> {
  const resolvedParams = await params;
  const leagueId = resolvedParams?.id ?? '';
  const userId = resolvedParams?.userId ?? '';

  return (
    <div className="px-6 py-6">
      <TeamRosterClient leagueId={leagueId} userId={userId} />
    </div>
  );
}
