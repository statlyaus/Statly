import type {
  DraftAction,
  DraftState,
  DraftPick,
  DraftParticipant,
  DraftPlayer,
  ConnectionState,
  TimerState,
  LiveDraftState,
  DraftDirection,
} from '@/types/draft';

export interface DraftReducerState {
  // Core state
  draft: DraftState | null;
  participants: DraftParticipant[];
  picks: DraftPick[];
  availablePlayers: DraftPlayer[];

  // Real-time state
  connection: ConnectionState;
  timer: TimerState;
  liveState: LiveDraftState;

  // Loading states
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
}

export const initialState: DraftReducerState = {
  draft: null,
  participants: [],
  picks: [],
  availablePlayers: [],
  connection: {
    status: 'disconnected',
    reconnectAttempts: 0,
    latency: 0,
  },
  timer: {
    timeRemaining: 0,
    isActive: false,
    isExpired: false,
    autoPickEnabled: false,
    autoPickTime: 120,
  },
  liveState: {
    picksUntilYourTurn: 0,
    isYourTurn: false,
  },
  isLoading: true,
  isSaving: false,
  error: null,
};

export function draftReducer(state: DraftReducerState, action: DraftAction): DraftReducerState {
  switch (action.type) {
    case 'SET_DRAFT':
      return {
        ...state,
        draft: action.payload.draft,
        participants: action.payload.participants || [],
        picks: action.payload.picks || [],
        availablePlayers: action.payload.availablePlayers || [],
        isLoading: false,
        error: null,
      };

    case 'UPDATE_PICK':
      return {
        ...state,
        picks: [...state.picks, action.payload.pick],
        availablePlayers: state.availablePlayers.map((player) =>
          player.id === action.payload.pick.player.id
            ? {
                ...player,
                isAvailable: false,
                draftedBy: action.payload.pick.member.userId,
                pickNumber: action.payload.pick.overall,
              }
            : player
        ),
        draft: state.draft
          ? {
              ...state.draft,
              currentPick: action.payload.currentPick,
              round: action.payload.round,
              direction: action.payload.direction,
              lastActivity: action.payload.lastActivity,
            }
          : null,
      };

    case 'UPDATE_PARTICIPANT':
      return {
        ...state,
        participants: state.participants.map((participant) =>
          participant.id === action.payload.participantId
            ? { ...participant, ...action.payload.updates }
            : participant
        ),
      };

    case 'SET_CONNECTION':
      return {
        ...state,
        connection: { ...state.connection, ...action.payload },
      };

    case 'SET_TIMER':
      return {
        ...state,
        timer: { ...state.timer, ...action.payload },
      };

    case 'SET_ERROR':
      return {
        ...state,
        error: action.payload.error,
        isLoading: false,
        isSaving: false,
      };

    case 'CLEAR_ERROR':
      return {
        ...state,
        error: null,
      };

    case 'SET_LOADING':
      return {
        ...state,
        isLoading: action.payload.isLoading,
        isSaving: action.payload.isSaving || false,
      };

    default:
      return state;
  }
}

// Helper functions for common state updates
export const draftActions = {
  setDraft: (
    draft: DraftState,
    participants: DraftParticipant[],
    picks: DraftPick[],
    availablePlayers: DraftPlayer[]
  ) => ({
    type: 'SET_DRAFT' as const,
    payload: { draft, participants, picks, availablePlayers },
  }),

  updatePick: (
    pick: DraftPick,
    currentPick: number,
    round: number,
    direction: DraftDirection,
    lastActivity: Date
  ) => ({
    type: 'UPDATE_PICK' as const,
    payload: { pick, currentPick, round, direction, lastActivity },
  }),

  updateParticipant: (participantId: string, updates: Partial<DraftParticipant>) => ({
    type: 'UPDATE_PARTICIPANT' as const,
    payload: { participantId, updates },
  }),

  setConnection: (updates: Partial<ConnectionState>) => ({
    type: 'SET_CONNECTION' as const,
    payload: updates,
  }),

  setTimer: (updates: Partial<TimerState>) => ({
    type: 'SET_TIMER' as const,
    payload: updates,
  }),

  setError: (error: string) => ({
    type: 'SET_ERROR' as const,
    payload: { error },
  }),

  clearError: () => ({
    type: 'CLEAR_ERROR' as const,
    payload: {},
  }),

  setLoading: (isLoading: boolean, isSaving: boolean = false) => ({
    type: 'SET_LOADING' as const,
    payload: { isLoading, isSaving },
  }),
};
