// Whether the signed-in user's credential has stopped working: a request was refused with 401 after
// a forced token refresh, or the refresh itself failed. The app shell shows one "sign in again"
// prompt while this is set, and background polls skip their ticks. Kept free of Firebase imports so
// the prompt, the polls and the auth provider can read it cheaply.

// Firebase error codes meaning the session itself has ended. Anything else (offline, a timeout)
// says nothing about the sign-in.
const ENDED_SESSION_ERROR_CODES = new Set([
  'auth/user-token-expired',
  'auth/user-disabled',
  'auth/user-not-found',
  'auth/invalid-user-token',
]);

export function isEndedSessionError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && ENDED_SESSION_ERROR_CODES.has(code);
}

type Listener = () => void;

let expired = false;
const listeners = new Set<Listener>();

function setExpired(next: boolean): void {
  if (expired === next) return;
  expired = next;
  listeners.forEach((listener) => listener());
}

export function reportSignInExpired(): void {
  setExpired(true);
}

/** Called when a credentialed request succeeds, on sign-in and on sign-out. */
export function clearSignInExpired(): void {
  setExpired(false);
}

export function isSignInExpired(): boolean {
  return expired;
}

export function subscribeSignInExpiry(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
