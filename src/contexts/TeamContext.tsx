'use client';

import { createContext, useContext } from 'react';
import { useTeamSwitcher } from '@/hooks/useTeamSwitcher';

/**
 * Context value returned by useTeamSwitcher hook
 *
 * @description Provides team switching functionality and state management
 * @property teams - Array of available teams/leagues for the current user
 * @property activeLeague - Currently selected league ID (nullable)
 * @property activeMember - Currently selected member ID (nullable)
 * @property switchTeam - Function to switch to a different team/league
 * @property loading - Boolean flag indicating if a team switch operation is in progress
 * @property error - Error state from team operations (nullable)
 *
 * @example
 * ```tsx
 * const { teams, switchTeam, loading } = useTeamContext();
 * ```
 */
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
