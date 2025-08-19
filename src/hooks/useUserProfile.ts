/**
 * User Profile React Hook
 * Provides client-side state management for user profiles and league memberships
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import type { 
  UserProfile, 
  LeagueMembership, 
  LeagueSpecificSettings, 
  UserWatchlist
} from '@/services/userProfileService';
import { userProfileService } from '@/services/userProfileService';
import { logger } from '@/lib/logger';

export interface UseUserProfileReturn {
  // Profile state
  profile: UserProfile | null;
  leagues: LeagueMembership[];
  watchlists: UserWatchlist[];
  
  // Loading states
  loading: boolean;
  updating: boolean;
  error: string | null;
  
  // Actions
  updateProfile: (updates: Partial<UserProfile>) => Promise<void>;
  joinLeague: (params: {
    leagueId: string;
    memberName: string;
    leagueSettings?: Partial<LeagueSpecificSettings>;
    inviteCode?: string;
  }) => Promise<void>;
  updateLeagueSettings: (leagueId: string, settings: Partial<LeagueSpecificSettings>) => Promise<void>;
  updateWatchlist: (params: {
    leagueId?: string;
    watchlistId?: string;
    name: string;
    playerIds: string[];
    isDefault?: boolean;
    isDraftList?: boolean;
    priority?: number;
    tags?: string[];
    description?: string;
  }) => Promise<void>;
  reorderWatchlist: (watchlistId: string, playerIds: string[]) => Promise<void>;
  deleteWatchlist: (watchlistId: string) => Promise<void>;
  getDraftWatchlists: (leagueId: string) => Promise<UserWatchlist[]>;
  getNextDraftPlayer: (leagueId: string, excludePlayerIds?: string[]) => Promise<string | null>;
  leaveLeague: (leagueId: string) => Promise<void>;
  
  // Getters
  getLeague: (leagueId: string) => LeagueMembership | null;
  getLeagueSettings: (leagueId: string) => LeagueSpecificSettings | null;
  getWatchlist: (leagueId?: string) => UserWatchlist | null;
  
  // Filters
  filterLeagues: (filters: {
    status?: LeagueMembership['status'][];
    format?: LeagueSpecificSettings['format'][];
    role?: LeagueMembership['role'][];
  }) => LeagueMembership[];
  
  // Refresh
  refresh: () => Promise<void>;
}

export function useUserProfile(userId?: string): UseUserProfileReturn {
  // For now, we'll accept userId as a parameter instead of using useAuth
  // This can be modified when useAuth hook is available
  const currentUserId = userId;
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Memoized derived data
  const leagues = useMemo(() => profile?.leagueMemberships || [], [profile?.leagueMemberships]);
  const watchlists = useMemo(() => profile?.watchlists || [], [profile?.watchlists]);

  /**
   * Load user profile
   */
  const loadProfile = useCallback(async () => {
    if (!currentUserId) {
      setProfile(null);
      setLoading(false);
      return;
    }

    try {
      setError(null);
      logger.debug('Loading user profile', { userId: currentUserId });

      const userProfile = await userProfileService.getUserProfile(currentUserId);
      setProfile(userProfile);

      logger.info('User profile loaded successfully', { 
        userId: currentUserId,
        leagueCount: userProfile?.leagueMemberships.length || 0 
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load profile';
      setError(errorMessage);
      logger.error('Failed to load user profile', { userId: currentUserId, error: err });
    } finally {
      setLoading(false);
    }
  }, [currentUserId]);

  /**
   * Update user profile
   */
  const updateProfile = useCallback(async (updates: Partial<UserProfile>) => {
    if (!currentUserId) {
      throw new Error('User not authenticated');
    }

    setUpdating(true);
    setError(null);

    try {
      logger.info('Updating user profile', { 
        userId: currentUserId, 
        updateKeys: Object.keys(updates) 
      });

      const updatedProfile = await userProfileService.updateUserProfile(currentUserId, updates);
      setProfile(updatedProfile);

      logger.info('User profile updated successfully', { userId: currentUserId });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to update profile';
      setError(errorMessage);
      logger.error('Failed to update user profile', { userId: currentUserId, error: err });
      throw err;
    } finally {
      setUpdating(false);
    }
  }, [currentUserId]);

  /**
   * Join a league
   */
  const joinLeague = useCallback(async (params: {
    leagueId: string;
    memberName: string;
    leagueSettings?: Partial<LeagueSpecificSettings>;
    inviteCode?: string;
  }) => {
    if (!currentUserId) {
      throw new Error('User not authenticated');
    }

    setUpdating(true);
    setError(null);

    try {
      logger.info('Joining league', { 
        userId: currentUserId, 
        leagueId: params.leagueId,
        memberName: params.memberName 
      });

      const membership = await userProfileService.joinLeague({
        userId: currentUserId,
        ...params,
      });

      // Update local state
      setProfile(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          leagueMemberships: [...prev.leagueMemberships, membership],
          updatedAt: new Date(),
        };
      });

      logger.info('Successfully joined league', { 
        userId: currentUserId, 
        leagueId: params.leagueId,
        membershipId: membership.id 
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to join league';
      setError(errorMessage);
      logger.error('Failed to join league', { 
        userId: currentUserId, 
        leagueId: params.leagueId, 
        error: err 
      });
      throw err;
    } finally {
      setUpdating(false);
    }
  }, [currentUserId]);

  /**
   * Update league-specific settings
   */
  const updateLeagueSettings = useCallback(async (
    leagueId: string, 
    settings: Partial<LeagueSpecificSettings>
  ) => {
    if (!currentUserId) {
      throw new Error('User not authenticated');
    }

    setUpdating(true);
    setError(null);

    try {
      logger.info('Updating league settings', { 
        userId: currentUserId, 
        leagueId,
        settingKeys: Object.keys(settings) 
      });

      const updatedSettings = await userProfileService.updateLeagueSettings(
        currentUserId, 
        leagueId, 
        settings
      );

      // Update local state
      setProfile(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          leagueMemberships: prev.leagueMemberships.map(membership =>
            membership.leagueId === leagueId
              ? { ...membership, leagueSettings: updatedSettings }
              : membership
          ),
          updatedAt: new Date(),
        };
      });

      logger.info('League settings updated successfully', { 
        userId: currentUserId, 
        leagueId 
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to update league settings';
      setError(errorMessage);
      logger.error('Failed to update league settings', { 
        userId: currentUserId, 
        leagueId, 
        error: err 
      });
      throw err;
    } finally {
      setUpdating(false);
    }
  }, [currentUserId]);

  /**
   * Update watchlist
   */
  const updateWatchlist = useCallback(async (params: {
    leagueId?: string;
    watchlistId?: string;
    name: string;
    playerIds: string[];
    isDefault?: boolean;
    isDraftList?: boolean;
    priority?: number;
    tags?: string[];
    description?: string;
  }) => {
    if (!currentUserId) {
      throw new Error('User not authenticated');
    }

    setUpdating(true);
    setError(null);

    try {
      logger.info('Updating watchlist', { 
        userId: currentUserId, 
        leagueId: params.leagueId,
        watchlistId: params.watchlistId,
        playerCount: params.playerIds.length 
      });

      const updatedWatchlist = await userProfileService.updateWatchlist({
        userId: currentUserId,
        ...params,
      });

      // Update local state
      setProfile(prev => {
        if (!prev) return prev;
        
        const existingIndex = prev.watchlists.findIndex(w => w.id === updatedWatchlist.id);
        let newWatchlists: UserWatchlist[];
        
        if (existingIndex >= 0) {
          newWatchlists = [...prev.watchlists];
          newWatchlists[existingIndex] = updatedWatchlist;
        } else {
          newWatchlists = [...prev.watchlists, updatedWatchlist];
        }

        return {
          ...prev,
          watchlists: newWatchlists,
          updatedAt: new Date(),
        };
      });

      logger.info('Watchlist updated successfully', { 
        userId: currentUserId, 
        watchlistId: updatedWatchlist.id 
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to update watchlist';
      setError(errorMessage);
      logger.error('Failed to update watchlist', { 
        userId: currentUserId, 
        error: err 
      });
      throw err;
    } finally {
      setUpdating(false);
    }
  }, [currentUserId]);

  /**
   * Reorder watchlist players
   */
  const reorderWatchlist = useCallback(async (watchlistId: string, playerIds: string[]) => {
    if (!currentUserId) {
      throw new Error('User not authenticated');
    }

    setUpdating(true);
    setError(null);

    try {
      logger.info('Reordering watchlist', { 
        userId: currentUserId, 
        watchlistId,
        playerCount: playerIds.length 
      });

      const updatedWatchlist = await userProfileService.reorderWatchlist({
        userId: currentUserId,
        watchlistId,
        playerIds,
      });

      // Update local state
      setProfile(prev => {
        if (!prev) return prev;
        
        const existingIndex = prev.watchlists.findIndex(w => w.id === updatedWatchlist.id);
        if (existingIndex >= 0) {
          const newWatchlists = [...prev.watchlists];
          newWatchlists[existingIndex] = updatedWatchlist;

          return {
            ...prev,
            watchlists: newWatchlists,
            updatedAt: new Date(),
          };
        }
        return prev;
      });

      logger.info('Watchlist reordered successfully', { 
        userId: currentUserId, 
        watchlistId 
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to reorder watchlist';
      setError(errorMessage);
      logger.error('Failed to reorder watchlist', { 
        userId: currentUserId, 
        error: err 
      });
      throw err;
    } finally {
      setUpdating(false);
    }
  }, [currentUserId]);

  /**
   * Delete watchlist
   */
  const deleteWatchlist = useCallback(async (watchlistId: string) => {
    if (!currentUserId) {
      throw new Error('User not authenticated');
    }

    setUpdating(true);
    setError(null);

    try {
      logger.info('Deleting watchlist', { userId: currentUserId, watchlistId });

      await userProfileService.deleteWatchlist(currentUserId, watchlistId);

      // Update local state
      setProfile(prev => {
        if (!prev) return prev;
        
        return {
          ...prev,
          watchlists: prev.watchlists.filter(w => w.id !== watchlistId),
          updatedAt: new Date(),
        };
      });

      logger.info('Watchlist deleted successfully', { userId: currentUserId, watchlistId });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to delete watchlist';
      setError(errorMessage);
      logger.error('Failed to delete watchlist', { 
        userId: currentUserId, 
        error: err 
      });
      throw err;
    } finally {
      setUpdating(false);
    }
  }, [currentUserId]);

  /**
   * Get draft watchlists for a league
   */
  const getDraftWatchlists = useCallback(async (leagueId: string): Promise<UserWatchlist[]> => {
    if (!currentUserId) {
      throw new Error('User not authenticated');
    }

    try {
      logger.debug('Getting draft watchlists', { userId: currentUserId, leagueId });
      return await userProfileService.getDraftWatchlists(currentUserId, leagueId);
    } catch (err) {
      logger.error('Failed to get draft watchlists', { 
        userId: currentUserId, 
        leagueId, 
        error: err 
      });
      throw err;
    }
  }, [currentUserId]);

  /**
   * Get next draft player from watchlists
   */
  const getNextDraftPlayer = useCallback(async (
    leagueId: string, 
    excludePlayerIds: string[] = []
  ): Promise<string | null> => {
    if (!currentUserId) {
      throw new Error('User not authenticated');
    }

    try {
      logger.debug('Getting next draft player', { 
        userId: currentUserId, 
        leagueId, 
        excludeCount: excludePlayerIds.length 
      });
      
      return await userProfileService.getNextDraftPlayer(
        currentUserId, 
        leagueId, 
        excludePlayerIds
      );
    } catch (err) {
      logger.error('Failed to get next draft player', { 
        userId: currentUserId, 
        leagueId, 
        error: err 
      });
      throw err;
    }
  }, [currentUserId]);

  /**
   * Leave a league
   */
  const leaveLeague = useCallback(async (leagueId: string) => {
    if (!currentUserId) {
      throw new Error('User not authenticated');
    }

    setUpdating(true);
    setError(null);

    try {
      logger.info('Leaving league', { userId: currentUserId, leagueId });

      // Update local state immediately (optimistic update)
      setProfile(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          leagueMemberships: prev.leagueMemberships.filter(m => m.leagueId !== leagueId),
          updatedAt: new Date(),
        };
      });

      // TODO: Implement actual API call
      // await userProfileService.leaveLeague(currentUserId, leagueId);

      logger.info('Successfully left league', { userId: currentUserId, leagueId });
    } catch (err) {
      // Revert optimistic update on error
      await loadProfile();
      
      const errorMessage = err instanceof Error ? err.message : 'Failed to leave league';
      setError(errorMessage);
      logger.error('Failed to leave league', { userId: currentUserId, leagueId, error: err });
      throw err;
    } finally {
      setUpdating(false);
    }
  }, [currentUserId, loadProfile]);

  /**
   * Get specific league membership
   */
  const getLeague = useCallback((leagueId: string): LeagueMembership | null => {
    return leagues.find(league => league.leagueId === leagueId) || null;
  }, [leagues]);

  /**
   * Get league-specific settings
   */
  const getLeagueSettings = useCallback((leagueId: string): LeagueSpecificSettings | null => {
    const league = getLeague(leagueId);
    return league?.leagueSettings || null;
  }, [getLeague]);

  /**
   * Get watchlist for league or global
   */
  const getWatchlist = useCallback((leagueId?: string): UserWatchlist | null => {
    return watchlists.find(watchlist => watchlist.leagueId === leagueId) || null;
  }, [watchlists]);

  /**
   * Filter leagues by criteria
   */
  const filterLeagues = useCallback((filters: {
    status?: LeagueMembership['status'][];
    format?: LeagueSpecificSettings['format'][];
    role?: LeagueMembership['role'][];
  }): LeagueMembership[] => {
    let filtered = [...leagues];

    if (filters.status) {
      filtered = filtered.filter(league => filters.status!.includes(league.status));
    }

    if (filters.format) {
      filtered = filtered.filter(league => 
        filters.format!.includes(league.leagueSettings.format)
      );
    }

    if (filters.role) {
      filtered = filtered.filter(league => filters.role!.includes(league.role));
    }

    return filtered;
  }, [leagues]);

  /**
   * Refresh profile data
   */
  const refresh = useCallback(async () => {
    setLoading(true);
    await loadProfile();
  }, [loadProfile]);

  // Load profile on mount and user change
  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  return {
    // State
    profile,
    leagues,
    watchlists,
    loading,
    updating,
    error,
    
    // Actions
    updateProfile,
    joinLeague,
    updateLeagueSettings,
    updateWatchlist,
    reorderWatchlist,
    deleteWatchlist,
    leaveLeague,
    
    // Getters
    getLeague,
    getLeagueSettings,
    getWatchlist,
    getDraftWatchlists,
    getNextDraftPlayer,
    
    // Filters
    filterLeagues,
    
    // Refresh
    refresh,
  };
}

export default useUserProfile;
