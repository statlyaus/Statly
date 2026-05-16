import type { FantasyCategoryKey } from '@/types/fantasyCategories';
import type { DraftParticipant, DraftPick, DraftPlayer, DraftState } from '@/types/draft';

export type DraftPlayerSortKey = 'adp' | 'name' | 'position' | 'club';

export interface DraftRoomFilters {
  searchQuery: string;
  positionFilter: string;
  sortBy: DraftPlayerSortKey;
}

export interface DraftRoomViewModelInput {
  draft: DraftState;
  participants: DraftParticipant[];
  picks: DraftPick[];
  availablePlayers: DraftPlayer[];
  selectedCategories: FantasyCategoryKey[];
  watchlistItems: Array<{ playerId: string }>;
  currentUserId: string;
  filters: DraftRoomFilters;
  isYourTurn: boolean;
  connectionStatus: string;
}

export interface DraftRoomViewModel {
  boardSlots: DraftBoardSlotViewModel[];
  currentParticipant: DraftParticipant | undefined;
  currentMemberId: string;
  currentDraftSlot: number | undefined;
  filteredPlayers: DraftPlayer[];
  availablePositions: string[];
  visibleCategories: FantasyCategoryKey[];
  draftProgressPercent: number;
  totalRounds: number | null;
  displayDraftTitle: string;
  displayDraftSubtitle: string;
  turnDescription: string;
  queuedPlayerIds: string[];
  draftedPlayerIds: string[];
  watchedPlayerIds: string[];
}

export interface DraftBoardSlotViewModel {
  overallPick: number;
  round: number;
  draftOrder: number;
  memberId: string;
  memberDisplayName: string;
  isCurrentPick: boolean;
  isCompleted: boolean;
  playerId: string | null;
  playerName: string | null;
  playerPosition: string | null;
  playerClub: string | null;
  isAutoPick: boolean;
}

function resolveDraftOrderForPick(overallPick: number, teamCount: number): number {
  const round = Math.ceil(overallPick / teamCount);
  const indexWithinRound = ((overallPick - 1) % teamCount) + 1;
  return round % 2 === 1 ? indexWithinRound : teamCount - indexWithinRound + 1;
}

function buildBoardSlots({
  draft,
  participants,
  picks,
}: {
  draft: DraftState;
  participants: DraftParticipant[];
  picks: DraftPick[];
}): DraftBoardSlotViewModel[] {
  const teamCount = participants.length;
  if (teamCount === 0 || draft.totalPicks <= 0) return [];

  const participantsByDraftOrder = new Map(
    participants.map((participant) => [Number(participant.draftOrder), participant])
  );
  const picksByOverall = new Map(picks.map((pick) => [Number(pick.overall), pick]));

  return Array.from({ length: draft.totalPicks }, (_, index) => {
    const overallPick = index + 1;
    const round = Math.ceil(overallPick / teamCount);
    const draftOrder = resolveDraftOrderForPick(overallPick, teamCount);
    const participant = participantsByDraftOrder.get(draftOrder);
    const pick = picksByOverall.get(overallPick);

    return {
      overallPick,
      round,
      draftOrder,
      memberId: participant?.id ?? '',
      memberDisplayName: participant?.displayName ?? `Team ${draftOrder}`,
      isCurrentPick: overallPick === draft.currentPick,
      isCompleted: Boolean(pick),
      playerId: pick?.player?.id ?? null,
      playerName: pick?.player?.name ?? null,
      playerPosition: pick?.player?.position ?? null,
      playerClub: pick?.player?.club ?? null,
      isAutoPick: Boolean(pick?.auto),
    };
  });
}

export function buildDraftRoomViewModel(input: DraftRoomViewModelInput): DraftRoomViewModel {
  const currentParticipant = input.participants.find(
    (participant) => String(participant.userId) === String(input.currentUserId)
  );
  const currentDraftSlot = currentParticipant?.draftOrder;
  const currentMemberId = currentParticipant?.id ?? '';
  const searchQuery = input.filters.searchQuery.trim().toLowerCase();

  const searchedPlayers = searchQuery
    ? input.availablePlayers.filter(
        (player) =>
          player.name.toLowerCase().includes(searchQuery) ||
          player.club.toLowerCase().includes(searchQuery) ||
          player.position.toLowerCase().includes(searchQuery)
      )
    : input.availablePlayers;

  const positionedPlayers =
    input.filters.positionFilter === 'ALL'
      ? searchedPlayers
      : searchedPlayers.filter((player) => player.position === input.filters.positionFilter);

  const filteredPlayers = [...positionedPlayers].sort((a, b) => {
    if (input.filters.sortBy === 'adp') {
      return Number(a.adp ?? 999) - Number(b.adp ?? 999);
    }

    return String(a[input.filters.sortBy] ?? '').localeCompare(
      String(b[input.filters.sortBy] ?? '')
    );
  });

  const derivedTotalRounds =
    input.draft.totalPicks > 0 && input.participants.length > 0
      ? Math.ceil(input.draft.totalPicks / input.participants.length)
      : null;
  const totalRounds = input.draft.settings?.totalRounds ?? derivedTotalRounds;
  const draftProgressPercent =
    input.draft.totalPicks > 0
      ? Math.min(100, Math.max(0, (input.draft.currentPick / input.draft.totalPicks) * 100))
      : 0;
  const hasPlaceholderDraftName =
    !input.draft.name ||
    input.draft.name === input.draft.id ||
    input.draft.name === `Draft ${input.draft.id}`;
  const displayDraftTitle = hasPlaceholderDraftName ? 'League Draft' : input.draft.name;
  const displayDraftSubtitle =
    totalRounds && totalRounds > 0
      ? `Round ${input.draft.round} of ${totalRounds}. Pick ${input.draft.currentPick} of ${input.draft.totalPicks}.`
      : `Pick ${input.draft.currentPick} of ${input.draft.totalPicks}.`;
  const turnDescription = input.isYourTurn
    ? 'Your pick clock is active. Your queue is the fallback if time expires.'
    : input.draft.status === 'PAUSED'
      ? 'Draft is paused. The server clock and auto-pick are stopped.'
      : input.draft.status === 'LIVE'
        ? 'Waiting for your pick. Keep your queue ready before the clock reaches you.'
        : `Connection: ${input.connectionStatus}`;

  return {
    boardSlots: buildBoardSlots({
      draft: input.draft,
      participants: input.participants,
      picks: input.picks,
    }),
    currentParticipant,
    currentMemberId,
    currentDraftSlot,
    filteredPlayers,
    availablePositions: [
      'ALL',
      ...Array.from(new Set(input.availablePlayers.map((player) => player.position))).sort(),
    ],
    visibleCategories: input.selectedCategories.slice(0, 6),
    draftProgressPercent,
    totalRounds,
    displayDraftTitle,
    displayDraftSubtitle,
    turnDescription,
    queuedPlayerIds: currentParticipant?.queue ?? [],
    draftedPlayerIds: input.picks
      .map((pick) => String(pick.player?.id ?? ''))
      .filter((playerId) => playerId.length > 0),
    watchedPlayerIds: input.watchlistItems.map((item) => String(item.playerId)),
  };
}
