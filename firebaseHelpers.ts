export type LeagueRequest = {
  leagueId: string;
  status: string;
};

export async function loadUserSettings(_uid: string): Promise<Record<string, unknown>> {
  return {};
}

export async function saveUserSettings(
  _uid: string,
  _settings: Record<string, unknown>
): Promise<void> {
  // no-op
}

export async function loadUserLeagueRequests(_uid: string): Promise<LeagueRequest[]> {
  return [];
}

export async function saveUserLeagueRequests(
  _uid: string,
  _requests: LeagueRequest[]
): Promise<void> {
  // no-op
}
