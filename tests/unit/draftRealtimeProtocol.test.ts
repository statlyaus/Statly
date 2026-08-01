import { describe, expect, it } from 'vitest';

import {
  DraftRealtimeJoinAckSchema,
  DraftRealtimeJoinRequestSchema,
  selectDraftRealtimeProtocol,
} from '@/services/realtime/draftRealtimeV2';

describe('draft realtime protocol negotiation', () => {
  it('keeps capability-absent legacy clients on v1', () => {
    const request = DraftRealtimeJoinRequestSchema.parse({ draftId: 'draft-1' });

    expect(selectDraftRealtimeProtocol(request.realtimeProtocols, [2, 1])).toBe(1);
  });

  it('respects client preference order among mutually supported protocols', () => {
    expect(selectDraftRealtimeProtocol([2, 1], [2, 1])).toBe(2);
    expect(selectDraftRealtimeProtocol([1, 2], [2, 1])).toBe(1);
  });

  it('falls back to v1 only when the client explicitly offers it', () => {
    expect(selectDraftRealtimeProtocol([2, 1], [1])).toBe(1);
    expect(selectDraftRealtimeProtocol([2], [1])).toBeNull();
  });

  it('rejects malformed capability lists and acknowledgements', () => {
    expect(
      DraftRealtimeJoinRequestSchema.safeParse({ draftId: 'draft-1', realtimeProtocols: [] })
        .success
    ).toBe(false);
    expect(
      DraftRealtimeJoinAckSchema.safeParse({
        ok: true,
        draftId: 'draft-1',
        protocol: 3,
      }).success
    ).toBe(false);
  });
});
