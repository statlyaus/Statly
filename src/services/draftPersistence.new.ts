/**
 * Scalable League-Isolated Draft Persistence Service
 * Ensures draft data is properly scoped to leagues with optimized performance
 */

import {
  doc,
  setDoc,
  getDoc,
  updateDoc,
  arrayUnion,
  serverTimestamp,
  onSnapshot,
  collection,
  query,
  where,
  orderBy,
  limit,
  writeBatch,
  runTransaction,
  type Unsubscribe,
  type Firestore,
  type DocumentReference,
  type CollectionReference,
} from 'firebase/firestore';
import { db } from '@/lib/firebaseClient';

// Enhanced interfaces for scalability
interface DraftPlayer {
  id: string;
  name: string;
  position: string;
  club: string;
  fantasyPoints?: number;
  avgPoints?: number;
  tier?: number;
  adp?: number; // Average Draft Position
}

interface DraftPick {
  id: string;
  leagueId: string; // Required for league isolation
  draftId: string;
  overall: number;
  round: number;
  slot: number;
  player: DraftPlayer;
  member: {
    id: string;
    userId: string;
    displayName: string;
  };
  auto: boolean;
  madeAt: string;
  timestamp: ReturnType<typeof serverTimestamp>;
  timeToMake?: number; // Seconds taken to make pick
}

interface DraftParticipant {
  id: string;
  userId: string;
  displayName: string;
  position: number;
  isOnline: boolean;
  lastSeen: ReturnType<typeof serverTimestamp>;
  queue: string[]; // Player IDs in queue
  autoPickSettings: {
    enabled: boolean;
    strategy: 'BALANCED' | 'AGGRESSIVE' | 'CONSERVATIVE';
    priorityPositions: string[];
  };
  connectionHealth: {
    lastPing: ReturnType<typeof serverTimestamp>;
    missedPings: number;
    connectionQuality: 'EXCELLENT' | 'GOOD' | 'POOR' | 'UNSTABLE';
  };
}

interface LeagueDraftState {
  id: string;
  leagueId: string; // Required for proper scoping
  name: string;
  leagueSize: number;
  draftType: 'snake' | 'linear';
  status: 'PENDING' | 'LIVE' | 'PAUSED' | 'COMPLETED' | 'CANCELLED';
  currentPick: number;
  currentRound: number;
  currentTurn: number; // Which participant's turn (0-based)
  timeRemaining: number;
  timerActive: boolean;
  participants: DraftParticipant[];
  picks: DraftPick[];
  createdAt: ReturnType<typeof serverTimestamp>;
  updatedAt: ReturnType<typeof serverTimestamp>;
  lastActivity: ReturnType<typeof serverTimestamp>;
  settings: {
    pickTimeLimit: number; // seconds
    allowTrades: boolean;
    autoPickEnabled: boolean;
    pauseOnDisconnect: boolean;
    maxPauseDuration: number; // seconds
  };
  
  // Performance optimization fields
  performance: {
    averagePickTime: number;
    totalPauses: number;
    disconnectionEvents: number;
    autoPickCount: number;
  };
  
  // League-specific configuration
  leagueSettings: {
    totalRounds: number;
    rosterSize: number;
    startingLineup: Record<string, number>;
    benchSize: number;
  };
}

// Performance and subscription management
interface DraftSubscription {
  unsubscribe: Unsubscribe;
  leagueId: string;
  draftId: string;
  lastActivity: Date;
}

export class ScalableLeagueDraftPersistence {
  private static instance: ScalableLeagueDraftPersistence;
  private subscriptions = new Map<string, DraftSubscription>();
  private connectionPool = new Map<string, number>(); // leagueId -> active connections
  
  static getInstance(): ScalableLeagueDraftPersistence {
    if (!ScalableLeagueDraftPersistence.instance) {
      ScalableLeagueDraftPersistence.instance = new ScalableLeagueDraftPersistence();
    }
    return ScalableLeagueDraftPersistence.instance;
  }

  private getFirestore(): Firestore {
    if (!db) {
      throw new Error('Firestore is not initialized. Please check your Firebase configuration.');
    }
    return db;
  }

  // League-scoped collection references for optimal performance
  private getLeagueDraftRef(leagueId: string, draftId: string): DocumentReference {
    return doc(this.getFirestore(), 'leagues', leagueId, 'drafts', draftId);
  }

  private getLeagueDraftsCollection(leagueId: string): CollectionReference {
    return collection(this.getFirestore(), 'leagues', leagueId, 'drafts');
  }

  private getLeagueDraftPicksCollection(leagueId: string, draftId: string): CollectionReference {
    return collection(this.getFirestore(), 'leagues', leagueId, 'drafts', draftId, 'picks');
  }

  /**
   * Initialize a new league-scoped draft with optimized structure
   */
  async initializeLeagueDraft(leagueId: string, draftData: Partial<LeagueDraftState>): Promise<void> {
    try {
      const draftRef = this.getLeagueDraftRef(leagueId, draftData.id!);

      const initialState: LeagueDraftState = {
        id: draftData.id!,
        leagueId: leagueId,
        name: draftData.name || 'Untitled Draft',
        leagueSize: draftData.leagueSize || 12,
        draftType: draftData.draftType || 'snake',
        status: 'PENDING',
        currentPick: 1,
        currentRound: 1,
        currentTurn: 0,
        timeRemaining: draftData.settings?.pickTimeLimit || 120,
        timerActive: false,
        participants: draftData.participants || [],
        picks: [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        lastActivity: serverTimestamp(),
        settings: {
          pickTimeLimit: 120,
          allowTrades: false,
          autoPickEnabled: true,
          pauseOnDisconnect: true,
          maxPauseDuration: 300,
          ...draftData.settings,
        },
        performance: {
          averagePickTime: 0,
          totalPauses: 0,
          disconnectionEvents: 0,
          autoPickCount: 0,
        },
        leagueSettings: {
          totalRounds: 22,
          rosterSize: 30,
          startingLineup: { DEF: 6, MID: 8, FWD: 6, RUCK: 2 },
          benchSize: 8,
          ...draftData.leagueSettings,
        },
      };

      // Use batched write for atomicity
      const batch = writeBatch(this.getFirestore());
      batch.set(draftRef, initialState);
      
      // Track connection for this league
      this.incrementLeagueConnections(leagueId);
      
      await batch.commit();
      console.log(`📦 League draft ${draftData.id} initialized for league ${leagueId}`);
    } catch (error) {
      console.error('Error initializing league draft:', error);
      throw error;
    }
  }

  /**
   * Get league-scoped draft state with caching optimization
   */
  async getLeagueDraftState(leagueId: string, draftId: string): Promise<LeagueDraftState | null> {
    try {
      const draftRef = this.getLeagueDraftRef(leagueId, draftId);
      const draftSnap = await getDoc(draftRef);

      if (draftSnap.exists()) {
        const data = draftSnap.data() as LeagueDraftState;
        console.log(`📖 League draft state retrieved for ${draftId} in league ${leagueId}`);
        return data;
      }

      console.warn(`Draft ${draftId} not found in league ${leagueId}`);
      return null;
    } catch (error) {
      console.error('Error fetching league draft state:', error);
      return null;
    }
  }

  /**
   * Save pick with atomic transaction and league isolation
   */
  async saveLeagueDraftPick(leagueId: string, draftId: string, pick: DraftPick): Promise<void> {
    try {
      await runTransaction(this.getFirestore(), async (transaction) => {
        const draftRef = this.getLeagueDraftRef(leagueId, draftId);
        const draftDoc = await transaction.get(draftRef);
        
        if (!draftDoc.exists()) {
          throw new Error(`Draft ${draftId} not found in league ${leagueId}`);
        }

        const currentState = draftDoc.data() as LeagueDraftState;
        const totalPicks = currentState.leagueSettings.totalRounds * currentState.leagueSize;
        const isComplete = currentState.currentPick >= totalPicks;

        // Calculate next turn with optimized logic
        const nextState = this.calculateNextDraftState(currentState, isComplete);

        // Update performance metrics
        const updatedPerformance = this.updatePerformanceMetrics(currentState.performance, pick);

        // Atomic update of draft state
        transaction.update(draftRef, {
          currentPick: currentState.currentPick + 1,
          currentRound: nextState.currentRound,
          currentTurn: nextState.currentTurn,
          timeRemaining: currentState.settings.pickTimeLimit,
          status: isComplete ? 'COMPLETED' : currentState.status,
          performance: updatedPerformance,
          updatedAt: serverTimestamp(),
          lastActivity: serverTimestamp(),
        });

        // Store pick in separate subcollection for better performance
        const pickRef = doc(this.getLeagueDraftPicksCollection(leagueId, draftId));
        transaction.set(pickRef, {
          ...pick,
          leagueId,
          draftId,
          timestamp: serverTimestamp(),
        });
      });

      console.log(`✅ Pick saved for draft ${draftId} in league ${leagueId}`);
    } catch (error) {
      console.error('Error saving league draft pick:', error);
      throw error;
    }
  }

  /**
   * Update participant with optimized field-level updates
   */
  async updateLeagueParticipant(
    leagueId: string,
    draftId: string,
    participantId: string,
    updates: Partial<DraftParticipant>
  ): Promise<void> {
    try {
      const draftRef = this.getLeagueDraftRef(leagueId, draftId);
      const currentState = await this.getLeagueDraftState(leagueId, draftId);
      
      if (!currentState) {
        throw new Error(`Draft ${draftId} not found in league ${leagueId}`);
      }

      const updatedParticipants = currentState.participants.map((p: DraftParticipant) =>
        p.id === participantId ? { ...p, ...updates, lastSeen: serverTimestamp() } : p
      );

      await updateDoc(draftRef, {
        participants: updatedParticipants,
        updatedAt: serverTimestamp(),
      });

      console.log(`👤 Participant ${participantId} updated in league ${leagueId}`);
    } catch (error) {
      console.error('Error updating league participant:', error);
      throw error;
    }
  }

  /**
   * League-scoped real-time subscription with connection management
   */
  subscribeToLeagueDraft(
    leagueId: string,
    draftId: string,
    callback: (draftState: LeagueDraftState) => void,
    onError?: (error: Error) => void
  ): string {
    const subscriptionKey = `${leagueId}-${draftId}`;
    const draftRef = this.getLeagueDraftRef(leagueId, draftId);

    const unsubscribe = onSnapshot(
      draftRef,
      (doc) => {
        if (doc.exists()) {
          const draftState = doc.data() as LeagueDraftState;
          callback(draftState);
          console.log(`� Real-time update for draft ${draftId} in league ${leagueId}`);
        }
      },
      (error) => {
        console.error(`❌ Subscription error for draft ${draftId}:`, error);
        if (onError) onError(error);
      }
    );

    // Track subscription for cleanup
    this.subscriptions.set(subscriptionKey, {
      unsubscribe,
      leagueId,
      draftId,
      lastActivity: new Date(),
    });

    this.incrementLeagueConnections(leagueId);
    console.log(`🎧 Subscribed to league draft ${draftId} in league ${leagueId}`);

    return subscriptionKey;
  }

  /**
   * Efficient cleanup of league subscriptions
   */
  unsubscribeFromLeagueDraft(subscriptionKey: string): void {
    const subscription = this.subscriptions.get(subscriptionKey);
    if (subscription) {
      subscription.unsubscribe();
      this.subscriptions.delete(subscriptionKey);
      this.decrementLeagueConnections(subscription.leagueId);
      console.log(`🔇 Unsubscribed from league draft ${subscription.draftId}`);
    }
  }

  /**
   * Recovery method for league draft state
   */
  async recoverLeagueDraftState(
    leagueId: string,
    draftId: string,
    participantId: string
  ): Promise<LeagueDraftState | null> {
    try {
      const draftState = await this.getLeagueDraftState(leagueId, draftId);
      if (draftState) {
        // Mark participant as online again
        await this.updateLeagueParticipant(leagueId, draftId, participantId, {
          isOnline: true,
          lastSeen: serverTimestamp(),
          connectionHealth: {
            lastPing: serverTimestamp(),
            missedPings: 0,
            connectionQuality: 'GOOD',
          },
        } as Partial<DraftParticipant>);
      }
      return draftState;
    } catch (error) {
      console.error('Error recovering league draft state:', error);
      return null;
    }
  }

  // Performance optimization methods
  private calculateNextDraftState(currentState: LeagueDraftState, isComplete: boolean) {
    if (isComplete) {
      return {
        currentRound: currentState.currentRound,
        currentTurn: currentState.currentTurn,
      };
    }

    let nextTurn = currentState.currentTurn;
    let nextRound = currentState.currentRound;

    if (currentState.draftType === 'snake') {
      const isEvenRound = nextRound % 2 === 0;
      if (isEvenRound) {
        nextTurn = nextTurn === 0 ? currentState.leagueSize - 1 : nextTurn - 1;
      } else {
        nextTurn = nextTurn === currentState.leagueSize - 1 ? 0 : nextTurn + 1;
      }
    } else {
      nextTurn = (nextTurn + 1) % currentState.leagueSize;
    }

    if (currentState.currentPick % currentState.leagueSize === 0) {
      nextRound++;
    }

    return { currentRound: nextRound, currentTurn: nextTurn };
  }

  private updatePerformanceMetrics(currentMetrics: LeagueDraftState['performance'], pick: DraftPick) {
    return {
      ...currentMetrics,
      autoPickCount: pick.auto ? currentMetrics.autoPickCount + 1 : currentMetrics.autoPickCount,
      averagePickTime: pick.timeToMake 
        ? (currentMetrics.averagePickTime + pick.timeToMake) / 2 
        : currentMetrics.averagePickTime,
    };
  }

  private incrementLeagueConnections(leagueId: string): void {
    const current = this.connectionPool.get(leagueId) || 0;
    this.connectionPool.set(leagueId, current + 1);
  }

  private decrementLeagueConnections(leagueId: string): void {
    const current = this.connectionPool.get(leagueId) || 0;
    if (current > 0) {
      this.connectionPool.set(leagueId, current - 1);
    }
  }

  /**
   * Get performance metrics for monitoring
   */
  getScalabilityMetrics() {
    return {
      activeSubscriptions: this.subscriptions.size,
      leagueConnections: Object.fromEntries(this.connectionPool),
      totalConnections: Array.from(this.connectionPool.values()).reduce((sum, count) => sum + count, 0),
      memoryUsage: process.memoryUsage ? process.memoryUsage() : null,
    };
  }

  /**
   * Cleanup stale subscriptions for memory efficiency
   */
  cleanupStaleSubscriptions(maxAgeMinutes: number = 30): void {
    const cutoff = new Date(Date.now() - maxAgeMinutes * 60 * 1000);
    const staleKeys: string[] = [];

    this.subscriptions.forEach((subscription, key) => {
      if (subscription.lastActivity < cutoff) {
        staleKeys.push(key);
      }
    });

    staleKeys.forEach(key => this.unsubscribeFromLeagueDraft(key));
    console.log(`🧹 Cleaned up ${staleKeys.length} stale draft subscriptions`);
  }
}

// Export singleton instance for backward compatibility and new scalable instance
export const draftPersistence = ScalableLeagueDraftPersistence.getInstance();
export const scalableLeagueDraft = ScalableLeagueDraftPersistence.getInstance();

// Export types
export type { 
  LeagueDraftState, 
  DraftPick, 
  DraftParticipant, 
  DraftPlayer,
  DraftSubscription 
};
  }
}

  /**
   * Save a pick to Firestore and update draft state
   */
  async savePick(draftId: string, pick: DraftPick): Promise<void> {
    try {
      const firestore = this.getFirestore();
      const draftRef = doc(firestore, 'drafts', draftId);

      // Get current state to calculate next turn
      const currentState = await this.getDraftState(draftId);
      if (!currentState) throw new Error('Draft not found');

      const totalPicks = currentState.leagueSize * 22; // 22 rounds typical
      const isComplete = currentState.currentPick >= totalPicks;

      let nextTurn = currentState.currentTurn;
      let nextRound = currentState.currentRound;

      if (!isComplete) {
        if (currentState.draftType === 'snake') {
          // Snake draft logic
          const isEvenRound = nextRound % 2 === 0;
          if (isEvenRound) {
            nextTurn = nextTurn === 0 ? currentState.leagueSize - 1 : nextTurn - 1;
          } else {
            nextTurn = nextTurn === currentState.leagueSize - 1 ? 0 : nextTurn + 1;
          }
        } else {
          // Linear draft
          nextTurn = (nextTurn + 1) % currentState.leagueSize;
        }

        // Check if we've completed a round
        if (currentState.currentPick % currentState.leagueSize === 0) {
          nextRound++;
        }
      }

      // Update draft state with new pick
      await updateDoc(draftRef, {
        picks: arrayUnion({
          ...pick,
          timestamp: serverTimestamp(),
        }),
        currentPick: currentState.currentPick + 1,
        currentRound: nextRound,
        currentTurn: nextTurn,
        timeRemaining: currentState.settings.pickTimeLimit,
        status: isComplete ? 'COMPLETED' : currentState.status,
        updatedAt: serverTimestamp(),
        lastActivity: serverTimestamp(),
      });

      console.log(
        `✅ Pick saved: ${pick.player.name} by ${pick.member.displayName} (Pick ${currentState.currentPick})`
      );
    } catch (error) {
      console.error('Error saving pick:', error);
      throw error;
    }
  }

  /**
   * Update participant status (online/offline, queue changes)
   */
  async updateParticipant(
    draftId: string,
    participantId: string,
    updates: Partial<DraftParticipant>
  ): Promise<void> {
    try {
      const firestore = this.getFirestore();
      const draftRef = doc(firestore, 'drafts', draftId);
      const currentState = await this.getDraftState(draftId);

      if (!currentState) throw new Error('Draft not found');

      const updatedParticipants = currentState.participants.map((p) =>
        p.id === participantId ? { ...p, ...updates, lastSeen: serverTimestamp() } : p
      );

      await updateDoc(draftRef, {
        participants: updatedParticipants,
        updatedAt: serverTimestamp(),
        lastActivity: serverTimestamp(),
      });

      console.log(`👤 Participant ${participantId} updated in draft ${draftId}`);
    } catch (error) {
      console.error('Error updating participant:', error);
      throw error;
    }
  }

  /**
   * Update timer state
   */
  async updateTimer(draftId: string, timeRemaining: number, timerActive: boolean): Promise<void> {
    try {
      const firestore = this.getFirestore();
      const draftRef = doc(firestore, 'drafts', draftId);

      await updateDoc(draftRef, {
        timeRemaining,
        timerActive,
        updatedAt: serverTimestamp(),
        lastActivity: serverTimestamp(),
      });

      console.log(`⏱️ Timer updated: ${timeRemaining}s remaining, active: ${timerActive}`);
    } catch (error) {
      console.error('Error updating timer:', error);
      throw error;
    }
  }

  /**
   * Listen to real-time draft state changes
   */
  subscribeToDraftUpdates(
    draftId: string,
    callback: (draftState: DraftState) => void
  ): Unsubscribe {
    const firestore = this.getFirestore();
    const draftRef = doc(firestore, 'drafts', draftId);

    const unsubscribe = onSnapshot(
      draftRef,
      (doc) => {
        if (doc.exists()) {
          const draftState = doc.data() as DraftState;
          console.log(`🔄 Real-time update received for draft ${draftId}`);
          callback(draftState);
        }
      },
      (error) => {
        console.error('Error listening to draft updates:', error);
      }
    );

    // Store the unsubscribe function
    this.listeners.set(draftId, unsubscribe);
    console.log(`🎧 Subscribed to real-time updates for draft ${draftId}`);

    return unsubscribe;
  }

  /**
   * Stop listening to draft updates
   */
  unsubscribeFromDraft(draftId: string): void {
    const unsubscribe = this.listeners.get(draftId);
    if (unsubscribe) {
      unsubscribe();
      this.listeners.delete(draftId);
      console.log(`🔇 Unsubscribed from draft ${draftId} updates`);
    }
  }

  /**
   * Recovery: Get full draft state for reconnection
   */
  async recoverDraftState(draftId: string, participantId: string): Promise<DraftState | null> {
    try {
      const draftState = await this.getDraftState(draftId);

      if (draftState) {
        // Mark participant as online
        await this.updateParticipant(draftId, participantId, {
          isOnline: true,
          lastSeen: serverTimestamp(),
        });

        console.log(
          `🔄 Draft state recovered for participant ${participantId} in draft ${draftId}`
        );
        return draftState;
      }

      return null;
    } catch (error) {
      console.error('Error recovering draft state:', error);
      return null;
    }
  }

  /**
   * Cleanup: Mark participant as offline
   */
  async markParticipantOffline(draftId: string, participantId: string): Promise<void> {
    try {
      await this.updateParticipant(draftId, participantId, {
        isOnline: false,
        lastSeen: serverTimestamp(),
      });

      console.log(`❌ Participant ${participantId} marked offline in draft ${draftId}`);
    } catch (error) {
      console.error('Error marking participant offline:', error);
    }
  }

  /**
   * Get draft summary for recovery/late joiners
   */
  async getDraftSummary(draftId: string): Promise<{
    totalPicks: number;
    currentPick: number;
    currentRound: number;
    currentTurnDisplayName: string;
    timeRemaining: number;
    isActive: boolean;
    lastActivity: ReturnType<typeof serverTimestamp>;
  } | null> {
    try {
      const draftState = await this.getDraftState(draftId);

      if (!draftState) return null;

      const currentParticipant = draftState.participants[draftState.currentTurn];

      return {
        totalPicks: draftState.picks.length,
        currentPick: draftState.currentPick,
        currentRound: draftState.currentRound,
        currentTurnDisplayName: currentParticipant?.displayName || 'Unknown',
        timeRemaining: draftState.timeRemaining,
        isActive: draftState.status === 'LIVE',
        lastActivity: draftState.lastActivity,
      };
    } catch (error) {
      console.error('Error getting draft summary:', error);
      return null;
    }
  }
}

export const draftPersistence = DraftPersistenceService.getInstance();
export type { DraftState, DraftPick, DraftParticipant, DraftPlayer };
