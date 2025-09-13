'use client';

import React from 'react';
import { createContext, useContext } from 'react';

import { useTeamSwitcher } from '@/hooks/useTeamSwitcher';

type TeamContextValue = ReturnType<typeof useTeamSwitcher>;

const TeamContext = createContext<TeamContextValue | null>(null);
TeamContext.displayName = 'TeamContext';

export function TeamProvider({ children }: { children: React.ReactNode }) {
  const value = useTeamSwitcher();
  return <TeamContext.Provider value={value}>{children}</TeamContext.Provider>;
}

export function useTeamContext(): TeamContextValue {
  const ctx = useContext(TeamContext);
  if (!ctx) throw new Error('useTeamContext must be used within a TeamProvider');
  return ctx;
}
