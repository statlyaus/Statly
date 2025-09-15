'use client';

import React from 'react';

import LeagueWaiversContainer from '@/components/waivers/LeagueWaiversContainer';

export default function WaiversClient({
  leagueId,
  initialClaims,
  initialSettings,
  availablePlayers,
  playersIndex,
  membersIndex,
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
  initialSettings?: { waiverSettings?: { faabBudget?: number } } | null;
  availablePlayers?: Array<{ id: string; name: string; team?: string; position?: string; ownership?: number }>;
  playersIndex?: Record<string, { id: string; name: string; team?: string; position?: string }>;
  membersIndex?: Record<string, { userId: string; teamId?: string; teamName?: string }>;
  initialPlayersCursor?: string | null;
}) {
  return (
    <LeagueWaiversContainer
      leagueId={leagueId}
      initialClaims={initialClaims}
      initialSettings={initialSettings ?? undefined}
      availablePlayers={availablePlayers}
      playersIndex={playersIndex}
      membersIndex={membersIndex}
      initialPlayersCursor={initialPlayersCursor}
    />
  );
}

