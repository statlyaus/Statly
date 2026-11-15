'use client';

import { useEffect, useState } from 'react';

import { authenticatedFetch } from '@/lib/authenticatedFetch';
import type { BiteCommissionerAction } from '@/server/leagues/biteCommissionerActions';

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
    commissionerActions: BiteCommissionerAction[];
  }>;
  viewer: { memberId: string; isBloodsucker: boolean; isCommissioner: boolean };
}

/** How often an open league page re-reads the summary. Polling only: Netlify has no Socket.IO (NFR-7). */
export const BLOODSUCKER_SUMMARY_REFRESH_MS = 60_000;

/**
 * BR-40: `GET /api/leagues/[id]/bloodsucker`, read only in a Bloodsucker league. A bite is granted
 * by the scoring job, not by anything the viewer does, so the summary is re-read when the window
 * gains focus or becomes visible, every minute while it is visible, and when `refreshKey` changes
 * (the league tab). A failed refresh keeps the last summary and reports `failed`.
 */
export function useBloodsuckerSummary(
  leagueId: string,
  enabled: boolean,
  userId?: string,
  refreshKey?: string
) {
  const [summary, setSummary] = useState<BloodsuckerSummaryView | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let latest = 0;
    const load = async () => {
      const request = (latest += 1);
      try {
        const response = await authenticatedFetch(
          `/api/leagues/${encodeURIComponent(leagueId)}/bloodsucker`,
          { cache: 'no-store' },
          userId
        );
        if (!response.ok) throw new Error(String(response.status));
        const body = (await response.json()) as BloodsuckerSummaryView;
        if (!active || request !== latest) return;
        setSummary(body);
        setFailed(false);
      } catch {
        if (active && request === latest) setFailed(true);
      }
    };
    const refreshIfVisible = () => {
      if (document.visibilityState !== 'hidden') void load();
    };

    void load();
    const timer = window.setInterval(refreshIfVisible, BLOODSUCKER_SUMMARY_REFRESH_MS);
    window.addEventListener('focus', refreshIfVisible);
    document.addEventListener('visibilitychange', refreshIfVisible);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshIfVisible);
      document.removeEventListener('visibilitychange', refreshIfVisible);
    };
  }, [enabled, leagueId, userId, refreshKey]);

  return { summary, failed };
}
