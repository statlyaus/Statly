// src/app/tradecentre/RankingsContext.tsx
'use client';

import * as React from 'react';

export type RankingsMap = Map<string, { totalValue: number; rank: number }>;

const RankingsContext = React.createContext<RankingsMap | null>(null);

/** Hook to read rankings anywhere under the Trade Centre tree. */
export function useRankings(): RankingsMap {
  const ctx = React.useContext(RankingsContext);
  return ctx ?? new Map();
}

/** Provider to wrap Trade Centre sections that need rankings. */
export function RankingsProvider({
  value,
  children,
}: {
  value: RankingsMap;
  children: React.ReactNode;
}) {
  return <RankingsContext.Provider value={value}>{children}</RankingsContext.Provider>;
}