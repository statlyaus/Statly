'use client';

import { useEffect, useState } from 'react';

import { authenticatedFetch } from '@/lib/authenticatedFetch';

import type { BiteStatus } from './bloodsuckerDisplay';

export interface BloodsuckerSummaryView {
  leagueFormat: string;
  bloodsucker: { memberId: string; teamName: string } | null;
  record: { wins: number; losses: number; draws: number };
  bites: Array<{
    biteId: string;
    round: number;
    status: BiteStatus;
    victim: { memberId: string; teamName: string };
    takenPlayer: { id: string; name: string } | null;
    returnedPlayer: { id: string; name: string } | null;
    deadlineAt: string;
    executedAt: string | null;
  }>;
  viewer: { memberId: string; isBloodsucker: boolean };
}

/** BR-40: `GET /api/leagues/[id]/bloodsucker`, read only in a Bloodsucker league. */
export function useBloodsuckerSummary(leagueId: string, enabled: boolean, userId?: string) {
  const [summary, setSummary] = useState<BloodsuckerSummaryView | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void (async () => {
      try {
        const response = await authenticatedFetch(
          `/api/leagues/${encodeURIComponent(leagueId)}/bloodsucker`,
          { cache: 'no-store' },
          userId
        );
        if (!response.ok) throw new Error(String(response.status));
        const body = (await response.json()) as BloodsuckerSummaryView;
        if (active) setSummary(body);
      } catch {
        if (active) setFailed(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [enabled, leagueId, userId]);

  return { summary, failed };
}
