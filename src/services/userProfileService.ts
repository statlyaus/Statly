/**
 * User Profile Management System
 * Handles user profiles with multiple league memberships and per-league settings
 */

import { logger } from '@/lib/logger';

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
  
  // Enhanced roster requirements
  rosterSettings: RosterSettings;
  
  // Draft configuration
  draftSettings: DraftSettings;
  
  // Scoring system configuration
  scoringFormat: ScoringFormat;
  
  // Waiver and trade rules
  waiverRules: WaiverRules;
  tradeDeadline: Date;
  
  // Lockout and scheduling rules
  lockoutSchedule: LockoutSchedule;
  
  // Legacy settings (maintained for compatibility)
  positionConfig: PositionConfiguration;
  scoringPreferences: ScoringPreferences;
  tradeSettings: TradeSettings;
  waiverSettings: WaiverSettings;
  notificationOverrides: NotificationOverrides;
  watchlist: string[]; // Player IDs specific to this league
  customRankings?: CustomRankings;
}

// Enhanced Roster Settings
export interface RosterSettings {
  totalRosterSize: number;
  startingLineup: StartingLineupRequirements;
  positionLimits: PositionLimits;
  benchSize: number;
  emergencySize: number;
  injuredReserveSlots: number;
  rookieSlots?: number; // For dynasty leagues
  taxiSquadSlots?: number; // For dynasty leagues
  customPositions: CustomPosition[];
}

export interface StartingLineupRequirements {
  DEF: number;
  MID: number;
  FWD: number;
  RUCK: number;
  FLEX?: number; // Flexible positions
  UTIL?: number; // Utility positions
  CAPTAIN: number; // Captain selections
  VICE_CAPTAIN: number; // Vice-captain selections
}

export interface PositionLimits {
  DEF: { min: number; max: number };
  MID: { min: number; max: number };
  FWD: { min: number; max: number };
  RUCK: { min: number; max: number };
  FLEX?: { min: number; max: number };
}

export interface CustomPosition {
  id: string;
  name: string;
  abbreviation: string;
  eligiblePositions: string[]; // Which base positions can fill this
  maxPlayers: number;
  required: boolean;
}

// Draft Settings
export interface DraftSettings {
  draftType: 'SNAKE' | 'LINEAR' | 'AUCTION' | 'SALARY_CAP';
  draftStyle: 'LIVE' | 'SLOW' | 'AUTO';
  totalRounds: number;
  pickTimeLimit: number; // seconds
  auctionSettings?: AuctionSettings;
  salaryCap?: SalaryCapSettings;
  draftOrder: DraftOrderSettings;
  autodraftSettings: AutodraftSettings;
}

export interface AuctionSettings {
  startingBudget: number;
  minimumBid: number;
  bidIncrement: number;
  nominationTimeLimit: number;
  biddingTimeLimit: number;
  maxPlayersPerTeam?: number;
}

export interface SalaryCapSettings {
  totalSalaryCap: number;
  minimumSalary: number;
  maximumSalary: number;
  contractLengths: boolean;
  salaryEscalation: number; // Percentage per year
}

export interface DraftOrderSettings {
  orderType: 'RANDOM' | 'LOTTERY' | 'REVERSE_STANDINGS' | 'CUSTOM';
  customOrder?: string[]; // User IDs in draft order
  lotteryWeights?: { [userId: string]: number };
}

export interface AutodraftSettings {
  enabled: boolean;
  useRankings: 'PLATFORM' | 'USER' | 'EXPERT';
  fillRosterBalance: boolean;
  avoidDuplicatePositions: boolean;
  prioritizeStarters: boolean;
}

// Scoring Format
export interface ScoringFormat {
  systemType: 'H2H_CATEGORIES' | 'H2H_POINTS' | 'ROTISSERIE' | 'POINTS_TOTAL';
  categories?: ScoringCategory[];
  pointsSystem?: PointsSystemSettings;
  rotisserieSettings?: RotisserieSettings;
  matchupSettings?: MatchupSettings;
}

export interface ScoringCategory {
  id: string;
  name: string;
  abbreviation: string;
  statType: 'COUNTING' | 'PERCENTAGE' | 'RATIO';
  weight: number;
  direction: 'HIGH_WINS' | 'LOW_WINS'; // For categories like turnovers
  includeInTotal: boolean;
}

export interface PointsSystemSettings {
  baseScoring: { [statName: string]: number };
  bonusRules: ScoringBonusRule[];
  penaltyRules: PenaltyRule[];
  captainMultiplier: number;
  viceCaptainMultiplier: number;
  emergencyScoring: boolean;
}

export interface RotisserieSettings {
  categories: string[];
  seasonLong: boolean;
  usePercentiles: boolean;
  tiebreakers: string[];
}

export interface MatchupSettings {
  seasonLength: number; // Number of weeks
  playoffWeeks: number;
  regularSeasonWeeks: number;
  playoffFormat: 'SINGLE_ELIMINATION' | 'BRACKET' | 'LADDER';
  playoffTeams: number;
  matchupPeriod: 'WEEKLY' | 'DAILY' | 'CUSTOM';
}

export interface ScoringBonusRule {
  id: string;
  name: string;
  description: string;
  statThreshold: number;
  bonusPoints: number;
  maxPerWeek?: number;
  positions?: string[]; // Which positions are eligible
}

export interface PenaltyRule {
  id: string;
  name: string;
  description: string;
  triggerCondition: string;
  penaltyPoints: number;
  positions?: string[];
}

// Waiver Rules
export interface WaiverRules {
  system: 'ROLLING_LIST' | 'FAAB' | 'PRIORITY_LIST' | 'FREE_AGENCY';
  processTime: 'DAILY' | 'TWICE_WEEKLY' | 'WEEKLY' | 'CONTINUOUS';
  waiverPeriod: number; // Hours after a player becomes available
  faubSettings?: FAUBSettings;
  claimSettings: ClaimSettings;
  dropSettings: DropSettings;
}

export interface FAUBSettings {
  startingBudget: number;
  minimumBid: number;
  tiebreaker: 'HIGHEST_BID' | 'WAIVER_PRIORITY' | 'RANDOM';
  budgetResets: boolean; // Whether budget resets each season
  allowZeroBids: boolean;
}

export interface ClaimSettings {
  maxClaimsPerWeek?: number;
  claimDeadline: string; // Time of day in league timezone
  retroactiveClaims: boolean; // Can claim players who already played
  blindBidding: boolean; // Hide other managers' bids
}

export interface DropSettings {
  cantDropList: string[]; // Player IDs that cannot be dropped
  dropDeadline?: string; // Time after which players cannot be dropped
  minimumOwnershipTime: number; // Hours a player must be owned before dropping
}

// Lockout Schedule
export interface LockoutSchedule {
  gameTimeLockout: boolean; // Lock players at their game time
  weeklyLockout: boolean; // Lock entire roster at start of week
  customLockouts: CustomLockout[];
  emergencyChanges: EmergencyChangeSettings;
  captainLockout: CaptainLockoutSettings;
}

export interface CustomLockout {
  round: number; // AFL round number
  lockoutTime: Date;
  affectedPositions?: string[]; // Empty means all positions
  reason?: string;
}

export interface EmergencyChangeSettings {
  allowEmergencyChanges: boolean;
  emergencyWindow: number; // Hours before game start
  maxEmergencyChanges: number; // Per round
  positions: string[]; // Which positions allow emergency changes
}

export interface CaptainLockoutSettings {
  captainLockoutTime: string; // Time before round starts
  allowCaptainChanges: boolean;
  viceCaptainPromotion: boolean; // Auto-promote VC if C doesn't play
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
  playerIds: string[]; // Ordered list - first = highest priority
  isDefault: boolean;
  isShared: boolean;
  isDraftList: boolean; // Can be used for auto-draft
  priority: number; // Higher number = higher priority for auto-selection
  tags: string[]; // Custom tags for organization
  lastUsedAt?: Date; // Track usage for auto-draft
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
      const defaultSettings: LeagueSpecificSettings = this.getDefaultLeagueSettings();
      defaultSettings.leagueId = leagueId;

      // Merge with provided league settings
      const finalSettings: LeagueSpecificSettings = {
        ...defaultSettings,
        ...leagueSettings,
        leagueId, // Ensure leagueId is always set correctly
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
        leagueSettings: finalSettings,
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
    isDraftList?: boolean;
    priority?: number;
    tags?: string[];
    description?: string;
  }): Promise<UserWatchlist> {
    const { 
      userId, 
      leagueId, 
      watchlistId, 
      name, 
      playerIds, 
      isDefault = false, 
      isDraftList = false, 
      priority = 0, 
      tags = [],
      description 
    } = params;

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
        description,
        playerIds: [...playerIds],
        isDefault,
        isShared: false,
        isDraftList,
        priority,
        tags,
        lastUsedAt: isDraftList ? new Date() : undefined,
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
   * Reorder players in a watchlist for priority ranking
   */
  async reorderWatchlist(params: {
    userId: string;
    watchlistId: string;
    playerIds: string[]; // New order
  }): Promise<UserWatchlist> {
    const { userId, watchlistId, playerIds } = params;

    try {
      logger.info('Reordering watchlist', { userId, watchlistId, playerCount: playerIds.length });

      const profile = await this.getUserProfile(userId);
      if (!profile) {
        throw new Error('User profile not found');
      }

      const watchlist = profile.watchlists.find(w => w.id === watchlistId);
      if (!watchlist) {
        throw new Error('Watchlist not found');
      }

      // Validate that all current players are included in the new order
      const currentPlayerIds = new Set(watchlist.playerIds);
      const newPlayerIds = new Set(playerIds);
      
      if (currentPlayerIds.size !== newPlayerIds.size || 
          !Array.from(currentPlayerIds).every(id => newPlayerIds.has(id))) {
        throw new Error('Player IDs do not match current watchlist');
      }

      const updatedWatchlist: UserWatchlist = {
        ...watchlist,
        playerIds: [...playerIds],
        updatedAt: new Date(),
      };

      await this.persistWatchlist(updatedWatchlist);

      // Update league settings if this is a league-specific watchlist
      if (watchlist.leagueId) {
        await this.updateLeagueSettings(userId, watchlist.leagueId, {
          watchlist: playerIds,
        });
      }

      logger.info('Watchlist reordered successfully', { userId, watchlistId });
      return updatedWatchlist;
    } catch (error) {
      logger.error('Failed to reorder watchlist', { userId, watchlistId, error });
      throw error;
    }
  }

  /**
   * Get draft-eligible watchlists for a league (ordered by priority)
   */
  async getDraftWatchlists(userId: string, leagueId: string): Promise<UserWatchlist[]> {
    try {
      logger.debug('Getting draft watchlists', { userId, leagueId });

      const profile = await this.getUserProfile(userId);
      if (!profile) {
        return [];
      }

      // Get both league-specific and global draft lists
      const draftLists = profile.watchlists.filter(w => 
        w.isDraftList && (w.leagueId === leagueId || !w.leagueId)
      );

      // Sort by priority (higher priority first), then by last used
      draftLists.sort((a, b) => {
        if (a.priority !== b.priority) {
          return b.priority - a.priority;
        }
        
        // If same priority, sort by last used (more recent first)
        const aLastUsed = a.lastUsedAt?.getTime() || 0;
        const bLastUsed = b.lastUsedAt?.getTime() || 0;
        return bLastUsed - aLastUsed;
      });

      logger.info('Draft watchlists retrieved', { 
        userId, 
        leagueId, 
        count: draftLists.length 
      });

      return draftLists;
    } catch (error) {
      logger.error('Failed to get draft watchlists', { userId, leagueId, error });
      throw error;
    }
  }

  /**
   * Get next player from draft watchlists for auto-draft
   */
  async getNextDraftPlayer(
    userId: string, 
    leagueId: string, 
    excludePlayerIds: string[] = []
  ): Promise<string | null> {
    try {
      logger.debug('Getting next draft player', { userId, leagueId, excludeCount: excludePlayerIds.length });

      const draftLists = await this.getDraftWatchlists(userId, leagueId);
      const excludeSet = new Set(excludePlayerIds);

      // Go through watchlists in priority order
      for (const watchlist of draftLists) {
        for (const playerId of watchlist.playerIds) {
          if (!excludeSet.has(playerId)) {
            // Mark watchlist as used
            const updatedWatchlist: UserWatchlist = {
              ...watchlist,
              lastUsedAt: new Date(),
              updatedAt: new Date(),
            };
            await this.persistWatchlist(updatedWatchlist);

            logger.info('Next draft player found', { 
              userId, 
              leagueId, 
              playerId, 
              watchlistId: watchlist.id 
            });

            return playerId;
          }
        }
      }

      logger.info('No draft player available', { userId, leagueId });
      return null;
    } catch (error) {
      logger.error('Failed to get next draft player', { userId, leagueId, error });
      throw error;
    }
  }

  /**
   * Delete a watchlist
   */
  async deleteWatchlist(userId: string, watchlistId: string): Promise<void> {
    try {
      logger.info('Deleting watchlist', { userId, watchlistId });

      const profile = await this.getUserProfile(userId);
      if (!profile) {
        throw new Error('User profile not found');
      }

      const watchlistIndex = profile.watchlists.findIndex(w => w.id === watchlistId);
      if (watchlistIndex === -1) {
        throw new Error('Watchlist not found');
      }

      const watchlist = profile.watchlists[watchlistIndex];
      
      // Remove from profile
      profile.watchlists.splice(watchlistIndex, 1);
      await this.persistProfileUpdates(userId, { watchlists: profile.watchlists });

      // Clear from league settings if applicable
      if (watchlist.leagueId) {
        await this.updateLeagueSettings(userId, watchlist.leagueId, {
          watchlist: [],
        });
      }

      logger.info('Watchlist deleted successfully', { userId, watchlistId });
    } catch (error) {
      logger.error('Failed to delete watchlist', { userId, watchlistId, error });
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
  private async buildUserProfile(_userId: string): Promise<UserProfile | null> {
    // This would typically query your database
    // Implement actual database queries here
    return null;
  }

  private async updateGlobalSettings(_userId: string, _settings: GlobalUserSettings): Promise<void> {
    // Implement database update
  }

  private async updatePreferences(_userId: string, _preferences: UserPreferences): Promise<void> {
    // Implement database update
  }

  private async persistProfileUpdates(_userId: string, _updates: Partial<UserProfile>): Promise<void> {
    // Implement database update
  }

  private async validateLeagueJoin(_leagueId: string, _inviteCode?: string): Promise<void> {
    // Implement league validation logic
  }

  private async getLeagueInfo(_leagueId: string): Promise<LeagueInfo> {
    // Implement league info retrieval
    throw new Error('Not implemented');
  }

  private async persistLeagueMembership(_membership: LeagueMembership): Promise<void> {
    // Implement database persistence
  }

  private async getLeagueMembership(_userId: string, _leagueId: string): Promise<LeagueMembership | null> {
    // Implement database query
    return null;
  }

  private async persistLeagueSettings(_userId: string, _leagueId: string, _settings: LeagueSpecificSettings): Promise<void> {
    // Implement database update
  }

  private async persistWatchlist(_watchlist: UserWatchlist): Promise<void> {
    // Implement database persistence
  }

  private async getWatchlistCreatedDate(_watchlistId: string): Promise<Date> {
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

  private aggregateStats(_statsArray: MembershipStats[]): MembershipStats {
    // Implement stats aggregation logic
    return this.getDefaultMembershipStats();
  }

  private calculateAchievements(_profile: UserProfile): string[] {
    // Implement achievement calculation logic
    return [];
  }

  private getDefaultLeagueSettings(): LeagueSpecificSettings {
    return {
      leagueId: '',
      format: 'CLASSIC',
      rosterSettings: this.getDefaultRosterSettings(),
      draftSettings: this.getDefaultDraftSettings(),
      scoringFormat: this.getDefaultScoringFormat(),
      waiverRules: this.getDefaultWaiverRules(),
      tradeDeadline: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000), // 6 months
      lockoutSchedule: this.getDefaultLockoutSchedule(),
      positionConfig: this.getDefaultPositionConfig(),
      scoringPreferences: this.getDefaultScoringPreferences(),
      tradeSettings: this.getDefaultTradeSettings(),
      waiverSettings: this.getDefaultWaiverSettings(),
      notificationOverrides: { leagueId: '', overrideGlobal: false },
      watchlist: [],
    };
  }

  private getDefaultRosterSettings(): RosterSettings {
    return {
      totalRosterSize: 30,
      startingLineup: {
        DEF: 6,
        MID: 8,
        FWD: 6,
        RUCK: 2,
        CAPTAIN: 1,
        VICE_CAPTAIN: 1,
      },
      positionLimits: {
        DEF: { min: 6, max: 10 },
        MID: { min: 8, max: 12 },
        FWD: { min: 6, max: 10 },
        RUCK: { min: 2, max: 4 },
      },
      benchSize: 4,
      emergencySize: 4,
      injuredReserveSlots: 0,
      customPositions: [],
    };
  }

  private getDefaultDraftSettings(): DraftSettings {
    return {
      draftType: 'SNAKE',
      draftStyle: 'LIVE',
      totalRounds: 30,
      pickTimeLimit: 90, // 90 seconds
      draftOrder: {
        orderType: 'RANDOM',
      },
      autodraftSettings: {
        enabled: true,
        useRankings: 'PLATFORM',
        fillRosterBalance: true,
        avoidDuplicatePositions: false,
        prioritizeStarters: true,
      },
    };
  }

  private getDefaultScoringFormat(): ScoringFormat {
    return {
      systemType: 'H2H_POINTS',
      pointsSystem: {
        baseScoring: {
          kicks: 3,
          handballs: 2,
          marks: 3,
          tackles: 4,
          goals: 6,
          behinds: 1,
          hitouts: 1,
          clangers: -2,
        },
        bonusRules: [],
        penaltyRules: [],
        captainMultiplier: 2,
        viceCaptainMultiplier: 1.5,
        emergencyScoring: true,
      },
      matchupSettings: {
        seasonLength: 23,
        playoffWeeks: 3,
        regularSeasonWeeks: 20,
        playoffFormat: 'BRACKET',
        playoffTeams: 6,
        matchupPeriod: 'WEEKLY',
      },
    };
  }

  private getDefaultWaiverRules(): WaiverRules {
    return {
      system: 'ROLLING_LIST',
      processTime: 'DAILY',
      waiverPeriod: 24, // 24 hours
      claimSettings: {
        claimDeadline: '03:00',
        retroactiveClaims: false,
        blindBidding: false,
      },
      dropSettings: {
        cantDropList: [],
        minimumOwnershipTime: 24, // 24 hours
      },
    };
  }

  private getDefaultLockoutSchedule(): LockoutSchedule {
    return {
      gameTimeLockout: true,
      weeklyLockout: false,
      customLockouts: [],
      emergencyChanges: {
        allowEmergencyChanges: true,
        emergencyWindow: 2, // 2 hours before game
        maxEmergencyChanges: 2,
        positions: ['DEF', 'MID', 'FWD', 'RUCK'],
      },
      captainLockout: {
        captainLockoutTime: '19:30', // 7:30 PM
        allowCaptainChanges: true,
        viceCaptainPromotion: true,
      },
    };
  }
}

// Export singleton instance
export const userProfileService = new UserProfileService();

export default UserProfileService;
