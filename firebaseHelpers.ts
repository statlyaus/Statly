// Minimal stubs for settings-related Firebase helpers used in the app.
// These allow the frontend to compile without an actual backend implementation.

export type UserSettings = {
  theme: string;
  notifications: boolean;
  favoriteTeam: string;
};

export type LeagueRequest = {
  leagueId: string;
  status: string;
};

// In a real app these would interact with Firebase. Here we simply
// resolve with default values to keep the typechecker satisfied.
export async function loadUserSettings(userId: string): Promise<Partial<UserSettings>> {
  void userId;
  return {};
}

export async function saveUserSettings(userId: string, settings: UserSettings): Promise<void> {
  void userId;
  void settings;
}

export async function loadUserLeagueRequests(userId: string): Promise<LeagueRequest[]> {
  void userId;
  return [];
}

export async function saveUserLeagueRequests(userId: string, requests: LeagueRequest[]): Promise<void> {
  void userId;
  void requests;
}

