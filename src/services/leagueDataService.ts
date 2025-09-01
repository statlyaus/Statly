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
  type Unsubscribe,
  runTransaction,
  limit,
  startAfter,
  startAt,
  endBefore,
  endAt,
  type DocumentSnapshot,
  getDocs,
  limitToLast,
} from 'firebase/firestore';
import { db } from '@/lib/firebaseClient';

// Helper to safely convert Firestore Timestamp/Date fields to Date
function toDate(value: Timestamp | Date | null | undefined): Date | undefined {
  if (!value) return undefined;
  return value instanceof Timestamp ? value.toDate() : value;
}

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
  bidAmount?: number; // optional FAAB amount when system=FAAB
}

// Firestore Waiver document shape (raw)
interface WaiverDoc {
  leagueId?: string;
  userId?: string;
  teamId?: string;
  playerId?: string;
  dropPlayerId?: string | null;
  priority?: number;
  status?: 'PENDING' | 'SUCCESSFUL' | 'FAILED' | 'CANCELLED';
  processingAt?: Timestamp | Date | null;
  processedAt?: Timestamp | Date | null;
  createdAt?: Timestamp | Date | null;
  bidAmount?: number | null;
  createdBy?: string | null;
}

export interface LeagueTeamAction {
  id: string;
  leagueId: string;
  userId: string;
  teamId: string;
  actionType:
    | 'SET_CAPTAIN'
    | 'SET_VICE_CAPTAIN'
    | 'TRADE_PROPOSAL'
    | 'WAIVER_CLAIM'
    | 'DROP_PLAYER'
    | 'OPTIMIZE_LINEUP';
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

export interface LeagueActivityItem {
  id: string;
  leagueId: string;
  type: 'waiver-submitted' | 'waiver-successful' | 'waiver-failed' | 'waiver-cancelled' | string;
  userId?: string;
  teamId?: string;
  playerId?: string;
  dropPlayerId?: string;
  bidAmount?: number;
  priority?: number;
  claimId?: string;
  reason?: string;
  timestamp: Date;
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
          const raw = doc.data() as { [key: string]: unknown };
          const roster: LeagueRoster = {
            id: doc.id,
            userId: typeof raw.userId === 'string' ? raw.userId : '',
            teamName: typeof raw.teamName === 'string' ? raw.teamName : '',
            playerIds: Array.isArray(raw.playerIds) ? (raw.playerIds as string[]) : [],
            bench: Array.isArray(raw.bench) ? (raw.bench as string[]) : [],
            captain: typeof raw.captain === 'string' ? raw.captain : undefined,
            viceCaptain: typeof raw.viceCaptain === 'string' ? raw.viceCaptain : undefined,
            emergencies: Array.isArray(raw.emergencies) ? (raw.emergencies as string[]) : [],
            leagueId: typeof raw.leagueId === 'string' ? raw.leagueId : String(leagueId),
            updatedAt: toDate(raw.updatedAt as Timestamp | Date | null | undefined) || new Date(),
            createdAt: toDate(raw.createdAt as Timestamp | Date | null | undefined) || new Date(),
          };
          rosters.push(roster);
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
        const raw = doc.data() as { [key: string]: unknown };
        const roster: LeagueRoster = {
          id: doc.id,
          userId: typeof raw.userId === 'string' ? raw.userId : '',
          teamName: typeof raw.teamName === 'string' ? raw.teamName : '',
          playerIds: Array.isArray(raw.playerIds) ? (raw.playerIds as string[]) : [],
          bench: Array.isArray(raw.bench) ? (raw.bench as string[]) : [],
          captain: typeof raw.captain === 'string' ? raw.captain : undefined,
          viceCaptain: typeof raw.viceCaptain === 'string' ? raw.viceCaptain : undefined,
          emergencies: Array.isArray(raw.emergencies) ? (raw.emergencies as string[]) : [],
          leagueId: typeof raw.leagueId === 'string' ? raw.leagueId : String(leagueId),
          updatedAt: toDate(raw.updatedAt as Timestamp | Date | null | undefined) || new Date(),
          createdAt: toDate(raw.createdAt as Timestamp | Date | null | undefined) || new Date(),
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
      q = query(tradesRef, where('fromUserId', '==', userId), orderBy('createdAt', 'desc'));
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
    const q = query(membersRef, orderBy('teamName'));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const members: LeagueMember[] = [];
        snapshot.forEach((docSnap) => {
          const raw = docSnap.data() as Record<string, unknown>;
          members.push({
            id: docSnap.id,
            userId: String(raw.userId || ''),
            leagueId: String(raw.leagueId || leagueId),
            teamName: String(raw.teamName || ''),
            joinedAt: toDate(raw.joinedAt as Timestamp | Date | null | undefined) || new Date(),
            role: (raw.role as LeagueMember['role']) || 'MEMBER',
            status: (raw.status as LeagueMember['status']) || 'ACTIVE',
            draftPreferences: {
              watchlist: Array.isArray(
                raw?.draftPreferences && (raw as any).draftPreferences.watchlist
              )
                ? ((raw as any).draftPreferences.watchlist as string[])
                : [],
              autoDraftEnabled: Boolean((raw as any)?.draftPreferences?.autoDraftEnabled),
              draftStrategy:
                ((raw as any)?.draftPreferences
                  ?.draftStrategy as LeagueMember['draftPreferences']['draftStrategy']) ||
                'BALANCED',
              priorityPositions: Array.isArray((raw as any)?.draftPreferences?.priorityPositions)
                ? ((raw as any).draftPreferences.priorityPositions as string[])
                : [],
            },
            scoringPreferences: {
              rankingType:
                ((raw as any)?.scoringPreferences
                  ?.rankingType as LeagueMember['scoringPreferences']['rankingType']) ||
                'H2H_POINTS',
              customWeights: (raw as any)?.scoringPreferences?.customWeights as
                | Record<string, number>
                | undefined,
              viewMode:
                ((raw as any)?.scoringPreferences
                  ?.viewMode as LeagueMember['scoringPreferences']['viewMode']) || 'DETAILED',
            },
            notificationSettings: {
              tradePush: Boolean((raw as any)?.notificationSettings?.tradePush),
              waiverPush: Boolean((raw as any)?.notificationSettings?.waiverPush),
              draftReminder: Boolean((raw as any)?.notificationSettings?.draftReminder),
              scoringAlerts: Boolean((raw as any)?.notificationSettings?.scoringAlerts),
            },
          });
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
   * Real-time subscription for league team actions
   */
  subscribeToLeagueTeamActions(
    leagueId: string,
    callback: (actions: LeagueTeamAction[]) => void,
    userId?: string,
    onError?: (error: Error) => void
  ): string {
    const subscriptionKey = `teamActions-${leagueId}${userId ? `-${userId}` : ''}`;

    this.unsubscribe(subscriptionKey);

    const actionsRef = this.getLeagueTeamActionsCollection(leagueId);
    let qBase = query(actionsRef, orderBy('createdAt', 'desc'));
    if (userId) {
      qBase = query(actionsRef, where('userId', '==', userId), orderBy('createdAt', 'desc'));
    }

    const unsubscribe = onSnapshot(
      qBase,
      (snapshot) => {
        const actions: LeagueTeamAction[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data() as Record<string, unknown>;
          actions.push({
            id: docSnap.id,
            leagueId: String(data.leagueId || leagueId),
            userId: String(data.userId || ''),
            teamId: String(data.teamId || ''),
            actionType: (data.actionType as LeagueTeamAction['actionType']) || 'OPTIMIZE_LINEUP',
            status: (data.status as LeagueTeamAction['status']) || 'PENDING',
            details: (data.details as Record<string, unknown>) || {},
            targetUserId: data.targetUserId ? String(data.targetUserId) : undefined,
            targetTeamId: data.targetTeamId ? String(data.targetTeamId) : undefined,
            processingAt: toDate(data.processingAt as Timestamp | Date | null | undefined),
            processedAt: toDate(data.processedAt as Timestamp | Date | null | undefined),
            createdAt: toDate(data.createdAt as Timestamp | Date | null | undefined) || new Date(),
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
      q = query(waiversRef, where('userId', '==', userId), orderBy('createdAt', 'desc'));
    }

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const claims: LeagueWaiverClaim[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data() as WaiverDoc;
          const bidAmount = typeof data.bidAmount === 'number' ? data.bidAmount : undefined;
          claims.push({
            id: docSnap.id,
            leagueId: String(data.leagueId || leagueId),
            userId: String(data.userId || ''),
            teamId: String(data.teamId || ''),
            playerId: String(data.playerId || ''),
            dropPlayerId: data.dropPlayerId ? String(data.dropPlayerId) : undefined,
            priority: Number(data.priority ?? 1),
            status: data.status || 'PENDING',
            processingAt: toDate(data.processingAt) || new Date(),
            processedAt: toDate(data.processedAt),
            createdAt: toDate(data.createdAt) || new Date(),
            bidAmount,
          });
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

  /** Subscribe to user's waiver priority (remaining FAAB, etc.) */
  subscribeToWaiverPriority(
    leagueId: string,
    userId: string,
    callback: (remainingFAAB: number | undefined) => void,
    onError?: (error: Error) => void
  ): string {
    const subscriptionKey = `waiver-priority-${leagueId}-${userId}`;
    this.unsubscribe(subscriptionKey);

    const priorityRef = doc(
      this.ensureFirestore(),
      'leagues',
      leagueId,
      'waiverPriorities',
      userId
    );
    const unsubscribe = onSnapshot(
      priorityRef,
      (snap) => {
        if (!snap.exists()) {
          callback(undefined);
          return;
        }
        const data = snap.data() as { remainingFAAB?: number };
        callback(typeof data.remainingFAAB === 'number' ? data.remainingFAAB : undefined);
      },
      (error) => {
        console.error(`Error in waiver priority subscription (${leagueId}, ${userId}):`, error);
        onError?.(error);
      }
    );

    this.subscriptions.set(subscriptionKey, {
      unsubscribe,
      collection: 'waiverPriorities',
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
   * Cancel a waiver claim with proper league scoping
   */
  async cancelLeagueWaiverClaim(leagueId: string, claimId: string, userId: string): Promise<void> {
    try {
      const db = this.ensureFirestore();
      const waiversRef = this.getLeagueWaiversCollection(leagueId);
      const claimRef = doc(waiversRef, claimId);

      await runTransaction(db, async (tx) => {
        const snap = await tx.get(claimRef);
        if (!snap.exists()) {
          throw new Error('Waiver claim not found.');
        }
        const data = snap.data() as WaiverDoc;
        const ownerId = data.userId || data.createdBy || undefined;
        if (!ownerId || ownerId !== userId) {
          throw new Error('Permission denied: only the claim owner can cancel this claim.');
        }
        if (data.status !== 'PENDING') {
          throw new Error('Cancellation forbidden: only pending claims can be cancelled.');
        }

        tx.update(claimRef, {
          status: 'CANCELLED',
          processedAt: Timestamp.now(),
          leagueId,
          userId,
        });
      });
    } catch (error) {
      console.error(`Error cancelling waiver claim (${leagueId}, ${claimId}):`, error);
      throw error;
    }
  }

  /**
   * Real-time subscription for league activity feed
   *
   * Index guidance:
   * - Using subcollections per league (leagues/{leagueId}/activity), a single-field index on `timestamp` is sufficient.
   * - If you ever query across leagues via a collection group query, add a composite index on (leagueId ASC, timestamp DESC).
   *   See firestore.indexes.json for an example entry.
   *
   * Pagination:
   * - Supports cursor-based paging using DocumentSnapshot or Date/Timestamp values.
   * - boundary determines how the cursor is applied (startAfter|startAt|endBefore|endAt).
   */
  subscribeToLeagueActivity(
    leagueId: string,
    callback: (
      items: LeagueActivityItem[],
      pageMeta?: { firstDoc: DocumentSnapshot | null; lastDoc: DocumentSnapshot | null }
    ) => void,
    options?: {
      pageSize?: number;
      /** @deprecated use pageSize */
      limit?: number;
      cursor?: DocumentSnapshot | Date | Timestamp;
      boundary?: 'startAfter' | 'startAt' | 'endBefore' | 'endAt';
      direction?: 'asc' | 'desc';
    },
    onError?: (error: Error) => void
  ): string {
    const subscriptionKey = `activity-${leagueId}`;
    this.unsubscribe(subscriptionKey);

    const activityRef = collection(this.ensureFirestore(), 'leagues', leagueId, 'activity');

    const direction = options?.direction === 'asc' ? 'asc' : 'desc';
    const pageSize = options?.pageSize ?? options?.limit ?? 50;

    let qBase = query(activityRef, orderBy('timestamp', direction));

    if (options?.cursor) {
      const c = options.cursor;
      if (c instanceof Date || c instanceof Timestamp) {
        const fieldCursor: Date | Timestamp = c;
        switch (options?.boundary) {
          case 'startAt':
            qBase = query(qBase, startAt(fieldCursor));
            break;
          case 'endBefore':
            qBase = query(qBase, endBefore(fieldCursor));
            break;
          case 'endAt':
            qBase = query(qBase, endAt(fieldCursor));
            break;
          case 'startAfter':
          default:
            qBase = query(qBase, startAfter(fieldCursor));
            break;
        }
      } else {
        const snap = c as DocumentSnapshot;
        switch (options?.boundary) {
          case 'startAt':
            qBase = query(qBase, startAt(snap));
            break;
          case 'endBefore':
            qBase = query(qBase, endBefore(snap));
            break;
          case 'endAt':
            qBase = query(qBase, endAt(snap));
            break;
          case 'startAfter':
          default:
            qBase = query(qBase, startAfter(snap));
            break;
        }
      }
    }

    const qFinal = query(qBase, limit(pageSize));

    const unsubscribe = onSnapshot(
      qFinal,
      (snapshot) => {
        const items: LeagueActivityItem[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data() as Record<string, unknown>;
          items.push({
            id: docSnap.id,
            leagueId,
            type: String(data.type || ''),
            userId: data.userId ? String(data.userId) : undefined,
            teamId: data.teamId ? String(data.teamId) : undefined,
            playerId: data.playerId ? String(data.playerId) : undefined,
            dropPlayerId: data.dropPlayerId ? String(data.dropPlayerId) : undefined,
            bidAmount: typeof data.bidAmount === 'number' ? data.bidAmount : undefined,
            priority: typeof data.priority === 'number' ? data.priority : undefined,
            claimId: data.claimId ? String(data.claimId) : undefined,
            reason: data.reason ? String(data.reason) : undefined,
            timestamp: toDate(data.timestamp as Timestamp | Date | null | undefined) || new Date(),
          });
        });
        const firstDoc = snapshot.docs[0] ?? null;
        const lastDoc = snapshot.docs[snapshot.docs.length - 1] ?? null;
        callback(items, { firstDoc, lastDoc });
      },
      (error) => {
        console.error(`Error in league activity subscription (${leagueId}):`, error);
        onError?.(error);
      }
    );

    this.subscriptions.set(subscriptionKey, {
      unsubscribe,
      collection: 'activity',
      leagueId,
    });

    return subscriptionKey;
  }

  /**
   * One-shot page fetch for league activity (useful for Load More UX).
   * Keeps the real-time subscription focused on the newest window while older pages are fetched on demand.
   */
  async getLeagueActivityPage(
    leagueId: string,
    options?: {
      pageSize?: number;
      direction?: 'asc' | 'desc';
      cursor?: DocumentSnapshot | Date | Timestamp;
      boundary?: 'startAfter' | 'startAt' | 'endBefore' | 'endAt';
      useLimitToLast?: boolean; // when paginating backwards with endBefore
    }
  ): Promise<{
    items: LeagueActivityItem[];
    firstDoc: DocumentSnapshot | null;
    lastDoc: DocumentSnapshot | null;
  }> {
    const activityRef = collection(this.ensureFirestore(), 'leagues', leagueId, 'activity');
    const direction = options?.direction === 'asc' ? 'asc' : 'desc';
    const pageSize = options?.pageSize ?? 50;

    let qBase = query(activityRef, orderBy('timestamp', direction));

    if (options?.cursor) {
      const c = options.cursor;
      if (c instanceof Date || c instanceof Timestamp) {
        const fieldCursor: Date | Timestamp = c;
        switch (options?.boundary) {
          case 'startAt':
            qBase = query(qBase, startAt(fieldCursor));
            break;
          case 'endBefore':
            qBase = query(qBase, endBefore(fieldCursor));
            break;
          case 'endAt':
            qBase = query(qBase, endAt(fieldCursor));
            break;
          case 'startAfter':
          default:
            qBase = query(qBase, startAfter(fieldCursor));
            break;
        }
      } else {
        const snap = c as DocumentSnapshot;
        switch (options?.boundary) {
          case 'startAt':
            qBase = query(qBase, startAt(snap));
            break;
          case 'endBefore':
            qBase = query(qBase, endBefore(snap));
            break;
          case 'endAt':
            qBase = query(qBase, endAt(snap));
            break;
          case 'startAfter':
          default:
            qBase = query(qBase, startAfter(snap));
            break;
        }
      }
    }

    const qFinal = options?.useLimitToLast
      ? query(qBase, limitToLast(pageSize))
      : query(qBase, limit(pageSize));

    const snapshot = await getDocs(qFinal);

    const items: LeagueActivityItem[] = [];
    snapshot.forEach((docSnap) => {
      const data = docSnap.data() as Record<string, unknown>;
      items.push({
        id: docSnap.id,
        leagueId,
        type: String(data.type || ''),
        userId: data.userId ? String(data.userId) : undefined,
        teamId: data.teamId ? String(data.teamId) : undefined,
        playerId: data.playerId ? String(data.playerId) : undefined,
        dropPlayerId: data.dropPlayerId ? String(data.dropPlayerId) : undefined,
        bidAmount: typeof data.bidAmount === 'number' ? data.bidAmount : undefined,
        priority: typeof data.priority === 'number' ? data.priority : undefined,
        claimId: data.claimId ? String(data.claimId) : undefined,
        reason: data.reason ? String(data.reason) : undefined,
        timestamp: toDate(data.timestamp as Timestamp | Date | null | undefined) || new Date(),
      });
    });

    const firstDoc = snapshot.docs[0] ?? null;
    const lastDoc = snapshot.docs[snapshot.docs.length - 1] ?? null;

    return { items, firstDoc, lastDoc };
  }

  /** Convenience: get next page after a given lastDoc */
  async getNextActivityPage(
    leagueId: string,
    lastDoc: DocumentSnapshot,
    pageSize = 50,
    direction: 'asc' | 'desc' = 'desc'
  ) {
    return this.getLeagueActivityPage(leagueId, {
      pageSize,
      direction,
      cursor: lastDoc,
      boundary: 'startAfter',
    });
  }

  /** Convenience: get previous page before a given firstDoc */
  async getPrevActivityPage(
    leagueId: string,
    firstDoc: DocumentSnapshot,
    pageSize = 50,
    direction: 'asc' | 'desc' = 'desc'
  ) {
    return this.getLeagueActivityPage(leagueId, {
      pageSize,
      direction,
      cursor: firstDoc,
      boundary: 'endBefore',
      useLimitToLast: true,
    });
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

    keysToRemove.forEach((key) => this.subscriptions.delete(key));
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
