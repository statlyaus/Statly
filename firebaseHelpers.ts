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

export async function loadUserSettings(uid: string): Promise<Partial<UserSettings>> {
  if (!hasLocalStorage()) return {};
  try {
    const raw = window.localStorage.getItem(`${SETTINGS_PREFIX}${uid}`);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export async function saveUserSettings(uid: string, settings: UserSettings): Promise<void> {
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

export async function loadUserLeagueRequests(uid: string): Promise<LeagueRequest[]> {
  if (!hasLocalStorage()) return [];
  try {
    const raw = window.localStorage.getItem(`${LEAGUE_PREFIX}${uid}`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function saveUserLeagueRequests(uid: string, requests: LeagueRequest[]): Promise<void> {
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
