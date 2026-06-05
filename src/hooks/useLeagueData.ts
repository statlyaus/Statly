/**
 * League Data Hook
 * Provides real-time league-isolated data management with proper scoping
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  leagueDataService,
  type LeagueRoster,
  type LeagueMember,
  type LeagueDraftPick,
  type LeagueTrade,
  type LeagueWaiverClaim,
  type LeagueSettings,
  type LeagueTeamAction,
} from '@/services/leagueDataService';

export interface UseLeagueDataOptions {
  leagueId: string;
  userId?: string;
  autoSubscribe?: boolean;
}

export interface UseLeagueDataReturn {
  // Data state
  rosters: LeagueRoster[];
  userRoster: LeagueRoster | null;
  members: LeagueMember[];
  draftPicks: LeagueDraftPick[];
  trades: LeagueTrade[];
  waiverClaims: LeagueWaiverClaim[];
  teamActions: LeagueTeamAction[];
  userTeamActions: LeagueTeamAction[];
  settings: LeagueSettings | null;

  // Loading states
  loading: {
    rosters: boolean;
    members: boolean;
    draft: boolean;
    trades: boolean;
    waivers: boolean;
    teamActions: boolean;
    settings: boolean;
  };

  // Error states
  errors: {
    rosters: Error | null;
    members: Error | null;
    draft: Error | null;
    trades: Error | null;
    waivers: Error | null;
    teamActions: Error | null;
    settings: Error | null;
  };

  // Actions
  updateRoster: (teamId: string, updates: Partial<LeagueRoster>) => Promise<void>;
  updateMemberPreferences: (updates: Partial<LeagueMember>) => Promise<void>;
  submitWaiverClaim: (
    claim: Omit<LeagueWaiverClaim, 'id' | 'leagueId' | 'createdAt'>
  ) => Promise<string>;
  proposeTrade: (trade: Omit<LeagueTrade, 'id' | 'leagueId' | 'createdAt'>) => Promise<string>;

  // Subscription management
  subscribe: (collections: string[]) => void;
  unsubscribe: (collections?: string[]) => void;
  isSubscribed: (collection: string) => boolean;

  // Utility functions
  getUserTeam: (userId: string) => LeagueRoster | null;
  getTeamOwner: (teamId: string) => LeagueMember | null;
  getUserTrades: (userId: string) => LeagueTrade[];
  getUserWaivers: (userId: string) => LeagueWaiverClaim[];
  getDraftPicksForTeam: (teamId: string) => LeagueDraftPick[];
}

export function useLeagueData({
  leagueId,
  userId,
  autoSubscribe = true,
}: UseLeagueDataOptions): UseLeagueDataReturn {
  // Data states
  const [rosters, setRosters] = useState<LeagueRoster[]>([]);
  const [userRoster, setUserRoster] = useState<LeagueRoster | null>(null);
  const [members, setMembers] = useState<LeagueMember[]>([]);
  const [draftPicks, setDraftPicks] = useState<LeagueDraftPick[]>([]);
  const [trades, setTrades] = useState<LeagueTrade[]>([]);
  const [waiverClaims, setWaiverClaims] = useState<LeagueWaiverClaim[]>([]);
  const [teamActions, setTeamActions] = useState<LeagueTeamAction[]>([]);
  const [userTeamActions, setUserTeamActions] = useState<LeagueTeamAction[]>([]);
  const [_settings, _setSettings] = useState<LeagueSettings | null>(null);

  // Loading states
  const [loading, setLoading] = useState({
    rosters: false,
    members: false,
    draft: false,
    trades: false,
    waivers: false,
    teamActions: false,
    settings: false,
  });

  // Error states
  const [errors, setErrors] = useState<{
    rosters: Error | null;
    members: Error | null;
    draft: Error | null;
    trades: Error | null;
    waivers: Error | null;
    teamActions: Error | null;
    settings: Error | null;
  }>({
    rosters: null,
    members: null,
    draft: null,
    trades: null,
    waivers: null,
    teamActions: null,
    settings: null,
  });

  // Subscription tracking
  const subscriptionsRef = useRef<Set<string>>(new Set());
  const subscriptionKeysRef = useRef<Map<string, string>>(new Map());

  // Helper to update loading state
  const setLoadingState = useCallback((collection: string, isLoading: boolean) => {
    setLoading((prev) => ({ ...prev, [collection]: isLoading }));
  }, []);

  // Helper to update error state
  const setErrorState = useCallback((collection: string, error: Error | null) => {
    setErrors((prev) => ({ ...prev, [collection]: error }));
  }, []);

  // Subscribe to rosters
  const subscribeToRosters = useCallback(() => {
    if (subscriptionsRef.current.has('rosters')) return;

    setLoadingState('rosters', true);
    setErrorState('rosters', null);

    const subscriptionKey = leagueDataService.subscribeToLeagueRosters(
      leagueId,
      (rostersData) => {
        setRosters(rostersData);
        setLoadingState('rosters', false);
      },
      (error) => {
        setErrorState('rosters', error);
        setLoadingState('rosters', false);
      }
    );

    subscriptionsRef.current.add('rosters');
    subscriptionKeysRef.current.set('rosters', subscriptionKey);
  }, [leagueId, setLoadingState, setErrorState]);

  // Subscribe to user's roster
  const subscribeToUserRoster = useCallback(() => {
    if (!userId || subscriptionsRef.current.has('userRoster')) return;

    const subscriptionKey = leagueDataService.subscribeToUserRoster(
      leagueId,
      userId,
      (rosterData) => {
        setUserRoster(rosterData);
      },
      (error) => {
        console.error('Error in user roster subscription:', error);
      }
    );

    subscriptionsRef.current.add('userRoster');
    subscriptionKeysRef.current.set('userRoster', subscriptionKey);
  }, [leagueId, userId]);

  // Subscribe to members
  const subscribeToMembers = useCallback(() => {
    if (subscriptionsRef.current.has('members')) return;

    setLoadingState('members', true);
    setErrorState('members', null);

    const subscriptionKey = leagueDataService.subscribeToLeagueMembers(
      leagueId,
      (membersData: LeagueMember[]) => {
        setMembers(membersData);
        setLoadingState('members', false);
      },
      (error: Error) => {
        setErrorState('members', error);
        setLoadingState('members', false);
      }
    );

    subscriptionsRef.current.add('members');
    subscriptionKeysRef.current.set('members', subscriptionKey);
  }, [leagueId, setLoadingState, setErrorState]);

  // Subscribe to draft
  const subscribeToDraft = useCallback(() => {
    if (subscriptionsRef.current.has('draft')) return;

    setLoadingState('draft', true);
    setErrorState('draft', null);

    const subscriptionKey = leagueDataService.subscribeToLeagueDraft(
      leagueId,
      (picksData) => {
        setDraftPicks(picksData);
        setLoadingState('draft', false);
      },
      (error) => {
        setErrorState('draft', error);
        setLoadingState('draft', false);
      }
    );

    subscriptionsRef.current.add('draft');
    subscriptionKeysRef.current.set('draft', subscriptionKey);
  }, [leagueId, setLoadingState, setErrorState]);

  // Subscribe to trades
  const subscribeToTrades = useCallback(() => {
    if (subscriptionsRef.current.has('trades')) return;

    setLoadingState('trades', true);
    setErrorState('trades', null);

    const subscriptionKey = leagueDataService.subscribeToLeagueTrades(
      leagueId,
      (tradesData: LeagueTrade[]) => {
        setTrades(tradesData);
        setLoadingState('trades', false);
      },
      undefined, // All trades, not just user's
      (error) => {
        setErrorState('trades', error);
        setLoadingState('trades', false);
      }
    );

    subscriptionsRef.current.add('trades');
    subscriptionKeysRef.current.set('trades', subscriptionKey);
  }, [leagueId, setLoadingState, setErrorState]);

  // Subscribe to waivers
  const subscribeToWaivers = useCallback(() => {
    if (subscriptionsRef.current.has('waivers')) return;

    setLoadingState('waivers', true);
    setErrorState('waivers', null);

    const subscriptionKey = leagueDataService.subscribeToLeagueWaivers(
      leagueId,
      (waiversData: LeagueWaiverClaim[]) => {
        setWaiverClaims(waiversData);
        setLoadingState('waivers', false);
      },
      undefined, // All waiver claims, not just user's
      (error) => {
        setErrorState('waivers', error);
        setLoadingState('waivers', false);
      }
    );

    subscriptionsRef.current.add('waivers');
    subscriptionKeysRef.current.set('waivers', subscriptionKey);
  }, [leagueId, setLoadingState, setErrorState]);

  // Subscribe to team actions
  const subscribeToTeamActions = useCallback(() => {
    if (subscriptionsRef.current.has('teamActions')) return;

    setLoadingState('teamActions', true);
    setErrorState('teamActions', null);

    const subscriptionKey = leagueDataService.subscribeToLeagueTeamActions(
      leagueId,
      (actionsData: LeagueTeamAction[]) => {
        setTeamActions(actionsData);
        setLoadingState('teamActions', false);
      },
      undefined, // All team actions
      (error: Error) => {
        setErrorState('teamActions', error);
        setLoadingState('teamActions', false);
      }
    );

    subscriptionsRef.current.add('teamActions');
    subscriptionKeysRef.current.set('teamActions', subscriptionKey);
  }, [leagueId, setLoadingState, setErrorState]);

  // Subscribe to user's team actions
  const subscribeToUserTeamActions = useCallback(() => {
    if (!userId || subscriptionsRef.current.has('userTeamActions')) return;

    const subscriptionKey = leagueDataService.subscribeToLeagueTeamActions(
      leagueId,
      (actionsData: LeagueTeamAction[]) => {
        setUserTeamActions(actionsData);
      },
      userId, // Only user's actions
      (error: Error) => {
        console.error('Error in user team actions subscription:', error);
      }
    );

    subscriptionsRef.current.add('userTeamActions');
    subscriptionKeysRef.current.set('userTeamActions', subscriptionKey);
  }, [leagueId, userId]);

  // Action: Update roster
  const updateRoster = useCallback(
    async (teamId: string, updates: Partial<LeagueRoster>) => {
      try {
        await leagueDataService.updateRoster(leagueId, teamId, updates);
      } catch (error) {
        console.error('Failed to update roster:', error);
        throw error;
      }
    },
    [leagueId]
  );

  // Action: Update member preferences
  const updateMemberPreferences = useCallback(
    async (updates: Partial<LeagueMember>) => {
      if (!userId) {
        throw new Error('User ID required to update member preferences');
      }

      try {
        await leagueDataService.updateMemberPreferences(leagueId, userId, updates);
      } catch (error) {
        console.error('Failed to update member preferences:', error);
        throw error;
      }
    },
    [leagueId, userId]
  );

  // Action: Submit waiver claim
  const submitWaiverClaim = useCallback(
    async (claim: Omit<LeagueWaiverClaim, 'id' | 'leagueId' | 'createdAt'>): Promise<string> => {
      try {
        return await leagueDataService.submitWaiverClaim(leagueId, {
          ...claim,
          leagueId, // Add the leagueId back
        });
      } catch (error) {
        console.error('Failed to submit waiver claim:', error);
        throw error;
      }
    },
    [leagueId]
  );

  // Action: Propose trade
  const proposeTrade = useCallback(
    async (trade: Omit<LeagueTrade, 'id' | 'leagueId' | 'createdAt'>): Promise<string> => {
      try {
        return await leagueDataService.proposeTrade(leagueId, {
          ...trade,
          leagueId, // Add the leagueId back
        });
      } catch (error) {
        console.error('Failed to propose trade:', error);
        throw error;
      }
    },
    [leagueId]
  );

  // Subscription management
  const subscribe = useCallback(
    (collections: string[]) => {
      collections.forEach((collection) => {
        switch (collection) {
          case 'rosters':
            subscribeToRosters();
            break;
          case 'userRoster':
            subscribeToUserRoster();
            break;
          case 'members':
            subscribeToMembers();
            break;
          case 'draft':
            subscribeToDraft();
            break;
          case 'trades':
            subscribeToTrades();
            break;
          case 'waivers':
            subscribeToWaivers();
            break;
          case 'teamActions':
            subscribeToTeamActions();
            break;
          case 'userTeamActions':
            subscribeToUserTeamActions();
            break;
        }
      });
    },
    [
      subscribeToRosters,
      subscribeToUserRoster,
      subscribeToMembers,
      subscribeToDraft,
      subscribeToTrades,
      subscribeToWaivers,
      subscribeToTeamActions,
      subscribeToUserTeamActions,
    ]
  );

  const unsubscribe = useCallback((collections?: string[]) => {
    const collectionsToUnsubscribe = collections || Array.from(subscriptionsRef.current);

    collectionsToUnsubscribe.forEach((collection) => {
      const subscriptionKey = subscriptionKeysRef.current.get(collection);
      if (subscriptionKey) {
        leagueDataService.unsubscribe(subscriptionKey);
        subscriptionsRef.current.delete(collection);
        subscriptionKeysRef.current.delete(collection);
      }
    });
  }, []);

  const isSubscribed = useCallback((collection: string): boolean => {
    return subscriptionsRef.current.has(collection);
  }, []);

  // Utility functions
  const getUserTeam = useCallback(
    (targetUserId: string): LeagueRoster | null => {
      return rosters.find((roster) => roster.userId === targetUserId) || null;
    },
    [rosters]
  );

  const getTeamOwner = useCallback(
    (teamId: string): LeagueMember | null => {
      const roster = rosters.find((r) => r.id === teamId);
      if (!roster) return null;
      return members.find((member) => member.userId === roster.userId) || null;
    },
    [rosters, members]
  );

  const getUserTrades = useCallback(
    (targetUserId: string): LeagueTrade[] => {
      return trades.filter(
        (trade) => trade.fromUserId === targetUserId || trade.toUserId === targetUserId
      );
    },
    [trades]
  );

  const getUserWaivers = useCallback(
    (targetUserId: string): LeagueWaiverClaim[] => {
      return waiverClaims.filter((claim) => claim.userId === targetUserId);
    },
    [waiverClaims]
  );

  const getDraftPicksForTeam = useCallback(
    (teamId: string): LeagueDraftPick[] => {
      return draftPicks.filter((pick) => pick.teamId === teamId);
    },
    [draftPicks]
  );

  // Auto-subscribe on mount
  useEffect(() => {
    if (autoSubscribe) {
      const collections = ['rosters', 'members'];
      if (userId) {
        collections.push('userRoster');
      }
      subscribe(collections);
    }

    return () => {
      unsubscribe();
    };
  }, [leagueId, userId, autoSubscribe, subscribe, unsubscribe]);

  // Clean up on league change
  useEffect(() => {
    return () => {
      leagueDataService.unsubscribeFromLeague(leagueId);
    };
  }, [leagueId]);

  return {
    // Data
    rosters,
    userRoster,
    members,
    draftPicks,
    trades,
    waiverClaims,
    teamActions,
    userTeamActions,
    settings: _settings,

    // Loading states
    loading,

    // Error states
    errors,

    // Actions
    updateRoster,
    updateMemberPreferences,
    submitWaiverClaim,
    proposeTrade,

    // Subscription management
    subscribe,
    unsubscribe,
    isSubscribed,

    // Utility functions
    getUserTeam,
    getTeamOwner,
    getUserTrades,
    getUserWaivers,
    getDraftPicksForTeam,
  };
}

export default useLeagueData;
