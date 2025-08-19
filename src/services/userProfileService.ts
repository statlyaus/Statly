/**
 * User Profile Management System
 * Handles user profiles with multiple league memberships and per-league settings
 */

import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';

// Core User Profile Interfaces
export interface UserProfile {
  id: string;
  userId: string;
  displayName: string;
  email: string;
  avatar?: string;
  timezone: string;
  globalSettings: GlobalUserSettings;
  leagueMemberships: LeagueMembership[];
  watchlists: UserWatchlist[];
  preferences: UserPreferences;
  createdAt: Date;
  updatedAt: Date;
  lastActiveAt: Date;
}

export interface GlobalUserSettings {
  defaultFormat: 'CLASSIC' | 'DRAFT' | 'KEEPER' | 'DYNASTY';
  defaultScoringSystem: 'STANDARD' | 'PPR' | 'HALF_PPR' | 'CUSTOM';
  notifications: NotificationSettings;
  privacy: PrivacySettings;
  displayPreferences: DisplayPreferences;
}

export interface LeagueMembership {
  id: string;
  userId: string;
  leagueId: string;
  league: LeagueInfo;
  role: 'OWNER' | 'COMMISSIONER' | 'MEMBER';
  status: 'ACTIVE' | 'INVITED' | 'DECLINED' | 'REMOVED';
  memberName: string; // Display name in this specific league
  joinedAt: Date;
  lastActivityAt: Date;
  
  // League-specific settings
  leagueSettings: LeagueSpecificSettings;
  
  // Performance tracking
  stats: MembershipStats;
  
  // Team info if applicable
  team?: TeamInfo;
}

export interface LeagueSpecificSettings {
  leagueId: string;
  format: 'CLASSIC' | 'DRAFT' | 'KEEPER' | 'DYNASTY';
  positionConfig: PositionConfiguration;
  scoringPreferences: ScoringPreferences;
  tradeSettings: TradeSettings;
  waiverSettings: WaiverSettings;
  notificationOverrides: NotificationOverrides;
  watchlist: string[]; // Player IDs specific to this league
  customRankings?: CustomRankings;
}

export interface PositionConfiguration {
  maxRosters: number;
  startingLineup: {
    DEF: number;
    MID: number;
    FWD: number;
    RUCK: number;
    BENCH: number;
    EMERGENCY: number;
  };
  positionLimits: {
    [position: string]: {
      min: number;
      max: number;
    };
  };
  flexPositions: string[]; // Positions that can be flex
}

export interface ScoringPreferences {
  system: 'STANDARD' | 'PPR' | 'HALF_PPR' | 'CUSTOM';
  customScoring?: {
    [stat: string]: number;
  };
  bonusSettings: {
    milestoneBonus: boolean;
    weeklyBonus: boolean;
    customBonus: BonusRule[];
  };
}

export interface TradeSettings {
  allowTrades: boolean;
  tradeDeadline?: Date;
  reviewPeriod: number; // hours
  requireCommissionerApproval: boolean;
  allowFuturePicks: boolean;
  maxTradesPerWeek?: number;
}

export interface WaiverSettings {
  system: 'ROLLING' | 'FAAB' | 'PRIORITY';
  processTime: 'DAILY' | 'TWICE_WEEKLY' | 'WEEKLY';
  budget?: number; // For FAAB
  minimumBid?: number;
  tiebreaker: 'REVERSE_STANDINGS' | 'LOTTERY' | 'CUSTOM';
}

export interface NotificationSettings {
  email: {
    weeklyRecap: boolean;
    tradeOffers: boolean;
    waiverResults: boolean;
    lineupReminders: boolean;
    injuryAlerts: boolean;
    scoreUpdates: boolean;
  };
  push: {
    realTimeScores: boolean;
    tradeAlerts: boolean;
    draftReminders: boolean;
    lineupDeadlines: boolean;
    emergencyAlerts: boolean;
  };
  frequency: 'IMMEDIATE' | 'DAILY' | 'WEEKLY' | 'NEVER';
}

export interface NotificationOverrides {
  leagueId: string;
  overrideGlobal: boolean;
  customSettings?: Partial<NotificationSettings>;
}

export interface PrivacySettings {
  profileVisibility: 'PUBLIC' | 'FRIENDS' | 'LEAGUES_ONLY' | 'PRIVATE';
  showRealName: boolean;
  showEmail: boolean;
  showStats: boolean;
  allowMessages: 'EVERYONE' | 'FRIENDS' | 'LEAGUES' | 'NONE';
}

export interface DisplayPreferences {
  theme: 'LIGHT' | 'DARK' | 'AUTO';
  language: string;
  timezone: string;
  dateFormat: 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD';
  currency: 'AUD' | 'USD' | 'EUR' | 'GBP';
  compactMode: boolean;
  showAdvancedStats: boolean;
}

export interface UserWatchlist {
  id: string;
  userId: string;
  leagueId?: string; // null for global watchlist
  name: string;
  description?: string;
  playerIds: string[];
  isDefault: boolean;
  isShared: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserPreferences {
  favoriteTeams: string[]; // AFL team IDs
  preferredPositions: string[];
  riskTolerance: 'CONSERVATIVE' | 'MODERATE' | 'AGGRESSIVE';
  tradingStyle: 'ACTIVE' | 'PASSIVE' | 'STRATEGIC';
  analyticsLevel: 'BASIC' | 'INTERMEDIATE' | 'ADVANCED';
  autoSetLineup: boolean;
  emergencyLooping: boolean;
}

export interface MembershipStats {
  seasonsPlayed: number;
  totalPoints: number;
  averageRank: number;
  championshipsWon: number;
  playoffAppearances: number;
  bestFinish: number;
  worstFinish: number;
  totalTrades: number;
  totalWaiverClaims: number;
  averageWeeklyScore: number;
  winLossRecord: {
    wins: number;
    losses: number;
    draws: number;
  };
}

export interface TeamInfo {
  id: string;
  name: string;
  abbreviation: string;
  logo?: string;
  primaryColor: string;
  secondaryColor: string;
  motto?: string;
  roster: TeamRoster;
}

export interface TeamRoster {
  starters: RosterPlayer[];
  bench: RosterPlayer[];
  emergency: RosterPlayer[];
  injured: RosterPlayer[];
}

export interface RosterPlayer {
  playerId: string;
  position: string;
  acquisitionType: 'DRAFT' | 'WAIVER' | 'TRADE' | 'FREE_AGENT';
  acquisitionDate: Date;
  cost?: number; // Draft position or waiver cost
}

export interface LeagueInfo {
  id: string;
  name: string;
  description?: string;
  format: 'CLASSIC' | 'DRAFT' | 'KEEPER' | 'DYNASTY';
  size: number;
  status: 'DRAFT' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  seasonYear: number;
  startDate: Date;
  endDate: Date;
  commissioner: {
    userId: string;
    displayName: string;
  };
  settings: LeagueSettings;
  memberCount: number;
  isPublic: boolean;
  inviteCode?: string;
}

export interface LeagueSettings {
  scoringSystem: 'STANDARD' | 'PPR' | 'HALF_PPR' | 'CUSTOM';
  tradeDeadline: Date;
  playoffWeeks: number;
  regularSeasonWeeks: number;
  waiverType: 'ROLLING' | 'FAAB' | 'PRIORITY';
  maxTrades: number;
  allowKeepers: boolean;
  keeperCount?: number;
}

export interface CustomRankings {
  leagueId: string;
  userId: string;
  rankings: PlayerRanking[];
  tiers: RankingTier[];
  lastUpdated: Date;
  isShared: boolean;
}

export interface PlayerRanking {
  playerId: string;
  rank: number;
  tier: number;
  notes?: string;
  projectedPoints: number;
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
}

export interface RankingTier {
  tier: number;
  name: string;
  description: string;
  color: string;
  playerCount: number;
}

export interface BonusRule {
  id: string;
  name: string;
  description: string;
  condition: string; // e.g., "goals >= 3"
  points: number;
  maxPerGame?: number;
}

export class UserProfileService {
  /**
   * Get complete user profile with all league memberships
   */
  async getUserProfile(userId: string): Promise<UserProfile | null> {
    try {
      logger.debug('Fetching user profile', { userId });

      // This would typically query your database
      // For now, returning a structured response
      const profile = await this.buildUserProfile(userId);
      
      if (!profile) {
        logger.warn('User profile not found', { userId });
        return null;
      }

      logger.info('User profile retrieved successfully', { 
        userId, 
        leagueCount: profile.leagueMemberships.length,
        watchlistCount: profile.watchlists.length 
      });

      return profile;
    } catch (error) {
      logger.error('Failed to get user profile', { userId, error });
      throw error;
    }
  }

  /**
   * Create or update user profile
   */
  async updateUserProfile(
    userId: string, 
    updates: Partial<UserProfile>
  ): Promise<UserProfile> {
    try {
      logger.info('Updating user profile', { userId, updateKeys: Object.keys(updates) });

      // Update global settings
      if (updates.globalSettings) {
        await this.updateGlobalSettings(userId, updates.globalSettings);
      }

      // Update preferences
      if (updates.preferences) {
        await this.updatePreferences(userId, updates.preferences);
      }

      // Update basic profile info
      const basicUpdates = {
        displayName: updates.displayName,
        avatar: updates.avatar,
        timezone: updates.timezone,
        updatedAt: new Date(),
      };

      await this.persistProfileUpdates(userId, basicUpdates);

      // Return updated profile
      return await this.getUserProfile(userId) as UserProfile;
    } catch (error) {
      logger.error('Failed to update user profile', { userId, error });
      throw error;
    }
  }

  /**
   * Join a league with specific settings
   */
  async joinLeague(params: {
    userId: string;
    leagueId: string;
    memberName: string;
    leagueSettings?: Partial<LeagueSpecificSettings>;
    inviteCode?: string;
  }): Promise<LeagueMembership> {
    const { userId, leagueId, memberName, leagueSettings, inviteCode } = params;

    try {
      logger.info('User joining league', { userId, leagueId, memberName });

      // Validate league and invitation
      await this.validateLeagueJoin(leagueId, inviteCode);

      // Create default league settings
      const defaultSettings: LeagueSpecificSettings = {
        leagueId,
        format: 'CLASSIC',
        positionConfig: this.getDefaultPositionConfig(),
        scoringPreferences: this.getDefaultScoringPreferences(),
        tradeSettings: this.getDefaultTradeSettings(),
        waiverSettings: this.getDefaultWaiverSettings(),
        notificationOverrides: { leagueId, overrideGlobal: false },
        watchlist: [],
        ...leagueSettings,
      };

      // Create membership
      const membership: LeagueMembership = {
        id: `membership-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        userId,
        leagueId,
        league: await this.getLeagueInfo(leagueId),
        role: 'MEMBER',
        status: 'ACTIVE',
        memberName,
        joinedAt: new Date(),
        lastActivityAt: new Date(),
        leagueSettings: defaultSettings,
        stats: this.getDefaultMembershipStats(),
      };

      await this.persistLeagueMembership(membership);

      logger.info('User successfully joined league', { 
        userId, 
        leagueId, 
        membershipId: membership.id 
      });

      return membership;
    } catch (error) {
      logger.error('Failed to join league', { userId, leagueId, error });
      throw error;
    }
  }

  /**
   * Update league-specific settings for a user
   */
  async updateLeagueSettings(
    userId: string,
    leagueId: string,
    settings: Partial<LeagueSpecificSettings>
  ): Promise<LeagueSpecificSettings> {
    try {
      logger.info('Updating league settings', { userId, leagueId, settingKeys: Object.keys(settings) });

      const membership = await this.getLeagueMembership(userId, leagueId);
      if (!membership) {
        throw new Error(`User ${userId} is not a member of league ${leagueId}`);
      }

      // Merge settings
      const updatedSettings: LeagueSpecificSettings = {
        ...membership.leagueSettings,
        ...settings,
        leagueId, // Ensure leagueId is preserved
      };

      await this.persistLeagueSettings(userId, leagueId, updatedSettings);

      logger.info('League settings updated successfully', { userId, leagueId });

      return updatedSettings;
    } catch (error) {
      logger.error('Failed to update league settings', { userId, leagueId, error });
      throw error;
    }
  }

  /**
   * Manage user watchlists (global or league-specific)
   */
  async updateWatchlist(params: {
    userId: string;
    leagueId?: string;
    watchlistId?: string;
    name: string;
    playerIds: string[];
    isDefault?: boolean;
  }): Promise<UserWatchlist> {
    const { userId, leagueId, watchlistId, name, playerIds, isDefault = false } = params;

    try {
      logger.info('Updating watchlist', { 
        userId, 
        leagueId, 
        watchlistId, 
        playerCount: playerIds.length 
      });

      const watchlist: UserWatchlist = {
        id: watchlistId || `watchlist-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        userId,
        leagueId,
        name,
        playerIds: [...playerIds],
        isDefault,
        isShared: false,
        createdAt: watchlistId ? await this.getWatchlistCreatedDate(watchlistId) : new Date(),
        updatedAt: new Date(),
      };

      await this.persistWatchlist(watchlist);

      // If this is a league-specific watchlist, also update the league settings
      if (leagueId) {
        await this.updateLeagueSettings(userId, leagueId, {
          watchlist: playerIds,
        });
      }

      logger.info('Watchlist updated successfully', { 
        userId, 
        leagueId, 
        watchlistId: watchlist.id 
      });

      return watchlist;
    } catch (error) {
      logger.error('Failed to update watchlist', { userId, leagueId, error });
      throw error;
    }
  }

  /**
   * Get user's leagues with filtering and sorting
   */
  async getUserLeagues(
    userId: string,
    filters?: {
      status?: LeagueMembership['status'][];
      format?: LeagueSpecificSettings['format'][];
      role?: LeagueMembership['role'][];
    }
  ): Promise<LeagueMembership[]> {
    try {
      logger.debug('Fetching user leagues', { userId, filters });

      const profile = await this.getUserProfile(userId);
      if (!profile) {
        return [];
      }

      let leagues = profile.leagueMemberships;

      // Apply filters
      if (filters?.status) {
        leagues = leagues.filter(l => filters.status!.includes(l.status));
      }

      if (filters?.format) {
        leagues = leagues.filter(l => filters.format!.includes(l.leagueSettings.format));
      }

      if (filters?.role) {
        leagues = leagues.filter(l => filters.role!.includes(l.role));
      }

      // Sort by last activity
      leagues.sort((a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime());

      logger.info('User leagues retrieved', { 
        userId, 
        totalCount: profile.leagueMemberships.length,
        filteredCount: leagues.length 
      });

      return leagues;
    } catch (error) {
      logger.error('Failed to get user leagues', { userId, error });
      throw error;
    }
  }

  /**
   * Get aggregated user statistics across all leagues
   */
  async getUserStats(userId: string): Promise<{
    overall: MembershipStats;
    byLeague: Array<{
      leagueId: string;
      leagueName: string;
      stats: MembershipStats;
    }>;
    achievements: string[];
  }> {
    try {
      logger.debug('Calculating user stats', { userId });

      const profile = await this.getUserProfile(userId);
      if (!profile) {
        throw new Error('User profile not found');
      }

      // Aggregate stats across all leagues
      const overall = this.aggregateStats(profile.leagueMemberships.map(m => m.stats));

      // Per-league stats
      const byLeague = profile.leagueMemberships.map(membership => ({
        leagueId: membership.leagueId,
        leagueName: membership.league.name,
        stats: membership.stats,
      }));

      // Calculate achievements
      const achievements = this.calculateAchievements(profile);

      logger.info('User stats calculated', { 
        userId, 
        leagueCount: byLeague.length,
        achievementCount: achievements.length 
      });

      return {
        overall,
        byLeague,
        achievements,
      };
    } catch (error) {
      logger.error('Failed to get user stats', { userId, error });
      throw error;
    }
  }

  // Private helper methods
  private async buildUserProfile(userId: string): Promise<UserProfile | null> {
    // This would typically query your database
    // Implement actual database queries here
    return null;
  }

  private async updateGlobalSettings(userId: string, settings: GlobalUserSettings): Promise<void> {
    // Implement database update
  }

  private async updatePreferences(userId: string, preferences: UserPreferences): Promise<void> {
    // Implement database update
  }

  private async persistProfileUpdates(userId: string, updates: any): Promise<void> {
    // Implement database update
  }

  private async validateLeagueJoin(leagueId: string, inviteCode?: string): Promise<void> {
    // Implement league validation logic
  }

  private async getLeagueInfo(leagueId: string): Promise<LeagueInfo> {
    // Implement league info retrieval
    throw new Error('Not implemented');
  }

  private async persistLeagueMembership(membership: LeagueMembership): Promise<void> {
    // Implement database persistence
  }

  private async getLeagueMembership(userId: string, leagueId: string): Promise<LeagueMembership | null> {
    // Implement database query
    return null;
  }

  private async persistLeagueSettings(userId: string, leagueId: string, settings: LeagueSpecificSettings): Promise<void> {
    // Implement database update
  }

  private async persistWatchlist(watchlist: UserWatchlist): Promise<void> {
    // Implement database persistence
  }

  private async getWatchlistCreatedDate(watchlistId: string): Promise<Date> {
    // Implement database query
    return new Date();
  }

  private getDefaultPositionConfig(): PositionConfiguration {
    return {
      maxRosters: 30,
      startingLineup: {
        DEF: 6,
        MID: 8,
        FWD: 6,
        RUCK: 2,
        BENCH: 4,
        EMERGENCY: 4,
      },
      positionLimits: {
        DEF: { min: 6, max: 10 },
        MID: { min: 8, max: 12 },
        FWD: { min: 6, max: 10 },
        RUCK: { min: 2, max: 4 },
      },
      flexPositions: ['MID/FWD', 'DEF/MID'],
    };
  }

  private getDefaultScoringPreferences(): ScoringPreferences {
    return {
      system: 'STANDARD',
      bonusSettings: {
        milestoneBonus: true,
        weeklyBonus: false,
        customBonus: [],
      },
    };
  }

  private getDefaultTradeSettings(): TradeSettings {
    return {
      allowTrades: true,
      reviewPeriod: 24,
      requireCommissionerApproval: false,
      allowFuturePicks: false,
    };
  }

  private getDefaultWaiverSettings(): WaiverSettings {
    return {
      system: 'ROLLING',
      processTime: 'DAILY',
      tiebreaker: 'REVERSE_STANDINGS',
    };
  }

  private getDefaultMembershipStats(): MembershipStats {
    return {
      seasonsPlayed: 0,
      totalPoints: 0,
      averageRank: 0,
      championshipsWon: 0,
      playoffAppearances: 0,
      bestFinish: 0,
      worstFinish: 0,
      totalTrades: 0,
      totalWaiverClaims: 0,
      averageWeeklyScore: 0,
      winLossRecord: {
        wins: 0,
        losses: 0,
        draws: 0,
      },
    };
  }

  private aggregateStats(statsArray: MembershipStats[]): MembershipStats {
    // Implement stats aggregation logic
    return this.getDefaultMembershipStats();
  }

  private calculateAchievements(profile: UserProfile): string[] {
    // Implement achievement calculation logic
    return [];
  }
}

// Export singleton instance
export const userProfileService = new UserProfileService();

export default UserProfileService;
