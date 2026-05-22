'use client';

import React from 'react';

import { RoundMatches } from '@/components/RoundMatches';

type MatchDTO = {
  id?: string;
  matchDate?: string | null;
  homeTeam: string;
  awayTeam: string;
  scoreHome: number | null;
  scoreAway: number | null;
  round: number;
};

export default function MatchesClient({
  round,
  initialMatches,
}: {
  round: number;
  initialMatches?: MatchDTO[];
}) {
  return <RoundMatches round={round} initialMatches={initialMatches} />;
}
