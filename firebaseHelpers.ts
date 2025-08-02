export type LeagueRequestStatus = 'Pending' | 'Approved' | 'Rejected';
export type LeagueRequest = { leagueId: string; status: LeagueRequestStatus };

export const getAllLeagueRequests = async (): Promise<
  { uid: string; leagueRequests: LeagueRequest[] }[]
> => [];

export const updateLeagueRequestStatus = async (
  _uid: string,
  _leagueId: string,
  _status: LeagueRequestStatus
): Promise<void> => {};

export const saveUserWatchlist = async (
  _uid: string,
  _watchlist: string[]
): Promise<void> => {};

export const loadUserWatchlist = async (_uid: string): Promise<string[]> =>
  Promise.resolve([]);

export const loadUserSettings = async <T = Record<string, unknown>>(
  _uid: string
): Promise<T> => Promise.resolve({} as T);

export const saveUserSettings = async <T = Record<string, unknown>>(
  _uid: string,
  _data: T
): Promise<void> => {};

export const saveUserTeam = async (_uid: string, _team: unknown): Promise<void> => {};
export const loadUserTeam = async (_uid: string): Promise<unknown> =>
  Promise.resolve(null);

export const saveUserTrades = async (
  _uid: string,
  _trades: unknown
): Promise<void> => {};
export const loadUserTrades = async (_uid: string): Promise<unknown> =>
  Promise.resolve(null);

export const saveUserPlayerNotes = async (
  _uid: string,
  _notes: unknown
): Promise<void> => {};
export const loadUserPlayerNotes = async (_uid: string): Promise<unknown> =>
  Promise.resolve(null);

export const loadUserLeagueRequests = async (
  _uid: string
): Promise<LeagueRequest[]> => Promise.resolve([]);

export const saveUserLeagueRequests = async (
  _uid: string,
  _requests: LeagueRequest[]
): Promise<void> => {};