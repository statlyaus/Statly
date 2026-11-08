import { describe, expect, it } from 'vitest';

import {
  draftRoom,
  isLeagueSocialRoom,
  leagueSeasonSocialRoom,
  legacyDraftRoom,
} from './roomNames';

describe('Socket.IO room names', () => {
  it('names league social rooms by league and season', () => {
    expect(leagueSeasonSocialRoom('league-1', 'season-2026')).toBe(
      'social:league:league-1:season:season-2026'
    );
    expect(leagueSeasonSocialRoom('league-1', 'season-2026')).not.toBe(
      leagueSeasonSocialRoom('league-1', 'season-2027')
    );
  });

  it('recognises a league social room in any season, and only that league', () => {
    expect(isLeagueSocialRoom('social:league:league-1:season:season-2026', 'league-1')).toBe(true);
    expect(isLeagueSocialRoom('social:league:league-10:season:season-2026', 'league-1')).toBe(
      false
    );
    expect(isLeagueSocialRoom('social:league:league-1', 'league-1')).toBe(false);
    expect(isLeagueSocialRoom('draft:league-1', 'league-1')).toBe(false);
  });

  it('keeps draft rooms keyed by the draft id, which belongs to one league season', () => {
    expect(draftRoom('draft-1')).toBe('draft:draft-1');
    expect(legacyDraftRoom('draft-1')).toBe('draft-1');
  });

  it('refuses ids that are empty or could spell another room', () => {
    expect(() => leagueSeasonSocialRoom('', 'season-2026')).toThrow();
    expect(() => leagueSeasonSocialRoom('league-1', '')).toThrow();
    expect(() => leagueSeasonSocialRoom('league-1:season:other', 'season-2026')).toThrow();
    expect(() => legacyDraftRoom('social:league:league-1')).toThrow();
    expect(() => draftRoom('')).toThrow();
  });
});
