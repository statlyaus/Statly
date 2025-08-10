// Simple in-memory helpers used by SettingsPage tests
// These stand in for real Firebase calls.

export type UserSettings = {
  theme: string;
  notifications: boolean;
  favoriteTeam: string;
};

export type LeagueRequest = {
  leagueId: string;
  status: string;
};

const settingsStore = new Map<string, Partial<UserSettings>>();
const leagueRequestStore = new Map<string, LeagueRequest[]>();

export async function loadUserSettings(uid: string): Promise<Partial<UserSettings>> {
  return settingsStore.get(uid) ?? {};
}

export async function saveUserSettings(uid: string, settings: Partial<UserSettings>): Promise<void> {
  settingsStore.set(uid, { ...settings });
}

export async function loadUserLeagueRequests(uid: string): Promise<LeagueRequest[]> {
  return leagueRequestStore.get(uid) ?? [];
}

export async function saveUserLeagueRequests(uid: string, requests: LeagueRequest[]): Promise<void> {
  leagueRequestStore.set(uid, [...requests]);
}

export {};
