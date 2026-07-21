import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  SOCIAL_COMPOSER_DRAFT_TTL_MS,
  createSocialComposerAttemptKey,
  getSocialComposerDraftKey,
  readSocialComposerDraft,
  writeSocialComposerDraft,
} from './socialComposerDraft';

describe('socialComposerDraft', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('isolates league, draft-room, and contextual drafts', () => {
    const base = {
      userId: 'user-1',
      leagueId: 'league-1',
      leagueSeasonId: 'season-1',
    };

    const leagueKey = getSocialComposerDraftKey({
      ...base,
      surface: { type: 'league-chat' },
    });
    const draftKey = getSocialComposerDraftKey({
      ...base,
      surface: { type: 'draft-chat', draftId: 'draft-1' },
    });
    const contextualKey = getSocialComposerDraftKey({
      ...base,
      surface: { type: 'league-chat' },
      discussion: { type: 'player', id: 'player-1' },
    });

    expect(new Set([leagueKey, draftKey, contextualKey]).size).toBe(3);
  });

  it('round-trips a draft and its stable retry key', () => {
    writeSocialComposerDraft(
      localStorage,
      'composer-key',
      { value: 'Unfinished message', attemptKey: 'chat:attempt-1' },
      100
    );

    expect(readSocialComposerDraft(localStorage, 'composer-key', 200)).toEqual({
      value: 'Unfinished message',
      attemptKey: 'chat:attempt-1',
      updatedAt: 100,
    });
  });

  it('expires abandoned drafts and removes empty drafts', () => {
    writeSocialComposerDraft(localStorage, 'expired', { value: 'Old draft' }, 100);
    expect(
      readSocialComposerDraft(localStorage, 'expired', 100 + SOCIAL_COMPOSER_DRAFT_TTL_MS + 1)
    ).toBeNull();
    expect(localStorage.getItem('expired')).toBeNull();

    localStorage.setItem('empty', 'stale');
    writeSocialComposerDraft(localStorage, 'empty', { value: '' });
    expect(localStorage.getItem('empty')).toBeNull();
  });

  it('creates server-compatible attempt keys', () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'attempt-uuid' });
    expect(createSocialComposerAttemptKey('chat')).toBe('chat:attempt-uuid');
    vi.unstubAllGlobals();
  });
});
