export type LeagueRequest = {
  leagueId: string;
  status: string;
};

// Fallback storage for non-browser environments (e.g., tests)
const memoryStore: Record<string, string> = {};

function getStorage() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // ignore access errors
  }

  return {
    getItem(key: string) {
      return Object.prototype.hasOwnProperty.call(memoryStore, key)
        ? memoryStore[key]
        : null;
    },
    setItem(key: string, value: string) {
      memoryStore[key] = value;
    },
  } as Pick<Storage, 'getItem' | 'setItem'>;
}

const storage = getStorage();

export async function loadUserSettings(uid: string): Promise<Record<string, unknown>> {
  const data = storage.getItem(`userSettings_${uid}`);
  return data ? JSON.parse(data) : {};
}

export async function saveUserSettings(
  uid: string,
  settings: Record<string, unknown>
): Promise<void> {
  storage.setItem(`userSettings_${uid}`, JSON.stringify(settings));
}

export async function loadUserLeagueRequests(uid: string): Promise<LeagueRequest[]> {
  const data = storage.getItem(`userLeagueRequests_${uid}`);
  return data ? JSON.parse(data) : [];
}

export async function saveUserLeagueRequests(
  uid: string,
  requests: LeagueRequest[]
): Promise<void> {
  storage.setItem(`userLeagueRequests_${uid}`, JSON.stringify(requests));
}

