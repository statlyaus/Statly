export interface UserSettings {
  theme: string;
  notifications: boolean;
  favoriteTeam: string;
}

export interface LeagueRequest {
  leagueId: string;
  status: string;
}

const SETTINGS_PREFIX = 'user_settings:';
const LEAGUE_PREFIX = 'league_requests:';

function hasLocalStorage() {
  try {
    return typeof window !== 'undefined' && !!window.localStorage;
  } catch {
    return false;
  }
}

export function loadUserSettings(uid: string): Partial<UserSettings> {
  if (!hasLocalStorage()) return {};
  try {
    const raw = window.localStorage.getItem(`${SETTINGS_PREFIX}${uid}`);
    if (!raw) return {};
    const data = JSON.parse(raw);
    return typeof data === 'object' && data !== null ? data : {};
  } catch {
    return {};
  }
}

export function saveUserSettings(uid: string, settings: UserSettings): void {
  if (!hasLocalStorage()) return;
  try {
    window.localStorage.setItem(
      `${SETTINGS_PREFIX}${uid}`,
      JSON.stringify(settings)
    );
  } catch (err) {
    console.error('Failed to save user settings', err);
  }
}

export function loadUserLeagueRequests(uid: string): LeagueRequest[] {
  if (!hasLocalStorage()) return [];
  try {
    const raw = window.localStorage.getItem(`${LEAGUE_PREFIX}${uid}`);
    if (!raw) return [];
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export function saveUserLeagueRequests(
  uid: string,
  requests: LeagueRequest[]
): void {
  if (!hasLocalStorage()) return;
  try {
    window.localStorage.setItem(
      `${LEAGUE_PREFIX}${uid}`,
      JSON.stringify(requests)
    );
  } catch (err) {
    console.error('Failed to save league requests', err);
  }
}
