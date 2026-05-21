'use client';

import React from 'react';

import LeagueWaiversContainer from '@/components/waivers/LeagueWaiversContainer';
import { isAuthBypassEnabled } from '@/lib/authBypass';

export default function WaiversClient({
  leagueId,
  initialClaims,
  initialSettings,
  availablePlayers,
  playersIndex,
  membersIndex,
  initialWaiverOrder,
  initialPlayersCursor,
}: {
  leagueId: string;
  initialClaims?: Array<{
    id: string;
    userId: string;
    teamId: string;
    playerId: string;
    dropPlayerId?: string;
    priority: number;
    status: 'PENDING' | 'SUCCESSFUL' | 'FAILED' | 'CANCELLED';
    createdAt: string;
    processedAt?: string;
    processingAt?: string;
  }>;
  initialSettings?: {
    waiverSettings?: {
      faabBudget?: number;
      minimumBid?: number;
      system?: string;
      processTime?: string;
      waiverPeriod?: number;
    };
  } | null;
  availablePlayers?: Array<{
    id: string;
    name: string;
    team?: string;
    position?: string;
    ownership?: number;
    avg?: number;
    statsSummary?: {
      disposals?: number;
      tackles?: number;
      marks?: number;
      goals?: number;
    };
  }>;
  playersIndex?: Record<
    string,
    {
      id: string;
      name: string;
      team?: string;
      position?: string;
      avg?: number;
      statsSummary?: {
        disposals?: number;
        tackles?: number;
        marks?: number;
        goals?: number;
      };
    }
  >;
  membersIndex?: Record<
    string,
    { userId: string; teamId?: string; teamName?: string; role?: string }
  >;
  initialWaiverOrder?: Array<{
    userId: string;
    teamId?: string;
    teamName?: string;
    currentPriority?: number;
    remainingFAAB?: number;
  }>;
  initialPlayersCursor?: string | null;
}) {
  const disableRealtime = isAuthBypassEnabled();

  return (
    <LeagueWaiversContainer
      leagueId={leagueId}
      disableRealtime={disableRealtime}
      initialClaims={initialClaims}
      initialSettings={initialSettings ?? undefined}
      availablePlayers={availablePlayers}
      playersIndex={playersIndex}
      membersIndex={membersIndex}
      initialWaiverOrder={initialWaiverOrder}
      initialPlayersCursor={initialPlayersCursor}
    />
  );
}
