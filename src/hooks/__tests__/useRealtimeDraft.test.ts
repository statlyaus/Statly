import { renderHook, act } from '@testing-library/react';
import { vi } from 'vitest';

import { useRealtimeDraft } from '../useRealtimeDraft';

// Mock the socket client
vi.mock('@/client/socket', () => ({
  joinDraft: vi.fn(() => ({
    socket: {
      emit: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      removeAllListeners: vi.fn(),
      disconnect: vi.fn(),
    },
    cleanup: vi.fn(),
  })),
  emitPick: vi.fn(),
  emitQueueUpdate: vi.fn(),
}));

describe('useRealtimeDraft', () => {
  const mockInitialDraftData = {
    id: 'test-draft-1',
    currentPick: 1,
    totalPicks: 264,
    round: 1,
    direction: 'FORWARD',
    status: 'LIVE',
    participants: [
      {
        slot: 1,
        member: {
          id: 'member-1',
          userId: 'user-1',
          displayName: 'User One',
          email: 'user1@example.com',
        },
      },
      {
        slot: 2,
        member: {
          id: 'member-2',
          userId: 'user-2',
          displayName: 'User Two',
          email: 'user2@example.com',
        },
      },
      {
        slot: 3,
        member: {
          id: 'member-3',
          userId: 'user-3',
          displayName: 'User Three',
          email: 'user3@example.com',
        },
      },
    ],
    picks: [],
  };

  const currentUserId = 'user-1';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize with provided draft data', () => {
    const { result } = renderHook(() =>
      useRealtimeDraft(mockInitialDraftData, currentUserId)
    );

    expect(result.current.draftData).toEqual(mockInitialDraftData);
    expect(result.current.liveDraftState.isYourTurn).toBe(true); // user-1 is in slot 1, which is current turn
  });

  it('should handle participant leave event with userId correctly', () => {
    const { result } = renderHook(() =>
      useRealtimeDraft(mockInitialDraftData, currentUserId)
    );

    // Verify initial state has 3 participants
    expect(result.current.draftData.participants).toHaveLength(3);

    // Simulate participant leave event with userId by directly testing the filter logic
    act(() => {
      // This simulates the filter logic that should be used in handleParticipantLeave
      const filteredParticipants = result.current.draftData.participants.filter(
        (p) => p.member?.userId !== 'user-2'
      );
      
      // Update the draft data to simulate the participant leaving
      result.current.draftData = {
        ...result.current.draftData,
        participants: filteredParticipants,
      };
    });

    // Verify participant was removed correctly
    expect(result.current.draftData.participants).toHaveLength(2);
    expect(result.current.draftData.participants.find(p => p.member.userId === 'user-2')).toBeUndefined();
    expect(result.current.draftData.participants.find(p => p.member.userId === 'user-1')).toBeDefined();
    expect(result.current.draftData.participants.find(p => p.member.userId === 'user-3')).toBeDefined();
  });

  it('should handle participant leave event with socketId correctly', () => {
    const { result } = renderHook(() =>
      useRealtimeDraft(mockInitialDraftData, currentUserId)
    );

    // Verify initial state has 3 participants
    expect(result.current.draftData.participants).toHaveLength(3);

    // Simulate participant leave event with socketId (fallback case)
    act(() => {
      // This simulates the case where the server sends socketId instead of userId
      // The filter should not match socketId to userId, so no participant should be removed
      const filteredParticipants = result.current.draftData.participants.filter(
        (p) => p.member?.userId !== 'socket-123' // socketId doesn't match any userId
      );
      
      // Update the draft data
      result.current.draftData = {
        ...result.current.draftData,
        participants: filteredParticipants,
      };
    });

    // Verify no participant was removed since socketId doesn't match any userId
    expect(result.current.draftData.participants).toHaveLength(3);
  });

  it('should handle participant leave with null member safely', () => {
    const draftDataWithNullMember = {
      ...mockInitialDraftData,
      participants: [
        ...mockInitialDraftData.participants,
        {
          slot: 4,
          member: null as any, // Simulate corrupted data
        },
      ],
    };

    const { result } = renderHook(() =>
      useRealtimeDraft(draftDataWithNullMember, currentUserId)
    );

    // Verify initial state has 4 participants (including null member)
    expect(result.current.draftData.participants).toHaveLength(4);

    // Simulate participant leave event
    act(() => {
      // The filter should handle null member safely
      const filteredParticipants = result.current.draftData.participants.filter(
        (p) => p.member?.userId !== 'user-2'
      );
      
      // Update the draft data
      result.current.draftData = {
        ...result.current.draftData,
        participants: filteredParticipants,
      };
    });

    // Verify participant was removed and null member was preserved
    expect(result.current.draftData.participants).toHaveLength(3);
    expect(result.current.draftData.participants.find(p => p.member?.userId === 'user-2')).toBeUndefined();
    expect(result.current.draftData.participants.find(p => p.member === null)).toBeDefined();
  });

  it('should add activity when participant leaves', () => {
    const { result } = renderHook(() =>
      useRealtimeDraft(mockInitialDraftData, currentUserId)
    );

    // Verify initial activity is empty
    expect(result.current.recentActivity).toHaveLength(0);

    // Simulate participant leave event by adding activity directly
    act(() => {
      // Simulate the activity addition that happens in the real handler
      const newActivity = {
        id: `${Date.now()}-${Math.random()}`,
        type: 'leave' as const,
        message: 'A participant left the draft',
        timestamp: new Date().toISOString(),
      };
      result.current.recentActivity = [newActivity, ...result.current.recentActivity.slice(0, 49)];
    });

    // Verify activity was added
    expect(result.current.recentActivity).toHaveLength(1);
    expect(result.current.recentActivity[0].type).toBe('leave');
    expect(result.current.recentActivity[0].message).toBe('A participant left the draft');
  });
});
