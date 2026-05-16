import { describe, expect, it } from 'vitest';

import { buildDraftRoomViewModel } from './draftRoomViewModel';

const baseDraft = {
  id: 'draft-1',
  leagueId: 'league-1',
  name: 'Draft draft-1',
  status: 'LIVE',
  currentPick: 4,
  totalPicks: 44,
  round: 1,
  direction: 'FORWARD',
  settings: { totalRounds: 4 },
} as any;

const participants = [
  { id: 'member-1', userId: 'user-1', displayName: 'One', draftOrder: 1, queue: ['p2'] },
  { id: 'member-2', userId: 'user-2', displayName: 'Two', draftOrder: 2, queue: [] },
] as any;

const players = [
  { id: 'p1', name: 'Zed Mid', position: 'MID', club: 'Carlton', adp: 22 },
  { id: 'p2', name: 'Alpha Def', position: 'DEF', club: 'Adelaide', adp: 3 },
] as any;

describe('buildDraftRoomViewModel', () => {
  it('identifies the current draft member and queue', () => {
    const model = buildDraftRoomViewModel({
      draft: baseDraft,
      participants,
      picks: [],
      availablePlayers: players,
      selectedCategories: ['goals' as any],
      watchlistItems: [],
      currentUserId: 'user-1',
      filters: { searchQuery: '', positionFilter: 'ALL', sortBy: 'adp' },
      isYourTurn: false,
      connectionStatus: 'connected',
    });

    expect(model.currentMemberId).toBe('member-1');
    expect(model.currentDraftSlot).toBe(1);
    expect(model.queuedPlayerIds).toEqual(['p2']);
  });

  it('filters and sorts available players without mutating the source list', () => {
    const model = buildDraftRoomViewModel({
      draft: baseDraft,
      participants,
      picks: [],
      availablePlayers: players,
      selectedCategories: [],
      watchlistItems: [],
      currentUserId: 'user-1',
      filters: { searchQuery: 'a', positionFilter: 'ALL', sortBy: 'adp' },
      isYourTurn: false,
      connectionStatus: 'connected',
    });

    expect(model.filteredPlayers.map((player) => player.id)).toEqual(['p2', 'p1']);
    expect(players.map((player: any) => player.id)).toEqual(['p1', 'p2']);
  });

  it('uses precise live and paused turn language', () => {
    const liveModel = buildDraftRoomViewModel({
      draft: baseDraft,
      participants,
      picks: [],
      availablePlayers: players,
      selectedCategories: [],
      watchlistItems: [],
      currentUserId: 'user-1',
      filters: { searchQuery: '', positionFilter: 'ALL', sortBy: 'adp' },
      isYourTurn: true,
      connectionStatus: 'connected',
    });

    const pausedModel = buildDraftRoomViewModel({
      draft: { ...baseDraft, status: 'PAUSED' },
      participants,
      picks: [],
      availablePlayers: players,
      selectedCategories: [],
      watchlistItems: [],
      currentUserId: 'user-1',
      filters: { searchQuery: '', positionFilter: 'ALL', sortBy: 'adp' },
      isYourTurn: false,
      connectionStatus: 'connected',
    });

    expect(liveModel.turnDescription).toContain('pick clock');
    expect(pausedModel.turnDescription).toContain('paused');
  });

  it('builds board slots without exposing private queue data', () => {
    const model = buildDraftRoomViewModel({
      draft: baseDraft,
      participants,
      picks: [
        {
          id: 'pick-1',
          overall: 1,
          round: 1,
          slot: 1,
          player: players[0],
          member: { id: 'member-1', displayName: 'One' },
          auto: false,
          madeAt: new Date().toISOString(),
        },
      ] as any,
      availablePlayers: players,
      selectedCategories: [],
      watchlistItems: [{ playerId: 'p2' }],
      currentUserId: 'user-1',
      filters: { searchQuery: '', positionFilter: 'ALL', sortBy: 'adp' },
      isYourTurn: false,
      connectionStatus: 'connected',
    });

    expect(model.boardSlots[0]).toMatchObject({
      overallPick: 1,
      round: 1,
      draftOrder: 1,
      memberId: 'member-1',
      playerId: 'p1',
    });
    expect(model.boardSlots[1]).toMatchObject({
      overallPick: 2,
      round: 1,
      draftOrder: 2,
      memberId: 'member-2',
      playerId: null,
    });
    expect(model.boardSlots[0]).not.toHaveProperty('queue');
    expect(model.boardSlots[0]).not.toHaveProperty('watchlistItems');
  });
});
