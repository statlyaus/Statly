export const DEVELOPMENT_AUTH_USER_ID = 'statly-dev-tester';
export const DEVELOPMENT_AUTH_EMAIL = 'admin@statly.dev';
export const DEVELOPMENT_AUTH_DISPLAY_NAME = 'Statly Dev Tester';
export const DEVELOPMENT_AUTH_STORAGE_KEY = 'statly.devAuth.user';
export const DEVELOPMENT_AUTH_COOKIE = 'statly_dev_user';

export interface DevelopmentAuthUser {
  uid: string;
  email: string;
  displayName: string;
}

export function isDevelopmentAuthEnabled(): boolean {
  return process.env.NODE_ENV !== 'production';
}

export function createDevelopmentAuthUser(): DevelopmentAuthUser {
  return {
    uid: DEVELOPMENT_AUTH_USER_ID,
    email: DEVELOPMENT_AUTH_EMAIL,
    displayName: DEVELOPMENT_AUTH_DISPLAY_NAME,
  };
}

export function isDevelopmentLogin(email: string, phrase: string): boolean {
  return (
    isDevelopmentAuthEnabled() &&
    email.trim().toLowerCase() === DEVELOPMENT_AUTH_EMAIL &&
    phrase === getDevelopmentAuthLoginPhrase()
  );
}

function getDevelopmentAuthLoginPhrase(): string {
  return ['statly', 'dev'].join('-');
}

export function persistDevelopmentAuthUser(user = createDevelopmentAuthUser()): void {
  if (typeof window === 'undefined') return;

  window.localStorage.setItem(DEVELOPMENT_AUTH_STORAGE_KEY, JSON.stringify(user));
  document.cookie = `${DEVELOPMENT_AUTH_COOKIE}=${encodeURIComponent(
    user.uid
  )}; Path=/; SameSite=Lax; Max-Age=1209600`;
}

export function clearDevelopmentAuthUser(): void {
  if (typeof window === 'undefined') return;

  window.localStorage.removeItem(DEVELOPMENT_AUTH_STORAGE_KEY);
  document.cookie = `${DEVELOPMENT_AUTH_COOKIE}=; Path=/; SameSite=Lax; Max-Age=0`;
}

export function readStoredDevelopmentAuthUser(): DevelopmentAuthUser | null {
  if (typeof window === 'undefined' || !isDevelopmentAuthEnabled()) return null;

  try {
    const raw = window.localStorage.getItem(DEVELOPMENT_AUTH_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<DevelopmentAuthUser>;
    if (parsed.uid !== DEVELOPMENT_AUTH_USER_ID) return null;

    return {
      uid: DEVELOPMENT_AUTH_USER_ID,
      email: parsed.email || DEVELOPMENT_AUTH_EMAIL,
      displayName: parsed.displayName || DEVELOPMENT_AUTH_DISPLAY_NAME,
    };
  } catch {
    return null;
  }
}

export function readStoredDevelopmentAuthUserId(): string | null {
  return readStoredDevelopmentAuthUser()?.uid ?? null;
}
