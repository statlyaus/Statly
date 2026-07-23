import type { TradePlayerDto } from '@/server/leagues/trades/tradeContracts';

export interface TradeComposerState {
  partnerId: string;
  sendingPlayerIds: string[];
  receivingPlayerIds: string[];
  message: string;
  activeRoster: 'sending' | 'receiving';
  step: 'edit' | 'review';
}

export type TradeComposerAction =
  | { type: 'selectPartner'; partnerId: string }
  | {
      type: 'initializeDeepLink';
      partnerId: string;
      sendingPlayerIds: string[];
      receivingPlayerIds: string[];
    }
  | { type: 'toggleSendingPlayer'; playerId: string }
  | { type: 'toggleReceivingPlayer'; playerId: string }
  | { type: 'syncSelections'; sendingPlayerIds: string[]; receivingPlayerIds: string[] }
  | { type: 'clearSelections' }
  | { type: 'setMessage'; message: string }
  | { type: 'showRoster'; roster: TradeComposerState['activeRoster'] }
  | { type: 'review' }
  | { type: 'edit' }
  | { type: 'reset' };

export interface CreateTradeComposerStateInput {
  partnerId: string;
  sendingPlayerIds?: string[];
  receivingPlayerIds?: string[];
  message?: string;
}

export function createTradeComposerState(input: CreateTradeComposerStateInput): TradeComposerState {
  return {
    partnerId: input.partnerId,
    sendingPlayerIds: [...(input.sendingPlayerIds ?? [])],
    receivingPlayerIds: [...(input.receivingPlayerIds ?? [])],
    message: input.message ?? '',
    activeRoster: 'sending',
    step: 'edit',
  };
}

function togglePlayer(selectedIds: readonly string[], playerId: string): string[] {
  return selectedIds.includes(playerId)
    ? selectedIds.filter((selectedId) => selectedId !== playerId)
    : [...selectedIds, playerId];
}

export function isTradeSelectionComplete(state: TradeComposerState): boolean {
  return state.sendingPlayerIds.length > 0 && state.receivingPlayerIds.length > 0;
}

export function tradeComposerReducer(
  state: TradeComposerState,
  action: TradeComposerAction
): TradeComposerState {
  switch (action.type) {
    case 'initializeDeepLink':
      return createTradeComposerState({
        partnerId: action.partnerId,
        sendingPlayerIds: action.sendingPlayerIds,
        receivingPlayerIds: action.receivingPlayerIds,
      });
    case 'selectPartner':
      return {
        ...state,
        partnerId: action.partnerId,
        receivingPlayerIds: [],
        step: 'edit',
      };
    case 'toggleSendingPlayer':
      return {
        ...state,
        sendingPlayerIds: togglePlayer(state.sendingPlayerIds, action.playerId),
      };
    case 'toggleReceivingPlayer':
      return {
        ...state,
        receivingPlayerIds: togglePlayer(state.receivingPlayerIds, action.playerId),
      };
    case 'syncSelections':
      return {
        ...state,
        sendingPlayerIds: [...action.sendingPlayerIds],
        receivingPlayerIds: [...action.receivingPlayerIds],
      };
    case 'clearSelections':
      return {
        ...state,
        sendingPlayerIds: [],
        receivingPlayerIds: [],
        step: 'edit',
      };
    case 'setMessage':
      return { ...state, message: action.message };
    case 'showRoster':
      return { ...state, activeRoster: action.roster };
    case 'review':
      return isTradeSelectionComplete(state) ? { ...state, step: 'review' } : state;
    case 'edit':
      return { ...state, step: 'edit' };
    case 'reset':
      return createTradeComposerState({ partnerId: state.partnerId });
  }
}

export function getSelectedPlayers(
  players: readonly TradePlayerDto[],
  selectedIds: readonly string[]
): TradePlayerDto[] {
  const selectedIdSet = new Set(selectedIds);
  return players.filter((player) => selectedIdSet.has(player.id));
}

function getPositionCountMap(players: readonly TradePlayerDto[]): Map<string, number> {
  const counts = new Map<string, number>();

  players.forEach((player) => {
    counts.set(player.position, (counts.get(player.position) ?? 0) + 1);
  });

  return counts;
}

export function getPositionCounts(players: readonly TradePlayerDto[]): Record<string, number> {
  return Object.fromEntries(getPositionCountMap(players));
}

export function getPositionDeltas(
  outgoingPlayers: readonly TradePlayerDto[],
  incomingPlayers: readonly TradePlayerDto[]
): Record<string, number> {
  const outgoingCounts = getPositionCountMap(outgoingPlayers);
  const incomingCounts = getPositionCountMap(incomingPlayers);
  const positions = new Set([...outgoingCounts.keys(), ...incomingCounts.keys()]);

  return Object.fromEntries(
    [...positions].map((position) => [
      position,
      (incomingCounts.get(position) ?? 0) - (outgoingCounts.get(position) ?? 0),
    ])
  );
}
