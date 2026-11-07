const BASE = 'http://statly.invalid';

// Resolve like the browser will, so `/\host` and tab tricks that browsers read as `//host` are rejected.
// Return the input, not the normalized path: `/..//host` resolves on-site but normalizes to `//host`.
export function toSafeRedirect(url?: string): string | undefined {
  if (!url?.startsWith('/')) return undefined;
  try {
    return new URL(url, BASE).origin === BASE ? url : undefined;
  } catch {
    return undefined;
  }
}

/** Link to `path`, carrying a same-site `next` destination so switching auth pages keeps it. */
export function withSafeNext(path: string, next?: string): string {
  const destination = toSafeRedirect(next);
  return destination ? `${path}?next=${encodeURIComponent(destination)}` : path;
}
