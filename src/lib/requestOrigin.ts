function normalizeOrigin(value: string | null | undefined): string | null {
  if (!value) return null;

  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function isSameOriginRequest(request: Request): boolean {
  const requestOrigin = normalizeOrigin(request.url);
  const suppliedOrigin = normalizeOrigin(request.headers.get('origin'));

  if (!requestOrigin || !suppliedOrigin) {
    return false;
  }

  const allowedOrigins = new Set(
    [requestOrigin, process.env.NEXT_PUBLIC_APP_ORIGIN, process.env.APP_URL]
      .map(normalizeOrigin)
      .filter((origin): origin is string => origin !== null)
  );

  return allowedOrigins.has(suppliedOrigin);
}
