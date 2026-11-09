// A fresh token the server still rejects would bounce between /login and the page forever. `AuthForm`
// records each automatic redirect from /login; being sent back for the same destination within the
// window ends the session instead. The signed-in app shell clears the record when it renders, so only
// a server bounce before the page renders counts as a loop. Storage is best effort throughout.
export const LOGIN_AUTO_REDIRECT_KEY = 'statly:login-auto-redirect';
const LOOP_WINDOW_MS = 10_000;

export function isRepeatLoginAutoRedirect(destination: string): boolean {
  try {
    const last = JSON.parse(window.sessionStorage.getItem(LOGIN_AUTO_REDIRECT_KEY) ?? 'null') as {
      destination?: unknown;
      at?: unknown;
    } | null;
    return (
      last?.destination === destination &&
      typeof last.at === 'number' &&
      Date.now() - last.at < LOOP_WINDOW_MS
    );
  } catch {
    return false;
  }
}

export function recordLoginAutoRedirect(destination: string): void {
  try {
    window.sessionStorage.setItem(
      LOGIN_AUTO_REDIRECT_KEY,
      JSON.stringify({ destination, at: Date.now() })
    );
  } catch {
    // Storage unavailable: the loop guard is best effort.
  }
}

export function clearLoginAutoRedirect(): void {
  try {
    window.sessionStorage.removeItem(LOGIN_AUTO_REDIRECT_KEY);
  } catch {
    // Storage unavailable: the loop guard is best effort.
  }
}
