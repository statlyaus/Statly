import { 
  doc, 
  setDoc, 
  getDoc, 
  updateDoc, 
  arrayUnion, 
  serverTimestamp,
  onSnapshot,
  type Unsubscribe,
  type Firestore
} from 'firebase/firestore';
import { db } from '@/lib/firebaseClient';

interface DraftPlayer {
  id: string;
  name: string;
  position: string;
  club: string;
  fantasyPoints?: number;
  avgPoints?: number;
}

interface DraftPick {
  id: string;
  overall: number;
  round: number;
  slot: number;
  player: DraftPlayer;
  member: {
    id: string;
    displayName: string;
  };
  auto: boolean;
  madeAt: string;
  timestamp: ReturnType<typeof serverTimestamp>;
}

interface DraftParticipant {
  id: string;
  displayName: string;
  position: number;
  isOnline: boolean;
  lastSeen: ReturnType<typeof serverTimestamp>;
  queue: string[]; // Player IDs in queue
}

interface DraftState {
  id: string;
  name: string;
  leagueSize: number;
  draftType: 'snake' | 'linear';
  status: 'PENDING' | 'LIVE' | 'PAUSED' | 'COMPLETED';
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
  };
}

export class DraftPersistenceService {
  private static instance: DraftPersistenceService;
  private listeners: Map<string, Unsubscribe> = new Map();

  static getInstance(): DraftPersistenceService {
    if (!DraftPersistenceService.instance) {
      DraftPersistenceService.instance = new DraftPersistenceService();
    }
    return DraftPersistenceService.instance;
  }

  private getFirestore(): Firestore {
    if (!db) {
      throw new Error('Firestore is not initialized. Please check your Firebase configuration.');
    }
    return db;
  }

  /**
   * Initialize a new draft in Firestore
   */
  async initializeDraft(draftData: Partial<DraftState>): Promise<void> {
    try {
      const firestore = this.getFirestore();
      const draftRef = doc(firestore, 'drafts', draftData.id!);
      
      const initialState: DraftState = {
        id: draftData.id!,
        name: draftData.name || 'Untitled Draft',
        leagueSize: draftData.leagueSize || 12,
        draftType: draftData.draftType || 'snake',
        status: 'PENDING',
        currentPick: 1,
        currentRound: 1,
        currentTurn: 0,
        timeRemaining: 120,
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
          ...draftData.settings
        }
      };

      await setDoc(draftRef, initialState);
      console.log(`📦 Draft ${draftData.id} initialized in Firestore`);
    } catch (error) {
      console.error('Error initializing draft:', error);
      throw error;
    }
  }

  /**
   * Get current draft state from Firestore
   */
  async getDraftState(draftId: string): Promise<DraftState | null> {
    try {
      const firestore = this.getFirestore();
      const draftRef = doc(firestore, 'drafts', draftId);
      const draftSnap = await getDoc(draftRef);
      
      if (draftSnap.exists()) {
        const data = draftSnap.data() as DraftState;
        console.log(`📖 Draft state retrieved for ${draftId}`);
        return data;
      }
      
      console.warn(`Draft ${draftId} not found in Firestore`);
      return null;
    } catch (error) {
      console.error('Error fetching draft state:', error);
      return null;
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
          timestamp: serverTimestamp()
        }),
        currentPick: currentState.currentPick + 1,
        currentRound: nextRound,
        currentTurn: nextTurn,
        timeRemaining: currentState.settings.pickTimeLimit,
        status: isComplete ? 'COMPLETED' : currentState.status,
        updatedAt: serverTimestamp(),
        lastActivity: serverTimestamp()
      });

      console.log(`✅ Pick saved: ${pick.player.name} by ${pick.member.displayName} (Pick ${currentState.currentPick})`);
    } catch (error) {
      console.error('Error saving pick:', error);
      throw error;
    }
  }

  /**
   * Update participant status (online/offline, queue changes)
   */
  async updateParticipant(draftId: string, participantId: string, updates: Partial<DraftParticipant>): Promise<void> {
    try {
      const firestore = this.getFirestore();
      const draftRef = doc(firestore, 'drafts', draftId);
      const currentState = await this.getDraftState(draftId);
      
      if (!currentState) throw new Error('Draft not found');

      const updatedParticipants = currentState.participants.map(p => 
        p.id === participantId 
          ? { ...p, ...updates, lastSeen: serverTimestamp() }
          : p
      );

      await updateDoc(draftRef, {
        participants: updatedParticipants,
        updatedAt: serverTimestamp(),
        lastActivity: serverTimestamp()
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
        lastActivity: serverTimestamp()
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
    
    const unsubscribe = onSnapshot(draftRef, (doc) => {
      if (doc.exists()) {
        const draftState = doc.data() as DraftState;
        console.log(`🔄 Real-time update received for draft ${draftId}`);
        callback(draftState);
      }
    }, (error) => {
      console.error('Error listening to draft updates:', error);
    });

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
          lastSeen: serverTimestamp()
        });
        
        console.log(`🔄 Draft state recovered for participant ${participantId} in draft ${draftId}`);
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
        lastSeen: serverTimestamp()
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
        lastActivity: draftState.lastActivity
      };
    } catch (error) {
      console.error('Error getting draft summary:', error);
      return null;
    }
  }
}

export const draftPersistence = DraftPersistenceService.getInstance();
export type { DraftState, DraftPick, DraftParticipant, DraftPlayer };
