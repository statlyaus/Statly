const DEFAULT_BYPASS_UID = 'statly-dev-tester';
const DEFAULT_BYPASS_EMAIL = 'tester@statly.dev';
const DEFAULT_BYPASS_NAME = 'Statly Dev Tester';

function getEnvBoolean(value: string | undefined): boolean | null {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

const isServer = typeof window === 'undefined';

export function isAuthBypassEnabled(): boolean {
  if (isServer) {
    const explicitServer = getEnvBoolean(process.env.BYPASS_AUTH);
    if (explicitServer !== null) {
      if (process.env.NODE_ENV === 'production' && explicitServer) {
        throw new Error('BYPASS_AUTH must remain disabled in production');
      }
      return explicitServer;
    }

    return process.env.NODE_ENV !== 'production';
  }

  const explicitClient = getEnvBoolean(process.env.NEXT_PUBLIC_BYPASS_AUTH);
  if (explicitClient !== null) return explicitClient;

  return process.env.NODE_ENV !== 'production';
}

export function getBypassUserDetails() {
  const uid = process.env.NEXT_PUBLIC_BYPASS_UID || process.env.BYPASS_UID || DEFAULT_BYPASS_UID;
  const email =
    process.env.NEXT_PUBLIC_BYPASS_EMAIL || process.env.BYPASS_EMAIL || DEFAULT_BYPASS_EMAIL;
  const displayName =
    process.env.NEXT_PUBLIC_BYPASS_NAME || process.env.BYPASS_NAME || DEFAULT_BYPASS_NAME;
  return {
    uid,
    email,
    displayName,
  };
}

export function getBypassUserId(): string {
  return getBypassUserDetails().uid;
}
