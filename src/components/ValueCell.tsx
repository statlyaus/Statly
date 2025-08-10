'use client';

import RankingDisplay from './RankingDisplay';

export function ValueCell({ playerId }: { playerId: string }) {
  return <RankingDisplay playerId={playerId} variant="chip" />;
}

export default ValueCell;
