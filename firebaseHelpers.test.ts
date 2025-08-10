/* @vitest-environment jsdom */
import { describe, expect, it, beforeEach } from 'vitest';
import {
  loadUserSettings,
  saveUserSettings,
  loadUserLeagueRequests,
  saveUserLeagueRequests,
  type LeagueRequest,
  type UserSettings,
} from './firebaseHelpers';

const uid = 'user-1';

describe('firebaseHelpers', () => {
  beforeEach(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.clear();
    }
  });

  it('saves and loads user settings', () => {
    const settings: UserSettings = {
      theme: 'dark',
      notifications: false,
      favoriteTeam: 'Cats',
    };
    saveUserSettings(uid, settings);
    const result = loadUserSettings(uid);
    expect(result).toEqual(settings);
  });

  it('saves and loads league requests', () => {
    const requests: LeagueRequest[] = [{ leagueId: 'abc', status: 'Pending' }];
    saveUserLeagueRequests(uid, requests);
    const result = loadUserLeagueRequests(uid);
    expect(result).toEqual(requests);
  });

  it('returns empty object when settings are malformed', () => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(
      `user_settings:${uid}`,
      JSON.stringify('not-an-object')
    );
    expect(loadUserSettings(uid)).toEqual({});
  });

  it('returns empty array when league requests are malformed', () => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(
      `league_requests:${uid}`,
      JSON.stringify({ bad: 'data' })
    );
    expect(loadUserLeagueRequests(uid)).toEqual([]);
  });
});
