/**
 * League-Isolated Data Flow & Sync Service
 * Ensures all dynamic state is properly scoped to leagues with real-time synchronization
 */

import { 
  collection, 
  doc, 
  onSnapshot, 
  updateDoc, 
  addDoc, 
  query, 
  where, 
  orderBy, 
  Timestamp,
  type DocumentReference,
  type CollectionReference,
  type Unsubscribe
} from 'firebase/firestore';
import { db } from '@/lib/firebaseClient';

// League-Isolated Entity Interfaces
export interface LeagueRoster {
  id: string;
  userId: string;
  teamName: string;
  playerIds: string[];
  bench: string[];
  captain?: string;
  viceCaptain?: string;
  emergencies: string[];
  leagueId: string; // Redundant for indexing
  updatedAt: Date;
  createdAt: Date;
}

export interface LeagueMember {
  id: string;
  userId: string;
  leagueId: string;
  teamName: string;
  joinedAt: Date;
  role: 'OWNER' | 'COMMISSIONER' | 'MEMBER';
  status: 'ACTIVE' | 'INVITED' | 'DECLINED' | 'REMOVED';
  
  // League-specific preferences
  draftPreferences: {
    watchlist: string[];
    autoDraftEnabled: boolean;
    draftStrategy: 'BALANCED' | 'AGGRESSIVE' | 'CONSERVATIVE';
    priorityPositions: string[];
  };
  
  scoringPreferences: {
    rankingType: 'H2H_POINTS' | 'H2H_CATEGORIES' | 'ROTISSERIE';
    customWeights?: Record<string, number>;
    viewMode: 'DETAILED' | 'SUMMARY';
  };
  
  notificationSettings: {
    tradePush: boolean;
    waiverPush: boolean;
    draftReminder: boolean;
    scoringAlerts: boolean;
  };
}

export interface LeagueDraftPick {
  id: string;
  leagueId: string;
  round: number;
  pick: number;
  overallPick: number;
  teamId: string;
  userId: string;
  playerId?: string;
  timeRemaining: number;
  pickedAt?: Date;
  isAutoPick: boolean;
  createdAt: Date;
}

export interface LeagueTrade {
  id: string;
  leagueId: string;
  fromTeamId: string;
  toTeamId: string;
  fromUserId: string;
  toUserId: string;
  
  // Trade components
  playersOffered: string[];
  playersRequested: string[];
  picksOffered: LeagueDraftPick[];
  picksRequested: LeagueDraftPick[];
  
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'CANCELLED' | 'COMPLETED';
  message?: string;
  reviewedAt?: Date;
  completedAt?: Date;
  expiresAt: Date;
  createdAt: Date;
}

export interface LeagueWaiverClaim {
  id: string;
  leagueId: string;
  userId: string;
  teamId: string;
  playerId: string;
  dropPlayerId?: string;
  priority: number;
  status: 'PENDING' | 'SUCCESSFUL' | 'FAILED' | 'CANCELLED';
  processingAt: Date;
  processedAt?: Date;
  reason?: string;
  createdAt: Date;
}

export interface LeagueTeamAction {
  id: string;
  leagueId: string;
  userId: string;
  teamId: string;
  actionType: 'SET_CAPTAIN' | 'SET_VICE_CAPTAIN' | 'TRADE_PROPOSAL' | 'WAIVER_CLAIM' | 'DROP_PLAYER' | 'OPTIMIZE_LINEUP';
  status: 'PENDING' | 'PROCESSED' | 'REJECTED' | 'CANCELLED';
  details: Record<string, unknown>;
  targetUserId?: string;
  targetTeamId?: string;
  processingAt?: Date;
  processedAt?: Date;
  createdAt: Date;
}

export interface LeagueSettings {
  id: string;
  leagueId: string;
  name: string;
  format: 'CLASSIC' | 'DRAFT' | 'KEEPER' | 'DYNASTY';
  maxTeams: number;
  
  // Roster configuration
  rosterSettings: {
    startingLineup: Record<string, number>;
    totalRosterSize: number;
    benchSize: number;
    emergencySize: number;
  };
  
  // Draft configuration
  draftSettings: {
    draftType: 'SNAKE' | 'LINEAR' | 'AUCTION';
    pickTimeLimit: number;
    draftDate?: Date;
    randomizeOrder: boolean;
  };
  
  // Waiver configuration
  waiverSettings: {
    system: 'ROLLING_LIST' | 'FAAB' | 'FREE_AGENCY';
    processTime: 'DAILY' | 'TWICE_WEEKLY' | 'WEEKLY' | 'CONTINUOUS';
    waiverPeriod: number;
    faabBudget?: number;
  };
  
  // Scoring configuration
  scoringSettings: {
    systemType: 'H2H_POINTS' | 'H2H_CATEGORIES' | 'ROTISSERIE';
    pointsSystem?: Record<string, number>;
    categories?: string[];
  };
  
  updatedAt: Date;
  createdAt: Date;
}

// Real-time subscription management
interface LeagueSubscription {
  unsubscribe: Unsubscribe;
  collection: string;
  leagueId: string;
}

export class LeagueDataService {
  private subscriptions = new Map<string, LeagueSubscription>();
  
  private ensureFirestore() {
    if (!db) {
      throw new Error('Firestore is not initialized. Please check your Firebase configuration.');
    }
    return db;
  }
  
  // Collection references with proper league scoping
  private getLeagueCollection(leagueId: string): DocumentReference {
    return doc(this.ensureFirestore(), 'leagues', leagueId);
  }
  
  private getLeagueMembersCollection(leagueId: string): CollectionReference {
    return collection(this.ensureFirestore(), 'leagues', leagueId, 'members');
  }
  
  private getLeagueRostersCollection(leagueId: string): CollectionReference {
    return collection(this.ensureFirestore(), 'leagues', leagueId, 'rosters');
  }
  
  private getLeagueDraftCollection(leagueId: string): CollectionReference {
    return collection(this.ensureFirestore(), 'leagues', leagueId, 'draft');
  }
  
  private getLeagueTradesCollection(leagueId: string): CollectionReference {
    return collection(this.ensureFirestore(), 'leagues', leagueId, 'trades');
  }
  
  private getLeagueWaiversCollection(leagueId: string): CollectionReference {
    return collection(this.ensureFirestore(), 'leagues', leagueId, 'waivers');
  }
  
  private getLeagueTeamActionsCollection(leagueId: string): CollectionReference {
    return collection(this.ensureFirestore(), 'leagues', leagueId, 'teamActions');
  }
  
  private getLeagueSettingsDoc(leagueId: string): DocumentReference {
    return doc(this.ensureFirestore(), 'leagues', leagueId, 'config', 'settings');
  }

  /**
   * Real-time subscription for league rosters
   */
  subscribeToLeagueRosters(
    leagueId: string,
    callback: (rosters: LeagueRoster[]) => void,
    onError?: (error: Error) => void
  ): string {
    const subscriptionKey = `rosters-${leagueId}`;
    
    // Clean up existing subscription
    this.unsubscribe(subscriptionKey);
    
    const rostersRef = this.getLeagueRostersCollection(leagueId);
    const q = query(rostersRef, orderBy('teamName'));
    
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const rosters: LeagueRoster[] = [];
        snapshot.forEach((doc) => {
          const data = doc.data();
          rosters.push({
            id: doc.id,
            ...data,
            createdAt: data.createdAt?.toDate() || new Date(),
            updatedAt: data.updatedAt?.toDate() || new Date(),
          } as LeagueRoster);
        });
        callback(rosters);
      },
      (error) => {
        console.error(`Error in league rosters subscription (${leagueId}):`, error);
        onError?.(error);
      }
    );
    
    this.subscriptions.set(subscriptionKey, {
      unsubscribe,
      collection: 'rosters',
      leagueId,
    });
    
    return subscriptionKey;
  }

  /**
   * Real-time subscription for user's specific roster in a league
   */
  subscribeToUserRoster(
    leagueId: string,
    userId: string,
    callback: (roster: LeagueRoster | null) => void,
    onError?: (error: Error) => void
  ): string {
    const subscriptionKey = `roster-${leagueId}-${userId}`;
    
    this.unsubscribe(subscriptionKey);
    
    const rostersRef = this.getLeagueRostersCollection(leagueId);
    const q = query(rostersRef, where('userId', '==', userId));
    
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        if (snapshot.empty) {
          callback(null);
          return;
        }
        
        const doc = snapshot.docs[0];
        const data = doc.data();
        const roster: LeagueRoster = {
          id: doc.id,
          ...data,
          createdAt: data.createdAt?.toDate() || new Date(),
          updatedAt: data.updatedAt?.toDate() || new Date(),
        } as LeagueRoster;
        
        callback(roster);
      },
      (error) => {
        console.error(`Error in user roster subscription (${leagueId}, ${userId}):`, error);
        onError?.(error);
      }
    );
    
    this.subscriptions.set(subscriptionKey, {
      unsubscribe,
      collection: 'roster',
      leagueId,
    });
    
    return subscriptionKey;
  }

  /**
   * Real-time subscription for league draft picks
   */
  subscribeToLeagueDraft(
    leagueId: string,
    callback: (picks: LeagueDraftPick[]) => void,
    onError?: (error: Error) => void
  ): string {
    const subscriptionKey = `draft-${leagueId}`;
    
    this.unsubscribe(subscriptionKey);
    
    const draftRef = collection(this.getLeagueDraftCollection(leagueId), 'picks');
    const q = query(draftRef, orderBy('overallPick'));
    
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const picks: LeagueDraftPick[] = [];
        snapshot.forEach((doc) => {
          const data = doc.data();
          picks.push({
            id: doc.id,
            ...data,
            pickedAt: data.pickedAt?.toDate(),
            createdAt: data.createdAt?.toDate() || new Date(),
          } as LeagueDraftPick);
        });
        callback(picks);
      },
      (error) => {
        console.error(`Error in league draft subscription (${leagueId}):`, error);
        onError?.(error);
      }
    );
    
    this.subscriptions.set(subscriptionKey, {
      unsubscribe,
      collection: 'draft',
      leagueId,
    });
    
    return subscriptionKey;
  }

  /**
   * Real-time subscription for league trades
   */
  subscribeToLeagueTrades(
    leagueId: string,
    callback: (trades: LeagueTrade[]) => void,
    userId?: string, // Optional: filter to user's trades only
    onError?: (error: Error) => void
  ): string {
    const subscriptionKey = `trades-${leagueId}${userId ? `-${userId}` : ''}`;
    
    this.unsubscribe(subscriptionKey);
    
    const tradesRef = this.getLeagueTradesCollection(leagueId);
    let q = query(tradesRef, orderBy('createdAt', 'desc'));
    
    // Filter to user's trades if specified
    if (userId) {
      q = query(
        tradesRef, 
        where('fromUserId', '==', userId),
        orderBy('createdAt', 'desc')
      );
    }
    
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const trades: LeagueTrade[] = [];
        snapshot.forEach((doc) => {
          const data = doc.data();
          trades.push({
            id: doc.id,
            ...data,
            reviewedAt: data.reviewedAt?.toDate(),
            completedAt: data.completedAt?.toDate(),
            expiresAt: data.expiresAt?.toDate() || new Date(),
            createdAt: data.createdAt?.toDate() || new Date(),
          } as LeagueTrade);
        });
        callback(trades);
      },
      (error) => {
        console.error(`Error in league trades subscription (${leagueId}):`, error);
        onError?.(error);
      }
    );
    
    this.subscriptions.set(subscriptionKey, {
      unsubscribe,
      collection: 'trades',
      leagueId,
    });
    
    return subscriptionKey;
  }

  /**
   * Real-time subscription for league waiver claims
   */
  subscribeToLeagueWaivers(
    leagueId: string,
    callback: (claims: LeagueWaiverClaim[]) => void,
    userId?: string,
    onError?: (error: Error) => void
  ): string {
    const subscriptionKey = `waivers-${leagueId}${userId ? `-${userId}` : ''}`;
    
    this.unsubscribe(subscriptionKey);
    
    const waiversRef = this.getLeagueWaiversCollection(leagueId);
    let q = query(waiversRef, orderBy('priority'), orderBy('createdAt'));
    
    if (userId) {
      q = query(
        waiversRef,
        where('userId', '==', userId),
        orderBy('createdAt', 'desc')
      );
    }
    
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const claims: LeagueWaiverClaim[] = [];
        snapshot.forEach((doc) => {
          const data = doc.data();
          claims.push({
            id: doc.id,
            ...data,
            processedAt: data.processedAt?.toDate(),
            createdAt: data.createdAt?.toDate() || new Date(),
          } as LeagueWaiverClaim);
        });
        callback(claims);
      },
      (error) => {
        console.error(`Error in league waivers subscription (${leagueId}):`, error);
        onError?.(error);
      }
    );
    
    this.subscriptions.set(subscriptionKey, {
      unsubscribe,
      collection: 'waivers',
      leagueId,
    });
    
    return subscriptionKey;
  }

  /**
   * Real-time subscription for league team actions
   */
  subscribeToLeagueTeamActions(
    leagueId: string,
    callback: (actions: LeagueTeamAction[]) => void,
    userId?: string,
    onError?: (error: Error) => void
  ): string {
    const subscriptionKey = userId 
      ? `team-actions-${leagueId}-${userId}` 
      : `team-actions-${leagueId}`;
    
    this.unsubscribe(subscriptionKey);
    
    const actionsRef = this.getLeagueTeamActionsCollection(leagueId);
    let q = query(actionsRef, orderBy('createdAt', 'desc'));
    
    // Filter by user if specified
    if (userId) {
      q = query(actionsRef, where('userId', '==', userId), orderBy('createdAt', 'desc'));
    }
    
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const actions: LeagueTeamAction[] = [];
        snapshot.forEach((doc) => {
          const data = doc.data() as Record<string, unknown>;
          actions.push({
            id: doc.id,
            leagueId: data.leagueId as string,
            userId: data.userId as string,
            teamId: data.teamId as string,
            actionType: data.actionType as LeagueTeamAction['actionType'],
            status: data.status as LeagueTeamAction['status'],
            details: (data.details as Record<string, unknown>) || {},
            targetUserId: data.targetUserId as string | undefined,
            targetTeamId: data.targetTeamId as string | undefined,
            processingAt: (data.processingAt as Timestamp)?.toDate?.(),
            processedAt: (data.processedAt as Timestamp)?.toDate?.(),
            createdAt: (data.createdAt as Timestamp)?.toDate?.() || new Date(),
          });
        });
        callback(actions);
      },
      (error) => {
        console.error(`Error in league team actions subscription (${leagueId}):`, error);
        onError?.(error);
      }
    );
    
    this.subscriptions.set(subscriptionKey, {
      unsubscribe,
      collection: 'teamActions',
      leagueId,
    });
    
    return subscriptionKey;
  }

  /**
   * Real-time subscription for league members
   */
  subscribeToLeagueMembers(
    leagueId: string,
    callback: (members: LeagueMember[]) => void,
    onError?: (error: Error) => void
  ): string {
    const subscriptionKey = `members-${leagueId}`;
    
    this.unsubscribe(subscriptionKey);
    
    const membersRef = this.getLeagueMembersCollection(leagueId);
    const q = query(membersRef, orderBy('joinedAt'));
    
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const members: LeagueMember[] = [];
        snapshot.forEach((doc) => {
          const data = doc.data();
          members.push({
            id: doc.id,
            ...data,
            joinedAt: data.joinedAt?.toDate() || new Date(),
          } as LeagueMember);
        });
        callback(members);
      },
      (error) => {
        console.error(`Error in league members subscription (${leagueId}):`, error);
        onError?.(error);
      }
    );
    
    this.subscriptions.set(subscriptionKey, {
      unsubscribe,
      collection: 'members',
      leagueId,
    });
    
    return subscriptionKey;
  }

  /**
   * Update roster with proper league scoping
   */
  async updateRoster(
    leagueId: string,
    teamId: string,
    updates: Partial<LeagueRoster>
  ): Promise<void> {
    try {
      const rosterRef = doc(this.getLeagueRostersCollection(leagueId), teamId);
      await updateDoc(rosterRef, {
        ...updates,
        updatedAt: Timestamp.now(),
        leagueId, // Ensure league ID is always set
      });
    } catch (error) {
      console.error(`Error updating roster (${leagueId}, ${teamId}):`, error);
      throw error;
    }
  }

  /**
   * Update league member preferences
   */
  async updateMemberPreferences(
    leagueId: string,
    userId: string,
    updates: Partial<LeagueMember>
  ): Promise<void> {
    try {
      const memberRef = doc(this.getLeagueMembersCollection(leagueId), userId);
      await updateDoc(memberRef, {
        ...updates,
        leagueId, // Ensure league scoping
      });
    } catch (error) {
      console.error(`Error updating member preferences (${leagueId}, ${userId}):`, error);
      throw error;
    }
  }

  /**
   * Submit waiver claim with proper league scoping
   */
  async submitWaiverClaim(
    leagueId: string,
    claim: Omit<LeagueWaiverClaim, 'id' | 'createdAt'>
  ): Promise<string> {
    try {
      const waiversRef = this.getLeagueWaiversCollection(leagueId);
      const docRef = await addDoc(waiversRef, {
        ...claim,
        leagueId, // Ensure league scoping
        createdAt: Timestamp.now(),
      });
      return docRef.id;
    } catch (error) {
      console.error(`Error submitting waiver claim (${leagueId}):`, error);
      throw error;
    }
  }

  /**
   * Propose trade with proper league scoping
   */
  async proposeTrade(
    leagueId: string,
    trade: Omit<LeagueTrade, 'id' | 'createdAt'>
  ): Promise<string> {
    try {
      const tradesRef = this.getLeagueTradesCollection(leagueId);
      const docRef = await addDoc(tradesRef, {
        ...trade,
        leagueId, // Ensure league scoping
        createdAt: Timestamp.now(),
      });
      return docRef.id;
    } catch (error) {
      console.error(`Error proposing trade (${leagueId}):`, error);
      throw error;
    }
  }

  /**
   * Clean up subscription
   */
  unsubscribe(subscriptionKey: string): void {
    const subscription = this.subscriptions.get(subscriptionKey);
    if (subscription) {
      subscription.unsubscribe();
      this.subscriptions.delete(subscriptionKey);
    }
  }

  /**
   * Clean up all subscriptions for a league
   */
  unsubscribeFromLeague(leagueId: string): void {
    const keysToRemove: string[] = [];
    
    this.subscriptions.forEach((subscription, key) => {
      if (subscription.leagueId === leagueId) {
        subscription.unsubscribe();
        keysToRemove.push(key);
      }
    });
    
    keysToRemove.forEach(key => this.subscriptions.delete(key));
  }

  /**
   * Clean up all subscriptions
   */
  unsubscribeAll(): void {
    this.subscriptions.forEach((subscription) => {
      subscription.unsubscribe();
    });
    this.subscriptions.clear();
  }

  /**
   * Get active subscriptions count for monitoring
   */
  getActiveSubscriptionsCount(): number {
    return this.subscriptions.size;
  }

  /**
   * Get active subscriptions by league for debugging
   */
  getSubscriptionsByLeague(leagueId: string): string[] {
    const subscriptions: string[] = [];
    this.subscriptions.forEach((subscription, key) => {
      if (subscription.leagueId === leagueId) {
        subscriptions.push(`${key} (${subscription.collection})`);
      }
    });
    return subscriptions;
  }
}

// Singleton instance
export const leagueDataService = new LeagueDataService();

export default leagueDataService;
