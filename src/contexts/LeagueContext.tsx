/**
 * League Context Provider for shared state and data
 * Centralizes league data, user permissions, and common actions
 */

import React, { createContext, useContext, useReducer, useEffect } from 'react';

import { fetchApi } from '@/lib/api';
import type { League, LeagueMember } from '@/types/leagues';
import { isConnectivityError, getConnectivityErrorMessage } from '@/utils/errorHandling';

interface LeagueContextState {
  league: League | null;
  members: LeagueMember[];
  currentUser: LeagueMember | null;
  permissions: UserPermissions;
  loading: boolean;
  error: string | null;
}

interface UserPermissions {
  canEdit: boolean;
  canManageMembers: boolean;
  canCreateDraft: boolean;
  isOwner: boolean;
}

interface LeagueContextActions {
  updateLeague: (updates: Partial<League>) => Promise<boolean>;
  updateMember: (memberId: string, updates: Partial<LeagueMember>) => Promise<boolean>;
  refreshData: () => Promise<void>;
  clearError: () => void;
}

type LeagueAction =
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'SET_LEAGUE'; payload: League }
  | { type: 'SET_MEMBERS'; payload: LeagueMember[] }
  | { type: 'UPDATE_MEMBER'; payload: { id: string; updates: Partial<LeagueMember> } };

const leagueReducer = (state: LeagueContextState, action: LeagueAction): LeagueContextState => {
  switch (action.type) {
    case 'SET_LOADING':
      return { ...state, loading: action.payload };
    case 'SET_ERROR':
      return { ...state, error: action.payload, loading: false };
    case 'SET_LEAGUE':
      return { ...state, league: action.payload };
    case 'SET_MEMBERS': {
      const currentUser =
        action.payload.find((m) => m.userId === state.currentUser?.userId) || null;
      const permissions = calculatePermissions(currentUser, state.league);
      return { ...state, members: action.payload, currentUser, permissions };
    }
    case 'UPDATE_MEMBER': {
      const updatedMembers = state.members.map((m) =>
        m.id === action.payload.id ? { ...m, ...action.payload.updates } : m
      );
      return { ...state, members: updatedMembers };
    }
    default:
      return state;
  }
};

const calculatePermissions = (
  user: LeagueMember | null,
  league: League | null
): UserPermissions => {
  if (!user || !league) {
    return { canEdit: false, canManageMembers: false, canCreateDraft: false, isOwner: false };
  }

  const isOwner = user.userId === league.ownerId;
  return {
    isOwner,
    canEdit: isOwner || user.role === 'manager',
    canManageMembers: isOwner,
    canCreateDraft: isOwner && league.status === 'preseason',
  };
};

const LeagueContext = createContext<(LeagueContextState & LeagueContextActions) | null>(null);

export const useLeagueContext = () => {
  const context = useContext(LeagueContext);
  if (!context) {
    throw new Error('useLeagueContext must be used within a LeagueProvider');
  }
  return context;
};

// src/contexts/LeagueContext.tsx

interface LeagueProviderProps {
  leagueId: string;
  // currentUserId was removed because it's not used in this component
  children: React.ReactNode;
}

export const LeagueProvider: React.FC<LeagueProviderProps> = ({ leagueId, children }) => {
  // …
  const [state, dispatch] = useReducer(leagueReducer, {
    league: null,
    members: [],
    currentUser: null,
    permissions: { canEdit: false, canManageMembers: false, canCreateDraft: false, isOwner: false },
    loading: true,
    error: null,
  });

  const refreshData = async () => {
    try {
      dispatch({ type: 'SET_LOADING', payload: true });
      dispatch({ type: 'SET_ERROR', payload: null });

      const [leagueResponse, membersResponse] = await Promise.all([
        fetchApi(`leagues/${leagueId}`),
        fetchApi(`leagues/${leagueId}/members`),
      ]);

      if (leagueResponse.success) {
        dispatch({ type: 'SET_LEAGUE', payload: leagueResponse.data });
      }

      if (membersResponse.success) {
        dispatch({ type: 'SET_MEMBERS', payload: membersResponse.data });
      }
    } catch (error) {
      if (error instanceof Error && isConnectivityError(error)) {
        dispatch({ type: 'SET_ERROR', payload: getConnectivityErrorMessage() });
      } else {
        dispatch({ type: 'SET_ERROR', payload: 'Failed to load league data' });
      }
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  };

  const updateLeague = async (updates: Partial<League>) => {
    try {
      dispatch({ type: 'SET_ERROR', payload: null });

      const response = await fetchApi(`leagues/${leagueId}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
      });

      if (response.success) {
        dispatch({ type: 'SET_LEAGUE', payload: response.data });
        return true;
      } else {
        dispatch({ type: 'SET_ERROR', payload: 'Failed to update league' });
        return false;
      }
    } catch (error) {
      if (error instanceof Error && isConnectivityError(error)) {
        dispatch({ type: 'SET_ERROR', payload: getConnectivityErrorMessage() });
      } else {
        dispatch({ type: 'SET_ERROR', payload: 'Failed to update league' });
      }
      return false;
    }
  };

  const updateMember = async (memberId: string, updates: Partial<LeagueMember>) => {
    try {
      dispatch({ type: 'SET_ERROR', payload: null });

      const response = await fetchApi(`leagues/${leagueId}/members/${memberId}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
      });

      if (response.success) {
        dispatch({ type: 'UPDATE_MEMBER', payload: { id: memberId, updates } });
        return true;
      } else {
        dispatch({ type: 'SET_ERROR', payload: 'Failed to update member' });
        return false;
      }
    } catch (error) {
      if (error instanceof Error && isConnectivityError(error)) {
        dispatch({ type: 'SET_ERROR', payload: getConnectivityErrorMessage() });
      } else {
        dispatch({ type: 'SET_ERROR', payload: 'Failed to update member' });
      }
      return false;
    }
  };

  const clearError = () => {
    dispatch({ type: 'SET_ERROR', payload: null });
  };

  useEffect(() => {
    refreshData();
  }, [leagueId]);

  const contextValue = {
    ...state,
    updateLeague,
    updateMember,
    refreshData,
    clearError,
  };

  return <LeagueContext.Provider value={contextValue}>{children}</LeagueContext.Provider>;
};
